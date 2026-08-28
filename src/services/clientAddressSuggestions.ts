import {
  apiClient,
  captureCloudSessionAuthority,
  type ClientAddressSuggestion,
  type ClientDirectoryClient,
  type ClientDirectorySite,
} from '../api/apiClient';
import {
  australianAddressFromInstallation,
  normalizeClientNameKey,
} from '../domain/australianAddress';
import {
  groupSavedFirstSuggestions,
  mergeClientSuggestionOptions,
  savedAddressSuggestions,
  savedFirstSuggestions,
  type ClientSuggestionOption,
} from '../domain/clientDirectory';
import { installationsRepo } from '../repositories';
import {
  mergeClientDirectoryCache,
  readClientDirectoryCache,
} from '../repositories/clientDirectoryCacheRepository';

export {
  groupSavedFirstSuggestions,
  mergeClientSuggestionOptions,
  savedAddressSuggestions,
  savedFirstSuggestions,
};
export type { ClientSuggestionOption };

export type ClientSuggestionResult = {
  clients: ClientSuggestionOption[];
  remoteAvailable: boolean;
};

export type AddressSuggestionResult = {
  storedSuggestions: ClientAddressSuggestion[];
  providerSuggestions: ClientAddressSuggestion[];
  suggestions: ClientAddressSuggestion[];
  providerAvailable: boolean;
  attribution: string | null;
};

function localClientsFromInstallations(
  installations: Awaited<ReturnType<typeof installationsRepo.list>>,
): ClientSuggestionOption[] {
  const byKey = new Map<string, ClientSuggestionOption>();
  for (const installation of installations) {
    const normalizedKey = normalizeClientNameKey(installation.client_name);
    if (!normalizedKey) continue;
    const canonicalId = installation.client_id?.trim() || null;
    const identity = canonicalId ? `id:${canonicalId}` : `name:${normalizedKey}`;
    const address = australianAddressFromInstallation(installation);
    const site: ClientDirectorySite = {
      id: installation.client_site_id?.trim() || `local-site:${installation.id}`,
      clientId: canonicalId ?? `local-client:${normalizedKey}`,
      siteName: installation.site_name,
      displayAddress: address.display_address,
      locality: address.locality,
      state: address.state,
      postcode: address.postcode,
      countryCode: 'AU',
      latitude: address.latitude,
      longitude: address.longitude,
      provider: address.provider,
      placeId: address.place_id,
      source: address.source,
      geocodingStatus: address.geocoding_status,
      fingerprint: address.fingerprint,
      timezone: installation.timezone ?? null,
      contactName: installation.site_contact_name ?? null,
      contactPhone: installation.site_contact_phone ?? null,
      contactEmail: installation.site_contact_email ?? null,
      accessInformation: installation.access_information ?? null,
      updatedAt: installation.updated_at,
    };
    const existing = byKey.get(identity);
    byKey.set(identity, {
      id: canonicalId ?? `local-client:${normalizedKey}`,
      canonicalId,
      name: installation.client_name,
      normalizedKey,
      contactName: existing?.contactName ?? null,
      contactPhone: existing?.contactPhone ?? null,
      contactEmail: existing?.contactEmail ?? null,
      updatedAt: existing?.updatedAt && existing.updatedAt > installation.updated_at
        ? existing.updatedAt
        : installation.updated_at,
      sites: [
        ...(existing?.sites ?? []).filter((item) => item.id !== site.id),
        site,
      ],
    });
  }
  return [...byKey.values()];
}

function optionFromCanonical(client: ClientDirectoryClient): ClientSuggestionOption {
  return { ...client, canonicalId: client.id };
}

function matchesClient(client: ClientSuggestionOption, query: string): boolean {
  const normalized = normalizeClientNameKey(query);
  return !normalized
    || client.normalizedKey.includes(normalized)
    || normalizeClientNameKey(client.name).includes(normalized);
}

export async function loadClientSuggestions(input: {
  actorUserId: string;
  query: string;
  signal?: AbortSignal;
  limit?: number;
}): Promise<ClientSuggestionResult> {
  const limit = Math.min(20, Math.max(1, input.limit ?? 8));
  const [installations, cached] = await Promise.all([
    installationsRepo.list(),
    readClientDirectoryCache(input.actorUserId),
  ]);
  const local = localClientsFromInstallations(
    installations.filter((installation) => (
      installation.local_owner_user_id === input.actorUserId
    )),
  );
  const cachedOptions = cached.map(optionFromCanonical);
  let combined = mergeClientSuggestionOptions([local, cachedOptions]);
  const authority = await captureCloudSessionAuthority();
  if (!authority || authority.actorUserId !== input.actorUserId) {
    return { clients: combined.filter((client) => matchesClient(client, input.query)).slice(0, limit), remoteAvailable: false };
  }
  try {
    const response = await apiClient.listClientDirectory({
      q: input.query.trim() || undefined,
      limit,
    }, input.signal, authority);
    const canonical = await mergeClientDirectoryCache(input.actorUserId, response.clients);
    combined = mergeClientSuggestionOptions([local, canonical.map(optionFromCanonical)]);
    return { clients: combined.filter((client) => matchesClient(client, input.query)).slice(0, limit), remoteAvailable: true };
  } catch {
    return { clients: combined.filter((client) => matchesClient(client, input.query)).slice(0, limit), remoteAvailable: false };
  }
}

export async function loadAddressSuggestions(input: {
  actorUserId: string;
  client: ClientSuggestionOption | null;
  query: string;
  postcode?: string;
  signal?: AbortSignal;
  limit?: number;
}): Promise<AddressSuggestionResult> {
  const limit = Math.min(10, Math.max(1, input.limit ?? 8));
  const localStored = savedAddressSuggestions(input.client, input.query, input.postcode, limit);
  const authority = await captureCloudSessionAuthority();
  if (!authority || authority.actorUserId !== input.actorUserId) {
    return {
      storedSuggestions: localStored,
      providerSuggestions: [],
      suggestions: localStored,
      providerAvailable: false,
      attribution: null,
    };
  }
  try {
    const response = await apiClient.suggestClientAddresses({
      ...(input.client?.canonicalId ? { clientId: input.client.canonicalId } : {}),
      query: input.query.trim(),
      ...(input.postcode ? { postcode: input.postcode } : {}),
      limit,
    }, input.signal, authority);
    const grouped = groupSavedFirstSuggestions(
      [...response.storedSuggestions, ...localStored],
      response.providerSuggestions,
    );
    return {
      ...grouped,
      providerAvailable: response.available,
      attribution: response.attribution,
    };
  } catch {
    return {
      storedSuggestions: localStored,
      providerSuggestions: [],
      suggestions: localStored,
      providerAvailable: false,
      attribution: null,
    };
  }
}
