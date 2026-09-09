import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { normalizeCanonicalStore, bumpTreeRevision, projectCanonicalCompatibility } from '../src/domain/installationV2';
import {
  applyAcceptedCompleteBackupAttempt, applyFinishedCompleteBackupAttempt,
  applyPreparedCompleteBackupAttempt, applyServerTreeRevision, buildInstallationBackupTree,
} from '../src/repositories/cloudSyncRepository';
import { applyCleanAssignedRefresh, captureCleanAssignedRefreshBaseline } from '../src/services/assignedWorkCleanRefresh';
import { installationIdsRetainedByNavigation, registerAssignedWorkNavigationSnapshot } from '../src/services/assignedWorkNavigationFence';
import { buildBackupPayload, discoverBackupMedia } from '../src/services/backupMedia';
import { assignedWorkServerMetadataFromInstallation } from '../src/services/assignedWorkPolicy';
import { remoteInstallationWorkTreeFingerprint } from '../src/services/remoteInstallationRevision';
import type { AppDataStore, CloudUploadQueueItem } from '../src/types';

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

test('clean newer same-ID portal root and children replace together and persist a new clean pair', () => {
  const unregister = noScreens();
  try {
    const store = fixture();
    const other = { ...structuredClone(store.installations[0]!), id: 'other' };
    store.installations.push(other);
    const baseline = captureCleanAssignedRefreshBaseline(store, 'job', 'actor')!;
    assert.ok(baseline);
    const remote = incoming(store);
    remote.zones.push({ ...remote.zones[0]!, id: 'new-zone', zone_code: 'NEW', zone_name: 'New portal zone' });
    assert.equal(applyCleanAssignedRefresh(store, remote, baseline, later), true);
    assert.equal(store.installations[0]!.id, 'job');
    assert.equal(store.installations[0]!.maas, false);
    assert.equal(store.installations[0]!.custom_job_number, 'PORTAL-NEW');
    assert.equal(store.installations[0]!.job_comments, 'Portal notes');
    assert.equal(store.installations[0]!.tree_revision, 8);
    assert.equal(store.installations[0]!.last_synced_local_tree_revision, 8);
    assert.equal(store.installations[0]!.last_synced_server_tree_revision, 5);
    assert.equal(store.cloudSync.synced_at_by_installation.job, later);
    assert.equal(store.zones.length, 2);
    assert.equal(store.zones[0]!.zone_name, 'Portal zone');
    assert.deepEqual(store.installations[1], other);
    assert.ok(captureCleanAssignedRefreshBaseline(store, 'job', 'actor'));
    assert.equal(applyCleanAssignedRefresh(store, remote, baseline, later), false);
  } finally { unregister(); }
});

const blockers: Array<[string, (store: AppDataStore) => void]> = [
  ['unknown legacy baseline', (store) => { delete store.installations[0]!.last_synced_local_tree_revision; }],
  ['unknown legacy server baseline', (store) => { delete store.installations[0]!.last_synced_server_tree_revision; }],
  ['same-timestamp local edit', (store) => { store.installations[0]!.tree_revision! += 1; }],
  ['metadata push without final confirmation', (store) => { applyServerTreeRevision(store, 'job', 5); }],
  ['forced dirty', (store) => { store.cloudSync.force_dirty_installation_ids.push('job'); }],
  ['different local owner', (store) => { store.installations[0]!.local_owner_user_id = 'someone-else'; }],
  ['inactive assignment', (store) => { store.installations[0]!.assigned_work_state = 'inactive'; }],
  ['different assigned actor', (store) => { Object.assign(store.installations[0]!, { assigned_work_state: 'active', assigned_work_actor_user_id: 'someone-else' }); }],
  ['copy', (store) => { store.installations[0]!.is_imported_copy = true; }],
  ['completed record', (store) => { store.installations[0]!.status = 'Completed'; }],
  ['backup disabled', (store) => { store.installations[0]!.cloud_backup_enabled = false; }],
  ['pending completion', (store) => { store.installations[0]!.pending_completion = { baseTreeRevision: 4, idempotencyKey: 'pending', createdAt: stamp }; }],
  ['pending final backup', (store) => { store.cloudSync.pending_complete_attempts = { job: {} as never }; }],
  ['CAS conflict', (store) => { store.installations[0]!.backup_conflict = { kind: 'STALE_BASE' } as never; }],
  ['persisted asset draft', (store) => { store.siteAssetEditorDrafts = [{ installationId: 'job' } as never]; }],
  ['unconfirmed local media', (store) => { store.zones[0]!.photos = ['file:///unconfirmed.jpg']; }],
  ['unconfirmed upload row', (store) => { store.cloudSync.upload_queue.push({ installation_id: 'job', status: 'uploaded' } as never); }],
];
for (const [label, block] of blockers) test(`clean refresh refuses ${label} without mutating the record`, () => {
  const unregister = noScreens();
  try {
    const store = fixture();
    const baseline = captureCleanAssignedRefreshBaseline(store, 'job', 'actor')!;
    const remote = incoming(store);
    block(store);
    const before = structuredClone(store);
    assert.equal(captureCleanAssignedRefreshBaseline(store, 'job', 'actor'), null);
    assert.equal(applyCleanAssignedRefresh(store, remote, baseline, later), false);
    assert.deepEqual(store, before);
  } finally { unregister(); }
});

