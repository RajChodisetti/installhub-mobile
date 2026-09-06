import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCanonicalStore } from '../src/domain/installationV2';
import { buildInstallationBackupSelection } from '../src/repositories/cloudSyncRepository';
import { acquireInstallationRecovery } from '../src/services/installationRecoveryFence';
import { assignedWorkServerMetadataFromInstallation } from '../src/services/assignedWorkPolicy';
import { backupOutcomeMessage, shouldRecordConfirmedBackup, type BackupInstallationOutcome } from '../src/services/backupOutcome';
import { lastConfirmedBackupAtSecureStoreKey, lastSyncedAtSecureStoreKey } from '../src/services/syncStatusStorage';
import type { AppDataStore, Installation } from '../src/types';

const stamp = '2026-09-05T10:00:00.000Z';
function fixture(): AppDataStore {
  return normalizeCanonicalStore({
    schemaVersion: 3,
    user: { id: 'actor', email: 'actor@example.test', full_name: 'Actor', role: 'admin' },
    installations: [{ id: 'job', client_name: 'Client', site_name: 'Site', site_address: '', inspector_name: '', audit_date: '',
      status: 'Draft', cloud_backup_enabled: true, local_owner_user_id: 'actor', assigned_work_state: 'none',
      created_at: stamp, updated_at: stamp, tree_schema_version: 2, tree_revision: 7, server_tree_revision: 4 }],
    gridSupplies: [], zones: [], electricalAssets: [], siteAssets: [], meterDevices: [], measurementAssignments: [], formSubmissions: [],
    cloudSync: { synced_at_by_installation: {}, force_dirty_installation_ids: [], upload_queue: [], thumbnail_queue: [] },
  });
}
function add(store: AppDataStore, id: string, patch: Partial<Installation> = {}) {
  store.installations.push({ ...structuredClone(store.installations[0]!), id, ...patch });
}
const zero: BackupInstallationOutcome = { selected: 0, confirmed: 0, alreadyCurrent: 0, deferred: 0, remaining: 0 };

test('selection excludes opt-outs and foreign/withdrawn records without reporting them as deferred', () => {
  const store = fixture();
  store.installations[0]!.cloud_backup_enabled = false;
  add(store, 'foreign', { cloud_backup_enabled: true, local_owner_user_id: 'other' });
  add(store, 'withdrawn', { cloud_backup_enabled: true, assigned_work_state: 'inactive', assigned_work_actor_user_id: 'actor' });
  add(store, 'different-assignee', { cloud_backup_enabled: true, assigned_work_state: 'active', assigned_work_actor_user_id: 'other' });
  const before = structuredClone(store);
  assert.deepEqual(buildInstallationBackupSelection(store, 'actor'), {
    trees: [], visibleInstallationIds: ['job'], optedInInstallationIds: [],
    alreadyCurrentInstallationIds: [], deferredInstallationIds: [],
  });
  assert.deepEqual(buildInstallationBackupSelection(store, 'nobody').visibleInstallationIds, []);
  assert.deepEqual(store, before);
});

test('conflicted opted-in record is deferred while the clean and dirty records remain distinct', () => {
  const store = fixture();
  add(store, 'clean'); add(store, 'paused');
  store.cloudSync.synced_at_by_installation.clean = stamp;
  const base = assignedWorkServerMetadataFromInstallation(store.installations[2]!);
  store.installations[2]!.assigned_work_refresh_conflict = {
    base, incoming: structuredClone(base), local_base_tree_revision: 4, remote_tree_revision: 5,
    conflicting_fields: [], remote_tree_changed: true, incoming_tree_fingerprint: 'changed', detected_at: stamp,
  };
  const selection = buildInstallationBackupSelection(store, 'actor');
  assert.deepEqual(selection.trees.map((tree) => tree.installation.id), ['job']);
  assert.deepEqual(selection.alreadyCurrentInstallationIds, ['clean']);
  assert.deepEqual(selection.deferredInstallationIds, ['paused']);
  assert.equal(store.installations[2]!.cloud_backup_enabled, true);
  assert.ok(store.installations[2]!.assigned_work_refresh_conflict);
});

