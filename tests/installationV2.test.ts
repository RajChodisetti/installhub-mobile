import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boardTypeCode,
  buildInstallationMappingExport,
  allAssetMeteringRows,
  canonicalJsonStringify,
  createMeasurementAssignment,
  deriveVirtualMeters,
  electricalTreeRows,
  installationReadiness,
  normalizeCanonicalStore,
  primaryGridSupplyId,
  replaceBoardMetersFromLegacy,
  siteAssetTypeCode,
} from '../src/domain/installationV2';
import type { AppDataStore } from '../src/types';

function storeFixture(): AppDataStore {
  const timestamp = '2026-08-01T00:00:00.000Z';
  return {
    user: { id: 'user', email: 'field@example.test', full_name: 'Field User', role: 'admin' },
    installations: [{
      id: 'installation', client_name: 'Client', site_name: 'Example Site', site_address: 'Address',
      inspector_name: 'Field User', audit_date: '2026-08-01', status: 'Draft',
      cloud_backup_enabled: false, timezone: 'Australia/Sydney', created_at: timestamp, updated_at: timestamp,
    }],
    gridSupplies: [],
    zones: [{ id: 'zone', audit_id: 'installation', zone_name: 'Plant', zone_description: '', photos: [], created_at: timestamp, updated_at: timestamp }],
    electricalAssets: [{
      id: 'board', audit_id: 'installation', zone_id: 'zone', asset_name: 'Main', display_code: 'ESS-MSB-001',
      asset_type: 'MSB', site_nmi: 'NMI-BASELINE', meter_present: true, meters: [{
        id: 'meter', device_name: 'Custom meter', device_type: 'Other', device_id: 'SERIAL',
        ww_channels: Array.from({ length: 8 }, (_, index) => ({ description: `Channel ${index + 1}` })),
      }], created_at: timestamp, updated_at: timestamp,
    }],
    siteAssets: [{
      id: 'asset', audit_id: 'installation', zone_id: 'zone', asset_name: 'Direct Grid Load', asset_type: 'HVAC',
      display_code: 'ESS-HVAC-001', electrical_board_id: null, electrical_board_tbc: true,
      meter_present: false, created_at: timestamp, updated_at: timestamp,
    }],
    meterDevices: [],
    measurementAssignments: [],
    formSubmissions: [],
    cloudSync: { synced_at_by_installation: {}, force_dirty_installation_ids: [], upload_queue: [], thumbnail_queue: [] },
  };
}

test('legacy normalization is idempotent and preserves arbitrary custom meter channel counts', () => {
  const store = normalizeCanonicalStore(storeFixture());
  assert.equal(store.schemaVersion, 3);
  assert.equal(store.meterDevices[0]?.deviceModel, 'OTHER');
  assert.equal(store.meterDevices[0]?.channels.length, 8);
  assert.equal(store.electricalAssets[0]?.electrical_source?.kind, 'GRID');
  assert.equal(store.siteAssets[0]?.electrical_source?.kind, 'TBC');
  const once = JSON.stringify(store);
  normalizeCanonicalStore(store);
  assert.equal(JSON.stringify(store), once);
});

test('direct-to-Grid site assets remain resolved while canonical export stays server-owned (MAP-08/VIR-04)', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const installation = store.installations[0]!;
  const asset = store.siteAssets[0]!;
  // Remove the custom meter to isolate the direct-Grid mapping case.
  store.meterDevices = [];
  store.electricalAssets[0]!.meters = [];
  store.electricalAssets[0]!.meter_present = false;
  asset.electrical_source = { kind: 'GRID', gridSupplyId: primaryGridSupplyId(installation.id) };
  asset.electrical_board_id = null;
  asset.electrical_board_tbc = false;
  asset.metering_state = { kind: 'UNMETERED' };
  installation.status = 'Completed';
  installation.record_version_number = 1;
  installation.completed_at = '2026-08-01T01:00:00.000Z';
  const readiness = installationReadiness(store, installation.id);
  assert.equal(readiness.readyToComplete, true);
  const rows = electricalTreeRows(store, installation.id);
  const assetRow = rows.find((row) => row.id === asset.id);
  assert.equal(assetRow?.sourceId, primaryGridSupplyId(installation.id));
  assert.equal(assetRow?.unresolved, undefined);
  assert.throws(
    () => buildInstallationMappingExport(store, installation.id),
    /server-owned/,
  );
});