test('the snapshot fence catches an unversioned content or queue change while pull is in flight', () => {
  const unregister = noScreens();
  try {
    for (const mutate of [
      (store: AppDataStore) => { store.zones[0]!.zone_description = 'Unsaved after dispatch'; },
      (store: AppDataStore) => { store.installations[0]!.job_comments = 'Late note'; },
    ]) {
      const store = fixture();
      const baseline = captureCleanAssignedRefreshBaseline(store, 'job', 'actor')!;
      const remote = incoming(store);
      mutate(store);
      const before = structuredClone(store);
      assert.equal(applyCleanAssignedRefresh(store, remote, baseline, later), false);
      assert.deepEqual(store, before);
    }
  } finally { unregister(); }
});

test('missing navigator, retained covered editors, and opening an editor during pull defer replacement', () => {
  const store = fixture();
  assert.equal(captureCleanAssignedRefreshBaseline(store, 'job', 'actor'), null);
  let state: unknown = { routes: [{ name: 'MainTabs' }] };
  const unregister = registerAssignedWorkNavigationSnapshot(() => state);
  try {
    const baseline = captureCleanAssignedRefreshBaseline(store, 'job', 'actor')!;
    state = { index: 1, routes: [
      { name: 'FormEditor', params: { installationId: 'job' } },
      { name: 'Settings', state: { routes: [{ name: 'BoardDetail', params: { installationId: 'other' } }] } },
    ] };
    assert.deepEqual([...installationIdsRetainedByNavigation(state)].sort(), ['job', 'other']);
    assert.equal(captureCleanAssignedRefreshBaseline(store, 'job', 'actor'), null);
    assert.equal(applyCleanAssignedRefresh(store, incoming(store), baseline, later), false);
    state = { routes: [{ name: 'MainTabs' }] };
    assert.equal(applyCleanAssignedRefresh(store, incoming(store), baseline, later), true);
  } finally { unregister(); }
  assert.equal(captureCleanAssignedRefreshBaseline(store, 'job', 'actor'), null);
});

test('foreign, duplicate, local-file, completed, equal and regressed projections cannot replace a clean tree', () => {
  const unregister = noScreens();
  try {
    for (const mutate of [
      (tree: ReturnType<typeof incoming>) => { tree.installation.id = 'foreign'; },
      (tree: ReturnType<typeof incoming>) => { tree.installation.local_owner_user_id = 'foreign'; },
      (tree: ReturnType<typeof incoming>) => { tree.installation.status = 'Completed'; },
      (tree: ReturnType<typeof incoming>) => { tree.installation.server_tree_revision = 4; },
      (tree: ReturnType<typeof incoming>) => { tree.installation.server_tree_revision = 3; },
      (tree: ReturnType<typeof incoming>) => { tree.zones[0]!.audit_id = 'foreign'; },
      (tree: ReturnType<typeof incoming>) => { tree.zones.push(structuredClone(tree.zones[0]!)); },
      (tree: ReturnType<typeof incoming>) => { tree.zones[0]!.photos = ['file:///foreign.jpg']; },
    ]) {
      const store = fixture();
      const before = structuredClone(store);
      const baseline = captureCleanAssignedRefreshBaseline(store, 'job', 'actor')!;
      const remote = incoming(store);
      mutate(remote);
      assert.equal(applyCleanAssignedRefresh(store, remote, baseline, later), false);
      assert.deepEqual(store, before);
    }
  } finally { unregister(); }
});

