import AsyncStorage from '@react-native-async-storage/async-storage';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ClientDirectoryClient, ClientDirectorySite } from '../src/api/apiClient';
import {
  CLIENT_DIRECTORY_CACHE_TTL_MS,
  mergeClientDirectoryCache,
  readClientDirectoryCache,
} from '../src/repositories/clientDirectoryCacheRepository';

const site = (clientId: string, id: string): ClientDirectorySite => ({
  id,
  clientId,
  siteName: id,
  displayAddress: `${id} Example Road, Sydney NSW 2000`,
  locality: 'Sydney',
  state: 'NSW',
  postcode: '2000',
  countryCode: 'AU',
  latitude: null,
  longitude: null,
  provider: null,
  placeId: null,
  source: 'manual',
  geocodingStatus: 'unresolved',
  fingerprint: id.padEnd(64, 'a').slice(0, 64),
  timezone: 'Australia/Sydney',
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  accessInformation: null,
  updatedAt: '2026-08-27T00:00:00.000Z',
});

const client = (
  id: string,
  sites: ClientDirectorySite[] = [site(id, `${id}-site`)],
): ClientDirectoryClient => ({
  id,
  name: `Client ${id}`,
  normalizedKey: `client ${id}`,
  contactName: null,
  contactPhone: null,
  contactEmail: null,
  updatedAt: '2026-08-27T00:00:00.000Z',
  sites,
});

test('actor cache expires retained clients and sites independently while enforcing bounds', async () => {
  const values = new Map<string, string>();
  const originalGetItem = AsyncStorage.getItem;
  const originalSetItem = AsyncStorage.setItem;
  AsyncStorage.getItem = async (key) => values.get(key) ?? null;
  AsyncStorage.setItem = async (key, value) => {
    values.set(key, value);
  };

  try {
    const firstSeen = Date.parse('2026-08-27T00:00:00.000Z');
    const refreshed = firstSeen + 24 * 60 * 60 * 1000;
    const afterFirstExpiry = firstSeen + CLIENT_DIRECTORY_CACHE_TTL_MS + 1;
    const mainSites = [site('client-main', 'site-current'), site('client-main', 'site-stale')];

    await mergeClientDirectoryCache(
      'actor-a',
      [client('client-main', mainSites), client('client-stale')],
      firstSeen,
    );
    await mergeClientDirectoryCache('actor-b', [client('client-b')], firstSeen);

    assert.deepEqual(
      (await readClientDirectoryCache('actor-a', refreshed)).map((item) => item.id).sort(),
      ['client-main', 'client-stale'],
    );
    assert.deepEqual(
      (await readClientDirectoryCache('actor-b', refreshed)).map((item) => item.id),
      ['client-b'],
    );

    await mergeClientDirectoryCache(
      'actor-a',
      [client('client-main', [site('client-main', 'site-current')])],
      refreshed,
    );
    const surviving = await readClientDirectoryCache('actor-a', afterFirstExpiry);
    assert.deepEqual(surviving.map((item) => item.id), ['client-main']);
    assert.deepEqual(surviving[0]?.sites.map((item) => item.id), ['site-current']);
    assert.deepEqual(await readClientDirectoryCache('actor-b', afterFirstExpiry), []);

    const oversized = Array.from({ length: 105 }, (_, index) => client(
      `bounded-${index.toString().padStart(3, '0')}`,
      Array.from({ length: 30 }, (__, siteIndex) => site(
        `bounded-${index.toString().padStart(3, '0')}`,
        `site-${siteIndex.toString().padStart(2, '0')}`,
      )),
    ));
    await mergeClientDirectoryCache('actor-bounds', oversized, firstSeen);
    const bounded = await readClientDirectoryCache('actor-bounds', firstSeen);
    assert.equal(bounded.length, 100);
    assert.ok(bounded.every((item) => item.sites.length === 25));
  } finally {
    AsyncStorage.getItem = originalGetItem;
    AsyncStorage.setItem = originalSetItem;
  }
});
