import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { normalizeCanonicalStore, bumpTreeRevision } from '../src/domain/installationV2';
import { buildInstallationBackupTree, buildInstallationBackupSelection } from '../src/repositories/cloudSyncRepository';
import { applyPreparedMetadataBackupAttempt, applyRejectedMetadataBackupAttempt, applyAcceptedMetadataBackupAttempt } from '../src/repositories/metadataBackupRepository';
import { buildBackupPayload } from '../src/services/backupMedia';
import { confirmMetadataBackupAttempt } from '../src/services/metadataBackupConfirmation';
import { metadataPrecommitRejectionCode, rejectedMetadataLocalMediaReferences } from '../src/services/metadataBackupRejection';
import { validateCanonicalRemoteTreeIds } from '../src/services/remoteInstallationValidation';
import { quarantineAssignedWorkCheckout, assignedWorkRecoveryLocalMediaReferences } from '../src/services/assignedWorkRecovery';
import { conflictRecoverySnapshot } from '../src/services/assignedWorkConflictRecoveryState';
import { acquireInstallationRecovery } from '../src/services/installationRecoveryFence';
import { planLocalDeletion, applyLocalDeletionPlan } from '../src/repositories/deletionIntegrity';
import { storedMediaIsReferenced } from '../src/services/ownedMediaPaths';
import type { AppDataStore, PendingMetadataBackupAttempt } from '../src/types';
import type { RemoteInstallationTree } from '../src/api/apiClient';

const stamp = '2026-09-05T10:00:00.000Z';
const reason = 'invalid_canonical_tree: Check the captured field value';
function fixture(firstCreate = false) {
  const store = normalizeCanonicalStore({ schemaVersion: 3,
    user: { id: 'actor', email: 'actor@example.test', full_name: 'Actor', role: 'admin' },
    installations: [{ id: 'job', client_name: 'Client', site_name: 'Site', site_address: 'QA Address', inspector_name: 'QA', audit_date: '2026-09-05', timezone: 'Australia/Sydney',
      status: 'Draft', cloud_backup_enabled: true, local_owner_user_id: 'actor', assigned_work_state: 'none',
      created_at: stamp, updated_at: stamp, tree_schema_version: 2, tree_revision: 7,
      ...(firstCreate ? {} : { server_tree_revision: 4, last_synced_local_tree_revision: 2, last_synced_server_tree_revision: 3 }) }],
    gridSupplies: [], zones: [], electricalAssets: [], siteAssets: [], meterDevices: [], measurementAssignments: [],
    formSubmissions: [{ id: 'form', installation_id: 'job', form_type: 'captis-logger', schema_version: 2, status: 'Draft',
      answers: { 'notes.notes': 'Original capture' }, attachments: [{ id: 'photo', slot: 'meter.closeup_photo',
        uri: 'file:///original.jpg', mime_type: 'image/jpeg', captured_at: stamp }], created_at: stamp, updated_at: stamp }],
    cloudSync: { synced_at_by_installation: { job: stamp }, force_dirty_installation_ids: ['job'],
      upload_queue: [{ id: 'upload', installation_id: 'job', entity_type: 'form_submission', entity_id: 'form', field_name: 'photo',
        local_uri: 'file:///original.jpg', mime_type: 'image/jpeg', status: 'pending', attempts: 0, updated_at: stamp }],
      thumbnail_queue: [{ id: 'thumb', installation_id: 'job', remote_uri: 'https://example.test/photo', local_uri: 'file:///preview.jpg',
        status: 'ready', attempts: 0, updated_at: stamp }] },
  } as AppDataStore);
  const tree = buildInstallationBackupTree(store, store.installations[0]!);
  const payload = buildBackupPayload(tree, store.cloudSync.upload_queue, 'metadata');
  const base = firstCreate ? undefined : { ...structuredClone(payload), treeSchemaVersion: 2, treeRevision: 4, recordVersionNumber: 0, serverDerived: { virtualMeterDefinitions: [] },
    installation: { ...(payload.installation as Record<string, unknown>), id: 'job', externalKey: 'ih_job', treeRevision: 4, recordVersionNumber: 0, createdByUserId: 'actor' } } as RemoteInstallationTree;
  const fence = { actorUserId: 'actor', assertCurrent() {}, expectedLocalTreeRevision: tree.installation.tree_revision ?? 0, expectedTreeWatermark: tree.watermark };
  const attempt = applyPreparedMetadataBackupAttempt(store, tree, payload, fence, base);
  return { store, attempt, base: base!, fence };
}

