import { commitStoreDocument, STORE_MANIFEST_KEY, parseStoreManifest, joinAndVerifyStoreDocument, storeChunkKeys, type StorePersistenceAdapter } from '../src/data/storePersistence';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { normalizeCanonicalStore } from '../src/domain/installationV2';
import { buildInstallationBackupTree } from '../src/repositories/cloudSyncRepository';
import { buildBackupPayload } from '../src/services/backupMedia';
import { captureCleanAssignedRefreshBaseline, projectionIsScopedToInstallation } from '../src/services/assignedWorkCleanRefresh';
import { captureConflictRecoveryBaseline, conflictRecoverySnapshot } from '../src/services/assignedWorkConflictRecoveryState';
import { acquireInstallationRecovery, installationRecoveryIsActive, assertInstallationNotRecovering } from '../src/services/installationRecoveryFence';
import { assignedWorkRecoveryLocalMediaReferences, buildAssignedWorkRecoveryManifest, quarantineAssignedWorkCheckout } from '../src/services/assignedWorkRecovery';
import { planLocalDeletion, applyLocalDeletionPlan } from '../src/repositories/deletionIntegrity';
import { preserveSameActorRecoveryCheckout } from '../src/services/assignedWorkRecovery';
import { activeTimeSessionMayDeliverFromLocalState } from '../src/services/activeTimeDeliveryPolicy';
import { registerAssignedWorkNavigationSnapshot } from '../src/services/assignedWorkNavigationFence';
import type { AppDataStore } from '../src/types';
import type { StoredActiveTimeSession } from '../src/services/activeTimeOutbox';
import type { ConflictRecoveryReview } from '../src/services/assignedWorkConflictRecovery';

const stamp = '2026-09-05T10:00:00.000Z';
const later = '2026-09-05T11:00:00.000Z';
const noScreens = () => registerAssignedWorkNavigationSnapshot(() => ({ routes: [{ name: 'MainTabs' }] }));
function fixture(): AppDataStore {
  return normalizeCanonicalStore({
    schemaVersion: 3,
    user: { id: 'actor', email: 'actor@example.test', full_name: 'Actor', role: 'admin' },
    installations: [{
      id: 'job', client_name: 'Client', site_name: 'Site', site_address: '1 Example Road, Sydney NSW 2000', inspector_name: '', audit_date: '',
      status: 'Draft', cloud_backup_enabled: true, local_owner_user_id: 'actor', assigned_work_state: 'none',
      created_at: stamp, updated_at: stamp, tree_schema_version: 2, tree_revision: 7, server_tree_revision: 4,
      timezone: 'Australia/Sydney',
      last_synced_local_tree_revision: 7, last_synced_server_tree_revision: 4,
      maas: true, custom_job_number: 'OLD', job_comments: 'Previous notes',
    }],
    gridSupplies: [{ id: 'grid', installationId: 'job', name: 'Grid', isDefault: true }],
    zones: [{ id: 'zone', audit_id: 'job', zone_name: 'Zone', zone_code: 'Z', zone_description: '', photos: [], created_at: stamp, updated_at: stamp }],
    electricalAssets: [{
      id: 'board', audit_id: 'job', zone_id: 'zone', asset_name: 'Board', asset_type: 'MSB', type_code: 'MSB',
      electrical_source: { kind: 'GRID', gridSupplyId: 'grid' }, meter_present: false, meters: [],
      display_code: 'MSB-1', created_at: stamp, updated_at: stamp,
    }],
    siteAssets: [], meterDevices: [], measurementAssignments: [], formSubmissions: [],
    cloudSync: { synced_at_by_installation: { job: stamp }, force_dirty_installation_ids: [], upload_queue: [], thumbnail_queue: [] },
  });
}

function incoming(store: AppDataStore) {
  const tree = buildInstallationBackupTree(store, store.installations[0]!);
  tree.baseTreeRevision = 5;
  tree.installation.server_tree_revision = 5;
  tree.installation.tree_revision = 5;
  tree.installation.updated_at = later;
  tree.installation.maas = false;
  tree.installation.custom_job_number = 'PORTAL-NEW';
  tree.installation.job_comments = 'Portal notes';
  tree.zones[0]!.zone_name = 'Portal zone';
  tree.zones[0]!.updated_at = later;
  tree.watermark = later;
  return tree;
}


