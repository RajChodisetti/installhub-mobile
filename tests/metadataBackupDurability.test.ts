import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from 'js-sha256';
import { normalizeCanonicalStore, bumpTreeRevision } from '../src/domain/installationV2';
import { buildInstallationBackupTree, buildInstallationBackupSelection } from '../src/repositories/cloudSyncRepository';
import { applyPreparedMetadataBackupAttempt, applyAcceptedMetadataBackupAttempt, applyConflictedMetadataBackupAttempt, assertPendingMetadataAttempt } from '../src/repositories/metadataBackupRepository';
import { buildBackupPayload } from '../src/services/backupMedia';
import { confirmMetadataBackupAttempt, type MetadataBackupConfirmationDependencies } from '../src/services/metadataBackupConfirmation';
import { acquireInstallationRecovery } from '../src/services/installationRecoveryFence';
import { quarantineAssignedWorkCheckout } from '../src/services/assignedWorkRecovery';
import { captureConflictRecoveryBaseline, assertConflictRecoveryBaseline } from '../src/services/assignedWorkConflictRecoveryState';
import { registerAssignedWorkNavigationSnapshot } from '../src/services/assignedWorkNavigationFence';
import type { AppDataStore, PendingMetadataBackupAttempt } from '../src/types';
import type { RemoteInstallationTree } from '../src/api/apiClient';

const stamp = '2026-09-05T10:00:00.000Z';
function fixture(): AppDataStore {
  return normalizeCanonicalStore({ schemaVersion: 3,
    user: { id: 'actor', email: 'actor@example.test', full_name: 'Actor', role: 'admin' },
    installations: [{ id: 'job', client_name: 'Client', site_name: 'Site', site_address: '', inspector_name: '', audit_date: '',
      status: 'Draft', cloud_backup_enabled: true, local_owner_user_id: 'actor', assigned_work_state: 'none',
      created_at: stamp, updated_at: stamp, tree_schema_version: 2, tree_revision: 7, server_tree_revision: 4 }],
    gridSupplies: [], zones: [], electricalAssets: [], siteAssets: [], meterDevices: [], measurementAssignments: [], formSubmissions: [],
    cloudSync: { synced_at_by_installation: { job: stamp }, force_dirty_installation_ids: ['job'], upload_queue: [], thumbnail_queue: [] },
  });
}
function prepare(store: AppDataStore, assertCurrent = () => {}) {
  const tree = buildInstallationBackupTree(store, store.installations[0]!);
  const payload = buildBackupPayload(tree, [], 'metadata');
  const fence = { actorUserId: 'actor', assertCurrent, expectedLocalTreeRevision: 7, expectedTreeWatermark: stamp, expectedServerTreeRevision: 4 };
  const baseRemote = { ...structuredClone(payload), treeSchemaVersion: 2, treeRevision: 4,
    installation: { ...(payload.installation as Record<string, unknown>), id: 'job', externalKey: 'ih_job', treeRevision: 4, createdByUserId: 'actor' } } as RemoteInstallationTree;
  return { tree, payload, fence, attempt: applyPreparedMetadataBackupAttempt(store, tree, payload, fence, baseRemote) };
}
function remote(attempt: PendingMetadataBackupAttempt, revision = 5): RemoteInstallationTree {
  return { ...structuredClone(attempt.payload), treeSchemaVersion: 2, treeRevision: revision,
    installation: { ...(attempt.payload.installation as Record<string, unknown>), id: 'job', externalKey: 'ih_job', treeRevision: revision },
    zones: structuredClone(attempt.payload.zones) as Record<string, unknown>[],
    electricalAssets: structuredClone(attempt.payload.electricalAssets) as Record<string, unknown>[],
    siteAssets: structuredClone(attempt.payload.siteAssets) as Record<string, unknown>[],
    formSubmissions: structuredClone(attempt.payload.formSubmissions) as Record<string, unknown>[],
  };
}

test('metadata request and sent snapshot persist as detached hashed intent before dispatch', () => {
  const store = fixture(); const { attempt, payload, tree } = prepare(store);
  const persisted = JSON.parse(JSON.stringify(store)) as AppDataStore;
  assert.equal(assertPendingMetadataAttempt('job', persisted.cloudSync.pending_metadata_attempts!.job!).id, attempt.id);
  (payload.installation as Record<string, unknown>).siteName = 'changed caller'; tree.installation.site_name = 'changed caller';
  assert.equal((attempt.payload.installation as Record<string, unknown>).siteName, 'Site');
  assert.equal(attempt.sent_tree.installation.site_name, 'Site');
  assert.equal(attempt.sent_tree_sha256, sha256(JSON.stringify(attempt.sent_tree)));
  assert.deepEqual(buildInstallationBackupSelection(store, 'actor').deferredInstallationIds, ['job']);
  assert.equal(store.cloudSync.synced_at_by_installation.job, stamp);
});