test('exclusive recovery defers an actor-visible opted-in record without releasing its fence', () => {
  const store = fixture();
  const recovery = acquireInstallationRecovery('job');
  try {
    const selection = buildInstallationBackupSelection(store, 'actor');
    assert.deepEqual(selection.deferredInstallationIds, ['job']);
    assert.equal(selection.trees.length, 0);
    assert.doesNotThrow(() => recovery.assertCurrent());
  } finally { recovery.release(); }
  assert.equal(buildInstallationBackupSelection(store, 'actor').trees.length, 1);
});

test('selection retains existing forced-dirty, pending-confirmation and child-watermark criteria', () => {
  const store = fixture();
  add(store, 'forced'); add(store, 'pending'); add(store, 'changed-child');
  for (const installation of store.installations) store.cloudSync.synced_at_by_installation[installation.id] = stamp;
  store.cloudSync.force_dirty_installation_ids = ['forced'];
  store.cloudSync.pending_complete_attempts = { pending: {} as never };
  store.zones.push({ id: 'zone', audit_id: 'changed-child', zone_name: 'Zone', zone_description: '', photos: [],
    created_at: stamp, updated_at: '2026-09-05T11:00:00.000Z' });
  const selection = buildInstallationBackupSelection(store, 'actor');
  assert.deepEqual(selection.trees.map((tree) => tree.installation.id), ['forced', 'pending', 'changed-child']);
  assert.deepEqual(selection.alreadyCurrentInstallationIds, ['job']);
});

test('only a confirmed final run with no remaining or deferred work advances the confirmed-backup timestamp', () => {
  assert.equal(shouldRecordConfirmedBackup({ phase: 'done' }), false);
  assert.equal(shouldRecordConfirmedBackup({ phase: 'done', installationOutcome: zero }), false);
  assert.equal(shouldRecordConfirmedBackup({ phase: 'done', installationOutcome: { ...zero, alreadyCurrent: 3 } }), false);
  for (const phase of ['idle', 'preparing', 'pushing', 'uploading', 'error', 'offline']) {
    assert.equal(shouldRecordConfirmedBackup({ phase, installationOutcome: { ...zero, selected: 1, confirmed: 1 } }), false);
  }
  assert.equal(shouldRecordConfirmedBackup({ phase: 'done', installationOutcome: { ...zero, selected: 2, confirmed: 1, deferred: 1, remaining: 1 } }), false);
  assert.equal(shouldRecordConfirmedBackup({ phase: 'done', installationOutcome: { ...zero, selected: 1, confirmed: 1, remaining: 1 } }), false);
  assert.equal(shouldRecordConfirmedBackup({ phase: 'done', installationOutcome: { ...zero, selected: 1, confirmed: 1 } }), true);
});

test('legacy check timestamps and confirmed backup timestamps are distinct, actor-scoped keys', () => {
  const actor = 'source:actor@example.test';
  const confirmed = lastConfirmedBackupAtSecureStoreKey(actor);
  assert.notEqual(confirmed, lastSyncedAtSecureStoreKey(actor));
  assert.notEqual(confirmed, lastConfirmedBackupAtSecureStoreKey('other'));
  assert.equal(confirmed, lastConfirmedBackupAtSecureStoreKey(actor));
  assert.ok(!confirmed.includes(actor));
  assert.throws(() => lastConfirmedBackupAtSecureStoreKey('  '), /Actor user ID/);
});

test('user-facing outcomes distinguish no upload, already current, mixed deferral and unavailable proof', () => {
  assert.match(backupOutcomeMessage(zero).message, /No installations uploaded/);
  assert.match(backupOutcomeMessage({ ...zero, selected: 1 }).message, /No installation backups confirmed/);
  assert.match(backupOutcomeMessage({ ...zero, alreadyCurrent: 2 }).message, /2 installations already up to date/);
  const mixed = backupOutcomeMessage({ selected: 2, confirmed: 1, alreadyCurrent: 0, deferred: 1, remaining: 1 });
  assert.equal(mixed.needsAttention, true);
  assert.match(mixed.message, /1 installation backed up and confirmed/);
  assert.match(mixed.message, /1 installation still needs backup/);
  assert.match(mixed.message, /paused/);
  assert.match(backupOutcomeMessage().message, /unavailable/);
  assert.doesNotMatch(backupOutcomeMessage().message, /up to date|confirmed/);
});