function dirtyFixture() {
  const store = fixture();
  delete store.installations[0]!.last_synced_local_tree_revision;
  Object.assign(store.installations[0]!, {
    assigned_work_refresh_conflict: { kind: 'remote_tree_changed', localTreeRevision: 7, serverTreeRevision: 5 },
    job_comments: 'Unsent native work', unknown_local_capture: { value: 'retain exactly' },
  });
  store.zones[0]!.photos = ['file:///original.jpg'];
  store.siteAssets = [{ id: 'local-asset', audit_id: 'job', zone_id: 'zone', asset_name: 'Unsent asset', location_photo: 'file:///asset.jpg' } as never];
  store.meterDevices = [{ id: 'local-meter', installationId: 'job', installedOnBoardId: 'board', deviceFamily: 'WATTWATCHERS', deviceModel: 'A3RM',
    channels: [{ id: 'original-channel', channelNumber: 1, additionalCapture: 'retain' }], wwPhotos: { labeling: 'file:///meter.jpg' } } as never];
  store.measurementAssignments = [{ id: 'original-assignment', installationId: 'job', channelIds: ['original-channel'], targetSiteAssetId: 'local-asset' } as never];
  store.siteAssetEditorDrafts = [{ installationId: 'job', userId: 'actor', payload: { locationPhoto: 'file:///draft.jpg', nestedUnknown: { value: 3 } } } as never];
  store.formSubmissions = [{ id: 'local-form', installation_id: 'job', zone_id: 'zone', attachments: [{ id: 'attachment-original', uri: 'file:///form.jpg' }], values: { unknown: 'retain' } } as never];
  store.cloudSync.force_dirty_installation_ids = ['job'];
  store.cloudSync.upload_queue = [{ id: 'upload-original', installation_id: 'job', status: 'failed', local_uri: 'file:///original.jpg', attempts: 2 } as never];
  store.cloudSync.thumbnail_queue = [{ id: 'preview-original', installation_id: 'job', status: 'ready', local_uri: 'file:///preview.jpg' } as never];
  store.cloudSync.conflicted_complete_attempts = { job: { id: 'conflicted-receipt', payload: { original: true } } as never };
  return store;
}
function remoteResponse() {
  const payload = buildBackupPayload(incoming(fixture()), [], 'complete');
  return { pulledAt: later, installations: [{ ...payload, treeSchemaVersion: 2, treeRevision: 5, recordVersionNumber: 0,
    serverDerived: { virtualMeterDefinitions: [] },
    installation: { ...payload.installation, treeSchemaVersion: 2, treeRevision: 5, recordVersionNumber: 0, createdByUserId: 'actor', createdAt: stamp, updatedAt: later },
  }] };
}
const timeSession = (): StoredActiveTimeSession => ({ sessionId: 'original-time', actorUserId: 'actor', installationId: 'job', startedAt: stamp,
  endedAt: later, lastActiveAt: later, activeMilliseconds: 12000, revision: 3, acknowledgedRevision: 1, serverParentConfirmed: true } as StoredActiveTimeSession);

/** Production confirmation -> canonical mapper, replacing only native I/O and
 * executing real chunked store persistence; the updateStore wrapper mirrors seed's rollback contract. */
