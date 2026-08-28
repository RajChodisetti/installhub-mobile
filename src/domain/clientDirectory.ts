import type {
  ClientAddressSuggestion,
  ClientDirectoryClient,
  ClientDirectorySite,
} from '../api/apiClient';
import { normalizeAustralianAddressText } from './australianAddress';

export interface ClientSuggestionOption extends ClientDirectoryClient {
  /** Null for a client known only from unsynced local installations. */
  canonicalId: string | null;
}

const DEFAULT_MAX_CLIENTS = 100;
const MAX_SITES_PER_CLIENT = 25;

function validSite(value: unknown): value is ClientDirectorySite {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const site = value as Partial<ClientDirectorySite>;
  return typeof site.id === 'string'
    && Boolean(site.id.trim())
    && typeof site.clientId === 'string'
    && typeof site.siteName === 'string'
    && typeof site.displayAddress === 'string'
    && typeof site.fingerprint === 'string'
    && typeof site.updatedAt === 'string';
}

function validClient(value: unknown): value is ClientDirectoryClient {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const client = value as Partial<ClientDirectoryClient>;
  return typeof client.id === 'string'
    && Boolean(client.id.trim())
    && typeof client.name === 'string'
    && typeof client.normalizedKey === 'string'
    && typeof client.updatedAt === 'string'
    && Array.isArray(client.sites);
}

function boundedSites(client: ClientDirectoryClient): ClientDirectoryClient {
  const byId = new Map(client.sites.filter(validSite).map((site) => [site.id, site]));
  return {
    ...client,
    sites: [...byId.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, MAX_SITES_PER_CLIENT),
  };
}

/** Incoming canonical rows win while unrelated cached clients and sites remain available offline. */
export function mergeClientDirectoryClients(
  existing: ClientDirectoryClient[],
  incoming: ClientDirectoryClient[],
  limit = DEFAULT_MAX_CLIENTS,
): ClientDirectoryClient[] {
  const byId = new Map(existing.filter(validClient).map((client) => [client.id, boundedSites(client)]));
  for (const client of incoming.filter(validClient)) {
    const prior = byId.get(client.id);
    byId.set(client.id, boundedSites({
      ...prior,
      ...client,
      sites: [...(prior?.sites ?? []), ...client.sites],
    }));
  }
  return [...byId.values()]
    .sort((left, right) => (
      right.updatedAt.localeCompare(left.updatedAt) || left.name.localeCompare(right.name, 'en-AU')
    ))
    .slice(0, Math.max(1, limit));
}

/** Canonical IDs win, while local-only sites remain usable until their first backup. */
export function mergeClientSuggestionOptions(
  sources: ClientSuggestionOption[][],
): ClientSuggestionOption[] {
  const result = new Map<string, ClientSuggestionOption>();
  for (const clients of sources) {
    for (const client of clients) {
      const matching = [...result.entries()].find(([, candidate]) => (
        (client.canonicalId && candidate.canonicalId === client.canonicalId)
        || (
          candidate.normalizedKey === client.normalizedKey
          && (!client.canonicalId || !candidate.canonicalId)
        )
      ));
      const priorKey = matching?.[0];
      const prior = matching?.[1];
      const canonicalId = client.canonicalId ?? prior?.canonicalId ?? null;
      const key = canonicalId ? `id:${canonicalId}` : `name:${client.normalizedKey}`;
      const sites = new Map((prior?.sites ?? []).map((site) => [site.id, site]));
      client.sites.forEach((site) => sites.set(site.id, site));
      if (priorKey && priorKey !== key) result.delete(priorKey);
      result.set(key, {
        ...prior,
        ...client,
        id: canonicalId ?? client.id,
        canonicalId,
        sites: [...sites.values()].sort((left, right) => (
          right.updatedAt.localeCompare(left.updatedAt)
        )),
      });
    }
  }
  return [...result.values()].sort((left, right) => left.name.localeCompare(right.name, 'en-AU'));
}

function suggestionFromStoredSite(
  client: ClientSuggestionOption,
  site: ClientDirectorySite,
): ClientAddressSuggestion {
  const isLocalSite = site.id.startsWith('local-site:');
  return {
    kind: 'client_saved',
    id: `client_saved:${site.id}`,
    label: site.displayAddress,
    clientId: isLocalSite ? client.canonicalId : (site.clientId || client.canonicalId),
    clientSiteId: isLocalSite ? null : site.id,
    siteName: site.siteName || null,
    address: {
      displayAddress: site.displayAddress,
      locality: site.locality,
      state: site.state,
      postcode: site.postcode,
      countryCode: 'AU',
      latitude: site.latitude,
      longitude: site.longitude,
      provider: site.provider,
      placeId: site.placeId,
      source: 'client_saved',
      geocodingStatus: site.geocodingStatus,
      fingerprint: site.fingerprint,
    },
  };
}

function storedSiteMatches(site: ClientDirectorySite, query: string, postcode?: string): boolean {
  const normalized = normalizeAustralianAddressText(query);
  return !normalized
    || normalizeAustralianAddressText(site.displayAddress).includes(normalized)
    || normalizeAustralianAddressText(site.siteName).includes(normalized)
    || Boolean(postcode && site.postcode === postcode);
}

export function savedAddressSuggestions(
  client: ClientSuggestionOption | null,
  query: string,
  postcode?: string,
  limit = 8,
): ClientAddressSuggestion[] {
  if (!client) return [];
  return client.sites
    .filter((site) => storedSiteMatches(site, query, postcode))
    .slice(0, limit)
    .map((site) => suggestionFromStoredSite(client, site));
}

export function savedFirstSuggestions(
  stored: ClientAddressSuggestion[],
  provider: ClientAddressSuggestion[],
): ClientAddressSuggestion[] {
  const all = [...stored, ...provider];
  const savedFingerprints = new Set(
    all
      .filter((suggestion) => suggestion.kind === 'client_saved')
      .map((suggestion) => suggestion.address.fingerprint.trim())
      .filter(Boolean),
  );
  const savedIdentities = new Set<string>();
  const saved = all.filter((suggestion) => {
    if (suggestion.kind !== 'client_saved') return false;
    const identity = suggestion.clientSiteId?.trim() || suggestion.id.trim();
    if (savedIdentities.has(identity)) return false;
    savedIdentities.add(identity);
    return true;
  });
  const providerFingerprints = new Set<string>();
  const providerIdentities = new Set<string>();
  const providerOnly = all.filter((suggestion) => {
    if (suggestion.kind !== 'provider') return false;
    const fingerprint = suggestion.address.fingerprint.trim();
    if (fingerprint) {
      if (savedFingerprints.has(fingerprint) || providerFingerprints.has(fingerprint)) return false;
      providerFingerprints.add(fingerprint);
      return true;
    }
    const identity = suggestion.id.trim();
    if (providerIdentities.has(identity)) return false;
    providerIdentities.add(identity);
    return true;
  });
  return [...saved, ...providerOnly];
}

export function groupSavedFirstSuggestions(
  stored: ClientAddressSuggestion[],
  provider: ClientAddressSuggestion[],
): {
  storedSuggestions: ClientAddressSuggestion[];
  providerSuggestions: ClientAddressSuggestion[];
  suggestions: ClientAddressSuggestion[];
} {
  const suggestions = savedFirstSuggestions(stored, provider);
  return {
    storedSuggestions: suggestions.filter((suggestion) => suggestion.kind === 'client_saved'),
    providerSuggestions: suggestions.filter((suggestion) => suggestion.kind === 'provider'),
    suggestions,
  };
}