test('display-code readiness matches server case-and-all-whitespace normalization', () => {
  const store = normalizeCanonicalStore(storeFixture());
  store.meterDevices = [];
  store.electricalAssets[0]!.meters = [];
  store.electricalAssets[0]!.meter_present = false;
  store.siteAssets[0]!.display_code_meta = {
    value: ' ess - msb - 001 ', generatedValue: 'ESS-HVAC-001', isOverridden: true, ruleVersion: 1,
  };
  const issues = installationReadiness(store, 'installation').issues;
  assert.equal(issues.filter((item) => item.code === 'DISPLAY_CODE_DUPLICATE').length, 2);
});

test('local canonical refresh never renames a server-confirmed generated code', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const board = store.electricalAssets[0]!;
  board.display_code = 'PINNED-MSB-004';
  board.display_code_meta = {
    value: 'PINNED-MSB-004', generatedValue: 'PINNED-MSB-004',
    isOverridden: false, ruleVersion: 4, provisional: false,
  };
  store.installations[0]!.site_name = 'A renamed site';
  store.installations[0]!.site_code = 'NEW';
  board.asset_type = 'DB';
  board.type_code = 'DB';
  normalizeCanonicalStore(store);
  assert.equal(board.display_code, 'PINNED-MSB-004');
  assert.deepEqual(board.display_code_meta, {
    value: 'PINNED-MSB-004', generatedValue: 'PINNED-MSB-004',
    isOverridden: false, ruleVersion: 4, provisional: false,
  });
});

test('canonical JSON hashing is independent of object insertion order', () => {
  assert.equal(
    canonicalJsonStringify({ b: 2, nested: { z: 1, a: 2 }, a: 1 }),
    canonicalJsonStringify({ a: 1, nested: { a: 2, z: 1 }, b: 2 }),
  );
});

test('accepted legacy taxonomy aliases normalize without losing deliberate custom labels', () => {
  assert.equal(boardTypeCode('MS8'), 'MSB');
  assert.equal(boardTypeCode('Main Snachboard'), 'MSB');
  assert.equal(boardTypeCode('Main Sub-Switchboard'), 'MSSB');
  assert.equal(siteAssetTypeCode('Lightning'), 'LIGHTING');
  assert.equal(siteAssetTypeCode('Refrigeration'), 'OTHER');
  assert.equal(siteAssetTypeCode('Compressed Air'), 'OTHER');

  const store = storeFixture();
  store.installations[0]!.site_code = 'ESS';
  store.electricalAssets[0]!.asset_type = 'MS8' as never;
  store.electricalAssets[0]!.site_nmi = 'NMI-123';
  store.siteAssets = [
    {
      ...store.siteAssets[0]!, id: 'existing-light', asset_type: 'Lightning' as never,
      display_code: 'ESS-LIGHTING-004',
    },
    {
      ...store.siteAssets[0]!, id: 'new-light', asset_type: 'Lightning' as never,
      display_code: undefined,
    },
    {
      ...store.siteAssets[0]!, id: 'refrigeration', asset_type: 'Refrigeration',
      display_code: 'ESS-OTHER-001',
    },
  ];
  store.gridSupplies = [
    { id: 'grid-z', installationId: 'installation', name: 'Z', isDefault: true },
    { id: 'grid-a', installationId: 'installation', name: 'A', isDefault: true },
  ];
  normalizeCanonicalStore(store);
  assert.equal(store.electricalAssets[0]!.type_code, 'MSB');
  assert.deepEqual(store.electricalAssets[0]!.electrical_source, { kind: 'GRID', gridSupplyId: 'grid-a' });
  assert.equal(store.gridSupplies.find((grid) => grid.isDefault)?.id, 'grid-a');
  assert.equal(store.siteAssets.find((asset) => asset.id === 'new-light')?.display_code, 'ESS-LIGHTING-005');
  assert.equal(store.siteAssets.find((asset) => asset.id === 'refrigeration')?.custom_type_name, 'Refrigeration');
});