function recoveryHarness(initial = dirtyFixture()) {
  let store = initial;
  let current = true;
  let backupRunning = false;
  let failPersist = false;
  let beforeCommit: (() => void) | undefined;
  let duringPull: (() => void) | undefined;
  let response = remoteResponse();
  let pulls = 0;
  let commits = 0;
  let checkpoints = 0;
  let resumes = 0;
  const time = { sessions: [timeSession()] };
  const assertCurrent = () => { if (!current) throw new Error('Session replaced'); };
  const lease = { actorUserId: 'actor', processAuthority: {}, cloudAuthority: {}, assertCurrent };
  const storageRows = new Map<string, string>();
  let generation = 0;
  const storage: StorePersistenceAdapter = {
    getItem: async (key) => storageRows.get(key) ?? null,
    setItem: async (key, value) => { storageRows.set(key, value); },
    multiSet: async (entries) => {
      for (const [key, value] of entries) {
        storageRows.set(key, value);
        if (failPersist) throw new Error('Disk full');
      }
    },
    multiGet: async (keys) => keys.map((key) => [key, storageRows.get(key) ?? null]),
    multiRemove: async (keys) => { keys.forEach((key) => storageRows.delete(key)); },
  };
  const persist = () => commitStoreDocument({ storage, document: JSON.stringify(store), generation: `recovery-test-${generation++}`, storeSchemaVersion: 3, writtenAt: later });
  const seed = {
    getStore: () => store, initStore: async () => {
      if (!storageRows.has(STORE_MANIFEST_KEY)) await persist();
      return store;
    },
    updateStore: async (mutate: (value: AppDataStore) => void) => {
      beforeCommit?.();
      const before = structuredClone(store);
      try { mutate(store); await persist(); commits += 1; }
      catch (error) { store = before; throw error; }
    },
  };
  const api = { apiClient: { pull: async () => { pulls += 1; duringPull?.(); return structuredClone(response); } }, assertCurrentCloudSessionAuthority: assertCurrent };
  const load = (relative: string, extra: Record<string, unknown> = {}) => {
    const file = new URL(relative, import.meta.url);
    const localRequire = createRequire(file);
    const exports: Record<string, any> = {};
    runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, structuredClone, URL, setTimeout, clearTimeout,
      require: (name: string) => {
        if (name in extra) return extra[name];
        if (name.endsWith('/apiClient')) return api;
        if (name.endsWith('/seed')) return seed;
        if (name.endsWith('/thumbnailCache')) return {};
        if (name.endsWith('/authenticatedCloudAction')) return { captureAuthenticatedCloudActionLease: async () => lease };
        if (name.endsWith('/assignedWorkMutationGuard')) return {
          ...localRequire(name), captureAssignedWorkMutationAuthority: () => ({}), assertCurrentAssignedWorkAuthority: assertCurrent,
        };
        return localRequire(name);
      },
    });
    return exports;
  };
  const repository = load('../src/repositories/remoteInstallationsRepository.ts');
  const recovery = load('../src/services/assignedWorkConflictRecovery.ts', {
    './syncService': { cloudBackupIsRunning: () => backupRunning },
    './auditWorkTrackingBridge': {
      suspendAuditWorkForInstallation: async () => { checkpoints += 1; return { id: 'suspend-token' }; },
      resumeAuditWorkForInstallation: async (_: unknown, authority: { isCurrent(): boolean }) => { if (authority.isCurrent()) resumes += 1; return authority.isCurrent(); },
    },
    './activeTimeOutbox': { getActiveTimeOutboxStore: async () => ({ read: async () => structuredClone(time) }) },
    '../repositories/remoteInstallationsRepository': repository,
  });
  return {
    prepare: () => recovery.prepareAssignedWorkConflictRecovery('job') as Promise<ConflictRecoveryReview>,
    confirm: (review: ConflictRecoveryReview) => recovery.confirmAssignedWorkConflictRecovery(review) as Promise<string>,
    sync: () => repository.syncAssignedInstallations('actor', {}),
    state: () => store,
    readPersisted: async () => {
      const manifest = parseStoreManifest(storageRows.get(STORE_MANIFEST_KEY)!);
      return JSON.parse(joinAndVerifyStoreDocument(manifest, await storage.multiGet(storeChunkKeys(manifest)))) as AppDataStore;
    },
    time, counters: () => ({ pulls, commits, checkpoints, resumes }),
    expire: () => { current = false; }, runningBackup: () => { backupRunning = true; },
    failPersistence: () => { failPersist = true; },
    onPull: (fn: () => void) => { duringPull = fn; }, onCommit: (fn: () => void) => { beforeCommit = fn; },
    changeServer: (fn: (tree: ReturnType<typeof remoteResponse>) => void) => fn(response),
    load,
  };
}

