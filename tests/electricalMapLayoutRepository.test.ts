import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import type { AppDataStore } from '../src/types';
import type { RemoteInstallationTree } from '../src/api/apiClient';
import type * as Repository from '../src/repositories/electricalMapLayoutRepository';
import * as layoutDomain from '../src/domain/electricalMapLayout';
import { normalizeCanonicalStore } from '../src/domain/installationV2';
import { buildInstallationBackupTree } from '../src/repositories/cloudSyncRepository';
import * as fences from '../src/services/serverResultCommitFence';
import * as leases from '../src/services/cloudActionLease';
import * as policy from '../src/services/assignedWorkPolicy';
import * as revisions from '../src/services/remoteInstallationRevision';
import * as mapping from '../src/services/pinnedInstallationMapping';
import * as versioning from '../src/services/reportVersioning';
import * as packTarget from '../src/services/installationPackTarget';

const code = ts.transpileModule(readFileSync(new URL('../src/repositories/electricalMapLayoutRepository.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const timestamp = '2026-09-05T00:00:00.000Z';
function harness(scenario = 'success', confirmedPair = true) {
  const store = normalizeCanonicalStore({
    user: { id: 'owner', email: 'owner@example.test', full_name: 'Owner', role: 'admin' },
    installations: [{ id: 'i', client_name: 'Client', site_name: 'Site', site_address: 'Address', audit_date: '2026-09-05', inspector_name: 'Owner', status: 'Draft', cloud_backup_enabled: true,
      local_owner_user_id: 'owner', assigned_work_state: 'none', server_tree_revision: 3, tree_revision: 8, created_at: timestamp, updated_at: timestamp,
      ...(confirmedPair ? { last_synced_local_tree_revision: 8, last_synced_server_tree_revision: 3 } : {}), backup_conflict: { kind: 'NONE' } }],
    gridSupplies: [{ id: 'g', installationId: 'i', name: 'Grid', isDefault: true }],
    zones: [], electricalAssets: [], siteAssets: [], meterDevices: [], measurementAssignments: [], formSubmissions: [],
    cloudSync: { synced_at_by_installation: { i: timestamp }, force_dirty_installation_ids: [], upload_queue: [], thumbnail_queue: [] },
  } as AppDataStore);
  const originalLayout = layoutDomain.validateElectricalMapLayout({ version: 1, canvas: { width: 500, height: 500 }, nodes: [{ nodeId: 'g', centerX: 100, centerY: 100 }] });
  const requestedLayout = layoutDomain.moveElectricalMapNode(originalLayout, 'g', 24, 0);
  const remote: RemoteInstallationTree = { treeSchemaVersion: 2, treeRevision: 3,
    installation: { id: 'i', status: 'Draft', treeRevision: 3, electricalMapLayout: originalLayout, electricalMapLayoutRevision: 2 },
    gridSupplies: structuredClone(store.gridSupplies) as unknown as Record<string, unknown>[], zones: [], electricalAssets: [], siteAssets: [], formSubmissions: [], meterDevices: [], measurementAssignments: [],
  };
  let puts = 0; let actorCurrent = true; let viewCurrent = true;
  const lease = { actorUserId: 'owner', processAuthority: {}, cloudAuthority: {}, assertCurrent() { if (!actorCurrent) throw Error('Actor changed'); } };
  const modules: Record<string, unknown> = {
    '../api/apiClient': { apiClient: {
      getInstallationElectricalMap: async (_id: string, _pin: unknown, authority: unknown) => {
        assert.equal(authority, lease.cloudAuthority);
        if (scenario === 'read-failure') throw Error('Offline');
        if (scenario === 'read-local-edit') store.installations[0]!.site_name = 'Unsynced edit during map read';
        return { installationId: 'i', treeRevision: scenario === 'read-revision' ? 9 : 3,
          nodes: [{ id: 'g', kind: 'GRID' }], edges: [], unresolved: [],
          ...(scenario === 'stale-layout' ? {} : { mapLayout: { ...originalLayout, layoutRevision: 2 } }) };
      },
      pull: async () => ({ installations: [structuredClone(remote)], pulledAt: timestamp }),
      saveInstallationElectricalMapLayout: async (id: string, input: { baseTreeRevision: number; baseLayoutRevision: number; layout: layoutDomain.ElectricalMapLayoutDocument }, authority: unknown) => {
        puts++; assert.equal(authority, lease.cloudAuthority); assert.equal(id, 'i'); assert.equal(input.baseTreeRevision, 3); assert.equal(input.baseLayoutRevision, 2);
        assert.deepEqual(input.layout, requestedLayout);
        if (scenario === 'reject') throw Error('Snapshot conflict');
        remote.treeRevision = 4; Object.assign(remote.installation, { treeRevision: 4, electricalMapLayout: structuredClone(input.layout), electricalMapLayoutRevision: 3, electricalMapLayoutUpdatedAt: timestamp });
        if (scenario === 'local-edit') store.installations[0]!.site_name = 'Unsynced captured edit';
        if (scenario === 'actor') actorCurrent = false;
        if (scenario === 'view') viewCurrent = false;
        if (scenario === 'remote-drift') remote.treeRevision = 5;
        if (scenario === 'ambiguous') throw Error('Response lost');
        return { installationId: 'i', treeRevision: 4, mapLayout: { ...input.layout, layoutRevision: 3, updatedAt: timestamp } };
      },
    } },
    '../data/seed': { updateStore: async (fn: (value: AppDataStore) => unknown) => fn(store) },
    '../domain/electricalMapLayout': layoutDomain,
    '../services/authenticatedCloudAction': { captureAuthenticatedCloudActionLease: async () => lease },
    '../services/cloudActionLease': leases,
    '../services/assignedWorkMutationGuard': { assertAssignedWorkMutationAllowed: () => lease.assertCurrent() },
    '../services/serverResultCommitFence': fences,
    '../services/assignedWorkPolicy': policy,
    '../services/remoteInstallationRevision': revisions,
    '../services/pinnedInstallationMapping': mapping,
    '../services/reportVersioning': versioning,
    '../services/installationPackTarget': packTarget,
    './cloudSyncRepository': {
      buildInstallationBackupTree,
      getInstallationBackupTree: async () => buildInstallationBackupTree(store, store.installations[0]!),
      getInstallationSyncMetadata: async () => ({ forceDirty: store.cloudSync.force_dirty_installation_ids.includes('i'), syncedWatermark: store.cloudSync.synced_at_by_installation.i }),
      getPendingCompleteBackupAttempt: async () => store.cloudSync.pending_complete_attempts?.i,
    },
  };
  const exports = {};
  new Function('require', 'exports', code)((name: string) => { assert.ok(modules[name], name); return modules[name]; }, exports);
  const repository = exports as typeof Repository;
  return { store, remote, requestedLayout, repository, puts: () => puts,
    load: () => repository.loadElectricalMapLayout('i', ['g'], () => { if (!viewCurrent) throw Error('View changed'); }),
  };
}

test('load uses retained layout revision even when GET hides an incompatible old arrangement', async () => {
  const h = harness('stale-layout'); const session = await h.load();
  assert.equal(session.savedLayout, undefined); assert.equal(session.baseLayoutRevision, 2);
  const attempt = await h.repository.prepareElectricalMapLayoutAttempt(session, h.requestedLayout);
  await h.repository.executeElectricalMapLayoutAttempt(attempt); assert.equal(h.puts(), 1);
});

test('API read failures and different server revisions cannot become an editable layout session', async () => {
  for (const scenario of ['read-failure', 'read-revision']) { const h = harness(scenario); await assert.rejects(h.load()); assert.equal(h.puts(), 0); }
});

test('confirmed save advances both revisions and only the existing exact clean baseline pair', async () => {
  for (const mode of ['current', 'legacy', 'stale']) {
    const confirmedPair = mode === 'current';
    const h = harness('success', confirmedPair);
    if (mode === 'stale') Object.assign(h.store.installations[0]!, { last_synced_local_tree_revision: 7, last_synced_server_tree_revision: 2 });
    const session = await h.load();
    const beforeChildren = JSON.stringify({ grids: h.store.gridSupplies, forms: h.store.formSubmissions });
    const attempt = await h.repository.prepareElectricalMapLayoutAttempt(session, h.requestedLayout);
    await h.repository.executeElectricalMapLayoutAttempt(attempt);
    const installation = h.store.installations[0]!;
    assert.equal(installation.server_tree_revision, 4); assert.equal(installation.tree_revision, 9);
    assert.equal(installation.last_synced_local_tree_revision, confirmedPair ? 9 : mode === 'stale' ? 7 : undefined);
    assert.equal(installation.last_synced_server_tree_revision, confirmedPair ? 4 : mode === 'stale' ? 2 : undefined);
    assert.equal(h.store.cloudSync.synced_at_by_installation.i, buildInstallationBackupTree(h.store, installation).watermark);
    assert.equal(JSON.stringify({ grids: h.store.gridSupplies, forms: h.store.formSubmissions }), beforeChildren);
    assert.equal(installation.assigned_work_server_tree_fingerprint, revisions.remoteInstallationWorkTreeFingerprint(h.remote));
  }
});

test('dirty, pending or conflicted installation fails before PUT and leaves the captured tree intact', async () => {
  for (const cause of ['dirty', 'pending', 'conflict', 'completed']) {
    const h = harness();
    if (cause === 'dirty') h.store.cloudSync.force_dirty_installation_ids.push('i');
    if (cause === 'pending') h.store.installations[0]!.pending_completion = { baseTreeRevision: 3, idempotencyKey: 'pending', createdAt: timestamp };
    if (cause === 'conflict') h.store.installations[0]!.backup_conflict = { kind: 'CONFLICT', localBaseTreeRevision: 3, detectedAt: timestamp };
    const session = await h.load();
    if (cause === 'completed') session.baseline.installation.status = 'Completed';
    const before = JSON.stringify(h.store);
    await assert.rejects(h.repository.prepareElectricalMapLayoutAttempt(session, h.requestedLayout));
    assert.equal(JSON.stringify(h.store), before); assert.equal(h.puts(), 0);
  }
});

test('local changes without revision/timestamp movement cannot be overwritten before or during a save', async () => {
  for (const during of [false, true]) {
    const h = harness(during ? 'local-edit' : 'success'); const session = await h.load();
    const attempt = await h.repository.prepareElectricalMapLayoutAttempt(session, h.requestedLayout);
    if (!during) h.store.installations[0]!.site_name = 'Unsynced captured edit';
    await assert.rejects(h.repository.executeElectricalMapLayoutAttempt(attempt), /changed/);
    assert.equal(h.store.installations[0]!.site_name, 'Unsynced captured edit');
    assert.equal(h.store.installations[0]!.server_tree_revision, 3); assert.equal(h.store.installations[0]!.last_synced_server_tree_revision, 3);
    assert.equal(h.puts(), during ? 1 : 0);
  }
});

test('remote drift, actor changes and view disposal never advance the local receipt', async () => {
  for (const scenario of ['remote-drift', 'actor', 'view', 'reject']) {
    const h = harness(scenario); const session = await h.load(); const before = JSON.stringify(h.store);
    const attempt = await h.repository.prepareElectricalMapLayoutAttempt(session, h.requestedLayout);
    await assert.rejects(h.repository.executeElectricalMapLayoutAttempt(attempt));
    assert.equal(JSON.stringify(h.store), before, scenario); assert.deepEqual(attempt.layout, h.requestedLayout);
  }
});

test('lost accepted PUT response recovers exact tree/layout +1 and does not issue a second PUT', async () => {
  const h = harness('ambiguous'); const session = await h.load();
  const attempt = await h.repository.prepareElectricalMapLayoutAttempt(session, h.requestedLayout);
  await assert.rejects(h.repository.executeElectricalMapLayoutAttempt(attempt), /Response lost/);
  assert.equal(h.store.installations[0]!.server_tree_revision, 3);
  await h.repository.executeElectricalMapLayoutAttempt(attempt);
  assert.equal(h.puts(), 1); assert.equal(h.store.installations[0]!.server_tree_revision, 4);
});

test('local mutation during map loading cannot be silently accepted by a later save', async () => {
  const h = harness('read-local-edit'); const session = await h.load();
  const before = JSON.stringify(h.store);
  const attempt = await h.repository.prepareElectricalMapLayoutAttempt(session, h.requestedLayout);
  await assert.rejects(h.repository.executeElectricalMapLayoutAttempt(attempt), /changed/);
  assert.equal(h.puts(), 0); assert.equal(JSON.stringify(h.store), before);
  assert.equal(h.store.installations[0]!.last_synced_local_tree_revision, 8);
});
