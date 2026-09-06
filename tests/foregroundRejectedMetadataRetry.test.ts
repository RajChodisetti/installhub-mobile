import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { sha256 } from 'js-sha256';
import { normalizeCanonicalStore, bumpTreeRevision } from '../src/domain/installationV2';
import { buildInstallationBackupTree } from '../src/repositories/cloudSyncRepository';
import { applyPreparedMetadataBackupAttempt, applyRejectedMetadataBackupAttempt, applyAcceptedMetadataBackupAttempt,
  applyFinishedMetadataBackupAttempt } from '../src/repositories/metadataBackupRepository';
import { buildBackupPayload } from '../src/services/backupMedia';
import { confirmMetadataBackupAttempt } from '../src/services/metadataBackupConfirmation';
import { metadataPrecommitRejectionCode } from '../src/services/metadataBackupRejection';
import { validateCanonicalRemoteTreeIds } from '../src/services/remoteInstallationValidation';
import { acquireInstallationRecovery } from '../src/services/installationRecoveryFence';
import { captureForegroundRejectedMetadataRetry } from '../src/services/foregroundRejectedMetadataRetry';
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


function rejected(firstCreate = false) {
  const state = fixture(firstCreate);
  if (firstCreate) applyRejectedMetadataBackupAttempt(state.store, state.attempt, 'invalid_canonical_tree', reason,
    { kind: 'absent_first_dispatch', installationId: 'job', freshFirstDispatch: true }, () => {});
  else retire(state);
  const descriptor = captureForegroundRejectedMetadataRetry(state.store, 'actor');
  return { ...state, descriptor };
}
function prepare(state: ReturnType<typeof rejected>, options: {
  automatic?: boolean; descriptor?: typeof state.descriptor; base?: RemoteInstallationTree; absent?: boolean;
  assertCurrent?: () => void;
} = {}) {
  const tree = buildInstallationBackupTree(state.store, state.store.installations[0]!);
  return applyPreparedMetadataBackupAttempt(state.store, tree, buildBackupPayload(tree, state.store.cloudSync.upload_queue, 'metadata'),
    { ...state.fence, assertCurrent: options.assertCurrent ?? (() => {}), expectedLocalTreeRevision: tree.installation.tree_revision ?? 0,
      expectedTreeWatermark: tree.watermark }, options.base ?? state.base,
    options.automatic ? undefined : { descriptor: options.descriptor ?? state.descriptor, firstCreateAbsenceProved: options.absent ?? false });
}

test('manual capture is immutable and excludes opted-out, invisible and foreign historical records', () => {
  const state = rejected(); const own = state.store.installations[0]!; const old = state.store.cloudSync.rejected_metadata_attempts![state.attempt.id]!;
  for (const [id, local_owner_user_id, cloud_backup_enabled, assigned_work_state] of [
    ['out', 'actor', false, 'none'], ['other', 'other', true, 'none'], ['inactive', 'actor', true, 'inactive'],
  ] as const) {
    state.store.installations.push({ ...structuredClone(own), id, local_owner_user_id, cloud_backup_enabled, assigned_work_state, assigned_work_actor_user_id: 'actor' });
    state.store.cloudSync.rejected_metadata_attempts![id] = { ...structuredClone(old), id, installation_id: id, actor_user_id: local_owner_user_id };
  }
  state.store.cloudSync.rejected_metadata_attempts!.orphan = { ...structuredClone(old), id: 'orphan', actor_user_id: 'previous-actor' };
  const descriptor = captureForegroundRejectedMetadataRetry(state.store, 'actor');
  assert.deepEqual(descriptor.attempts.map((item) => item.attemptId), [old.id]);
  assert.ok(Object.isFrozen(descriptor)); assert.ok(Object.isFrozen(descriptor.attempts)); assert.ok(Object.isFrozen(descriptor.attempts[0]));
  const hash = descriptor.attempts[0]!.rejectedRecordSha256;
  old.preserved_upload_queue[0]!.last_error = 'changed later';
  assert.equal(descriptor.attempts[0]!.rejectedRecordSha256, hash);
});