test('legacy MSB without NMI evidence remains explicitly TBC', () => {
  const store = storeFixture();
  store.electricalAssets[0]!.asset_type = 'Main Snachboard' as never;
  store.electricalAssets[0]!.site_nmi = undefined;
  store.electricalAssets[0]!.electrical_parent_id = null;
  store.electricalAssets[0]!.electrical_parent_tbc = false;
  normalizeCanonicalStore(store);
  assert.equal(store.electricalAssets[0]!.type_code, 'MSB');
  assert.deepEqual(store.electricalAssets[0]!.electrical_source, { kind: 'TBC' });
});

test('invalid timezone is a non-completion-blocking export warning', () => {
  const store = normalizeCanonicalStore(storeFixture());
  store.installations[0]!.timezone = 'Mars/Olympus_Mons';
  store.meterDevices = [];
  store.electricalAssets[0]!.meters = [];
  store.electricalAssets[0]!.meter_present = false;
  store.siteAssets[0]!.electrical_source = {
    kind: 'GRID', gridSupplyId: store.gridSupplies[0]!.id,
  };
  store.siteAssets[0]!.metering_state = { kind: 'UNMETERED' };
  store.siteAssets[0]!.meter_present = false;
  const readiness = installationReadiness(store, 'installation');
  const timezone = readiness.issues.find((item) => item.code === 'TIMEZONE_REQUIRED_FOR_EXPORT');
  assert.equal(timezone?.severity, 'WARNING');
  assert.equal(readiness.readyToComplete, true);
  assert.equal(readiness.eligibility.mappingExport, false);
});

test('legacy channel migration and projection preserve custom loads and model-specific ratings', () => {
  const store = storeFixture();
  const legacyMeter = store.electricalAssets[0]!.meters[0]!;
  legacyMeter.device_type = 'A6M';
  legacyMeter.ww_channels = [{
    purpose: 'SUB_CIRCUIT',
    load_type: 'Refrigeration',
    ct_ratio: '120A',
    phase_label: 'L1',
    capabilities: { labels: ['pulse'] },
  }];
  normalizeCanonicalStore(store);
  const channel = store.meterDevices[0]!.channels[0]!;
  assert.equal(channel.loadTypeCode, 'OTHER');
  assert.equal(channel.customLoadTypeName, 'Refrigeration');
  assert.equal(channel.sensorRating, '120A');
  assert.equal(channel.phaseLabel, 'L1');
  const projected = store.electricalAssets[0]!.meters[0]!.ww_channels![0]!;
  assert.equal(projected.load_type, 'Refrigeration');
  assert.equal(projected.ct_ratio, '120A');
  assert.equal(projected.rogowski_size, undefined);
});

test('DEC-005 custom meters require explicit channels, capabilities, and positive ordinals', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const meter = store.meterDevices[0]!;
  meter.customManufacturerName = 'Example Instruments';
  meter.customModelName = 'Flex 8';
  meter.channels = [];
  assert.ok(installationReadiness(store, 'installation').issues.some(
    (item) => item.code === 'METER_CAPABILITY_REQUIRED' && item.entityType === 'meter',
  ));

  meter.channels = [{ id: 'custom-channel', ordinal: 1, purpose: 'SPARE' }];
  assert.ok(installationReadiness(store, 'installation').issues.some(
    (item) => item.code === 'METER_CAPABILITY_REQUIRED' && item.field === 'capabilities',
  ));

  meter.channels[0]!.capabilities = { labels: ['pulse'] };
  const validCustomIssues = installationReadiness(store, 'installation').issues;
  assert.equal(validCustomIssues.some(
    (item) => item.code === 'METER_CAPABILITY_REQUIRED',
  ), false);
  assert.equal(validCustomIssues.some(
    (item) => item.code === 'METER_DEVICE_REQUIRED' && item.field === 'formSubmissions',
  ), false);

  meter.channels[0]!.ordinal = 0;
  assert.ok(installationReadiness(store, 'installation').issues.some(
    (item) => item.code === 'CHANNEL_NOT_FOUND' && item.field === 'ordinal',
  ));
});