test('production review and confirmation preserve exact dirty state and atomically adopt same canonical IDs', async () => {
  const unregister = noScreens();
  try {
    const harness = recoveryHarness();
    const before = structuredClone(conflictRecoverySnapshot(harness.state(), 'job'));
    const beforeTime = structuredClone(harness.time);
    const review = await harness.prepare();
    assert.equal(harness.counters().commits, 0);
    assert.equal(await harness.confirm(review), review.operationId);
    const after = harness.state();
    const archive = after.assignedWorkRecoveryCheckouts![0]!;
    for (const key of Object.keys(before)) assert.deepEqual(archive[key as keyof typeof archive], before[key as keyof typeof before], key);
    assert.equal(archive.reason, 'same_actor_reconciliation');
    assert.equal(archive.reconciliation!.operationId, review.operationId);
    assert.deepEqual(archive.reconciliation!.activeTimeSessions, beforeTime.sessions);
    assert.deepEqual((await harness.readPersisted()).assignedWorkRecoveryCheckouts, JSON.parse(JSON.stringify(after.assignedWorkRecoveryCheckouts)), 'real persistence generation reload retains the complete archive');
    assert.deepEqual(harness.time, beforeTime, 'time IDs, revisions and acknowledgements remain unchanged');
    assert.deepEqual(assignedWorkRecoveryLocalMediaReferences(archive), ['file:///asset.jpg', 'file:///draft.jpg', 'file:///form.jpg', 'file:///meter.jpg', 'file:///original.jpg', 'file:///preview.jpg']);
    assert.equal(after.installations.length, 1);
    assert.equal(after.installations[0]!.id, 'job');
    assert.equal(after.zones[0]!.id, 'zone');
    assert.equal(after.electricalAssets[0]!.id, 'board');
    assert.equal(after.installations[0]!.job_comments, 'Portal notes');
    assert.ok(captureCleanAssignedRefreshBaseline(after, 'job', 'actor'));
    assert.equal(after.cloudSync.upload_queue.length, 0);
    assert.equal(after.cloudSync.thumbnail_queue.length, 0);
    assert.equal(after.siteAssetEditorDrafts!.length, 0);
    assert.equal(after.formSubmissions.length, 0);
    after.zones[0]!.zone_name = 'New canonical edit';
    assert.equal(archive.zones[0]!.zone_name, before.zones[0]!.zone_name, 'no shared references');
    assert.equal(activeTimeSessionMayDeliverFromLocalState(after, timeSession(), 'actor'), true);
    const laterTime = { ...timeSession(), sessionId: 'new-after-recovery' };
    const manifest = buildAssignedWorkRecoveryManifest(archive, [...beforeTime.sessions, laterTime]);
    assert.equal(manifest.activeTime.disposition, 'canonical_same_actor_outbox_unchanged');
    assert.deepEqual(manifest.activeTime.pendingSessions, beforeTime.sessions, 'frozen recovery time excludes later canonical sessions');
    assert.equal(await harness.confirm(review), review.operationId, 'repeated confirmation is idempotent');
    assert.equal(after.assignedWorkRecoveryCheckouts!.length, 1);
    assert.deepEqual(harness.counters(), { pulls: 2, commits: 1, checkpoints: 1, resumes: 1 });
    assert.equal(installationRecoveryIsActive('job'), false);
  } finally { unregister(); }
});

for (const assigned of [false, true]) test(`an unchanged background pull preserves an open recovery review (assigned=${assigned})`, async () => {
  const unregister = noScreens();
  try {
    const h = recoveryHarness();
    if (assigned) h.changeServer((response) => Object.assign(response.installations[0]!.installation,
      { createdByUserId: 'other-owner', assignedInspectorUserId: 'actor' }));
    await h.sync();
    const review = await h.prepare();
    const original = structuredClone(conflictRecoverySnapshot(h.state(), 'job'));
    h.changeServer((response) => { response.pulledAt = '2026-09-05T12:00:00.000Z'; });
    await h.sync();
    assert.deepEqual(conflictRecoverySnapshot(h.state(), 'job'), original,
      'an identical conflict retains its first detection time and exact local review snapshot');
    assert.equal(await h.confirm(review), review.operationId);
  } finally { unregister(); }
});

test('changed assigned-job summary still invalidates an open recovery review', async () => {
  const unregister = noScreens();
  try {
    const h = recoveryHarness();
    h.changeServer((response) => Object.assign(response.installations[0]!.installation,
      { createdByUserId: 'other-owner', assignedInspectorUserId: 'actor' }));
    await h.sync();
    const review = await h.prepare();
    h.changeServer((response) => {
      response.pulledAt = '2026-09-05T12:00:00.000Z';
      Object.assign(response.installations[0]!.installation, { scheduledStartAt: '2026-09-06T09:00:00.000Z' });
    });
    await h.sync();
    assert.equal(h.state().installations[0]!.assigned_work_job_summary!.pulled_at, '2026-09-05T12:00:00.000Z');
    await assert.rejects(h.confirm(review), /Device work changed/);
    assert.equal(h.state().assignedWorkRecoveryCheckouts?.length ?? 0, 0);
  } finally { unregister(); }
});