test('automatic remains suppressed; explicit same-body retry creates ordinary durable intent without replacing original history', () => {
  const state = rejected(); const before = structuredClone(state.store); const archived = state.store.cloudSync.rejected_metadata_attempts;
  assert.throws(() => prepare(state, { automatic: true }), /Correct the reported/);
  assert.deepEqual(state.store, before);
  const next = prepare(state);
  assert.equal(next.id, state.attempt.id); assert.deepEqual(next.payload, state.attempt.payload);
  assert.deepEqual(next.sent_tree, state.attempt.sent_tree); assert.deepEqual(next.base_remote_tree, state.base);
  assert.equal(state.store.cloudSync.pending_metadata_attempts!.job!.id, next.id);
  assert.deepEqual(state.store.cloudSync.rejected_metadata_attempts, archived);
  assert.deepEqual(state.store.formSubmissions, before.formSubmissions);
  assert.deepEqual(state.store.cloudSync.upload_queue, before.cloudSync.upload_queue);
  assert.deepEqual(state.store.installations, before.installations);
});

test('repeated rejection retains immutable original and consumes only one exception; another automatic run stays suppressed', () => {
  const state = rejected(); const original = structuredClone(state.store.cloudSync.rejected_metadata_attempts);
  const next = prepare(state);
  applyRejectedMetadataBackupAttempt(state.store, next, 'invalid_canonical_tree', reason, { kind: 'unchanged_preimage', tree: state.base }, () => {});
  assert.deepEqual(state.store.cloudSync.rejected_metadata_attempts, original);
  assert.throws(() => prepare(state), /fresh manual/);
  assert.throws(() => prepare(state, { automatic: true }), /Correct the reported/);
  const fresh = captureForegroundRejectedMetadataRetry(state.store, 'actor');
  assert.equal(prepare(state, { descriptor: fresh }).id, next.id);
});

for (const kind of ['opt-out', 'owner', 'assignment', 'rejection-hash', 'accepted-receipt', 'invalid-code', 'invalid-proof',
  'payload-tamper', 'pending-metadata', 'pending-completion', 'pending-final', 'conflicted-final', 'conflicted-metadata', 'server-preimage', 'server-revision',
  'session', 'lock', 'forged-descriptor'] as const) {
  test(`manual retry refuses ${kind} with original evidence untouched`, () => {
    const state = rejected(); const record = state.store.cloudSync.rejected_metadata_attempts![state.attempt.id]!;
    let options: Parameters<typeof prepare>[1] = {}; let release: (() => void) | undefined;
    if (kind === 'opt-out') state.store.installations[0]!.cloud_backup_enabled = false;
    if (kind === 'owner') state.store.installations[0]!.local_owner_user_id = 'other';
    if (kind === 'assignment') state.store.installations[0]!.assigned_work_state = 'inactive';
    if (kind === 'rejection-hash') record.preserved_upload_queue[0]!.attempts += 1;
    if (kind === 'accepted-receipt') record.accepted_record_version_number = null;
    if (kind === 'invalid-code') record.rejection_code = 'arbitrary400';
    if (kind === 'invalid-proof') record.rejection_proof = { kind: 'absent_first_dispatch' };
    if (kind === 'payload-tamper') record.payload.syncStage = 'complete';
    if (kind === 'pending-metadata') state.store.cloudSync.pending_metadata_attempts = { job: structuredClone(state.attempt) };
    if (kind === 'pending-completion') state.store.installations[0]!.pending_completion = {} as never;
    if (kind === 'pending-final') state.store.cloudSync.pending_complete_attempts = { job: {} as never };
    if (kind === 'conflicted-final') state.store.cloudSync.conflicted_complete_attempts = { job: {} as never };
    if (kind === 'conflicted-metadata') state.store.cloudSync.conflicted_metadata_attempts = { job: {} as never };
    if (kind === 'server-preimage' || kind === 'server-revision') {
      const base = structuredClone(state.base); if (kind === 'server-preimage') base.installation.notes = 'Unexpected remote change';
      else base.treeRevision = 5; options = { base };
    }
    if (kind === 'session') { let checks = 0; options = { assertCurrent() { if (++checks === 4) throw new Error('Session replaced at final boundary'); } }; }
    if (kind === 'lock') release = acquireInstallationRecovery('job').release;
    if (kind === 'forged-descriptor') options = { descriptor: structuredClone(state.descriptor) };
    const before = structuredClone(state.store);
    try { assert.throws(() => prepare(state, options)); assert.deepEqual(state.store, before); }
    finally { release?.(); }
  });
}

