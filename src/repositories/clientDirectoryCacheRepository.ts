import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ClientDirectoryClient } from '../api/apiClient';
import { mergeClientDirectoryClients } from '../domain/clientDirectory';

const CACHE_PREFIX = 'installhub.client-address-directory.v1';
const CACHE_VERSION = 2 as const;
const MAX_CLIENTS = 100;
export const CLIENT_DIRECTORY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type ClientDirectoryCacheDocument = {
  version: typeof CACHE_VERSION;
  actorUserId: string;
  clients: ClientDirectoryClient[];
  clientCachedAt: Record<string, string>;
  siteCachedAt: Record<string, string>;
};

function cacheKey(actorUserId: string): string {
  if (!actorUserId.trim()) throw new Error('Client-directory cache requires an actor.');
  return `${CACHE_PREFIX}:${encodeURIComponent(actorUserId)}`;
}

function siteTimestampKey(clientId: string, siteId: string): string {
  return `${clientId}\u001f${siteId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function timestampValue(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

function isFresh(value: string | null, now: number): value is string {
  if (!value) return false;
  const age = now - Date.parse(value);
  return age >= 0 && age <= CLIENT_DIRECTORY_CACHE_TTL_MS;
}

function parseCacheDocument(
  raw: string,
  actorUserId: string,
  now: number,
): ClientDirectoryCacheDocument | null {
  const parsed: unknown = JSON.parse(raw);
  if (
    !isRecord(parsed)
    || parsed.version !== CACHE_VERSION
    || parsed.actorUserId !== actorUserId
    || !Array.isArray(parsed.clients)
    || !isRecord(parsed.clientCachedAt)
    || !isRecord(parsed.siteCachedAt)
  ) return null;

  const parsedClientCachedAt = parsed.clientCachedAt;
  const parsedSiteCachedAt = parsed.siteCachedAt;
  const candidates: ClientDirectoryClient[] = [];
  for (const value of parsed.clients) {
    if (!isRecord(value) || typeof value.id !== 'string') continue;
    const clientCachedAt = timestampValue(parsedClientCachedAt[value.id]);
    if (!isFresh(clientCachedAt, now)) continue;
    const sites = Array.isArray(value.sites)
      ? value.sites.filter((site) => {
          if (!isRecord(site) || typeof site.id !== 'string') return false;
          return isFresh(
            timestampValue(parsedSiteCachedAt[siteTimestampKey(value.id as string, site.id)]),
            now,
          );
        })
      : [];
    candidates.push({ ...value, sites } as unknown as ClientDirectoryClient);
  }

  const clients = mergeClientDirectoryClients([], candidates, MAX_CLIENTS);
  const clientCachedAt: Record<string, string> = {};
  const siteCachedAt: Record<string, string> = {};
  for (const client of clients) {
    clientCachedAt[client.id] = timestampValue(parsedClientCachedAt[client.id])!;
    for (const site of client.sites) {
      const key = siteTimestampKey(client.id, site.id);
      siteCachedAt[key] = timestampValue(parsedSiteCachedAt[key])!;
    }
  }
  return {
    version: CACHE_VERSION,
    actorUserId,
    clients,
    clientCachedAt,
    siteCachedAt,
  };
}

async function readCacheDocument(
  actorUserId: string,
  now: number,
): Promise<ClientDirectoryCacheDocument | null> {
  const raw = await AsyncStorage.getItem(cacheKey(actorUserId)).catch(() => null);
  if (!raw) return null;
  try {
    return parseCacheDocument(raw, actorUserId, now);
  } catch {
    return null;
  }
}

export async function readClientDirectoryCache(
  actorUserId: string,
  now = Date.now(),
): Promise<ClientDirectoryClient[]> {
  return (await readCacheDocument(actorUserId, now))?.clients ?? [];
}

export async function mergeClientDirectoryCache(
  actorUserId: string,
  incoming: ClientDirectoryClient[],
  now = Date.now(),
): Promise<ClientDirectoryClient[]> {
  const existingDocument = await readCacheDocument(actorUserId, now);
  const existing = existingDocument?.clients ?? [];
  const canonicalIncoming = mergeClientDirectoryClients(
    [],
    incoming,
    Math.max(1, incoming.length),
  );
  const incomingById = new Map(canonicalIncoming.map((client) => [client.id, client]));
  const merged = mergeClientDirectoryClients(
    existing,
    canonicalIncoming,
    Math.max(MAX_CLIENTS, existing.length + canonicalIncoming.length),
  );
  const refreshedAt = new Date(now).toISOString();
  const clientCachedAt: Record<string, string> = {};
  const siteCachedAt: Record<string, string> = {};
  const clients = merged.flatMap((client): ClientDirectoryClient[] => {
    const incomingClient = incomingById.get(client.id);
    const clientTimestamp = incomingClient
      ? refreshedAt
      : existingDocument?.clientCachedAt[client.id];
    if (!clientTimestamp) return [];
    clientCachedAt[client.id] = clientTimestamp;
    const incomingSiteIds = new Set(incomingClient?.sites.map((site) => site.id) ?? []);
    const sites = client.sites.filter((site) => {
      const key = siteTimestampKey(client.id, site.id);
      const siteTimestamp = incomingSiteIds.has(site.id)
        ? refreshedAt
        : existingDocument?.siteCachedAt[key];
      if (!siteTimestamp) return false;
      siteCachedAt[key] = siteTimestamp;
      return true;
    });
    return [{ ...client, sites }];
  }).sort((left, right) => (
    clientCachedAt[right.id]!.localeCompare(clientCachedAt[left.id]!)
    || right.updatedAt.localeCompare(left.updatedAt)
  )).slice(0, MAX_CLIENTS);

  const retainedClientIds = new Set(clients.map((client) => client.id));
  for (const clientId of Object.keys(clientCachedAt)) {
    if (!retainedClientIds.has(clientId)) delete clientCachedAt[clientId];
  }
  const retainedSiteKeys = new Set(
    clients.flatMap((client) => client.sites.map((site) => siteTimestampKey(client.id, site.id))),
  );
  for (const key of Object.keys(siteCachedAt)) {
    if (!retainedSiteKeys.has(key)) delete siteCachedAt[key];
  }

  const document: ClientDirectoryCacheDocument = {
    version: CACHE_VERSION,
    actorUserId,
    clients,
    clientCachedAt,
    siteCachedAt,
  };
  // Suggestions must remain usable when the cache cannot be persisted (for
  // example, storage pressure). The network response still belongs to this
  // actor and can safely be returned for the current interaction.
  await AsyncStorage.setItem(cacheKey(actorUserId), JSON.stringify(document)).catch(() => undefined);
  return clients;
}
