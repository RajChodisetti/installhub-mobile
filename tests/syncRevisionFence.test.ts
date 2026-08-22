import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyAcceptedCompleteBackupAttempt,
  applyDiscardCompleteBackupAttempt,
  applyInstallationBackupConflict,
  applyPreparedCompleteBackupAttempt,
  applyPreparedCompleteBackupAttemptForSnapshot,
  applyReconciledBackupMediaQueueForSnapshot,
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
import { quarantineAssignedWorkCheckout } from '../src/services/assignedWorkRecovery';
import {
  applyServerResultCommitFence,
  captureServerResultInstallationSnapshot,
} from '../src/services/serverResultCommitFence';
import { createAssignedWorkMutationAuthorityRuntime } from '../src/services/assignedWorkMutationGuard';

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
  store.installations[0]!.assigned_work_server_tree_fingerprint = 'older-server-tree';
  applyServerTreeRevision(store, 'offline-installation', 1);
  assert.equal(
    store.installations[0]!.assigned_work_server_tree_fingerprint,
    undefined,
  );
  store.installations[0]!.assigned_work_server_tree_fingerprint = 'canonical-revision-1';
  applyServerTreeRevision(store, 'offline-installation', 1);
  assert.equal(
    store.installations[0]!.assigned_work_server_tree_fingerprint,
    'canonical-revision-1',
  );
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