test('standard A3RM SPARE channels do not require custom capabilities', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const meter = store.meterDevices[0]!;
  meter.deviceFamily = 'WATTWATCHERS';
  meter.deviceModel = 'A3RM';
  meter.channels = [1, 2, 3].map((ordinal) => ({
    id: `standard-spare-${ordinal}`,
    ordinal,
    purpose: 'SPARE' as const,
  }));

  const issues = installationReadiness(store, 'installation').issues;
  assert.equal(issues.some((item) => item.code === 'METER_CAPABILITY_REQUIRED'), false);
});

test('measurement-assignment identity hashing never mutates persisted phase order', () => {
  const meter = {
    id: 'meter-order', installationId: 'installation', installedOnBoardId: 'board',
    deviceFamily: 'WATTWATCHERS' as const, deviceModel: 'A3RM' as const,
    serialNumber: 'serial',
    displayName: { value: 'ESS-A3RM-001', generatedValue: 'ESS-A3RM-001', isOverridden: false, ruleVersion: 1 as const },
    channels: [
      { id: 'c1', ordinal: 1, purpose: 'SUB_CIRCUIT' as const },
      { id: 'c2', ordinal: 2, purpose: 'SUB_CIRCUIT' as const },
      { id: 'c3', ordinal: 3, purpose: 'SUB_CIRCUIT' as const },
    ],
  };
  const assignment = createMeasurementAssignment({
    installationId: 'installation', assetId: 'asset', meter,
    channelIds: ['c3', 'c1', 'c2'], phaseMode: 'THREE_PHASE',
  });
  assert.deepEqual(assignment.channelIds, ['c3', 'c1', 'c2']);
});

test('virtual residual definitions use immediate children and deterministic IDs', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const board = store.electricalAssets[0]!;
  const gridId = store.gridSupplies[0]!.id;
  store.meterDevices = [{
    id: 'meter-total', installationId: 'installation', installedOnBoardId: board.id,
    deviceFamily: 'WATTWATCHERS', deviceModel: 'A3RM', serialNumber: 'serial',
    displayName: { value: 'ESS-A3RM-001', generatedValue: 'ESS-A3RM-001', isOverridden: false, ruleVersion: 1 },
    channels: [
      { id: 'total', ordinal: 1, purpose: 'MAIN_SUPPLY' },
      { id: 'subtract', ordinal: 2, purpose: 'SUB_CIRCUIT' },
      { id: 'spare', ordinal: 3, purpose: 'SPARE' },
    ],
  }];
  store.measurementAssignments = [
    {
      id: 'assignment-total', installationId: 'installation', meterId: 'meter-total',
      channelIds: ['total'], phaseMode: 'SINGLE_PHASE',
      target: { kind: 'GRID_BOUNDARY', gridSupplyId: gridId }, direction: 'CONSUMPTION', status: 'CONFIRMED',
    },
    {
      id: 'assignment-asset', installationId: 'installation', meterId: 'meter-total',
      channelIds: ['subtract'], phaseMode: 'SINGLE_PHASE',
      target: { kind: 'SITE_ASSET', siteAssetId: 'asset' }, direction: 'CONSUMPTION', status: 'CONFIRMED',
    },
  ];
  store.siteAssets[0]!.electrical_source = { kind: 'GRID', gridSupplyId: gridId };
  const virtuals = deriveVirtualMeters(store, 'installation');
  assert.equal(virtuals.length, 1);
  assert.equal(virtuals[0]!.parentNodeId, gridId);
  assert.deepEqual(virtuals[0]!.subtractAssignmentIds, ['assignment-asset']);
  assert.match(virtuals[0]!.id, /^virtual_[a-f0-9]{24}$/);
});

