import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { sha256 } from 'js-sha256';
import type { AppDataStore, ConflictedMetadataBackupAttempt } from '../src/types';
import type { RemoteInstallationTree } from '../src/api/apiClient';
import { normalizeCanonicalStore, bumpTreeRevision } from '../src/domain/installationV2';
import { buildInstallationBackupTree } from '../src/repositories/cloudSyncRepository';
import { applyPreparedMetadataBackupAttempt, applyAcceptedMetadataBackupAttempt, applyConflictedMetadataBackupAttempt,
  assertAcceptedMetadataConflictReadable, applyResolvedMetadataConflict } from '../src/repositories/metadataBackupRepository';
import { buildBackupPayload } from '../src/services/backupMedia';
import { registerAssignedWorkNavigationSnapshot } from '../src/services/assignedWorkNavigationFence';
import { acquireInstallationRecovery } from '../src/services/installationRecoveryFence';
import { validateCanonicalRemoteTreeIds } from '../src/services/remoteInstallationValidation';
import { quarantineAssignedWorkCheckout, assignedWorkRecoveryLocalMediaReferences } from '../src/services/assignedWorkRecovery';
import { conflictRecoverySnapshot } from '../src/services/assignedWorkConflictRecoveryState';
import { metadataHistoryLocalMediaReferences } from '../src/services/metadataBackupRejection';
import { applyLocalDeletionPlan, planLocalDeletion } from '../src/repositories/deletionIntegrity';

const stamp = '2026-09-05T10:00:00.000Z';
const hash = (value: unknown) => sha256(JSON.stringify(value));
function fixture() {
  const store = normalizeCanonicalStore({ schemaVersion: 3,
    user: { id: 'actor', email: 'actor@example.test', full_name: 'Actor', role: 'admin' },
    installations: [{ id: 'job', client_name: 'QA Client', site_name: 'QA Site', site_address: 'QA Address', inspector_name: 'QA',
      audit_date: '2026-09-05', timezone: 'Australia/Sydney', status: 'Draft', cloud_backup_enabled: true,
      local_owner_user_id: 'actor', assigned_work_state: 'none', created_at: stamp, updated_at: stamp,
      tree_schema_version: 2, tree_revision: 7, server_tree_revision: 4,
      last_synced_local_tree_revision: 2, last_synced_server_tree_revision: 3 }],
    gridSupplies: [], zones: [], electricalAssets: [], siteAssets: [], meterDevices: [], measurementAssignments: [],
    formSubmissions: [{ id: 'form', installation_id: 'job', form_type: 'captis-logger', schema_version: 2, status: 'Draft',
      answers: { 'notes.text': 'Original' }, attachments: [{ id: 'photo', slot: 'meter.closeup_photo', uri: 'file:///original.jpg', mime_type: 'image/jpeg', captured_at: stamp }],
      created_at: stamp, updated_at: stamp }],
    cloudSync: { synced_at_by_installation: { job: stamp }, force_dirty_installation_ids: ['job'],
      upload_queue: [{ id: 'upload', installation_id: 'job', entity_type: 'form_submission', entity_id: 'form', field_name: 'photo',
        local_uri: 'file:///original.jpg', mime_type: 'image/jpeg', status: 'pending', attempts: 0, updated_at: stamp }],
      thumbnail_queue: [{ id: 'thumb', installation_id: 'job', remote_uri: 'https://example.test/photo', local_uri: 'file:///preview.jpg',
        status: 'ready', attempts: 0, updated_at: stamp }] },
  } as AppDataStore);
  const tree = buildInstallationBackupTree(store, store.installations[0]!);
  const payload = buildBackupPayload(tree, store.cloudSync.upload_queue, 'metadata');
  const base = { ...structuredClone(payload), treeSchemaVersion: 2, treeRevision: 4, recordVersionNumber: 2,
    serverDerived: { virtualMeterDefinitions: [] }, installation: { ...(payload.installation as Record<string, unknown>),
      id: 'job', externalKey: 'ih_job', treeRevision: 4, recordVersionNumber: 2, createdByUserId: 'actor' } } as RemoteInstallationTree;
  const attempt = applyPreparedMetadataBackupAttempt(store, tree, payload,
    { actorUserId: 'actor', assertCurrent() {}, expectedLocalTreeRevision: 7, expectedTreeWatermark: tree.watermark }, base);
  applyAcceptedMetadataBackupAttempt(store, attempt, { installationId: 'job', treeRevision: 5, recordVersionNumber: 2 }, () => {});
  applyConflictedMetadataBackupAttempt(store, attempt, 'snapshot_conflict', () => {});
  const original = structuredClone(store.cloudSync.conflicted_metadata_attempts!.job!);
  const remote = structuredClone(base); remote.treeRevision = 5; remote.installation.treeRevision = 5;
  return { store, original, remote };
}
function fence(store: AppDataStore, assertCurrent = () => {}) {
  const tree = buildInstallationBackupTree(store, store.installations[0]!);
  return { actorUserId: 'actor', assertCurrent, expectedLocalTreeRevision: tree.installation.tree_revision ?? 0,
    expectedTreeWatermark: tree.watermark, expectedServerTreeRevision: tree.installation.server_tree_revision,
    expectedTreeSnapshotSha256: hash(tree) };
}
const home = () => registerAssignedWorkNavigationSnapshot(() => ({ routes: [] }));