test('tampered original payload or snapshot never passes journal integrity validation', () => {
  const { attempt } = prepare(fixture());
  for (const mutate of [
    (row: PendingMetadataBackupAttempt) => { row.payload.syncStage = 'complete'; },
    (row: PendingMetadataBackupAttempt) => { row.sent_tree.installation.job_comments = 'changed'; },
    (row: PendingMetadataBackupAttempt) => { row.actor_user_id = 'other'; },
    (row: PendingMetadataBackupAttempt) => { row.base_tree_revision = 9; },
    (row: PendingMetadataBackupAttempt) => { row.base_remote_tree!.installation.siteName = 'tampered preimage'; },
  ]) {
    const changed = structuredClone(attempt); mutate(changed);
    assert.throws(() => assertPendingMetadataAttempt('job', changed), /integrity/);
  }
});

test('prepare rejects unsent snapshot mutation, other owner, pending complete and recovery locks without a journal write', () => {
  for (const mutate of [
    (store: AppDataStore) => { store.installations[0]!.job_comments = 'same-clock mutation'; },
    (store: AppDataStore) => { store.installations[0]!.local_owner_user_id = 'other'; },
    (store: AppDataStore) => { store.cloudSync.pending_complete_attempts = { job: {} as never }; },
  ]) {
    const store = fixture(); const tree = buildInstallationBackupTree(store, store.installations[0]!);
    mutate(store); const before = structuredClone(store);
    assert.throws(() => applyPreparedMetadataBackupAttempt(store, tree, buildBackupPayload(tree, [], 'metadata'),
      { actorUserId: 'actor', assertCurrent() {}, expectedLocalTreeRevision: 7, expectedTreeWatermark: stamp }));
    assert.deepEqual(store, before);
  }
  const store = fixture(); const lock = acquireInstallationRecovery('job');
  try { assert.throws(() => prepare(store), /being recovered/); assert.equal(store.cloudSync.pending_metadata_attempts?.job, undefined); }
  finally { lock.release(); }
});

test('same-user session replacement inside prepare or receipt commit leaves state unchanged', () => {
  const store = fixture(); const initial = structuredClone(store);
  assert.throws(() => prepare(store, () => { throw new Error('session replaced'); }), /session replaced/);
  assert.deepEqual(store, initial);
  const { attempt } = prepare(store); const beforeReceipt = structuredClone(store);
  assert.throws(() => applyAcceptedMetadataBackupAttempt(store, attempt,
    { installationId: 'job', treeRevision: 5, recordVersionNumber: 2 }, () => { throw new Error('session replaced'); }), /session replaced/);
  assert.deepEqual(store, beforeReceipt);
});

test('metadata acknowledgement preserves later captures and does not advance full-backup watermarks or clean pair', () => {
  const store = fixture(); const { attempt } = prepare(store);
  store.installations[0]!.job_comments = 'Captured after dispatch'; bumpTreeRevision(store, 'job');
  applyAcceptedMetadataBackupAttempt(store, attempt, { installationId: 'job', treeRevision: 5, recordVersionNumber: 2 }, () => {});
  assert.equal(store.installations[0]!.job_comments, 'Captured after dispatch');
  assert.equal(store.installations[0]!.server_tree_revision, 4);
  assert.equal(store.cloudSync.synced_at_by_installation.job, stamp);
  assert.deepEqual(store.cloudSync.force_dirty_installation_ids, ['job']);
  assert.equal(store.installations[0]!.last_synced_local_tree_revision, undefined);
});

test('lost acknowledgement replays its body but a saved receipt resumes with reads after restart and later edits', async () => {
  let store = fixture(); const { attempt } = prepare(store); const originalBody = JSON.stringify(attempt.payload);
  let pushCount = 0; let failPull = true; let finished = 0; const events: string[] = [];
  const deps: MetadataBackupConfirmationDependencies = {
    assertCurrent() {},
    async push(body) { events.push('push'); pushCount += 1; assert.equal(JSON.stringify(body), originalBody);
      if (pushCount === 1) throw new Error('response lost after server commit');
      return { installationId: 'job', treeRevision: 5, recordVersionNumber: 2 }; },
    async recordAccepted(row, result) { events.push('receipt'); applyAcceptedMetadataBackupAttempt(store, row, result, () => {}); },
    async fetchCanonical() { events.push('pull'); if (failPull) throw new Error('pull failed'); return remote(attempt); },
    async finish() { events.push('finish'); finished += 1; },
  };
  await assert.rejects(confirmMetadataBackupAttempt(attempt, deps), /response lost/);
  assert.equal(store.cloudSync.pending_metadata_attempts!.job!.accepted_tree_revision, undefined);
  store = JSON.parse(JSON.stringify(store)) as AppDataStore;
  store.installations[0]!.job_comments = 'Later unsent capture'; bumpTreeRevision(store, 'job');
  await assert.rejects(confirmMetadataBackupAttempt(store.cloudSync.pending_metadata_attempts!.job!, deps), /pull failed/);
  assert.equal(store.cloudSync.pending_metadata_attempts!.job!.accepted_tree_revision, 5);
  store = JSON.parse(JSON.stringify(store)) as AppDataStore; failPull = false;
  await confirmMetadataBackupAttempt(store.cloudSync.pending_metadata_attempts!.job!, deps);
  assert.equal(pushCount, 2); assert.equal(finished, 1);
  assert.deepEqual(events, ['push', 'push', 'receipt', 'pull', 'pull', 'finish']);
  assert.equal(store.installations[0]!.job_comments, 'Later unsent capture');
  assert.equal(store.cloudSync.synced_at_by_installation.job, stamp);
});