test('later corrected local capture makes a normal new request and never replays the rejected body', () => {
  const state = rejected(); const old = structuredClone(state.attempt.payload);
  state.store.installations[0]!.job_comments = 'Corrected current capture'; bumpTreeRevision(state.store, 'job');
  const next = prepare(state);
  assert.notEqual(next.id, state.attempt.id); assert.notDeepEqual(next.payload, old);
  assert.equal((next.payload.installation as any).jobComments, 'Corrected current capture');
  assert.deepEqual(state.store.cloudSync.rejected_metadata_attempts![state.attempt.id]!.payload, old);
});

test('first-create retry requires a new exact absence observation, not merely missing preimage input', () => {
  const state = rejected(true); assert.throws(() => prepare(state), /still absent/);
  assert.equal(prepare(state, { absent: true }).id, state.attempt.id);
});

test('failed durable preparation cannot dispatch and does not grant automatic authority', () => {
  const state = rejected(); const durableBefore = JSON.stringify(state.store); let posts = 0;
  const transactional = async () => {
    const detached = { ...state, store: JSON.parse(durableBefore) as AppDataStore };
    prepare(detached); throw new Error('Storage commit failed');
  };
  return assert.rejects(transactional().then(() => { posts++; }), /Storage commit failed/).then(() => {
    assert.equal(posts, 0); assert.equal(JSON.stringify(state.store), durableBefore);
    assert.throws(() => prepare(state), /fresh manual/);
    assert.throws(() => prepare(state, { automatic: true }), /Correct the reported/);
    assert.ok(prepare(state, { descriptor: captureForegroundRejectedMetadataRetry(state.store, 'actor') }));
  });
});

/** Executes the actual production recovery function, confirmation state machine,
 * repository receipt/merge functions and native wire builder. HTTP/storage I/O
 * are controlled. No matching mock is substituted for semantic confirmation. */
