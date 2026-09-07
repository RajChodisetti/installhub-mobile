import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { focusedAuditInstallationId } from '../src/services/auditWorkTrackingPolicy';
import test from 'node:test';
import { applyConfirmedMeterHistoryRollback, confirmedHistoryMeter, meterHistoryRollbackUnavailable } from '../src/domain/meterHistory';
import { buildInstallationBackupTree } from '../src/repositories/cloudSyncRepository';
import { applyServerResultCommitFence } from '../src/services/serverResultCommitFence';
import { normalizeCanonicalStore } from '../src/domain/installationV2';
import type { AppDataStore } from '../src/types';
import type { RemoteInstallationTree } from '../src/api/apiClient';
import type { MeterHistoryRollbackResult } from '../src/api/meterHistoryTypes';
import { assignedWorkServerMetadataFromInstallation, mergeAssignedInstallationServerState } from '../src/services/assignedWorkPolicy';
import { remoteInstallationWorkTreeFingerprint } from '../src/services/remoteInstallationRevision';

function fixture() {
  const timestamp = '2026-09-05T00:00:00.000Z';
  const store = normalizeCanonicalStore({
    user: { id: 'owner', email: 'owner@example.test', full_name: 'Owner', role: 'admin' },
    installations: [{ id: 'installation', client_name: 'Client', site_name: 'Site', site_address: 'Address',
      audit_date: '2026-09-05', inspector_name: 'Owner', status: 'Draft', cloud_backup_enabled: true,
      local_owner_user_id: 'owner', assigned_work_state: 'none', server_tree_revision: 3,
      tree_revision: 8, created_at: timestamp, updated_at: timestamp, backup_conflict: { kind: 'NONE' } }],
    zones: [{ id: 'zone', audit_id: 'installation', zone_name: 'Zone', zone_description: '', photos: [], created_at: timestamp, updated_at: timestamp }],
    electricalAssets: [{ id: 'board', audit_id: 'installation', zone_id: 'zone', asset_name: 'Main', asset_type: 'MSB',
      display_code: 'BOARD', electrical_source: { kind: 'GRID', gridSupplyId: 'grid' }, meter_present: true,
      comments: 'Keep current board', meters: [{ id: 'meter', device_name: 'Meter', device_type: 'A3RM', device_id: 'CURRENT' }], created_at: timestamp, updated_at: timestamp }],
    gridSupplies: [{ id: 'grid', installationId: 'installation', name: 'Grid', isDefault: true }],
    siteAssets: [], meterDevices: [], measurementAssignments: [], formSubmissions: [],
    cloudSync: { synced_at_by_installation: { installation: timestamp }, force_dirty_installation_ids: [], upload_queue: [], thumbnail_queue: [] },
  } as AppDataStore);
  const baseline = buildInstallationBackupTree(store, store.installations[0]!);
  const restored = structuredClone(store.meterDevices[0]!);
  restored.serialNumber = 'HISTORICAL';
  restored.deviceModel = 'A6M';
  restored.lifecycleState = 'INACTIVE';
  const remote = { treeSchemaVersion: 2, treeRevision: 4,
    installation: { id: 'installation', treeRevision: 4 }, meterDevices: [restored],
    measurementAssignments: [], electricalAssets: [], siteAssets: [], zones: [], formSubmissions: [],
  } as unknown as RemoteInstallationTree;
  const result: MeterHistoryRollbackResult = { installationId: 'installation', meterHistory: {
    operation: 'ROLLBACK', meterId: 'meter', restoredFromRecordVersionNumber: 1,
    recordVersionNumber: 6, treeRevision: 4, reason: 'Restore known working device',
  } };
  return { store, baseline, remote, result };
}

test('restore only applies the exact device revision and preserves unrelated records', () => {
  const { store, baseline, remote, result } = fixture();
  const originalZones = JSON.stringify(store.zones);
  const originalForms = JSON.stringify(store.formSubmissions);
  applyConfirmedMeterHistoryRollback(store, baseline, result, remote, buildInstallationBackupTree(store, store.installations[0]!));
  assert.equal(store.meterDevices[0]!.serialNumber, 'HISTORICAL');
  assert.equal(store.meterDevices[0]!.lifecycleState, 'INACTIVE');
  assert.equal(store.electricalAssets[0]!.meters[0]!.device_id, 'HISTORICAL');
  assert.equal(store.electricalAssets[0]!.meters[0]!.device_type, 'A6M');
  assert.equal(store.electricalAssets[0]!.meters[0]!.lifecycle_state, 'INACTIVE');
  assert.equal(store.electricalAssets[0]!.comments, 'Keep current board');
  assert.equal(JSON.stringify(store.zones), originalZones);
  assert.equal(JSON.stringify(store.formSubmissions), originalForms);
  assert.equal(store.installations[0]!.server_tree_revision, 4);
  assert.equal(store.installations[0]!.record_version_number, 6);
});