test('exact accepted conflict recovers on a detached plan, preserves later capture/queues and retains raw original history', () => {
  const state = fixture(); const unregister = home();
  try {
    state.store.formSubmissions[0]!.answers['notes.text'] = 'Later capture'; bumpTreeRevision(state.store, 'job');
    const before = structuredClone(state.store);
    applyResolvedMetadataConflict(state.store, state.original, state.remote, fence(state.store));
    assert.equal(state.store.installations[0]!.server_tree_revision, 5);
    assert.equal(state.store.installations[0]!.tree_revision, before.installations[0]!.tree_revision);
    assert.equal(state.store.installations[0]!.last_synced_local_tree_revision, 2);
    assert.equal(state.store.installations[0]!.last_synced_server_tree_revision, 3);
    assert.equal(state.store.cloudSync.synced_at_by_installation.job, stamp);
    assert.deepEqual(state.store.formSubmissions, before.formSubmissions);
    assert.deepEqual(state.store.cloudSync.upload_queue, before.cloudSync.upload_queue);
    assert.deepEqual(state.store.cloudSync.thumbnail_queue, before.cloudSync.thumbnail_queue);
    assert.equal(state.store.cloudSync.pending_metadata_attempts?.job, undefined);
    assert.equal(state.store.cloudSync.conflicted_metadata_attempts?.job, undefined);
    const history = state.store.cloudSync.resolved_metadata_conflicts![state.original.id]!;
    assert.deepEqual(history.original, state.original); assert.equal(history.original_sha256, hash(state.original));
    assert.equal(history.canonical_tree_sha256, hash(state.remote));
    assert.deepEqual(history.preserved_upload_queue, before.cloudSync.upload_queue);
  } finally { unregister(); }
});

