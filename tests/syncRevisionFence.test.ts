import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAcceptedCompleteBackupAttempt,
  applyDiscardCompleteBackupAttempt,
  applyInstallationBackupConflict,
  applyPreparedCompleteBackupAttempt,
  applyServerTreeRevision,
  buildInstallationBackupTree,
} from '../src/repositories/cloudSyncRepository';
import { buildBackupPayload } from '../src/services/backupMedia';
import { confirmCompleteBackupAttempt } from '../src/services/completeBackupConfirmation';
import { bumpTreeRevision } from '../src/domain/installationV2';
import { confirmedUploadTreeRevision } from '../src/services/uploadConfirmationRevision';
import {
  isDefinitivelyUnconfirmedUploadConfirmationError,
  recoverUploadConfirmation,
} from '../src/services/uploadConfirmationRecovery';
import { createSingleFlightProgressRunner } from '../src/services/singleFlightProgress';
import type { CloudUploadQueueItem } from '../src/types';
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

test('lost upload response recovers the exact confirmed revision before final push', () => {
  const store = offlineCaptureStore();
  applyServerTreeRevision(store, 'offline-installation', 1);

  // A confirmation committed revision 2, but its first response was lost.
  // check-photo/create-session retry returns the immutable row revision.
  applyServerTreeRevision(
    store,
    'offline-installation',
    confirmedUploadTreeRevision(2),
  );

  const finalTree = buildInstallationBackupTree(store, store.installations[0]!);
  assert.equal(buildBackupPayload(finalTree, [], 'complete').baseTreeRevision, 2);
  assert.throws(
    () => confirmedUploadTreeRevision(undefined),
    /missing its authoritative tree revision/,
  );
});

test('fresh backup run confirms an interrupted upload before metadata uses its base', async () => {
  const store = offlineCaptureStore();
  applyServerTreeRevision(store, 'offline-installation', 1);
  const row: CloudUploadQueueItem = {
    id: 'upload-1',
    installation_id: 'offline-installation',
    entity_type: 'zone',
    entity_id: 'zone-1',
    field_name: 'photos[0]',
    local_uri: 'file:///evidence.jpg',
    mime_type: 'image/jpeg',
    status: 'pending',
    attempts: 1,
    checksum: 'checksum-1',
    session_id: 'session-1',
    updated_at: timestamp,
  };
  let cleared = false;
  const recovered = await recoverUploadConfirmation(row, {
    confirm: async () => ({ remoteUrl: 'https://api.test/evidence.jpg', treeRevision: 2 }),
    recordRevision: async (installationId, revision) => {
      applyServerTreeRevision(store, installationId, revision);
    },
    markComplete: async () => { cleared = true; },
    resetUnconfirmed: async () => { assert.fail('committed confirmation must not reset'); },
    isProvenUnconfirmed: () => false,
  });

  assert.equal(recovered, true);
  assert.equal(cleared, true);
  const refreshedTree = buildInstallationBackupTree(store, store.installations[0]!);
  assert.equal(buildBackupPayload(refreshedTree, [], 'metadata').baseTreeRevision, 2);
});

test('definitive confirmation conflict resets only the uncommitted upload session', async () => {
  const row: CloudUploadQueueItem = {
    id: 'upload-raced',
    installation_id: 'offline-installation',
    entity_type: 'zone',
    entity_id: 'zone-1',
    field_name: 'photos[0]',
    local_uri: 'file:///evidence.jpg',
    mime_type: 'image/jpeg',
    status: 'failed',
    attempts: 2,
    checksum: 'checksum-raced',
    session_id: 'session-raced',
    updated_at: timestamp,
  };
  let reset = false;

  const recovered = await recoverUploadConfirmation(row, {
    confirm: async () => {
      throw Object.assign(new Error('snapshot_conflict'), { status: 409 });
    },
    recordRevision: async () => { assert.fail('uncommitted session has no revision'); },
    markComplete: async () => { assert.fail('uncommitted session cannot clear'); },
    resetUnconfirmed: async (item) => {
      assert.equal(item.session_id, 'session-raced');
      reset = true;
    },
    isProvenUnconfirmed: isDefinitivelyUnconfirmedUploadConfirmationError,
  });

  assert.equal(recovered, false);
  assert.equal(reset, true);
  assert.equal(
    isDefinitivelyUnconfirmedUploadConfirmationError(
      Object.assign(new Error('upload_confirmation_revision_unavailable'), { status: 409 }),
    ),
    false,
  );
});

test('foreground and background backup callers share one operation and both receive progress', async () => {
  let executions = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const run = createSingleFlightProgressRunner<string, string>(async (emit) => {
    executions += 1;
    emit('started');
    await held;
    emit('finished');
    return 'done';
  });
  const foregroundProgress: string[] = [];
  const backgroundProgress: string[] = [];
  const foreground = run((value) => foregroundProgress.push(value));
  const background = run((value) => backgroundProgress.push(value));

  await Promise.resolve();
  assert.equal(executions, 1);
  assert.strictEqual(foreground, background);
  release();
  assert.equal(await foreground, 'done');
  assert.deepEqual(foregroundProgress, ['started', 'finished']);
  assert.deepEqual(backgroundProgress, ['started', 'finished']);
});