function retire(state: ReturnType<typeof fixture>, assertCurrent = () => {}) {
  applyRejectedMetadataBackupAttempt(state.store, state.attempt, 'invalid_canonical_tree', reason,
    { kind: 'unchanged_preimage', tree: structuredClone(state.base) }, assertCurrent);
}

test('proven rejection preserves original capture, queues and clean markers while corrected local work can prepare', () => {
  const state = fixture(); const { store, attempt } = state;
  store.formSubmissions[0]!.answers['notes.notes'] = 'Corrected after dispatch'; bumpTreeRevision(store, 'job');
  const before = structuredClone(store); retire(state);
  assert.equal(store.cloudSync.pending_metadata_attempts?.job, undefined);
  const archived = store.cloudSync.rejected_metadata_attempts![attempt.id]!;
  assert.deepEqual(archived.sent_tree, attempt.sent_tree); assert.deepEqual(archived.payload, attempt.payload);
  assert.deepEqual(archived.preserved_upload_queue, before.cloudSync.upload_queue);
  assert.deepEqual(archived.preserved_thumbnail_queue, before.cloudSync.thumbnail_queue);
  assert.deepEqual(store.installations, before.installations);
  assert.deepEqual(store.formSubmissions, before.formSubmissions);
  assert.deepEqual(store.cloudSync.upload_queue, before.cloudSync.upload_queue);
  assert.deepEqual(store.cloudSync.thumbnail_queue, before.cloudSync.thumbnail_queue);
  assert.equal(store.cloudSync.synced_at_by_installation.job, stamp);
  assert.equal(buildInstallationBackupSelection(store, 'actor').trees.length, 1);
  const tree = buildInstallationBackupTree(store, store.installations[0]!);
  const next = applyPreparedMetadataBackupAttempt(store, tree, buildBackupPayload(tree, store.cloudSync.upload_queue, 'metadata'),
    { ...state.fence, expectedLocalTreeRevision: tree.installation.tree_revision ?? 0, expectedTreeWatermark: tree.watermark }, state.base);
  assert.notEqual(next.id, attempt.id); assert.ok(store.cloudSync.rejected_metadata_attempts![attempt.id]);
});

test('rejected history survives reload, deduplicates unchanged intent and protects media on later deletion/quarantine', () => {
  const state = fixture(); retire(state);
  const store = JSON.parse(JSON.stringify(state.store)) as AppDataStore;
  const tree = buildInstallationBackupTree(store, store.installations[0]!);
  assert.throws(() => applyPreparedMetadataBackupAttempt(store, tree, buildBackupPayload(tree, store.cloudSync.upload_queue, 'metadata'), state.fence, state.base), /Correct the reported/);
  assert.equal(Object.keys(store.cloudSync.rejected_metadata_attempts!).length, 1);
  assert.equal(conflictRecoverySnapshot(store, 'job').cloudSync.rejected_metadata_attempts.length, 1);
  const plan = planLocalDeletion(store, { kind: 'form_draft', id: 'form' })!;
  const effects = applyLocalDeletionPlan(store, plan, stamp);
  assert.ok(effects.protectedFormAttachmentUris.includes('file:///original.jpg'));
  assert.ok(storedMediaIsReferenced('file:///original.jpg', store));
  assert.ok(rejectedMetadataLocalMediaReferences(store).includes('file:///preview.jpg'));
  const preserved = structuredClone(store.cloudSync.rejected_metadata_attempts);
  const recovery = quarantineAssignedWorkCheckout(store, 'job', 'other', { createRecoveryId: () => 'copy' });
  assert.deepEqual(recovery.cloudSync.rejected_metadata_attempts, Object.values(preserved!));
  assert.equal(Object.keys(store.cloudSync.rejected_metadata_attempts!).length, 0);
  assert.ok(assignedWorkRecoveryLocalMediaReferences(recovery).includes('file:///original.jpg'));
  assert.ok(assignedWorkRecoveryLocalMediaReferences(recovery).includes('file:///preview.jpg'));
});