for (const boundary of ['after review', 'during pull', 'before commit'] as const) test(`production recovery refuses local change ${boundary}`, async () => {
  const unregister = noScreens();
  try {
    const h = recoveryHarness(); const review = await h.prepare();
    const mutate = () => { h.state().zones[0]!.zone_description = 'New local capture'; };
    if (boundary === 'after review') mutate();
    if (boundary === 'during pull') h.onPull(mutate);
    if (boundary === 'before commit') h.onCommit(mutate);
    await assert.rejects(h.confirm(review), /Device work changed/);
    assert.equal(h.state().zones[0]!.zone_description, 'New local capture');
    assert.equal(h.state().assignedWorkRecoveryCheckouts?.length ?? 0, 0);
    assert.equal(h.counters().commits, 0); assert.equal(installationRecoveryIsActive('job'), false);
  } finally { unregister(); }
});

for (const boundary of ['during pull', 'before commit'] as const) test(`production recovery refuses replaced session ${boundary}`, async () => {
  const unregister = noScreens();
  try {
    const h = recoveryHarness(); const review = await h.prepare(); const before = structuredClone(h.state());
    if (boundary === 'during pull') h.onPull(h.expire); else h.onCommit(h.expire);
    await assert.rejects(h.confirm(review), /Session replaced/);
    assert.deepEqual(h.state(), before); assert.equal(h.counters().resumes, 0);
    assert.equal(installationRecoveryIsActive('job'), false);
  } finally { unregister(); }
});

test('production recovery storage failure leaves the complete original checkout and no archive', async () => {
  const unregister = noScreens();
  try {
    const h = recoveryHarness(); const review = await h.prepare(); const before = structuredClone(h.state()); h.failPersistence();
    await assert.rejects(h.confirm(review), /Disk full/);
    assert.deepEqual(h.state(), before);
    assert.deepEqual(await h.readPersisted(), JSON.parse(JSON.stringify(before)), 'partial storage write does not advance durable generation');
    assert.equal(h.counters().commits, 0);
    assert.equal(h.counters().resumes, 1); assert.equal(installationRecoveryIsActive('job'), false);
  } finally { unregister(); }
});

for (const [label, mutation, pattern] of [
  ['server revision advanced', (r: ReturnType<typeof remoteResponse>) => { r.installations[0]!.treeRevision = 6; }, /changed after review/],
  ['same-revision server content changed', (r: ReturnType<typeof remoteResponse>) => { r.installations[0]!.zones[0]!.zoneName = 'Changed'; }, /changed after review/],
  ['assignment changed', (r: ReturnType<typeof remoteResponse>) => { r.installations[0]!.installation.createdByUserId = 'other'; }, /no longer owned/],
  ['server completed', (r: ReturnType<typeof remoteResponse>) => { r.installations[0]!.installation.status = 'Completed'; }, /no longer Draft/],
] as const) test(`production confirmation rejects ${label}`, async () => {
  const unregister = noScreens();
  try {
    const h = recoveryHarness(); const review = await h.prepare(); const before = structuredClone(h.state()); h.changeServer(mutation);
    await assert.rejects(h.confirm(review), pattern); assert.deepEqual(h.state(), before);
  } finally { unregister(); }
});

test('running backup and a retained editor block recovery with no mutation', async () => {
  let state: unknown = { routes: [{ name: 'MainTabs' }] };
  const unregister = registerAssignedWorkNavigationSnapshot(() => state);
  try {
    const h = recoveryHarness(); const review = await h.prepare(); h.runningBackup();
    await assert.rejects(h.confirm(review), /Cloud Backup to finish/);
    const other = recoveryHarness(); const otherReview = await other.prepare();
    state = { routes: [{ name: 'FormEditor', params: { installationId: 'job' } }] };
    await assert.rejects(other.confirm(otherReview), /close all installation editors/);
    assert.equal(other.counters().commits + h.counters().commits, 0);
  } finally { unregister(); }
});