for (const kind of ['newer-revision', 'changed-answers', 'wrong-version', 'null-version', 'other-id', 'owner', 'inactive', 'local-base',
  'completed', 'pending', 'new-completion', 'different-conflict', 'missing-receipt', 'missing-record-receipt', 'tampered-intent', 'retained', 'draft'] as const) {
  test(`accepted conflict refuses ${kind} and leaves all original state untouched`, () => {
    const state = fixture(); let retained = false; const unregister = registerAssignedWorkNavigationSnapshot(() => ({ routes: retained ? [{ params: { installationId: 'job' } }] : [] }));
    try {
      if (kind === 'newer-revision') state.remote.treeRevision = 6;
      if (kind === 'changed-answers') (state.remote.formSubmissions[0]!.answers as Record<string, string>)['notes.text'] = 'Different server capture';
      if (kind === 'wrong-version') state.remote.recordVersionNumber = 3;
      if (kind === 'null-version') state.original.accepted_record_version_number = null;
      if (kind === 'other-id') state.remote.installation.id = 'other';
      if (kind === 'owner') state.store.installations[0]!.local_owner_user_id = 'other';
      if (kind === 'inactive') state.store.installations[0]!.assigned_work_state = 'inactive';
      if (kind === 'local-base') state.store.installations[0]!.server_tree_revision = 6;
      if (kind === 'completed') state.store.installations[0]!.status = 'Completed';
      if (kind === 'pending') state.store.cloudSync.pending_metadata_attempts = { job: {} as never };
      if (kind === 'new-completion') state.store.cloudSync.pending_complete_attempts = { job: {} as never };
      if (kind === 'different-conflict') state.store.installations[0]!.backup_conflict = { kind: 'CONFLICT', localBaseTreeRevision: 4, remoteTreeRevision: 6, detectedAt: stamp };
      if (kind === 'missing-receipt') delete state.original.accepted_tree_revision;
      if (kind === 'missing-record-receipt') delete state.original.accepted_record_version_number;
      if (kind === 'tampered-intent') state.original.payload.syncStage = 'complete';
      if (kind === 'retained') retained = true;
      if (kind === 'draft') state.store.siteAssetEditorDrafts = [{ installationId: 'job' } as never];
      if (['null-version','missing-receipt','missing-record-receipt','tampered-intent'].includes(kind)) state.store.cloudSync.conflicted_metadata_attempts!.job = structuredClone(state.original);
      const before = structuredClone(state.store);
      assert.throws(() => applyResolvedMetadataConflict(state.store, state.original, state.remote, fence(state.store)));
      assert.deepEqual(state.store, before);
    } finally { unregister(); }
  });
}

test('null receipt requires exact canonical zero version and cannot silently accept another version', () => {
  const state = fixture(); const unregister = home();
  try {
    state.original.accepted_record_version_number = null;
    state.store.cloudSync.conflicted_metadata_attempts!.job = structuredClone(state.original);
    state.remote.recordVersionNumber = 0; state.remote.installation.recordVersionNumber = 0;
    applyResolvedMetadataConflict(state.store, state.original, state.remote, fence(state.store));
    assert.equal(state.store.cloudSync.resolved_metadata_conflicts![state.original.id]!.accepted_record_version_number, null);
  } finally { unregister(); }
});

test('session replacement or opening an editor at final commit discards the detached plan', () => {
  for (const mode of ['session', 'editor', 'lock'] as const) {
    const state = fixture(); let retained = false; let calls = 0;
    const unregister = registerAssignedWorkNavigationSnapshot(() => ({ routes: retained ? [{ params: { installationId: 'job' } }] : [] }));
    const before = structuredClone(state.store); let lock: ReturnType<typeof acquireInstallationRecovery> | undefined;
    try {
      assert.throws(() => applyResolvedMetadataConflict(state.store, state.original, state.remote, fence(state.store, () => {
        calls += 1; if (calls !== 4) return;
        if (mode === 'session') throw new Error('session replaced');
        if (mode === 'editor') retained = true;
        if (mode === 'lock') lock = acquireInstallationRecovery('job');
      })));
      assert.deepEqual(state.store, before);
    } finally { lock?.release(); unregister(); }
  }
});