test('shared residual coverage uses one unallocated boundary ID for several known assets', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const board = store.electricalAssets[0]!;
  const first = store.siteAssets[0]!;
  first.electrical_source = { kind: 'BOARD', boardId: board.id };
  first.metering_state = { kind: 'UNMETERED' };
  store.siteAssets.push({
    ...first,
    id: 'asset-2',
    asset_name: 'Second known load',
    display_code: 'ESS-HVAC-002',
    display_code_meta: {
      value: 'ESS-HVAC-002', generatedValue: 'ESS-HVAC-002',
      isOverridden: false, ruleVersion: 1,
    },
  });
  store.meterDevices = [{
    id: 'boundary-meter', installationId: 'installation', installedOnBoardId: board.id,
    deviceFamily: 'OTHER', deviceModel: 'OTHER', customManufacturerName: 'Example',
    customModelName: 'Boundary', serialNumber: 'boundary-serial',
    displayName: {
      value: 'ESS-METER-001', generatedValue: 'ESS-METER-001',
      isOverridden: false, ruleVersion: 1,
    },
    channels: [{
      id: 'boundary-total', ordinal: 1, purpose: 'MAIN_SUPPLY', capabilities: { current: true },
    }],
  }];
  store.measurementAssignments = [{
    id: 'boundary-assignment', installationId: 'installation', meterId: 'boundary-meter',
    channelIds: ['boundary-total'], phaseMode: 'SINGLE_PHASE',
    target: { kind: 'BOARD', boardId: board.id }, direction: 'CONSUMPTION', status: 'CONFIRMED',
  }];
  const rows = allAssetMeteringRows(store, 'installation');
  assert.deepEqual(rows.map((row) => row.state), ['VIRTUAL', 'VIRTUAL']);
  assert.equal(rows[0]!.virtualMeterId, rows[1]!.virtualMeterId);
  assert.equal(JSON.stringify(rows).includes('quantity'), false);
  assert.equal(JSON.stringify(rows).includes('percentage'), false);
});

test('Draft meter removal retires active mapping while retaining completed form evidence', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const board = store.electricalAssets[0]!;
  const meter = store.meterDevices[0]!;
  store.measurementAssignments = [{
    id: 'assignment-to-remove', installationId: 'installation', meterId: meter.id,
    channelIds: [meter.channels[0]!.id], phaseMode: 'SINGLE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: 'asset' },
    direction: 'CONSUMPTION', status: 'CONFIRMED',
  }];
  store.siteAssets[0]!.metering_state = {
    kind: 'METERED', measurementAssignmentIds: ['assignment-to-remove'],
  };
  store.formSubmissions = [{
    id: 'completed-meter-form', form_type: 'ww-installation', schema_version: 1,
    status: 'Completed', installation_id: 'installation', board_id: board.id,
    meter_id: meter.id, answers: {}, attachments: [{
      id: 'retained-evidence', slot: 'device', uri: 'file:///retained.jpg',
      mime_type: 'image/jpeg', captured_at: '2026-08-01T00:00:00.000Z',
    }], completed_at: '2026-08-01T01:00:00.000Z',
    created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
  }];

  replaceBoardMetersFromLegacy(store, board, []);
  assert.equal(store.meterDevices.some((item) => item.id === meter.id), false);
  assert.equal(store.measurementAssignments.length, 0);
  assert.deepEqual(store.siteAssets[0]!.metering_state, { kind: 'TBC' });
  assert.equal(store.formSubmissions[0]!.status, 'Completed');
  assert.equal(store.formSubmissions[0]!.historical_meter_removed, true);
  assert.equal(store.formSubmissions[0]!.attachments[0]!.id, 'retained-evidence');
  assert.equal(installationReadiness(store, 'installation').issues.some(
    (issue) => issue.code === 'FORM_CONTEXT_REQUIRED' && issue.entityId === 'completed-meter-form',
  ), false);
});