test('an installation backup tree is a coherent snapshot, not live store references', () => {
  const store = offlineCaptureStore();
  store.zones.push({
    id: 'zone-snapshot',
    audit_id: 'offline-installation',
    zone_name: 'Original zone',
    zone_description: 'Original description',
    photos: [],
    created_at: timestamp,
    updated_at: timestamp,
  });
  const snapshot = buildInstallationBackupTree(
    store,
    store.installations[0]!,
  );

  store.installations[0]!.site_name = 'Mutated site';
  store.zones[0]!.zone_name = 'Mutated zone';

  assert.equal(snapshot.installation.site_name, 'Offline site');
  assert.equal(snapshot.zones[0]!.zone_name, 'Original zone');
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

test('a local mutation invalidates server-derived residuals without losing the server CAS base', () => {
  const store = offlineCaptureStore();
  store.installations[0]!.server_tree_revision = 3;
  store.installations[0]!.server_derived = {
    treeRevision: 3,
    virtualMeterDefinitions: [{
      id: 'virtual-stale',
      parentNodeId: 'board-removed',
      totalMeasurementAssignmentId: 'assignment-removed',
      subtractAssignmentIds: [],
      formulaVersion: 1,
      allocation: 'UNALLOCATED_RESIDUAL',
    }],
  };

  bumpTreeRevision(store, 'offline-installation');

  assert.equal(store.installations[0]!.server_derived, undefined);
  assert.equal(store.installations[0]!.server_tree_revision, 3);
  assert.equal(store.installations[0]!.tree_revision, 9);
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

test('callers with the exact same authority share one operation and progress', async () => {
  let executions = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const run = createSingleFlightProgressRunner<string, string, object>(async (emit) => {
    executions += 1;
    emit('started');
    await held;
    emit('finished');
    return 'done';
  });
  const foregroundProgress: string[] = [];
  const backgroundProgress: string[] = [];
  const authority = {};
  const foreground = run((value) => foregroundProgress.push(value), authority);
  const background = run((value) => backgroundProgress.push(value), authority);

  await Promise.resolve();
  assert.equal(executions, 1);
  assert.strictEqual(foreground, background);
  release();
  assert.equal(await foreground, 'done');
  assert.deepEqual(foregroundProgress, ['started', 'finished']);
  assert.deepEqual(backgroundProgress, ['started', 'finished']);
});

test('a foreground authority waits and restarts instead of joining a background-owned flight', async () => {
  const releases: Array<() => void> = [];
  const executedAuthorities: string[] = [];
  const run = createSingleFlightProgressRunner<string, string, { scope: string }>(
    async (_emit, authority) => {
      executedAuthorities.push(authority.scope);
      await new Promise<void>((resolve) => { releases.push(resolve); });
      return authority.scope;
    },
  );

  const background = run(undefined, { scope: 'background-A' });
  await Promise.resolve();
  const foreground = run(undefined, { scope: 'foreground-A-generation-7' });
  await Promise.resolve();
  assert.deepEqual(executedAuthorities, ['background-A']);
  assert.notStrictEqual(background, foreground);

  releases[0]!();
  assert.equal(await background, 'background-A');
  await Promise.resolve();
  assert.deepEqual(executedAuthorities, [
    'background-A',
    'foreground-A-generation-7',
  ]);
  releases[1]!();
  assert.equal(await foreground, 'foreground-A-generation-7');
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

test('new complete-backup replay checks current dispatch authority immediately before push', async () => {
  const store = offlineCaptureStore();
  const tree = buildInstallationBackupTree(store, store.installations[0]!);
  const attempt = applyPreparedCompleteBackupAttempt(
    store,
    tree.installation.id,
    buildBackupPayload(tree, [], 'complete'),
    tree.watermark,
    tree.installation.status,
    tree.installation.tree_revision ?? 0,
    undefined,
    '2026-08-01T01:00:00.000Z',
  );
  let pushed = false;

  await assert.rejects(
    () => confirmCompleteBackupAttempt(attempt, {
      getInstallationBackupTree: async () => tree,
      assertNewDispatchAllowed: () => {
        throw new Error('assignment became inactive');
      },
      push: async () => {
        pushed = true;
        return {
          installationId: tree.installation.id,
          treeRevision: 2,
          recordVersionNumber: null,
        };
      },
      recordAccepted: async () => {},
      fetchAndMerge: async () => ({ installation: { status: 'Draft' } }),
      applyServerState: async () => {},
      finish: async () => {},
    }),
    /assignment became inactive/,
  );
  assert.equal(pushed, false);
});

test('complete replay rejects a same-watermark local revision change before push', async () => {
  const store = offlineCaptureStore();
  const tree = buildInstallationBackupTree(store, store.installations[0]!);
  const attempt = applyPreparedCompleteBackupAttempt(
    store,
    tree.installation.id,
    buildBackupPayload(tree, [], 'complete'),
    tree.watermark,
    tree.installation.status,
    tree.installation.tree_revision ?? 0,
  );
  const changedAtSameTimestamp = {
    ...tree,
    installation: {
      ...tree.installation,
      tree_revision: (tree.installation.tree_revision ?? 0) + 1,
    },
  };
  let pushed = false;

  await assert.rejects(
    () => confirmCompleteBackupAttempt(attempt, {
      getInstallationBackupTree: async () => changedAtSameTimestamp,
      push: async () => {
        pushed = true;
        return {
          installationId: tree.installation.id,
          treeRevision: 2,
          recordVersionNumber: null,
        };
      },
      recordAccepted: async () => {},
      fetchAndMerge: async () => ({ installation: { status: 'Draft' } }),
      applyServerState: async () => {},
      finish: async () => {},
    }),
    /Local installation changed/,
  );
  assert.equal(pushed, false);
});

test('complete replay rejects a same-watermark revision change after canonical merge', async () => {
  const store = offlineCaptureStore();
  const tree = buildInstallationBackupTree(store, store.installations[0]!);
  const attempt = applyPreparedCompleteBackupAttempt(
    store,
    tree.installation.id,
    buildBackupPayload(tree, [], 'complete'),
    tree.watermark,
    tree.installation.status,
    tree.installation.tree_revision ?? 0,
  );
  let reads = 0;
  let applied = false;

  await assert.rejects(
    () => confirmCompleteBackupAttempt(attempt, {
      getInstallationBackupTree: async () => {
        reads += 1;
        return reads === 1 ? tree : {
          ...tree,
          installation: {
            ...tree.installation,
            tree_revision: (tree.installation.tree_revision ?? 0) + 1,
          },
        };
      },
      push: async () => ({
        installationId: tree.installation.id,
        treeRevision: 2,
        recordVersionNumber: null,
      }),
      recordAccepted: async () => {},
      fetchAndMerge: async () => ({ installation: { status: 'Draft' } }),
      applyServerState: async () => { applied = true; },
      finish: async () => {},
    }),
    /Local installation changed/,
  );
  assert.equal(applied, false);
});

test('same-user relogin cannot prepare a completion attempt inside the queued store commit', () => {
  const store = offlineCaptureStore();
  const installation = store.installations[0]!;
  installation.local_owner_user_id = 'actor-a';
  installation.assigned_work_state = 'none';
  const tree = buildInstallationBackupTree(store, installation);
  const runtime = createAssignedWorkMutationAuthorityRuntime();
  runtime.replaceAuthenticatedActor('actor-a');
  const authority = runtime.capture();
  const fence = {
    actorUserId: 'actor-a',
    expectedLocalTreeRevision: installation.tree_revision ?? 0,
    expectedTreeWatermark: tree.watermark,
    assertCurrent: () => runtime.assertCurrentAuthority(authority, 'actor-a'),
  };

  runtime.replaceAuthenticatedActor(null);
  runtime.replaceAuthenticatedActor('actor-a');
  assert.throws(
    () => applyPreparedCompleteBackupAttemptForSnapshot(
      store,
      installation.id,
      'actor-a',
      buildBackupPayload(tree, [], 'complete'),
      tree.watermark,
      installation.status,
      installation.tree_revision ?? 0,
      fence,
    ),
    /authenticated session changed/i,
  );
  assert.equal(store.cloudSync.pending_complete_attempts?.[installation.id], undefined);
});

test('stale A media reconciliation cannot rewrite a clean same-ID B queue', () => {
  const store = offlineCaptureStore();
  const actorA = store.installations[0]!;
  actorA.local_owner_user_id = 'actor-a';
  actorA.assigned_work_state = 'active';
  actorA.assigned_work_actor_user_id = 'actor-a';
  const snapshot = buildInstallationBackupTree(store, actorA);
  const fence = {
    actorUserId: 'actor-a',
    expectedLocalTreeRevision: actorA.tree_revision ?? 0,
    expectedTreeWatermark: snapshot.watermark,
    assertCurrent: () => {},
  };

  quarantineAssignedWorkCheckout(store, actorA.id, 'actor-b', {
    createRecoveryId: () => 'recovery-media-a',
    quarantinedAt: '2026-08-01T01:00:00.000Z',
  });
  store.installations.push({
    ...actorA,
    local_owner_user_id: 'actor-b',
    assigned_work_actor_user_id: 'actor-b',
    site_name: 'Clean B materialization',
  });
  store.cloudSync.upload_queue = [{
    id: 'b-queue',
    installation_id: actorA.id,
    entity_type: 'zone',
    entity_id: 'b-zone',
    field_name: 'photos[0]',
    local_uri: 'file:///b.jpg',
    mime_type: 'image/jpeg',
    status: 'pending',
    attempts: 0,
    updated_at: timestamp,
  }];

  assert.throws(
    () => applyReconciledBackupMediaQueueForSnapshot(store, actorA.id, [{
      installation_id: actorA.id,
      entity_type: 'zone',
      entity_id: 'a-zone',
      field_name: 'photos[0]',
      local_uri: 'file:///a.jpg',
      mime_type: 'image/jpeg',
    }], fence),
    /different local checkout owner|initiating local installation snapshot/,
  );
  assert.deepEqual(store.cloudSync.upload_queue.map((item) => item.id), ['b-queue']);
});

test('session replacement during accepted-attempt persistence blocks canonical pull', async () => {
  const store = offlineCaptureStore();
  const tree = buildInstallationBackupTree(store, store.installations[0]!);
  const attempt = applyPreparedCompleteBackupAttempt(
    store,
    tree.installation.id,
    buildBackupPayload(tree, [], 'complete'),
    tree.watermark,
    tree.installation.status,
    tree.installation.tree_revision ?? 0,
  );
  let current = true;
  let acceptedPersisted = false;
  let fetchCalled = false;
  let recordStarted!: () => void;
  const recordHasStarted = new Promise<void>((resolve) => { recordStarted = resolve; });
  let releaseRecord!: () => void;
  const recordHeld = new Promise<void>((resolve) => { releaseRecord = resolve; });

  const confirmation = confirmCompleteBackupAttempt(attempt, {
    getInstallationBackupTree: async () => tree,
    assertNewDispatchAllowed: () => {
      if (!current) throw new Error('session replaced');
    },
    push: async () => ({
      installationId: tree.installation.id,
      treeRevision: 2,
      recordVersionNumber: null,
    }),
    recordAccepted: async () => {
      recordStarted();
      await recordHeld;
      acceptedPersisted = true;
    },
    fetchAndMerge: async () => {
      fetchCalled = true;
      return { installation: { status: 'Draft' } };
    },
    applyServerState: async () => {},
    finish: async () => {},
  });

  await recordHasStarted;
  current = false;
  releaseRecord();
  await assert.rejects(confirmation, /session replaced/);
  assert.equal(acceptedPersisted, true);
  assert.equal(fetchCalled, false);
});

test('held A server result cannot commit into a clean same-ID B checkout', () => {
  const store = offlineCaptureStore();
  const actorA = store.installations[0]!;
  actorA.local_owner_user_id = 'actor-a';
  actorA.assigned_work_state = 'active';
  actorA.assigned_work_actor_user_id = 'actor-a';
  actorA.server_tree_revision = 3;
  const snapshot = buildInstallationBackupTree(store, actorA);
  const fence = {
    actorUserId: 'actor-a',
    expectedLocalTreeRevision: actorA.tree_revision ?? 0,
    expectedTreeWatermark: snapshot.watermark,
    // Even if a caller forgot to invalidate its outer lease, exact local
    // ownership still prevents a stale A response from touching B.
    assertCurrent: () => {},
  };

  quarantineAssignedWorkCheckout(
    store,
    actorA.id,
    'actor-b',
    {
      createRecoveryId: () => 'recovery-held-a',
      quarantinedAt: '2026-08-01T01:00:00.000Z',
    },
  );
  store.installations.push({
    ...actorA,
    local_owner_user_id: 'actor-b',
    assigned_work_actor_user_id: 'actor-b',
    site_name: 'Clean B materialization',
    status: 'Draft',
    server_tree_revision: 9,
  });
  let commitCalled = false;
  assert.throws(
    () => applyServerResultCommitFence(store, actorA.id, fence, (installation) => {
      commitCalled = true;
      installation.status = 'Completed';
    }),
    /different local checkout owner/,
  );
  const actorB = store.installations[0]!;
  assert.equal(commitCalled, false);
  assert.equal(actorB.local_owner_user_id, 'actor-b');
  assert.equal(actorB.site_name, 'Clean B materialization');
  assert.equal(actorB.status, 'Draft');
  assert.equal(actorB.server_tree_revision, 9);

  const sync = readFileSync(
    new URL('../src/services/syncService.ts', import.meta.url),
    'utf8',
  );
  assert.match(sync, /reconcileResolvedDisplayCodes\([\s\S]*serverResultCommitFence/);
  assert.match(sync, /installationsRepo\.applyServerState\([\s\S]*serverResultCommitFence/);
});

test('held reopen response cannot regress a newer same-actor server revision', () => {
  const store = offlineCaptureStore();
  const installation = store.installations[0]!;
  installation.local_owner_user_id = 'actor-a';
  installation.assigned_work_state = 'none';
  installation.status = 'Completed';
  installation.server_tree_revision = 3;
  const snapshot = buildInstallationBackupTree(store, installation);
  const fence = {
    actorUserId: 'actor-a',
    expectedLocalTreeRevision: installation.tree_revision ?? 0,
    expectedTreeWatermark: snapshot.watermark,
    expectedServerTreeRevision: 3,
    assertCurrent: () => {},
  };

  // A later same-account sync committed while the older reopen POST response
  // was held. It need not change the local edit revision or timestamp.
  installation.server_tree_revision = 5;
  installation.record_version_number = 4;
  let applied = false;
  assert.throws(
    () => applyServerResultCommitFence(store, installation.id, fence, (current) => {
      applied = true;
      current.status = 'Draft';
      current.server_tree_revision = 4;
    }),
    /local installation changed/,
  );
  assert.equal(applied, false);
  assert.equal(installation.status, 'Completed');
  assert.equal(installation.server_tree_revision, 5);
  assert.equal(installation.record_version_number, 4);

  const detail = readFileSync(
    new URL('../src/screens/InstallationDetailScreen.tsx', import.meta.url),
    'utf8',
  );
  const reopen = detail.slice(
    detail.indexOf('  async function reopenInstallation()'),
    detail.indexOf('\n  function openGridEditor', detail.indexOf('  async function reopenInstallation()')),
  );
  assert.match(reopen, /expectedLocalTreeRevision: reopenLocalTreeRevision/);
  assert.match(reopen, /expectedTreeWatermark: reopenTreeWatermark/);
  assert.match(reopen, /expectedServerTreeRevision: reopenServerTreeRevision/);
  assert.match(reopen, /assertCurrent: actionLease!\.assertCurrent/);
});

test('held metadata response cannot commit after the source installation changes', async () => {
  const store = offlineCaptureStore();
  const installation = store.installations[0]!;
  installation.local_owner_user_id = 'actor-a';
  installation.assigned_work_state = 'none';
  const liveTree = buildInstallationBackupTree(store, installation);
  const snapshot = captureServerResultInstallationSnapshot(liveTree);
  let releaseResponse!: () => void;
  const responseHeld = new Promise<void>((resolve) => { releaseResponse = resolve; });
  let commitCalled = false;

  const commitAfterResponse = (async () => {
    await responseHeld;
    return applyServerResultCommitFence(store, installation.id, {
      actorUserId: 'actor-a',
      expectedLocalTreeRevision: snapshot.localTreeRevision,
      expectedTreeWatermark: snapshot.treeWatermark,
      assertCurrent: () => {},
    }, (current) => {
      commitCalled = true;
      current.status = snapshot.status;
      current.record_version_number = snapshot.recordVersionNumber;
    });
  })();

  // Backup trees are immutable snapshots. Mutate only the source record's
  // revision while retaining the timestamp, so the watermark stays unchanged
  // and the independent local-revision fence must reject the held response.
  installation.tree_revision = snapshot.localTreeRevision + 1;
  assert.equal(liveTree.installation.tree_revision, snapshot.localTreeRevision);
  assert.equal(
    buildInstallationBackupTree(store, installation).watermark,
    snapshot.treeWatermark,
  );
  releaseResponse();
  await assert.rejects(commitAfterResponse, /local installation changed/);
  assert.equal(commitCalled, false);

  const sync = readFileSync(
    new URL('../src/services/syncService.ts', import.meta.url),
    'utf8',
  );
  const metadataStart = sync.indexOf(
    'const metadataSnapshot = captureServerResultInstallationSnapshot(originalTree)',
  );
  const nextStage = sync.indexOf('let next = await getNextUpload', metadataStart);
  const metadataStage = sync.slice(metadataStart, nextStage);
  assert.match(metadataStage, /metadataSnapshot\.localTreeRevision/);
  assert.match(metadataStage, /metadataSnapshot\.treeWatermark/);
  assert.match(metadataStage, /status: metadataSnapshot\.status/);
  assert.match(metadataStage, /metadataSnapshot\.recordVersionNumber/);
  assert.doesNotMatch(
    metadataStage.slice(metadataStage.indexOf('await apiClient.push')),
    /originalTree\.installation/,
  );
});

test('whole-tree watermark blocks a server result after an unversioned child change', () => {
  const store = offlineCaptureStore();
  const installation = store.installations[0]!;
  installation.local_owner_user_id = 'field-user';
  installation.assigned_work_state = 'none';
  const snapshot = buildInstallationBackupTree(store, installation);
  store.zones.push({
    id: 'late-zone',
    audit_id: installation.id,
    zone_name: 'Late local edit',
    zone_description: '',
    photos: [],
    created_at: '2026-08-01T01:00:00.000Z',
    updated_at: '2026-08-01T01:00:00.000Z',
  });
  let commitCalled = false;
  assert.throws(
    () => applyServerResultCommitFence(store, installation.id, {
      actorUserId: 'field-user',
      expectedLocalTreeRevision: installation.tree_revision ?? 0,
      expectedTreeWatermark: snapshot.watermark,
      assertCurrent: () => {},
    }, () => {
      commitCalled = true;
    }),
    /local installation changed/,
  );
  assert.equal(commitCalled, false);
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