for (const change of ['server-revision', 'server-content', 'server-identity', 'receipt', 'local-base', 'local-status', 'completion', 'actor', 'attempt', 'proof-code'] as const) {
  test(`rejection refuses ${change} without any journal/checkout write`, () => {
    const state = fixture(); const observation = { kind: 'unchanged_preimage' as const, tree: structuredClone(state.base) };
    if (change === 'server-revision') observation.tree.treeRevision = 5;
    if (change === 'server-content') observation.tree.installation.siteName = 'Unexpected server edit';
    if (change === 'server-identity') observation.tree.installation.id = 'other';
    if (change === 'receipt') applyAcceptedMetadataBackupAttempt(state.store, state.attempt, { installationId: 'job', treeRevision: 5, recordVersionNumber: 1 }, () => {});
    if (change === 'local-base') state.store.installations[0]!.server_tree_revision = 5;
    if (change === 'local-status') state.store.installations[0]!.status = 'Completed';
    if (change === 'completion') state.store.cloudSync.pending_complete_attempts = { job: {} as never };
    if (change === 'actor') state.store.installations[0]!.local_owner_user_id = 'other';
    if (change === 'attempt') state.store.cloudSync.pending_metadata_attempts!.job!.prepared_at = 'changed';
    const before = structuredClone(state.store);
    assert.throws(() => applyRejectedMetadataBackupAttempt(state.store, state.attempt,
      change === 'proof-code' ? 'unknown' : 'invalid_canonical_tree', reason, observation, () => {}));
    assert.deepEqual(state.store, before);
  });
}

test('orphan rejected history remains private when another actor receives the same canonical ID', () => {
  const state = fixture(); retire(state);
  const original = structuredClone(state.store.cloudSync.rejected_metadata_attempts);
  state.store.installations[0]!.local_owner_user_id = 'new-actor';
  assert.deepEqual(conflictRecoverySnapshot(state.store, 'job').cloudSync.rejected_metadata_attempts, []);
  const recovery = quarantineAssignedWorkCheckout(state.store, 'job', 'third-actor', { createRecoveryId: () => 'other-copy' });
  assert.deepEqual(recovery.cloudSync.rejected_metadata_attempts, []);
  assert.deepEqual(state.store.cloudSync.rejected_metadata_attempts, original);
  assert.ok(storedMediaIsReferenced('file:///original.jpg', state.store));
});

test('same-user session change at final write and active recovery lock preserve the complete intent', () => {
  const state = fixture(); const before = structuredClone(state.store); let checks = 0;
  assert.throws(() => retire(state, () => { if (++checks === 2) throw new Error('session replaced'); }), /session replaced/);
  assert.deepEqual(state.store, before);
  const lock = acquireInstallationRecovery('job');
  try { assert.throws(() => retire(state), /being recovered/); assert.deepEqual(state.store, before); }
  finally { lock.release(); }
});

/** Production orchestration is evaluated without native module initialization.
 * Only HTTP/store I/O and process authority are controlled; receipt policy,
 * original-body confirmation and serialized commit function are real imports. */
