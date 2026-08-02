import assert from 'node:assert/strict';
import test from 'node:test';
import type { RemoteInstallationTree } from '../src/api/apiClient';
import { mergeResolvedDisplayCodes } from '../src/services/displayCodeReconciliation';
import type { AppDataStore, DisplayCode } from '../src/types';

const code = (value: string, isOverridden = false, provisional = true): DisplayCode => ({
  value,
  generatedValue: value,
  isOverridden,
  ruleVersion: 1,
  provisional,
});

function fixture(): AppDataStore {
  const timestamp = '2026-08-01T00:00:00.000Z';
  return {
    schemaVersion: 3,
    user: { id: 'user', email: 'field@example.test', full_name: 'Field', role: 'admin' },
    installations: [{
      id: 'installation', client_name: 'Client', site_name: 'Site', site_address: 'Address',
      inspector_name: 'Field', audit_date: '2026-08-01', status: 'Draft',
      tree_schema_version: 2, tree_revision: 4, cloud_backup_enabled: true,
      created_at: timestamp, updated_at: timestamp,
    }],
    gridSupplies: [{ id: 'grid', installationId: 'installation', name: 'Grid', isDefault: true }],
    zones: [{
      id: 'zone', audit_id: 'installation', zone_name: 'Plant', zone_description: '', photos: [],
      created_at: timestamp, updated_at: timestamp,
    }],
    electricalAssets: [{
      id: 'board', audit_id: 'installation', zone_id: 'zone', asset_name: 'Main',
      asset_type: 'MSB', type_code: 'MSB', display_code: 'SITE-MSB-900',
      display_code_meta: code('SITE-MSB-900'),
      electrical_source: { kind: 'GRID', gridSupplyId: 'grid' },
      meter_present: true, meters: [], created_at: timestamp, updated_at: timestamp,
    }],
    siteAssets: [{
      id: 'asset', audit_id: 'installation', zone_id: 'zone', asset_name: 'Load',
      asset_type: 'HVAC', type_code: 'HVAC', display_code: 'CUSTOM-LOAD',
      display_code_meta: code('CUSTOM-LOAD', true),
      electrical_source: { kind: 'BOARD', boardId: 'board' },
      metering_state: { kind: 'UNMETERED' }, meter_present: false,
      created_at: timestamp, updated_at: timestamp,
    }],
    meterDevices: [{
      id: 'meter', installationId: 'installation', installedOnBoardId: 'board',
      deviceFamily: 'WATTWATCHERS', deviceModel: 'A3RM', serialNumber: 'serial',
      displayName: code('SITE-A3RM-900'), channels: [],
    }],
    measurementAssignments: [],
    formSubmissions: [],
    cloudSync: {
      synced_at_by_installation: {}, force_dirty_installation_ids: [],
      upload_queue: [], thumbnail_queue: [],
    },
  };
}

function remoteTree(assetValue = 'CUSTOM-LOAD'): RemoteInstallationTree {
  return {
    treeSchemaVersion: 2,
    treeRevision: 5,
    installation: { id: 'installation', treeRevision: 5 },
    gridSupplies: [{ id: 'grid' }],
    zones: [],
    electricalAssets: [{
      id: 'board',
      displayCode: {
        value: 'SITE-MSB-001', generatedValue: 'SITE-MSB-001',
        isOverridden: false, ruleVersion: 1,
      },
    }],
    siteAssets: [{
      id: 'asset',
      displayCode: {
        value: assetValue, generatedValue: 'SITE-HVAC-001',
        isOverridden: true, ruleVersion: 1, overrideReason: 'Field label',
      },
    }],
    meterDevices: [{
      id: 'meter',
      displayName: {
        value: 'SITE-A3RM-001', generatedValue: 'SITE-A3RM-001',
        isOverridden: false, ruleVersion: 1,
      },
    }],
    measurementAssignments: [],
    formSubmissions: [],
  };
}

test('exact canonical tree finalizes generated board and meter codes while preserving overrides', () => {
  const store = fixture();
  const changes = mergeResolvedDisplayCodes(
    store,
    'installation',
    remoteTree(),
    5,
    '2026-08-01T01:00:00.000Z',
  );
  assert.deepEqual(changes.map((item) => item.entityType).sort(), ['board', 'meter']);
  assert.equal(store.electricalAssets[0]!.display_code, 'SITE-MSB-001');
  assert.equal(store.meterDevices[0]!.displayName.value, 'SITE-A3RM-001');
  assert.equal(store.meterDevices[0]!.displayName.provisional, false);
  assert.equal(store.siteAssets[0]!.display_code, 'CUSTOM-LOAD');
  assert.equal(store.siteAssets[0]!.display_code_meta?.isOverridden, true);
});

test('override conflict and revision-only trees fail atomically', () => {
  const store = fixture();
  const before = JSON.stringify(store);
  assert.throws(
    () => mergeResolvedDisplayCodes(store, 'installation', remoteTree('SERVER-CHANGED'), 5),
    /display-code conflict/,
  );
  assert.equal(JSON.stringify(store), before);
  assert.throws(
    () => mergeResolvedDisplayCodes(store, 'installation', { ...remoteTree(), meterDevices: undefined }, 5),
    /omitted meter devices/,
  );
});

test('server-confirmed generated codes never rename after later metadata changes', () => {
  const store = fixture();
  store.electricalAssets[0]!.display_code = 'SITE-MSB-001';
  store.electricalAssets[0]!.display_code_meta = code('SITE-MSB-001', false, false);
  const tree = remoteTree();
  const remoteCode = tree.electricalAssets[0]!.displayCode as Record<string, unknown>;
  remoteCode.value = 'RENAMED-MSB-001';
  remoteCode.generatedValue = 'RENAMED-MSB-001';
  const before = JSON.stringify(store);
  assert.throws(
    () => mergeResolvedDisplayCodes(store, 'installation', tree, 5),
    /rename confirmed display code/,
  );
  assert.equal(JSON.stringify(store), before);
});

test('display-code reconciliation preserves the exact server-pinned rule version', () => {
  const store = fixture();
  const tree = remoteTree();
  const boardCode = tree.electricalAssets[0]!.displayCode as Record<string, unknown>;
  boardCode.ruleVersion = 7;
  mergeResolvedDisplayCodes(store, 'installation', tree, 5);
  assert.equal(store.electricalAssets[0]!.display_code_meta?.ruleVersion, 7);
});