test('a local edit, remote revision drift, or conflicting assignment cannot be overwritten by restore', () => {
  for (const mutation of ['local', 'remote', 'assignment']) {
    const { store, baseline, remote, result } = fixture();
    if (mutation === 'local') store.electricalAssets[0]!.comments = 'Concurrent edit without timestamp change';
    if (mutation === 'remote') remote.treeRevision = 5;
    if (mutation === 'assignment') remote.measurementAssignments = [{ id: 'foreign', meterId: 'meter' }];
    const before = JSON.stringify(store);
    assert.throws(() => applyConfirmedMeterHistoryRollback(store, baseline, result, remote, buildInstallationBackupTree(store, store.installations[0]!)));
    assert.equal(JSON.stringify(store), before);
  }
});

test('accepted restore advances the assigned-work baseline for the next same-revision refresh', () => {
  const { store, remote, result } = fixture();
  const installation = store.installations[0]!;
  installation.assigned_work_server_metadata_base = assignedWorkServerMetadataFromInstallation(installation);
  installation.assigned_work_server_tree_fingerprint = remoteInstallationWorkTreeFingerprint({
    ...remote, meterDevices: structuredClone(store.meterDevices) as unknown as Record<string, unknown>[],
  });
  const priorFingerprint = installation.assigned_work_server_tree_fingerprint;
  const baseline = buildInstallationBackupTree(store, installation);
  applyConfirmedMeterHistoryRollback(store, baseline, result, remote, buildInstallationBackupTree(store, installation));
  assert.notEqual(installation.assigned_work_server_tree_fingerprint, priorFingerprint);
  assert.equal(installation.assigned_work_server_tree_fingerprint, remoteInstallationWorkTreeFingerprint(remote));
  assert.deepEqual(installation.assigned_work_server_metadata_base, assignedWorkServerMetadataFromInstallation(installation));
  const refreshed = mergeAssignedInstallationServerState(installation, remote);
  assert.equal(refreshed.serverTreeRevision, result.meterHistory.treeRevision);
  assert.equal(refreshed.serverTreeFingerprint, installation.assigned_work_server_tree_fingerprint);
  assert.equal(refreshed.refreshConflict, null);
});

test('restore checks identity, placement, display ID, and stable channel IDs before projection', () => {
  const { store } = fixture();
  const meter = store.meterDevices[0]!;
  for (const changed of [
    { id: 'another' }, { installationId: 'another' }, { installedOnBoardId: 'another' },
    { lifecycleState: 'DECOMMISSIONED' },
    { displayName: { ...meter.displayName, value: 'Renamed' } },
    { channels: [{ id: 'dup', ordinal: 1, purpose: 'SPARE' }, { id: 'dup', ordinal: 2, purpose: 'SPARE' }] },
  ]) assert.throws(() => confirmedHistoryMeter({ ...meter, ...changed }, meter));
});

test('local-only, dirty, pending, completed, and conflicted installations cannot restore', () => {
  const { baseline } = fixture();
  const metadata = { forceDirty: false, syncedWatermark: baseline.watermark };
  assert.equal(meterHistoryRollbackUnavailable(baseline, metadata, false), null);
  assert.ok(meterHistoryRollbackUnavailable(baseline, { ...metadata, forceDirty: true }, false));
  assert.ok(meterHistoryRollbackUnavailable(baseline, metadata, true));
  for (const patch of [
    { status: 'Completed' as const }, { cloud_backup_enabled: false }, { server_tree_revision: undefined },
    { backup_conflict: { kind: 'CONFLICT' as const, localBaseTreeRevision: 3, detectedAt: '2026-09-05T00:00:00.000Z' } },
  ]) assert.ok(meterHistoryRollbackUnavailable({ ...baseline, installation: { ...baseline.installation, ...patch } }, metadata, false));
});

test('account or generation change rejects inside the transaction before device restore', () => {
  const { store, baseline, remote, result } = fixture();
  const before = JSON.stringify(store);
  assert.throws(() => applyServerResultCommitFence(store, 'installation', {
    actorUserId: 'owner', expectedLocalTreeRevision: 8, expectedTreeWatermark: baseline.watermark,
    expectedServerTreeRevision: 3, assertCurrent: () => { throw new Error('Session changed'); },
  }, () => applyConfirmedMeterHistoryRollback(store, baseline, result, remote, baseline)), /Session changed/);
  assert.equal(JSON.stringify(store), before);
});

test('history API and retry orchestration use exact version, revision, lease and idempotency key', () => {
  const api = readFileSync(new URL('../src/api/apiClient.ts', import.meta.url), 'utf8');
  const service = readFileSync(new URL('../src/repositories/meterHistoryRepository.ts', import.meta.url), 'utf8');
  assert.match(api, /history\?offset=\$\{offset\}&limit=20/);
  assert.match(api, /history\/rollback/);
  assert.match(service, /baseTreeRevision: baseline\.installation\.server_tree_revision/);
  assert.match(service, /if \(!attempt\.confirmedResult\)/);
  assert.match(service, /attempt\.input, lease\.cloudAuthority/);
  assert.match(service, /applyServerResultCommitFence/);
  assert.match(service, /applyConfirmedMeterHistoryRollback/);
});


test('device history remains inside the installation access and tracking route fence', () => {
  assert.equal(focusedAuditInstallationId({ name: 'MeterHistory', params: { installationId: 'installation', meterId: 'meter' } }), 'installation');
});