test('confirmed originals and queue identities survive photo reorder, duplicate URLs, and legacy meter projection', () => {
  const unregister = noScreens();
  try {
    const store = fixture();
    store.zones[0]!.photos = ['file:///first.jpg', 'file:///second.jpg'];
    store.meterDevices.push({
      id: 'meter', installationId: 'job', installedOnBoardId: 'board', deviceFamily: 'WATTWATCHERS', deviceModel: 'A3RM',
      customName: 'Meter', serialNumber: '', displayName: { value: 'M-1', generatedValue: 'M-1', isOverridden: false, ruleVersion: 1 },
      channels: [], wwPhotos: { labeling: 'file:///meter.jpg' },
    });
    projectCanonicalCompatibility(store, 'job');
    const queue: CloudUploadQueueItem[] = discoverBackupMedia(buildInstallationBackupTree(store, store.installations[0]!))
      .map((reference, index) => ({ ...reference, id: `upload-${index}`, remote_url: `https://media.example.test/${index}`, status: 'cleared', attempts: 1, updated_at: stamp }));
    store.cloudSync.upload_queue = queue;
    const baseline = captureCleanAssignedRefreshBaseline(store, 'job', 'actor')!;
    const remote = incoming(store);
    remote.zones[0]!.photos = [queue[1]!.remote_url!, queue[0]!.remote_url!, queue[0]!.remote_url!];
    remote.meterDevices[0]!.wwPhotos!.labeling = queue[2]!.remote_url!;
    remote.electricalAssets[0]!.meters[0]!.ww_photos!.labeling = queue[2]!.remote_url!;
    assert.equal(applyCleanAssignedRefresh(store, remote, baseline, later), true);
    assert.deepEqual(store.zones[0]!.photos, ['file:///second.jpg', 'file:///first.jpg', 'file:///first.jpg']);
    assert.equal(store.meterDevices[0]!.wwPhotos!.labeling, 'file:///meter.jpg');
    assert.equal(store.electricalAssets[0]!.meters[0]!.ww_photos!.labeling, 'file:///meter.jpg');
    assert.equal(new Set(store.cloudSync.upload_queue.map((row) => row.id)).size, 4);
    const wire = buildBackupPayload(buildInstallationBackupTree(store, store.installations[0]!), store.cloudSync.upload_queue, 'complete');
    assert.deepEqual(wire.zones[0]!.photos, remote.zones[0]!.photos);
    assert.equal(wire.meterDevices[0]!.wwPhotos!.labeling, queue[2]!.remote_url);
    assert.ok(captureCleanAssignedRefreshBaseline(store, 'job', 'actor'));
  } finally { unregister(); }
});

test('only final exact accepted backup confirmation can establish a missing durable clean baseline', () => {
  const unregister = noScreens();
  try {
    const store = fixture();
    delete store.installations[0]!.last_synced_local_tree_revision;
    delete store.installations[0]!.last_synced_server_tree_revision;
    // Canonical reconciliation has already cleared provisional codes.
    store.electricalAssets[0]!.display_code_meta!.provisional = false;
    const tree = buildInstallationBackupTree(store, store.installations[0]!);
    const attempt = applyPreparedCompleteBackupAttempt(store, 'job', buildBackupPayload(tree, [], 'complete'), tree.watermark, 'Draft', 7);
    assert.equal(captureCleanAssignedRefreshBaseline(store, 'job', 'actor'), null);
    assert.throws(() => applyFinishedCompleteBackupAttempt(store, 'job', attempt.id));
    applyAcceptedCompleteBackupAttempt(store, 'job', attempt.id, 5, null);
    assert.throws(() => applyFinishedCompleteBackupAttempt(store, 'job', attempt.id));
    applyServerTreeRevision(store, 'job', 5);
    applyFinishedCompleteBackupAttempt(store, 'job', attempt.id);
    assert.equal(store.installations[0]!.last_synced_local_tree_revision, 7);
    assert.equal(store.installations[0]!.last_synced_server_tree_revision, 5);
    assert.ok(captureCleanAssignedRefreshBaseline(store, 'job', 'actor'));
    bumpTreeRevision(store, 'job');
    assert.equal(captureCleanAssignedRefreshBaseline(store, 'job', 'actor'), null);
  } finally { unregister(); }
});