test('resolved originals survive reload/deletion and follow only their actor into recovery copies', () => {
  const state = fixture(); const unregister = home();
  try { applyResolvedMetadataConflict(state.store, state.original, state.remote, fence(state.store)); }
  finally { unregister(); }
  const store = JSON.parse(JSON.stringify(state.store)) as AppDataStore;
  assert.equal(conflictRecoverySnapshot(store, 'job').cloudSync.resolved_metadata_conflicts.length, 1);
  const effects = applyLocalDeletionPlan(store, planLocalDeletion(store, { kind: 'form_draft', id: 'form' })!, stamp);
  assert.ok(effects.protectedFormAttachmentUris.includes('file:///original.jpg'));
  assert.ok(metadataHistoryLocalMediaReferences(store).includes('file:///preview.jpg'));
  const copy = quarantineAssignedWorkCheckout(store, 'job', 'other', { createRecoveryId: () => 'copy' });
  assert.deepEqual(copy.cloudSync.resolved_metadata_conflicts![0]!.original, state.original);
  assert.ok(assignedWorkRecoveryLocalMediaReferences(copy).includes('file:///original.jpg'));
  assert.equal(Object.keys(store.cloudSync.resolved_metadata_conflicts!).length, 0);
});

test('production accepted-conflict recovery uses only exact scoped GET and skips commit after actor/editor changes', async () => {
  for (const mode of ['ok', 'actor', 'editor', 'foreign', 'newer'] as const) {
    const state = fixture(); let current = true; let retained = false;
    const unregister = registerAssignedWorkNavigationSnapshot(() => ({ routes: retained ? [{ params: { installationId: 'job' } }] : [] }));
    try {
      const source = readFileSync(new URL('../src/services/syncService.ts', import.meta.url), 'utf8');
      const parsed = ts.createSourceFile('syncService.ts', source, ts.ScriptTarget.Latest, true);
      const fn = parsed.statements.find((item) => ts.isFunctionDeclaration(item) && item.name?.text === 'recoverAcceptedMetadataConflict')!;
      const events: string[] = []; const exports: any = {}; const cloudAuthority = {};
      const assertCurrent = () => { if (!current) throw new Error('actor changed'); };
      runInNewContext(ts.transpileModule(fn.getFullText(parsed) + '\nexports.run = recoverAcceptedMetadataConflict;',
        { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
        exports, Error, JSON, sha256, validateCanonicalRemoteTreeIds,
        assertCloudBackupRunAuthorityCurrent: assertCurrent,
        assertCurrentAcceptedMetadataConflict: (original: ConflictedMetadataBackupAttempt, check: () => void) => assertAcceptedMetadataConflictReadable(state.store, original, check),
        apiClient: { async pull(since: string, id: string, authority: unknown) {
          events.push('GET'); assert.equal(since, '1970-01-01T00:00:00.000Z'); assert.equal(id, 'job'); assert.equal(authority, cloudAuthority);
          if (mode === 'actor') current = false; if (mode === 'editor') retained = true;
          if (mode === 'foreign') state.remote.installation.id = 'other';
          if (mode === 'newer') { state.remote.treeRevision = 6; state.remote.installation.treeRevision = 6; }
          return { installations: [state.remote] };
        }, async push() { assert.fail('An acknowledged conflict must never POST'); } },
        getInstallationBackupTree: async () => buildInstallationBackupTree(state.store, state.store.installations[0]!),
        serverResultCommitFence: () => fence(state.store, assertCurrent),
        resolveAcceptedMetadataConflict: async (original: ConflictedMetadataBackupAttempt, remote: RemoteInstallationTree, guard: ReturnType<typeof fence>) => {
          events.push('commit'); applyResolvedMetadataConflict(state.store, original, remote, guard);
        },
      });
      if (mode === 'ok') { await exports.run(state.original, { actorUserId: 'actor', cloudAuthority }); assert.deepEqual(events, ['GET', 'commit']); }
      else { await assert.rejects(exports.run(state.original, { actorUserId: 'actor', cloudAuthority })); assert.ok(state.store.cloudSync.conflicted_metadata_attempts?.job); }
    } finally { unregister(); }
  }
});