test('acknowledged recovery never posts again even when the API rejects stale metadata replay', async () => {
  const store = fixture(); const { attempt } = prepare(store);
  applyAcceptedMetadataBackupAttempt(store, attempt, { installationId: 'job', treeRevision: 5, recordVersionNumber: 2 }, () => {});
  const durable = JSON.parse(JSON.stringify(store.cloudSync.pending_metadata_attempts!.job!)) as PendingMetadataBackupAttempt;
  let finishes = 0;
  const deps: MetadataBackupConfirmationDependencies = {
    assertCurrent() {},
    async push() { assert.fail('An accepted request must not be sent again'); },
    async recordAccepted() { assert.fail('The original durable receipt must not be replaced'); },
    async fetchCanonical() { return remote(durable); },
    async finish(row, received, revision) { assert.deepEqual(row, durable); assert.equal(received.treeRevision, 5); assert.equal(revision, 5); finishes += 1; },
  };
  await confirmMetadataBackupAttempt(durable, deps);
  assert.equal(finishes, 1);
  await assert.rejects(confirmMetadataBackupAttempt(durable, { ...deps, async fetchCanonical() { return remote(durable, 6); } }), /revision/);
  assert.equal(finishes, 1);
});

test('partial persisted acknowledgement never dispatches or finishes', async () => {
  for (const kind of ['revision-only', 'version-only'] as const) {
    const { attempt } = prepare(fixture());
    if (kind === 'revision-only') attempt.accepted_tree_revision = 5;
    else attempt.accepted_record_version_number = null;
    await assert.rejects(confirmMetadataBackupAttempt(attempt, {
      assertCurrent() {}, async push() { assert.fail('No POST for an incomplete receipt'); },
      async recordAccepted() { assert.fail('No receipt overwrite'); },
      async fetchCanonical() { assert.fail('No read for an incomplete receipt'); },
      async finish() { assert.fail('No finish for an incomplete receipt'); },
    }), /incomplete/);
  }
});

test('foreign acknowledgement and later canonical revision stay pending without finish', async () => {
  for (const kind of ['ack', 'revision'] as const) {
    const store = fixture(); const { attempt } = prepare(store); let finished = false;
    await assert.rejects(confirmMetadataBackupAttempt(attempt, {
      assertCurrent() {}, async push() { return { installationId: kind === 'ack' ? 'foreign' : 'job', treeRevision: 5, recordVersionNumber: 2 }; },
      async recordAccepted(row, result) { applyAcceptedMetadataBackupAttempt(store, row, result, () => {}); },
      async fetchCanonical() { return remote(attempt, 6); }, async finish() { finished = true; },
    }), /acknowledgement|revision/);
    assert.equal(finished, false); assert.ok(store.cloudSync.pending_metadata_attempts?.job);
    assert.equal(store.cloudSync.conflicted_metadata_attempts?.job, undefined);
  }
});

test('definitive replay conflict archives exact intent and acknowledgement without unpausing or losing local data', () => {
  const store = fixture(); const { attempt } = prepare(store);
  applyAcceptedMetadataBackupAttempt(store, attempt, { installationId: 'job', treeRevision: 5, recordVersionNumber: 2 }, () => {});
  store.installations[0]!.job_comments = 'Unsent work';
  applyConflictedMetadataBackupAttempt(store, attempt, 'snapshot_conflict', () => {});
  assert.equal(store.cloudSync.pending_metadata_attempts?.job, undefined);
  const archived = store.cloudSync.conflicted_metadata_attempts!.job!;
  assert.equal(archived.id, attempt.id); assert.equal(archived.accepted_tree_revision, 5);
  assert.deepEqual(archived.payload, attempt.payload); assert.deepEqual(archived.sent_tree, attempt.sent_tree);
  assert.equal(store.installations[0]!.job_comments, 'Unsent work');
  assert.equal(store.installations[0]!.server_tree_revision, 4);
  assert.deepEqual(buildInstallationBackupSelection(store, 'actor').deferredInstallationIds, ['job']);
  assert.throws(() => prepare(store), /backup or completion state/);
});