for (const [label, mutate] of [
  ['foreign actor', (s: AppDataStore) => { s.installations[0]!.local_owner_user_id = 'other'; }],
  ['inactive', (s: AppDataStore) => { s.installations[0]!.assigned_work_state = 'inactive'; }],
  ['completed', (s: AppDataStore) => { s.installations[0]!.status = 'Completed'; }],
  ['copy', (s: AppDataStore) => { s.installations[0]!.is_imported_copy = true; }],
  ['final backup receipt', (s: AppDataStore) => { s.cloudSync.pending_complete_attempts = { job: {} as never }; }],
  ['pending completion', (s: AppDataStore) => { s.installations[0]!.pending_completion = {} as never; }],
  ['upload in flight', (s: AppDataStore) => { s.cloudSync.upload_queue[0]!.status = 'uploading'; }],
  ['thumbnail in flight', (s: AppDataStore) => { s.cloudSync.thumbnail_queue[0]!.status = 'downloading'; }],
  ['foreign editor draft', (s: AppDataStore) => { s.siteAssetEditorDrafts![0]!.userId = 'other'; }],
] as const) test(`recovery baseline refuses ${label}`, () => {
  const unregister = noScreens();
  try { const store = dirtyFixture(); mutate(store); const before = structuredClone(store);
    assert.throws(() => captureConflictRecoveryBaseline(store, 'job', 'actor')); assert.deepEqual(store, before);
  } finally { unregister(); }
});

test('reassignment quarantine still suppresses old actor time and same-actor quarantine cannot be called accidentally', () => {
  const store = dirtyFixture();
  assert.throws(() => quarantineAssignedWorkCheckout(store, 'job', 'actor'));
  quarantineAssignedWorkCheckout(store, 'job', 'other');
  assert.equal(activeTimeSessionMayDeliverFromLocalState(store, timeSession(), 'actor'), false);
});

test('recovery exclusive fence rejects another operation and stale ordinary pull commits', async () => {
  const unregister = noScreens();
  const lock = acquireInstallationRecovery('job');
  try {
    assert.throws(() => acquireInstallationRecovery('job'), /being recovered/);
    assert.throws(() => assertInstallationNotRecovering('job'), /being recovered/);
    const h = recoveryHarness(); const before = structuredClone(h.state());
    await assert.rejects(h.sync(), /being recovered/); assert.deepEqual(h.state(), before);
  } finally { lock.release(); unregister(); }
});


test('backup dispatch, backup recovery and thumbnail claims are blocked by the operation lease', async () => {
  const h = recoveryHarness();
  const repo = h.load('../src/repositories/cloudSyncRepository.ts');
  const lock = acquireInstallationRecovery('job');
  try {
    assert.throws(() => repo.assertInstallationAllowsNewBackupDispatch('job', 'actor'), /dispatch stopped/);
    assert.throws(() => repo.assertInstallationAllowsBackupRecovery('job', 'actor'), /recovery stopped/);
    const before = structuredClone(h.state().cloudSync.thumbnail_queue);
    assert.equal(await repo.updateThumbnailDownload('preview-original', { status: 'downloading' }, 'actor', {}), false);
    assert.deepEqual(h.state().cloudSync.thumbnail_queue, before);
  } finally { lock.release(); }
});

for (const scenario of ['recovery starts', 'copy archived'] as const) test(`thumbnail cleanup fails closed when ${scenario} during native module load`, async () => {
  const h = recoveryHarness();
  let lock: ReturnType<typeof acquireInstallationRecovery> | undefined;
  let deleted = 0;
  const fileSystem = {};
  // This getter runs after the initial ownership/archive read at the awaited
  // module boundary, matching a recovery racing cache cleanup's module load.
  Object.defineProperty(fileSystem, 'File', { get: () => {
    if (scenario === 'recovery starts') lock = acquireInstallationRecovery('job');
    else preserveSameActorRecoveryCheckout(h.state(), 'job', 'actor', {
      operationId: 'cache-race-copy', localSnapshotSha256: 'local', serverTreeSha256: 'server', serverTreeRevision: 5, activeTimeSessions: [],
    });
    return class { exists = true; size = 10; delete() { deleted += 1; } };
  } });
  const diagnostics = h.load('../src/services/storageDiagnostics.ts', { 'expo-file-system': fileSystem });
  try {
    await assert.rejects(diagnostics.clearImportedThumbnailCache('actor'), /being recovered|retained by a recovery/);
    assert.equal(deleted, 0);
    if (scenario === 'copy archived') assert.equal(h.state().assignedWorkRecoveryCheckouts![0]!.cloudSync.thumbnail_queue[0]!.local_uri, 'file:///preview.jpg');
  } finally { lock?.release(); }
});