/** Execute the production mapper and pull orchestration with controlled I/O. */
function pullHarness(
  store: AppDataStore,
  pull: (since?: string, installationId?: string, authority?: unknown) => Promise<unknown>,
) {
  let current = true;
  let beforeCommit: (() => void) | undefined;
  const assertCurrent = () => { if (!current) throw new Error('Session replaced'); };
  const file = new URL('../src/repositories/remoteInstallationsRepository.ts', import.meta.url);
  const localRequire = createRequire(file);
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports: Record<string, unknown> = {};
  runInNewContext(source, {
    exports, structuredClone, URL, setTimeout, clearTimeout,
    require: (name: string) => {
      if (name === '../api/apiClient') return { apiClient: { pull }, assertCurrentCloudSessionAuthority: assertCurrent };
      if (name === '../data/seed') return {
        getStore: () => store, initStore: async () => store,
        updateStore: async (mutate: (value: AppDataStore) => void) => { beforeCommit?.(); mutate(store); },
      };
      if (name === '../services/thumbnailCache') return {};
      if (name === '../services/authenticatedCloudAction') return {};
      if (name === '../services/assignedWorkMutationGuard') return {
        ...localRequire(name), captureAssignedWorkMutationAuthority: () => ({}),
        assertCurrentAssignedWorkAuthority: assertCurrent,
      };
      return localRequire(name);
    },
  });
  return {
    sync: (installationId?: string) => (exports.syncAssignedInstallations as (
      actor: string,
      authority: unknown,
      installationId?: string,
    ) => Promise<unknown>)('actor', {}, installationId),
    replaceSession: () => { current = false; },
    onCommit: (callback: () => void) => { beforeCommit = callback; },
  };
}

test('notification-scoped assigned refresh pulls only the notified installation', async () => {
  const unregister = noScreens();
  try {
    const store = fixture();
    let requestedSince: string | undefined;
    let requestedInstallationId: string | undefined;
    const response = remoteResponse(store);
    const harness = pullHarness(store, async (since, installationId) => {
      requestedSince = since;
      requestedInstallationId = installationId;
      return response;
    });
    await harness.sync('job');
    assert.equal(requestedSince, '1970-01-01T00:00:00.000Z');
    assert.equal(requestedInstallationId, 'job');
  } finally { unregister(); }
});

function remoteResponse(store: AppDataStore) {
  const remote = incoming(store);
  const payload = buildBackupPayload(remote, [], 'complete');
  return {
    pulledAt: later,
    installations: [{ ...payload, treeSchemaVersion: 2, treeRevision: 5, recordVersionNumber: 0, serverDerived: { virtualMeterDefinitions: [] },
      installation: { ...payload.installation, treeSchemaVersion: 2, treeRevision: 5, recordVersionNumber: 0, createdByUserId: 'actor', createdAt: stamp, updatedAt: later },
    }],
  };
}

test('production pull and canonical mapper refresh an existing clean record before metadata reconciliation', async () => {
  const unregister = noScreens();
  try {
    const store = fixture();
    const response = remoteResponse(store);
    const harness = pullHarness(store, async () => response);
    await harness.sync();
    assert.equal(store.installations.length, 1);
    assert.equal(store.installations[0]!.custom_job_number, 'PORTAL-NEW');
    assert.equal(store.installations[0]!.maas, false);
    assert.equal(store.zones[0]!.zone_name, 'Portal zone');
    assert.equal(store.installations[0]!.assigned_work_refresh_conflict, undefined);
    assert.equal(store.installations[0]!.server_tree_revision, 5);
    assert.ok(captureCleanAssignedRefreshBaseline(store, 'job', 'actor'));
  } finally { unregister(); }
});

test('production pull preserves canonical inactive meter lifecycle in local and legacy projections', async () => {
  const unregister = noScreens();
  try {
    const store = fixture();
    store.meterDevices.push({
      id: 'meter', installationId: 'job', installedOnBoardId: 'board',
      deviceFamily: 'WATTWATCHERS', deviceModel: 'A3RM', customName: 'Meter',
      serialNumber: 'SERIAL', lifecycleState: 'ACTIVE',
      displayName: { value: 'M-1', generatedValue: 'M-1', isOverridden: false, ruleVersion: 1 },
      channels: [1, 2, 3].map((ordinal) => ({
        id: `meter:${ordinal}`, ordinal, purpose: 'SPARE' as const,
      })),
    });
    projectCanonicalCompatibility(store, 'job');
    const response = remoteResponse(store);
    response.installations[0]!.meterDevices[0]!.lifecycleState = 'INACTIVE';
    const harness = pullHarness(store, async () => response);
    await harness.sync();
    assert.equal(store.meterDevices[0]!.lifecycleState, 'INACTIVE');
    assert.equal(store.electricalAssets[0]!.meters[0]!.lifecycle_state, 'INACTIVE');
  } finally { unregister(); }
});