function engine(state: ReturnType<typeof fixture>, options: {
  status?: number; message?: string; first?: boolean; pull?: () => Promise<{ installations: RemoteInstallationTree[] }>;
  afterPull?: () => void; assertCurrent?: () => void;
} = {}) {
  const path = new URL('../src/services/syncService.ts', import.meta.url);
  const parsed = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = parsed.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'recoverMetadataAttempt')!;
  const apiPath = new URL('../src/api/apiClient.ts', import.meta.url);
  const api = ts.createSourceFile(apiPath.pathname, readFileSync(apiPath, 'utf8'), ts.ScriptTarget.Latest, true);
  const errorClass = api.statements.find((item) => ts.isClassDeclaration(item) && item.name?.text === 'ApiError')!;
  const code = errorClass.getFullText(api).replace(/^export\s+/m, '') + '\n' + fn.getFullText(parsed)
    + '\nObject.assign(exports, { ApiError, recoverMetadataAttempt });';
  const exports: any = {}; const events: string[] = [];
  runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, Error, String, Object, Number, Promise, JSON, confirmMetadataBackupAttempt, metadataPrecommitRejectionCode,
    validateCanonicalRemoteTreeIds, assertCloudBackupRunAuthorityCurrent: options.assertCurrent ?? (() => {}),
    assertInstallationAllowsBackupRecovery() {},
    apiClient: {
      async push(payload: unknown) { events.push('POST'); assert.deepEqual(payload, state.attempt.payload); throw new exports.ApiError(options.message ?? reason, options.status ?? 400); },
      async pull() { events.push('GET'); const result = options.pull ? await options.pull() : { installations: [structuredClone(state.base)] }; options.afterPull?.(); return result; },
    },
    async archiveRejectedMetadataBackupAttempt(attempt: PendingMetadataBackupAttempt, code: string, message: string, observation: any, assertCurrent: () => void) {
      events.push('retire'); applyRejectedMetadataBackupAttempt(state.store, attempt, code, message, observation, assertCurrent);
    },
    async archiveConflictedMetadataBackupAttempt() { events.push('conflict'); },
    async recordAcceptedMetadataBackupAttempt() { events.push('accepted'); },
    async finishMetadataBackupAttempt() { events.push('finish'); },
  });
  return { exports, events, run: () => exports.recoverMetadataAttempt(state.attempt, { actorUserId: 'actor' }, options.first ?? false) as Promise<void> };
}

test('production400 flow proves unchanged preimage before retirement; it never reports full backup success', async () => {
  const state = fixture(); const runtime = engine(state);
  await assert.rejects(runtime.run(), /Correct this capture/);
  assert.deepEqual(runtime.events, ['POST', 'GET', 'retire']);
  assert.equal(state.store.cloudSync.pending_metadata_attempts?.job, undefined);
  assert.ok(state.store.cloudSync.rejected_metadata_attempts![state.attempt.id]);
});

for (const [status, message] of [[400, 'Bad request'], [400, 'invalid_canonical_tree_changed: unknown'], [500, reason], [0, 'response lost']] as const) {
  test(`production ${status}/${message} retains ambiguity without requesting retirement proof`, async () => {
    const state = fixture(); const runtime = engine(state, { status, message });
    await assert.rejects(runtime.run()); assert.deepEqual(runtime.events, ['POST']);
    assert.ok(state.store.cloudSync.pending_metadata_attempts?.job);
    assert.equal(state.store.cloudSync.rejected_metadata_attempts, undefined);
  });
}

test('response-lost prior acceptance followed by400 cannot retire against advanced canonical state', async () => {
  const state = fixture(); const prior = structuredClone(state.base); prior.treeRevision = 5; prior.installation.treeRevision = 5;
  const runtime = engine(state, { pull: async () => ({ installations: [prior] }) });
  await assert.rejects(runtime.run(), /server changed/);
  assert.ok(state.store.cloudSync.pending_metadata_attempts?.job);
  assert.equal(state.store.cloudSync.rejected_metadata_attempts, undefined);
});

test('delayed proof after session replacement never reaches retirement', async () => {
  const state = fixture(); let current = true;
  const runtime = engine(state, { afterPull() { current = false; }, assertCurrent() { if (!current) throw new Error('session replaced'); } });
  await assert.rejects(runtime.run(), /session replaced/); assert.deepEqual(runtime.events, ['POST', 'GET']);
  assert.ok(state.store.cloudSync.pending_metadata_attempts?.job);
});

test('first-create requires exact scoped404 and newly prepared first dispatch; replayed404 stays pending', async () => {
  for (const fresh of [true, false]) {
    const state = fixture(true); let runtime: ReturnType<typeof engine>;
    runtime = engine(state, { first: fresh, pull: async () => { throw new runtime.exports.ApiError('Installation not found', 404); } });
    await assert.rejects(runtime.run());
    assert.deepEqual(runtime.events, fresh ? ['POST', 'GET', 'retire'] : ['POST', 'GET']);
    assert.equal(Boolean(state.store.cloudSync.rejected_metadata_attempts?.[state.attempt.id]), fresh);
    assert.equal(Boolean(state.store.cloudSync.pending_metadata_attempts?.job), !fresh);
  }
  const state = fixture(true); const empty = engine(state, { first: true, pull: async () => ({ installations: [] }) });
  await assert.rejects(empty.run(), /could not prove/); assert.ok(state.store.cloudSync.pending_metadata_attempts?.job);
});