test('deleting the adopted canonical job keeps all archived original evidence protected', async () => {
  const unregister = noScreens();
  try {
    const h = recoveryHarness(); await h.confirm(await h.prepare());
    const store = h.state();
    const plan = planLocalDeletion(store, { kind: 'installation', id: 'job' })!;
    const effects = applyLocalDeletionPlan(store, plan, later);
    const protectedUris = [...effects.protectedEntityMediaUris, ...effects.protectedFormAttachmentUris];
    assert.ok(protectedUris.includes('file:///original.jpg'));
    assert.ok(protectedUris.includes('file:///form.jpg'));
    assert.equal(store.assignedWorkRecoveryCheckouts!.length, 1);
    assert.equal(store.assignedWorkRecoveryCheckouts![0]!.formSubmissions[0]!.id, 'local-form');
    assert.equal(effects.orphanedThumbnailCacheUris.includes('file:///preview.jpg'), false);
  } finally { unregister(); }
});

test('replacement scope rejects foreign channel identities but permits attachment reuse by form amendments', () => {
  const store = fixture(); const tree = incoming(store);
  tree.meterDevices.push({ id: 'meter', installationId: 'job', channels: [{ id: 'channel-shared' }] } as never);
  store.meterDevices.push({ id: 'foreign-meter', installationId: 'other', channels: [{ id: 'channel-shared' }] } as never);
  assert.equal(projectionIsScopedToInstallation(store, tree), false);
  store.meterDevices = [];
  tree.formSubmissions.push({ id: 'form', installation_id: 'job', attachments: [{ id: 'attachment-shared' }] } as never);
  store.formSubmissions.push({ id: 'foreign-form', installation_id: 'other', attachments: [{ id: 'attachment-shared' }] } as never);
  tree.formSubmissions.push({ ...tree.formSubmissions[0]!, id: 'amendment' });
  assert.equal(projectionIsScopedToInstallation(store, tree), true, 'attachment identity is scoped to forms and reused by amendments');
});


test('a newly started backup engine cannot replay a pending upload session while recovery owns the job', async () => {
  const store = dirtyFixture();
  delete store.installations[0]!.assigned_work_refresh_conflict;
  store.installations[0]!.backup_conflict = { kind: 'CONFLICT' } as never;
  Object.assign(store.cloudSync.upload_queue[0]!, { session_id: 'durable-session', checksum: 'checksum' });
  const h = recoveryHarness(store);
  const repo = h.load('../src/repositories/cloudSyncRepository.ts');
  assert.equal((await repo.listInstallationsNeedingBackup('actor')).length, 1, 'fixture is otherwise eligible for confirmation replay');
  let writes = 0;
  const api = { apiClient: { confirmUpload: () => { writes += 1; throw new Error('Unexpected confirmation'); }, push: () => { writes += 1; throw new Error('Unexpected push'); } } };
  const engine = h.load('../src/services/syncService.ts', {
    'expo-file-system': {}, '../api/apiClient': api, '../repositories': {},
    '../repositories/cloudSyncRepository': repo, './operationalDiagnostics': {},
  });
  assert.equal(engine.cloudBackupIsRunning(), false);
  const lock = acquireInstallationRecovery('job');
  try {
    assert.equal((await repo.listInstallationsNeedingBackup('actor')).length, 0);
    await assert.rejects(engine.runCloudBackup(() => {}, { identity: {}, actorUserId: 'actor' }), /recovery to finish/);
    assert.equal(writes, 0); assert.equal(engine.cloudBackupIsRunning(), false);
  } finally { lock.release(); }
});

test('thumbnail selection skips a locked job and continues another actor-owned job without retry spin', async () => {
  const store = dirtyFixture();
  store.installations.push({ ...store.installations[0]!, id: 'other-job', is_imported_copy: true });
  store.installations[0]!.is_imported_copy = true;
  store.cloudSync.thumbnail_queue = [
    { id: 'locked-preview', installation_id: 'job', status: 'pending', attempts: 0, remote_uri: 'https://example.test/one' },
    { id: 'available-preview', installation_id: 'other-job', status: 'pending', attempts: 0, remote_uri: 'https://example.test/two' },
  ] as never;
  const h = recoveryHarness(store); const repo = h.load('../src/repositories/cloudSyncRepository.ts');
  const lock = acquireInstallationRecovery('job');
  try {
    const next = await repo.getNextThumbnailDownload('actor', {});
    assert.equal(next?.id, 'available-preview');
    assert.equal(h.counters().commits, 0);
  } finally { lock.release(); }
});