test('accepted complete push survives a failed pull and replays before any metadata write', async () => {
  const store = offlineCaptureStore();
  applyServerTreeRevision(store, 'offline-installation', 1);
  const tree = buildInstallationBackupTree(store, store.installations[0]!);
  const payload = buildBackupPayload(tree, [], 'complete');
  const attempt = applyPreparedCompleteBackupAttempt(
    store,
    'offline-installation',
    payload,
    tree.watermark,
    tree.installation.status,
    tree.installation.tree_revision ?? 0,
    undefined,
    '2026-08-01T01:00:00.000Z',
  );
  const exactPayload = JSON.stringify(attempt.payload);
  const localRevisionBeforeBlockedEdit = store.installations[0]!.tree_revision;
  assert.throws(
    () => bumpTreeRevision(store, 'offline-installation'),
    /Cloud backup confirmation is pending/,
  );
  assert.equal(store.installations[0]!.tree_revision, localRevisionBeforeBlockedEdit);
  const pushedStages: unknown[] = [];
  let pullAttempts = 0;

  const dependencies = {
    getInstallationBackupTree: async () =>
      buildInstallationBackupTree(store, store.installations[0]!),
    push: async (request: unknown) => {
      pushedStages.push((request as Record<string, unknown>).syncStage);
      assert.equal(JSON.stringify(request), exactPayload);
      return {
        installationId: 'offline-installation',
        treeRevision: 2,
        recordVersionNumber: 1,
      };
    },
    recordAccepted: async (
      installationId: string,
      attemptId: string,
      treeRevision: number,
      recordVersionNumber: number | null,
    ) => {
      applyAcceptedCompleteBackupAttempt(
        store,
        installationId,
        attemptId,
        treeRevision,
        recordVersionNumber,
      );
    },
    fetchAndMerge: async (installationId: string, treeRevision: number) => {
      pullAttempts += 1;
      if (pullAttempts === 1) throw new Error('confirmation pull interrupted');
      applyServerTreeRevision(store, installationId, treeRevision);
      return { installation: { status: 'Draft' } };
    },
    applyServerState: async (_installationId: string, patch: {
      status: 'Draft' | 'Completed';
      record_version_number?: number;
      backup_conflict: { kind: 'NONE' };
    }) => {
      store.installations[0]!.status = patch.status;
      store.installations[0]!.record_version_number = patch.record_version_number;
      store.installations[0]!.backup_conflict = patch.backup_conflict;
    },
    finish: async (installationId: string, attemptId: string) => {
      assert.equal(store.cloudSync.pending_complete_attempts?.[installationId]?.id, attemptId);
      store.cloudSync.synced_at_by_installation[installationId] = attempt.tree_watermark;
      delete store.cloudSync.pending_complete_attempts?.[installationId];
    },
  };

  await assert.rejects(
    () => confirmCompleteBackupAttempt(attempt, dependencies),
    /confirmation pull interrupted/,
  );
  assert.equal(store.cloudSync.pending_complete_attempts?.['offline-installation']?.id, attempt.id);
  assert.equal(attempt.accepted_tree_revision, 2);

  await confirmCompleteBackupAttempt(attempt, dependencies);

  assert.deepEqual(pushedStages, ['complete', 'complete']);
  assert.equal(store.installations[0]!.server_tree_revision, 2);
  assert.equal(store.cloudSync.pending_complete_attempts?.['offline-installation'], undefined);
  assert.equal(
    store.cloudSync.synced_at_by_installation['offline-installation'],
    attempt.tree_watermark,
  );
});

test('definitive pending-complete conflict retires only the exact marker and unfreezes edits', () => {
  const store = offlineCaptureStore();
  const tree = buildInstallationBackupTree(store, store.installations[0]!);
  const attempt = applyPreparedCompleteBackupAttempt(
    store,
    'offline-installation',
    buildBackupPayload(tree, [], 'complete'),
    tree.watermark,
    tree.installation.status,
    tree.installation.tree_revision ?? 0,
  );

  assert.equal(
    applyDiscardCompleteBackupAttempt(store, 'offline-installation', 'stale-attempt'),
    false,
  );
  assert.throws(
    () => bumpTreeRevision(store, 'offline-installation'),
    /confirmation is pending/,
  );
  assert.equal(
    applyDiscardCompleteBackupAttempt(store, 'offline-installation', attempt.id),
    true,
  );
  assert.equal(
    store.cloudSync.conflicted_complete_attempts?.['offline-installation']?.id,
    attempt.id,
  );
  assert.doesNotThrow(() => bumpTreeRevision(store, 'offline-installation'));
  assert.equal(store.cloudSync.synced_at_by_installation['offline-installation'], undefined);
});