test('prepare requires an exact base preimage owned by or assigned to the actor', () => {
  for (const mode of ['foreign', 'missing', 'wrong-status', 'wrong-revision'] as const) {
    const store = fixture(); const { tree, payload, fence, attempt } = prepare(store);
    delete store.cloudSync.pending_metadata_attempts!.job;
    const prior = structuredClone(attempt.base_remote_tree!);
    if (mode === 'foreign') prior.installation.createdByUserId = 'someone-else';
    if (mode === 'missing') delete prior.installation.createdByUserId;
    if (mode === 'wrong-status') prior.installation.status = 'Completed';
    if (mode === 'wrong-revision') prior.treeRevision = 999;
    const before = structuredClone(store);
    assert.throws(() => applyPreparedMetadataBackupAttempt(store, tree, payload, fence, prior), /integrity/);
    assert.deepEqual(store, before);
  }
  const store = fixture(); const { tree, payload, fence, attempt } = prepare(store);
  delete store.cloudSync.pending_metadata_attempts!.job;
  const prior = structuredClone(attempt.base_remote_tree!);
  prior.installation.createdByUserId = 'owner'; prior.installation.assignedInspectorUserId = 'actor';
  assert.equal(applyPreparedMetadataBackupAttempt(store, tree, payload, fence, prior).actor_user_id, 'actor');
});


test('ambiguous intent blocks explicit recovery; a definitive archived intent is part of the reviewed snapshot', () => {
  const unregister = registerAssignedWorkNavigationSnapshot(() => ({ routes: [{ name: 'MainTabs' }] }));
  try {
    const store = fixture(); const { attempt } = prepare(store);
    store.installations[0]!.backup_conflict = { kind: 'CONFLICT', localBaseTreeRevision: 4, detectedAt: stamp };
    assert.throws(() => captureConflictRecoveryBaseline(store, 'job', 'actor'), /pending.*confirmation/);
    applyConflictedMetadataBackupAttempt(store, attempt, 'stale server revision', () => {});
    const baseline = captureConflictRecoveryBaseline(store, 'job', 'actor');
    store.cloudSync.conflicted_metadata_attempts!.job!.conflict_reason = 'changed review';
    assert.throws(() => assertConflictRecoveryBaseline(store, baseline), /changed after/);
  } finally { unregister(); }
});

for (const conflicted of [false, true]) test(`reassignment archives the full metadata intent and receipt without exposing it to the next actor (conflicted=${conflicted})`, () => {
  const store = fixture(); const { attempt } = prepare(store);
  applyAcceptedMetadataBackupAttempt(store, attempt, { installationId: 'job', treeRevision: 5, recordVersionNumber: 2 }, () => {});
  if (conflicted) applyConflictedMetadataBackupAttempt(store, attempt, 'server changed', () => {});
  const original = structuredClone(conflicted ? store.cloudSync.conflicted_metadata_attempts!.job! : store.cloudSync.pending_metadata_attempts!.job!);
  const recovery = quarantineAssignedWorkCheckout(store, 'job', 'next-actor', { createRecoveryId: () => 'preserved-qa' });
  assert.equal(recovery.actor_user_id, 'actor');
  assert.deepEqual(conflicted ? recovery.cloudSync.conflicted_metadata_attempt : recovery.cloudSync.pending_metadata_attempt, original);
  assert.equal(store.cloudSync.pending_metadata_attempts?.job, undefined);
  assert.equal(store.cloudSync.conflicted_metadata_attempts?.job, undefined);
  assert.equal(store.installations.some((item) => item.id === 'job'), false);
  assert.deepEqual(store.assignedWorkRecoveryCheckouts![0]!.cloudSync, recovery.cloudSync);
});


test('a replay cannot replace an already persisted revision or record-version receipt', () => {
  const store = fixture(); const { attempt } = prepare(store);
  applyAcceptedMetadataBackupAttempt(store, attempt, { installationId: 'job', treeRevision: 5, recordVersionNumber: 2 }, () => {});
  const before = structuredClone(store);
  for (const result of [
    { installationId: 'job', treeRevision: 6, recordVersionNumber: 2 },
    { installationId: 'job', treeRevision: 5, recordVersionNumber: 3 },
    { installationId: 'job', treeRevision: 5, recordVersionNumber: null },
  ]) {
    assert.throws(() => applyAcceptedMetadataBackupAttempt(store, attempt, result, () => {}), /different.*acknowledgement/);
    assert.deepEqual(store, before);
  }
});
