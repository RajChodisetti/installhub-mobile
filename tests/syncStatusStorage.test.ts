import assert from 'node:assert/strict';
import test from 'node:test';
import { lastSyncedAtSecureStoreKey } from '../src/services/syncStatusStorage';

test('last-sync timestamps use stable Expo SecureStore-safe actor keys', () => {
  const sourceManaged = lastSyncedAtSecureStoreKey('unified-field:ecoaudit:raj@users.local');
  const repeated = lastSyncedAtSecureStoreKey('unified-field:ecoaudit:raj@users.local');
  const different = lastSyncedAtSecureStoreKey('unified-field:solarsense:raj@users.local');

  assert.equal(sourceManaged, repeated);
  assert.notEqual(sourceManaged, different);
  assert.match(sourceManaged, /^[A-Za-z0-9._-]+$/);
  assert.doesNotMatch(sourceManaged, /[:@]/);
  assert.throws(() => lastSyncedAtSecureStoreKey('   '), /Actor user ID is required/);
});