test('production pull preserves local work changed after request capture', async () => {
  const unregister = noScreens();
  try {
    const store = fixture();
    const response = remoteResponse(store);
    const harness = pullHarness(store, async () => {
      store.zones[0]!.zone_name = 'New local work';
      bumpTreeRevision(store, 'job');
      return response;
    });
    await harness.sync();
    assert.equal(store.zones[0]!.zone_name, 'New local work');
    assert.equal(store.installations[0]!.server_tree_revision, 4);
    assert.equal(store.installations[0]!.assigned_work_refresh_conflict?.remote_tree_changed, true);
  } finally { unregister(); }
});

test('production pull rejects same-user relogin after fetch and inside the queued adoption commit', async () => {
  const unregister = noScreens();
  try {
    for (const replacementAt of ['fetch', 'commit']) {
      const store = fixture();
      const before = structuredClone(store);
      const response = remoteResponse(store);
      const harness = pullHarness(store, async () => {
        if (replacementAt === 'fetch') harness.replaceSession();
        return response;
      });
      if (replacementAt === 'commit') harness.onCommit(harness.replaceSession);
      await assert.rejects(harness.sync(), /Session replaced/);
      assert.deepEqual(store, before);
    }
  } finally { unregister(); }
});

test('accepted metadata-only merge keeps a proven pair usable after the retained workspace closes', async () => {
  let state: unknown = { routes: [{ name: 'InstallationDetail', params: { installationId: 'job' } }] };
  const unregister = registerAssignedWorkNavigationSnapshot(() => state);
  try {
    const store = fixture();
    const response = remoteResponse(store);
    response.installations[0]!.zones = buildBackupPayload(buildInstallationBackupTree(store, store.installations[0]!), [], 'complete').zones;
    store.installations[0]!.assigned_work_server_metadata_base = assignedWorkServerMetadataFromInstallation(store.installations[0]!);
    store.installations[0]!.assigned_work_server_tree_fingerprint = remoteInstallationWorkTreeFingerprint(response.installations[0] as never);
    await pullHarness(store, async () => response).sync();
    assert.equal(store.installations[0]!.server_tree_revision, 5);
    assert.equal(store.installations[0]!.last_synced_server_tree_revision, 5);
    assert.equal(store.zones[0]!.zone_name, 'Zone');
    assert.equal(captureCleanAssignedRefreshBaseline(store, 'job', 'actor'), null);
    state = { routes: [{ name: 'MainTabs' }] };
    assert.ok(captureCleanAssignedRefreshBaseline(store, 'job', 'actor'));
    const next = remoteResponse(store);
    next.installations[0]!.treeRevision = 6;
    next.installations[0]!.installation.treeRevision = 6;
    await pullHarness(store, async () => next).sync();
    assert.equal(store.installations[0]!.server_tree_revision, 6);
    assert.equal(store.zones[0]!.zone_name, 'Portal zone');
    assert.ok(captureCleanAssignedRefreshBaseline(store, 'job', 'actor'));
  } finally { unregister(); }
});

test('accepted metadata-only merge never seeds a legacy or locally dirty pair', async () => {
  const unregister = registerAssignedWorkNavigationSnapshot(() => ({ routes: [{ params: { installationId: 'job' } }] }));
  try {
    for (const legacy of [true, false]) {
      const store = fixture();
      const response = remoteResponse(store);
      response.installations[0]!.zones = buildBackupPayload(buildInstallationBackupTree(store, store.installations[0]!), [], 'complete').zones;
      store.installations[0]!.assigned_work_server_metadata_base = assignedWorkServerMetadataFromInstallation(store.installations[0]!);
      store.installations[0]!.assigned_work_server_tree_fingerprint = remoteInstallationWorkTreeFingerprint(response.installations[0] as never);
      if (legacy) delete store.installations[0]!.last_synced_server_tree_revision;
      else store.installations[0]!.tree_revision! += 1;
      await pullHarness(store, async () => response).sync();
      assert.equal(store.installations[0]!.server_tree_revision, 5);
      assert.equal(store.installations[0]!.last_synced_server_tree_revision, legacy ? undefined : 4);
      assert.equal(captureCleanAssignedRefreshBaseline(store, 'job', 'actor'), null);
    }
  } finally { unregister(); }
});