function recoveryEngine(state: ReturnType<typeof rejected>, options: { pushError?: 'response-lost' | 'rejected'; pullError?: boolean } = {}) {
  const source = ts.createSourceFile('syncService.ts', readFileSync(new URL('../src/services/syncService.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'recoverMetadataAttempt')!;
  const api = ts.createSourceFile('apiClient.ts', readFileSync(new URL('../src/api/apiClient.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const errorClass = api.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === 'ApiError')!;
  const text = errorClass.getFullText(api).replace(/^export\s+/m, '') + '\n' + fn.getFullText(source)
    + '\nObject.assign(exports, { ApiError, recoverMetadataAttempt });';
  const exports: any = {}; const events: string[] = [];
  const remote = structuredClone(state.base); remote.treeRevision = 5; remote.installation.treeRevision = 5;
  const assertCurrent = () => assert.equal(state.store.installations[0]!.local_owner_user_id, 'actor');
  runInNewContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, Error, String, Object, Number, Promise, JSON, sha256, confirmMetadataBackupAttempt,
    metadataPrecommitRejectionCode, validateCanonicalRemoteTreeIds,
    assertCloudBackupRunAuthorityCurrent: assertCurrent, assertInstallationAllowsBackupRecovery: assertCurrent,
    serverResultCommitFence: (_: unknown, revision: number, watermark: string) => ({ actorUserId: 'actor', expectedLocalTreeRevision: revision,
      expectedTreeWatermark: watermark, assertCurrent }),
    apiClient: {
      async push(payload: unknown) {
        events.push('POST'); assert.equal(state.store.cloudSync.pending_metadata_attempts!.job!.id, state.attempt.id);
        assert.deepEqual(payload, state.attempt.payload);
        if (options.pushError === 'response-lost') throw new Error('Response lost after dispatch');
        if (options.pushError === 'rejected') throw new exports.ApiError(reason, 400);
        return { installationId: 'job', treeRevision: 5, recordVersionNumber: 0 };
      },
      async pull() { events.push('GET'); if (options.pullError) throw new Error('Canonical pull unavailable');
        return { installations: [structuredClone(options.pushError === 'rejected' ? state.base : remote)] }; },
    },
    async archiveRejectedMetadataBackupAttempt(attempt: PendingMetadataBackupAttempt, code: string, message: string, observation: any, check: () => void) {
      events.push('rejected'); applyRejectedMetadataBackupAttempt(state.store, attempt, code, message, observation, check);
    },
    async archiveConflictedMetadataBackupAttempt() { throw new Error('Unexpected conflict path'); },
    async recordAcceptedMetadataBackupAttempt(attempt: PendingMetadataBackupAttempt, result: any, check: () => void) {
      events.push('accepted'); applyAcceptedMetadataBackupAttempt(state.store, attempt, result, check);
    },
    async getInstallationBackupTree() { return buildInstallationBackupTree(state.store, state.store.installations[0]!); },
    async finishMetadataBackupAttempt(attempt: PendingMetadataBackupAttempt, canonical: RemoteInstallationTree, fence: any, revision: number) {
      events.push('finish'); applyFinishedMetadataBackupAttempt(state.store, attempt, canonical, fence, revision);
    },
  });
  return { events, run: (fresh = false) => exports.recoverMetadataAttempt(structuredClone(state.store.cloudSync.pending_metadata_attempts!.job!), { actorUserId: 'actor' }, fresh) as Promise<void> };
}

test('explicit retry after a server-side fix posts the original once, verifies canonical result, and leaves full-backup markers dirty', async () => {
  const state = rejected(); const original = structuredClone(state.store.cloudSync.rejected_metadata_attempts);
  const captures = structuredClone(state.store.formSubmissions); prepare(state);
  const engine = recoveryEngine(state); await engine.run(true);
  assert.deepEqual(engine.events, ['POST', 'accepted', 'GET', 'finish']);
  assert.deepEqual(state.store.cloudSync.rejected_metadata_attempts, original);
  assert.deepEqual(state.store.formSubmissions, captures);
  assert.equal(state.store.installations[0]!.server_tree_revision, 5);
  assert.equal(state.store.installations[0]!.last_synced_local_tree_revision, 2);
  assert.equal(state.store.installations[0]!.last_synced_server_tree_revision, 3);
  assert.equal(state.store.cloudSync.synced_at_by_installation.job, stamp);
  assert.ok(state.store.cloudSync.force_dirty_installation_ids.includes('job'));
  assert.equal(state.store.cloudSync.pending_metadata_attempts?.job, undefined);
});

test('response loss preserves the retried durable request and resumes without reusing foreground permission', async () => {
  const state = rejected(); prepare(state);
  const failed = recoveryEngine(state, { pushError: 'response-lost' }); await assert.rejects(failed.run(true), /Response lost/);
  assert.deepEqual(failed.events, ['POST']);
  state.store = JSON.parse(JSON.stringify(state.store)) as AppDataStore;
  const resumed = recoveryEngine(state); await resumed.run();
  assert.deepEqual(resumed.events, ['POST', 'accepted', 'GET', 'finish']);
  assert.ok(state.store.cloudSync.rejected_metadata_attempts![state.attempt.id]);
});

test('saved retried receipt resumes GET-only after failed canonical pull, without another manual descriptor', async () => {
  const state = rejected(); prepare(state);
  const failed = recoveryEngine(state, { pullError: true }); await assert.rejects(failed.run(true), /Canonical pull/);
  assert.deepEqual(failed.events, ['POST', 'accepted', 'GET']);
  state.store = JSON.parse(JSON.stringify(state.store)) as AppDataStore;
  const resumed = recoveryEngine(state); await resumed.run();
  assert.deepEqual(resumed.events, ['GET', 'finish']);
});

test('repeated400 production path proves no mutation again and restores automatic dedupe without overwriting first rejection', async () => {
  const state = rejected(); const original = structuredClone(state.store.cloudSync.rejected_metadata_attempts); prepare(state);
  const engine = recoveryEngine(state, { pushError: 'rejected' }); await assert.rejects(engine.run(true), /Correct this capture/);
  assert.deepEqual(engine.events, ['POST', 'GET', 'rejected']);
  assert.deepEqual(state.store.cloudSync.rejected_metadata_attempts, original);
  assert.throws(() => prepare(state, { automatic: true }), /Correct the reported/);
  assert.throws(() => prepare(state), /fresh manual/);
});
