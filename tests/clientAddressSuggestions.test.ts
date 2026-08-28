import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  ClientAddressSuggestion,
  ClientDirectoryClient,
  ClientDirectorySite,
} from '../src/api/apiClient';
import {
  groupSavedFirstSuggestions,
  mergeClientDirectoryClients,
  mergeClientSuggestionOptions,
  savedAddressSuggestions,
  savedFirstSuggestions,
  type ClientSuggestionOption,
} from '../src/domain/clientDirectory';

const site = (overrides: Partial<ClientDirectorySite> = {}): ClientDirectorySite => ({
  id: 'site-1',
  clientId: 'client-1',
  siteName: 'Sydney Warehouse',
  displayAddress: '1 Example Road, Sydney NSW 2000',
  locality: 'Sydney',
  state: 'NSW',
  postcode: '2000',
  countryCode: 'AU',
  latitude: -33.8688,
  longitude: 151.2093,
  provider: 'geoapify',
  placeId: 'place-1',
  source: 'suggested',
  geocodingStatus: 'resolved',
  fingerprint: 'a'.repeat(64),
  timezone: 'Australia/Sydney',
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  accessInformation: null,
  updatedAt: '2026-08-27T01:00:00.000Z',
  ...overrides,
});

const client = (overrides: Partial<ClientDirectoryClient> = {}): ClientDirectoryClient => ({
  id: 'client-1',
  name: 'ABC Energy',
  normalizedKey: 'abc energy',
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  updatedAt: '2026-08-27T01:00:00.000Z',
  sites: [site()],
  ...overrides,
});

test('bounded directory cache merges canonical clients and preserves unrelated sites', () => {
  const merged = mergeClientDirectoryClients([
    client({ sites: [site(), site({ id: 'site-2', displayAddress: '2 Old Road' })] }),
  ], [
    client({ updatedAt: '2026-08-27T02:00:00.000Z', sites: [site({ displayAddress: '1 Canonical Road' })] }),
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.sites.length, 2);
  assert.equal(merged[0]?.sites.find((item) => item.id === 'site-1')?.displayAddress, '1 Canonical Road');
});

test('canonical client identity wins over a case-equivalent local-only option', () => {
  const local: ClientSuggestionOption = {
    ...client({ id: 'local-client:abc-energy', name: 'abc energy' }),
    canonicalId: null,
  };
  const canonical: ClientSuggestionOption = { ...client(), canonicalId: 'client-1' };
  const merged = mergeClientSuggestionOptions([[local], [canonical]]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.canonicalId, 'client-1');
  assert.equal(merged[0]?.name, 'ABC Energy');
});

test('distinct canonical client IDs never merge or relabel each others saved sites by name', () => {
  const first: ClientSuggestionOption = {
    ...client({
      id: 'client-1',
      sites: [site({ id: 'site-1', clientId: 'client-1' })],
    }),
    canonicalId: 'client-1',
  };
  const second: ClientSuggestionOption = {
    ...client({
      id: 'client-2',
      sites: [site({ id: 'site-2', clientId: 'client-2' })],
    }),
    canonicalId: 'client-2',
  };

  const merged = mergeClientSuggestionOptions([[first, second]]);

  assert.deepEqual(merged.map((item) => item.canonicalId).sort(), ['client-1', 'client-2']);
  assert.deepEqual(
    merged.flatMap((item) => savedAddressSuggestions(item, '')
      .map((suggestion) => [suggestion.clientId, suggestion.clientSiteId])),
    [['client-1', 'site-1'], ['client-2', 'site-2']],
  );
});

test('saved client addresses are emitted as client_saved and filter by site details', () => {
  const option: ClientSuggestionOption = { ...client(), canonicalId: 'client-1' };
  const suggestions = savedAddressSuggestions(option, 'warehouse');
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0]?.kind, 'client_saved');
  assert.equal(suggestions[0]?.clientId, 'client-1');
  assert.equal(suggestions[0]?.clientSiteId, 'site-1');
  assert.equal(suggestions[0]?.address.source, 'client_saved');
});

test('mixed suggestions keep saved addresses first and remove provider duplicates', () => {
  const stored = savedAddressSuggestions({ ...client(), canonicalId: 'client-1' }, '');
  const provider: ClientAddressSuggestion[] = [{
    ...stored[0]!,
    id: 'provider-duplicate',
    kind: 'provider',
    clientId: null,
    clientSiteId: null,
  }, {
    ...stored[0]!,
    id: 'provider-new',
    kind: 'provider',
    label: '3 New Road',
    clientId: null,
    clientSiteId: null,
    address: { ...stored[0]!.address, fingerprint: 'b'.repeat(64) },
  }];
  const mixed = savedFirstSuggestions(stored, provider);
  assert.deepEqual(mixed.map((item) => item.id), ['client_saved:site-1', 'provider-new']);
});

test('saved-site identity survives a shared fingerprint while local saved rows suppress providers', () => {
  const first = savedAddressSuggestions({ ...client(), canonicalId: 'client-1' }, '')[0]!;
  const second: ClientAddressSuggestion = {
    ...first,
    id: 'client_saved:site-2',
    clientSiteId: 'site-2',
    siteName: 'Sydney Warehouse - Loading Dock',
  };
  const repeatedFirst = { ...first, id: 'server-alias-for-site-1' };
  const localSaved: ClientAddressSuggestion = {
    ...first,
    id: 'client_saved:local-site:installation-1',
    clientSiteId: null,
    siteName: 'Unsynced local site',
    address: { ...first.address, fingerprint: 'c'.repeat(64) },
  };
  const duplicateLocalProvider: ClientAddressSuggestion = {
    ...localSaved,
    kind: 'provider',
    id: 'provider-local-duplicate',
    clientId: null,
  };
  const newProvider: ClientAddressSuggestion = {
    ...duplicateLocalProvider,
    id: 'provider-new',
    address: { ...duplicateLocalProvider.address, fingerprint: 'd'.repeat(64) },
  };

  const grouped = groupSavedFirstSuggestions(
    [first, second],
    [repeatedFirst, localSaved, duplicateLocalProvider, newProvider, { ...newProvider, id: 'provider-new-alias' }],
  );

  assert.deepEqual(
    grouped.suggestions.map((item) => [item.kind, item.clientSiteId, item.id]),
    [
      ['client_saved', 'site-1', 'client_saved:site-1'],
      ['client_saved', 'site-2', 'client_saved:site-2'],
      ['client_saved', null, 'client_saved:local-site:installation-1'],
      ['provider', null, 'provider-new'],
    ],
  );
  assert.deepEqual(grouped.providerSuggestions.map((item) => item.id), ['provider-new']);
});
