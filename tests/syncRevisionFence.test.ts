import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyInstallationBackupConflict,
  applyServerTreeRevision,
  buildInstallationBackupTree,
} from '../src/repositories/cloudSyncRepository';
import { buildBackupPayload } from '../src/services/backupMedia';
import type { AppDataStore } from '../src/types';

const timestamp = '2026-08-01T00:00:00.000Z';

function offlineCaptureStore(): AppDataStore {
  return {
    schemaVersion: 3,
    user: {
      id: 'field-user',
      email: 'field@example.test',
      full_name: 'Field User',
      role: 'admin',
    },
    installations: [{
      id: 'offline-installation',
      client_name: 'Client',
      site_name: 'Offline site',
      site_address: 'Address',
      inspector_name: 'Field User',
      audit_date: '2026-08-01',
      status: 'Draft',
      tree_schema_version: 2,
      // Eight offline mutations occurred before the server record existed.
      tree_revision: 8,
      cloud_backup_enabled: true,
      created_at: timestamp,
      updated_at: timestamp,
    }],
    gridSupplies: [],
    zones: [],
    electricalAssets: [],
    siteAssets: [],
    meterDevices: [],
    measurementAssignments: [],
    formSubmissions: [],
    cloudSync: {
      synced_at_by_installation: {},
      force_dirty_installation_ids: ['offline-installation'],
      upload_queue: [],
      thumbnail_queue: [],
    },
  };
}

test('first offline capture advances metadata through confirmations to the exact complete CAS', () => {
  const store = offlineCaptureStore();

  const firstTree = buildInstallationBackupTree(store, store.installations[0]!);
  const metadata = buildBackupPayload(firstTree, [], 'metadata');
  assert.equal(metadata.baseTreeRevision, undefined);
  assert.equal('treeRevision' in metadata.installation, false);

  // Metadata creates server revision 1; two first-time confirmations advance
  // it to 3. Each response is durably applied before the next request.
  applyServerTreeRevision(store, 'offline-installation', 1);
  assert.equal(
    buildInstallationBackupTree(store, store.installations[0]!).baseTreeRevision,
    1,
  );
  applyServerTreeRevision(store, 'offline-installation', 2);
  applyServerTreeRevision(store, 'offline-installation', 3);

  const finalTree = buildInstallationBackupTree(store, store.installations[0]!);
  const complete = buildBackupPayload(finalTree, [], 'complete');
  assert.equal(complete.baseTreeRevision, 3);
  assert.equal('treeRevision' in complete.installation, false);
  assert.equal(complete.syncStage, 'complete');
  assert.equal(store.installations[0]!.tree_revision, 8);
  assert.equal(store.installations[0]!.server_tree_revision, 3);

  // Idempotent confirmation replay may return the same current revision.
  applyServerTreeRevision(store, 'offline-installation', 3);
  assert.equal(store.installations[0]!.server_tree_revision, 3);
  assert.throws(
    () => applyServerTreeRevision(store, 'offline-installation', 2),
    /regressed from 3 to 2/,
  );
});

test('portal conflicts report the persisted server base, not the local mutation counter', () => {
  const store = offlineCaptureStore();
  applyServerTreeRevision(store, 'offline-installation', 4);
  store.installations[0]!.tree_revision = 19;

  applyInstallationBackupConflict(
    store,
    'offline-installation',
    7,
    '2026-08-01T01:00:00.000Z',
  );

  assert.deepEqual(store.installations[0]!.backup_conflict, {
    kind: 'CONFLICT',
    localBaseTreeRevision: 4,
    remoteTreeRevision: 7,
    detectedAt: '2026-08-01T01:00:00.000Z',
  });
  assert.deepEqual(store.cloudSync.force_dirty_installation_ids, ['offline-installation']);
});
