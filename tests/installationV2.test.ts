import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boardTypeCode,
  buildInstallationMappingExport,
  allAssetMeteringRows,
  canonicalJsonStringify,
  cycleSafeBoardCandidates,
  createMeasurementAssignment,
  deriveVirtualMeters,
  electricalTreeRows,
  installationReadiness,
  installationDisplayCodePrefix,
  installationSiteCodeForNewCopy,
  isValidInstallationSiteCode,
  meteringInventorySummary,
  normalizeCanonicalStore,
  normalizedSiteCode,
  normalizeGridSupplyNmi,
  primaryGridSupplyId,
  replaceBoardMetersFromLegacy,
  replaceMeterMeasurementAssignments,
  setAssetMeteringState,
  setDefaultGridSupplyNmi,
  siteAssetTypeCode,
  siteAssetTypeFromCode,
  SITE_ASSET_TYPE_LABELS,
} from '../src/domain/installationV2';
import { SITE_ASSET_TYPE_CODES, type AppDataStore } from '../src/types';

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

test('site-code rule matches the canonical eight-initial cross-client fixtures', () => {
  assert.deepEqual([
    normalizedSiteCode('Warehouse'),
    normalizedSiteCode('Alpha Bravo Charlie Delta Echo Foxtrot Golf'),
    normalizedSiteCode('Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel'),
    normalizedSiteCode('Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India'),
  ], ['W', 'ABCDEFG', 'ABCDEFGH', 'ABCDEFGH']);
  for (const valid of ['W', 'SYD-WH1', '123', 'ABCDEFGHIJKLMNOP']) {
    assert.equal(isValidInstallationSiteCode(valid), true);
  }
  for (const invalid of ['bad', 'BAD SITE', 'BAD!', '-BAD', 'BAD-', 'BAD--SITE', 'ABCDEFGHIJKLMNOPQ']) {
    assert.equal(isValidInstallationSiteCode(invalid), false);
  }
});

test('Electricity NMI is trimmed onto the canonical default Grid supply and can be cleared', () => {
  const store = storeFixture();
  const grid = setDefaultGridSupplyNmi(store, 'installation', ' 41020000000 ');

  assert.equal(grid.id, primaryGridSupplyId('installation'));
  assert.equal(grid.isDefault, true);
  assert.equal(grid.nmi, '41020000000');
  assert.equal(setDefaultGridSupplyNmi(store, 'installation', null).nmi, undefined);
  assert.equal(normalizeGridSupplyNmi(' NMI-ABC '), 'NMI-ABC');
  assert.throws(
    () => normalizeGridSupplyNmi('N'.repeat(101)),
    /Electricity NMI must contain at most 100 characters/,
  );
});

test('Refrigeration and Compressed Air are first-class choices without rewriting legacy Other data', () => {
  assert.ok(SITE_ASSET_TYPE_CODES.includes('REFRIGERATION'));
  assert.ok(SITE_ASSET_TYPE_CODES.includes('COMPRESSED_AIR'));
  assert.equal(SITE_ASSET_TYPE_LABELS.REFRIGERATION, 'Refrigeration');
  assert.equal(SITE_ASSET_TYPE_LABELS.COMPRESSED_AIR, 'Compressed Air');
  assert.equal(siteAssetTypeFromCode('REFRIGERATION'), 'Refrigeration');
  assert.equal(siteAssetTypeFromCode('COMPRESSED_AIR'), 'Compressed Air');
  assert.equal(siteAssetTypeCode('Refrigeration'), 'OTHER');
  assert.equal(siteAssetTypeCode('Compressed Air'), 'OTHER');
});

test('historical site codes use the shared bounded display-code prefix', () => {
  assert.equal(installationDisplayCodePrefix('Legacy Site Code / 2024'), 'LEGACY-SITE-CODE');
  assert.equal(installationDisplayCodePrefix('---'), 'SITE');
  assert.equal(installationDisplayCodePrefix('123456789012345-678'), '123456789012345');
});

test('a new imported copy derives a strict code without rewriting the source code', () => {
  const source = 'Legacy Site Code / 2024';
  assert.equal(installationSiteCodeForNewCopy(source, 'Golden Site cp2'), 'GSC');
  assert.equal(source, 'Legacy Site Code / 2024');
  assert.equal(installationSiteCodeForNewCopy('SYD-WH1', 'Golden Site cp2'), 'SYD-WH1');
});

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

test('job metadata normalization preserves nullable outcomes and defaults legacy sites to Australia', () => {
  const fixture = storeFixture();
  Object.assign(fixture.installations[0]!, {
    customer_name: 'End Customer',
    maas: null,
    service_type: 'Metering installation',
    site_contact_name: 'Site Contact',
    access_information: 'Collect keys from reception.',
    monitoring_installed: false,
    solar_capacity_kw: 42.5,
  });

  const installation = normalizeCanonicalStore(fixture).installations[0]!;
  assert.equal(installation.site_country_code, 'AU');
  assert.equal(installation.client_id, null);
  assert.equal(installation.client_site_id, null);
  assert.equal(installation.site_address_source, 'manual');
  assert.equal(installation.site_geocoding_status, 'unresolved');
  assert.equal(installation.site_latitude, null);
  assert.equal(installation.site_longitude, null);
  assert.match(installation.site_address_fingerprint ?? '', /^[0-9a-f]{64}$/);
  assert.equal(installation.customer_name, 'End Customer');
  assert.equal(installation.maas, null);
  assert.equal(installation.monitoring_installed, false);
  assert.equal(installation.solar_capacity_kw, 42.5);
  assert.equal(installation.access_information, 'Collect keys from reception.');
});

test('meter commissioning metadata survives legacy-to-canonical-to-legacy normalization', () => {
  const store = storeFixture();
  const meter = store.electricalAssets[0]!.meters[0]!;
  meter.classification = 'Electricity meter';
  meter.coverage = 'Main switchboard incoming supply';
  meter.ww_prestart = {
    site_induction: true,
    safe_access: true,
    correct_ppe: true,
    live_points_aware: true,
    can_isolate: true,
    additional_hazards: false,
    safe_to_proceed: true,
  };
  meter.ww_switchboard = {
    sb_name: 'Main Switchboard',
    sb_location: 'Plant room north wall',
    firmware: 'QA',
    antenna_type: 'Internal',
    signal_strength: 'Verified',
  };
  meter.ww_verification = {
    voltage_checked: true,
    polarity_checked: true,
    communications_ok: true,
    notes: 'Three-phase mapping verified',
  };
  meter.ww_commissioning = {
    device_online: true,
    channels_reporting: true,
    labeled: true,
    photos_taken: false,
    notes: 'Commissioned in QA',
  };
  meter.ww_photos = {
    device_installed: 'file:///installed.jpg',
    switchboard_overview: undefined,
    labeling: 'file:///label.jpg',
    extra: ['file:///extra-1.jpg', 'file:///extra-2.jpg'],
  };

  normalizeCanonicalStore(store);

  assert.deepEqual(store.meterDevices[0]!.commissioningData, {
    classification: 'Electricity meter',
    coverage: 'Main switchboard incoming supply',
    prestart: {
      siteInduction: true,
      safeAccess: true,
      correctPpe: true,
      livePointsAware: true,
      canIsolate: true,
      additionalHazards: false,
      safeToProceed: true,
    },
    switchboard: {
      name: 'Main Switchboard',
      location: 'Plant room north wall',
      deviceSerial: null,
      firmware: 'QA',
      antennaType: 'Internal',
      signalStrength: 'Verified',
      notes: null,
    },
    verification: {
      voltageChecked: true,
      polarityChecked: true,
      communicationsOk: true,
      notes: 'Three-phase mapping verified',
    },
    commissioning: {
      deviceOnline: true,
      channelsReporting: true,
      labeled: true,
      photosTaken: false,
      notes: 'Commissioned in QA',
    },
  });
  const projected = store.electricalAssets[0]!.meters[0]!;
  assert.equal(projected.classification, 'Electricity meter');
  assert.equal(projected.ww_prestart?.safe_to_proceed, true);
  assert.equal(projected.ww_switchboard?.sb_location, 'Plant room north wall');
  assert.equal(projected.ww_verification?.communications_ok, true);
  assert.equal(projected.ww_commissioning?.channels_reporting, true);
  assert.deepEqual(store.meterDevices[0]!.wwPhotos, {
    deviceInstalled: 'file:///installed.jpg',
    switchboardOverview: undefined,
    labeling: 'file:///label.jpg',
    extra: ['file:///extra-1.jpg', 'file:///extra-2.jpg'],
  });
  assert.deepEqual(projected.ww_photos, meter.ww_photos);
});

test('legacy meter load labels map to canonical codes only for sub-circuits', () => {
  const store = storeFixture();
  store.electricalAssets[0]!.meters[0]!.ww_channels = [
    { load_type: 'Mains Supply', rogowski_size: '3000A - 9cm' },
    { load_type: 'Not Used' },
    { purpose: 'SUB_CIRCUIT', load_type: 'Lighting', ct_ratio: '120A' },
    { purpose: 'SUB_CIRCUIT', load_type: 'General Power', ct_ratio: '120A' },
    { purpose: 'SUB_CIRCUIT', load_type: 'Forklift Charger', ct_ratio: '120A' },
    { purpose: 'SUB_CIRCUIT', load_type: 'Refrigeration', ct_ratio: '120A' },
  ];

  normalizeCanonicalStore(store);

  assert.deepEqual(
    store.meterDevices[0]!.channels.map((channel) => ({
      purpose: channel.purpose,
      loadTypeCode: channel.loadTypeCode ?? null,
      customLoadTypeName: channel.customLoadTypeName ?? null,
    })),
    [
      { purpose: 'MAIN_SUPPLY', loadTypeCode: null, customLoadTypeName: null },
      { purpose: 'SPARE', loadTypeCode: null, customLoadTypeName: null },
      { purpose: 'SUB_CIRCUIT', loadTypeCode: 'LIGHTING', customLoadTypeName: null },
      { purpose: 'SUB_CIRCUIT', loadTypeCode: 'POWER_OUTLET', customLoadTypeName: null },
      { purpose: 'SUB_CIRCUIT', loadTypeCode: 'FORKLIFT', customLoadTypeName: null },
      { purpose: 'SUB_CIRCUIT', loadTypeCode: 'OTHER', customLoadTypeName: 'Refrigeration' },
    ],
  );
});

test('legacy normalization preserves a non-empty historical site code and fills only a missing one', () => {
  const historical = storeFixture();
  historical.installations[0]!.site_code = 'Legacy Site Code / 2024';
  normalizeCanonicalStore(historical);
  assert.equal(historical.installations[0]!.site_code, 'Legacy Site Code / 2024');

  const missing = storeFixture();
  missing.installations[0]!.site_code = '   ';
  normalizeCanonicalStore(missing);
  assert.equal(missing.installations[0]!.site_code, 'ES');
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

test('metering inventory keeps confirmed unmetered non-blocking and exposes broken or unassigned mappings', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const asset = store.siteAssets[0]!;
  const board = store.electricalAssets[0]!;
  asset.electrical_source = { kind: 'BOARD', boardId: board.id };
  asset.electrical_board_id = board.id;
  asset.electrical_board_tbc = false;
  asset.metering_state = { kind: 'UNMETERED' };
  asset.meter_present = false;
  store.measurementAssignments = [];
  store.meterDevices = [{
    id: 'meter-inventory',
    installationId: 'installation',
    installedOnBoardId: board.id,
    deviceFamily: 'OTHER',
    deviceModel: 'OTHER',
    customManufacturerName: 'Example',
    customModelName: 'Inventory meter',
    serialNumber: 'inventory-serial',
    displayName: {
      value: 'ESS-METER-INVENTORY',
      generatedValue: 'ESS-METER-INVENTORY',
      isOverridden: false,
      ruleVersion: 1,
    },
    channels: [
      { id: 'active-unassigned', ordinal: 1, purpose: 'SUB_CIRCUIT', capabilities: { current: true } },
      { id: 'explicit-spare', ordinal: 2, purpose: 'SPARE', capabilities: { current: true } },
    ],
  }];

  const valid = meteringInventorySummary(store, 'installation');
  assert.equal(valid.assets.confirmedUnmetered, 1);
  assert.equal(valid.assets.brokenMappings, 0);
  assert.equal(valid.channels.unassignedActive, 1);
  assert.equal(valid.channels.spare, 1);
  assert.equal(valid.meters.withUnassignedActiveChannels, 1);

  store.measurementAssignments = [{
    id: 'retained-unmetered-assignment',
    installationId: 'installation',
    meterId: 'meter-inventory',
    channelIds: ['active-unassigned'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: asset.id },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  }];
  asset.meter_present = true;
  assert.equal(
    installationReadiness(store, 'installation').issues.find(
      (issue) => issue.code === 'METERING_STATE_INVALID' && issue.entityId === asset.id,
    )?.field,
    'meteringState.measurementAssignmentIds',
  );
  store.measurementAssignments = [];
  asset.meter_present = false;

  asset.metering_state = { kind: 'METERED', measurementAssignmentIds: ['missing-assignment'] };
  assert.equal(allAssetMeteringRows(store, 'installation')[0]?.state, 'MAPPING_ISSUE');
  const broken = meteringInventorySummary(store, 'installation');
  assert.equal(broken.assets.confirmedUnmetered, 0);
  assert.equal(broken.assets.brokenMappings, 1);

  store.measurementAssignments = [{
    id: 'invalid-direct-assignment',
    installationId: 'installation',
    meterId: 'meter-inventory',
    channelIds: ['missing-channel'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: asset.id },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  }];
  asset.meter_present = true;
  asset.metering_state = {
    kind: 'METERED',
    measurementAssignmentIds: ['invalid-direct-assignment'],
  };
  const invalidDirect = allAssetMeteringRows(store, 'installation')[0];
  assert.equal(invalidDirect?.state, 'MAPPING_ISSUE');
  assert.ok(invalidDirect?.meteringIssueCodes.includes('CHANNEL_NOT_FOUND'));

  store.measurementAssignments = [{
    id: 'wrong-meter-assignment',
    installationId: 'installation',
    meterId: 'missing-meter',
    channelIds: ['active-unassigned'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'TBC' },
    direction: 'CONSUMPTION',
    status: 'TBC',
  }];
  asset.meter_present = false;
  asset.metering_state = { kind: 'UNMETERED' };
  const wrongMeter = meteringInventorySummary(store, 'installation');
  assert.equal(wrongMeter.channels.assignedActive, 0);
  assert.equal(wrongMeter.channels.unassignedActive, 1);
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

test('human names accept spaces and punctuation while duplicate checks span boards, assets, and devices', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const board = store.electricalAssets[0]!;
  const asset = store.siteAssets[0]!;
  const meter = store.meterDevices[0]!;
  board.display_code = 'Main Switchboard & Services';
  board.display_code_meta = {
    value: board.display_code,
    generatedValue: board.display_code,
    isOverridden: true,
    ruleVersion: 1,
  };
  asset.display_code = 'Chiller Plant / East';
  asset.display_code_meta = {
    value: asset.display_code,
    generatedValue: asset.display_code,
    isOverridden: true,
    ruleVersion: 1,
  };
  meter.displayName = {
    value: 'Example Site - Plant - Other',
    generatedValue: 'Example Site - Plant - Other',
    isOverridden: false,
    ruleVersion: 1,
  };
  const validIssues = installationReadiness(store, 'installation').issues;
  assert.equal(validIssues.some((issue) =>
    issue.code === 'DISPLAY_CODE_INVALID' && [board.id, asset.id, meter.id].includes(issue.entityId)), false);

  board.display_code = 'Shared Name';
  board.display_code_meta.value = 'Shared Name';
  asset.display_code = ' shared   name ';
  asset.display_code_meta.value = ' shared   name ';
  meter.displayName.value = 'SHAREDNAME';
  const duplicateIds = installationReadiness(store, 'installation').issues
    .filter((issue) => issue.code === 'DISPLAY_CODE_DUPLICATE')
    .map((issue) => issue.entityId)
    .sort();
  assert.deepEqual(duplicateIds, [asset.id, board.id, meter.id].sort());
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
  assert.equal(
    store.siteAssets.find((asset) => asset.id === 'new-light')?.display_code,
    'ESS-PLANT-01-DIRECT-GRID-LOAD',
  );
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

test('invalid timezone blocks local completion and mapping export', () => {
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
  assert.equal(timezone?.severity, 'ERROR');
  assert.equal(readiness.readyToComplete, false);
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
    channelIds: ['c3', 'c1', 'c2'], phaseMode: 'THREE_PHASE', direction: 'CONSUMPTION',
  });
  assert.deepEqual(assignment.channelIds, ['c3', 'c1', 'c2']);
});

test('virtual residual definitions use immediate children and deterministic IDs', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const board = store.electricalAssets[0]!;
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
      target: { kind: 'BOARD', boardId: board.id }, direction: 'CONSUMPTION', status: 'CONFIRMED',
    },
    {
      id: 'assignment-asset', installationId: 'installation', meterId: 'meter-total',
      channelIds: ['subtract'], phaseMode: 'SINGLE_PHASE',
      target: { kind: 'SITE_ASSET', siteAssetId: 'asset' }, direction: 'CONSUMPTION', status: 'CONFIRMED',
    },
  ];
  store.siteAssets[0]!.electrical_source = { kind: 'BOARD', boardId: board.id };
  const virtuals = deriveVirtualMeters(store, 'installation');
  assert.equal(virtuals.length, 1);
  assert.equal(virtuals[0]!.parentNodeId, board.id);
  assert.deepEqual(virtuals[0]!.subtractAssignmentIds, ['assignment-asset']);
  assert.match(virtuals[0]!.id, /^virtual_[a-f0-9]{24}$/);
});

test('virtual residual derivation rejects a total whose meter is on the wrong board', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const board = store.electricalAssets[0]!;
  const unrelatedBoard = {
    ...board,
    id: 'unrelated-board',
    asset_name: 'Unrelated board',
    display_code: 'ESS-DB-099',
    display_code_meta: {
      value: 'ESS-DB-099',
      generatedValue: 'ESS-DB-099',
      isOverridden: false,
      ruleVersion: 1 as const,
    },
    electrical_source: { kind: 'TBC' as const },
    meters: [],
  };
  store.electricalAssets.push(unrelatedBoard);
  store.meterDevices = [{
    id: 'wrong-boundary-meter',
    installationId: 'installation',
    installedOnBoardId: unrelatedBoard.id,
    deviceFamily: 'OTHER',
    deviceModel: 'OTHER',
    customManufacturerName: 'Example',
    customModelName: 'Boundary',
    serialNumber: 'WRONG-BOUNDARY',
    displayName: {
      value: 'Wrong boundary meter',
      generatedValue: 'Wrong boundary meter',
      isOverridden: false,
      ruleVersion: 1,
    },
    channels: [{ id: 'wrong-total', ordinal: 1, purpose: 'MAIN_SUPPLY' }],
  }];
  store.measurementAssignments = [{
    id: 'wrong-total-assignment',
    installationId: 'installation',
    meterId: 'wrong-boundary-meter',
    channelIds: ['wrong-total'],
    phaseMode: 'SINGLE_PHASE',
    target: { kind: 'BOARD', boardId: board.id },
    direction: 'CONSUMPTION',
    status: 'CONFIRMED',
  }];

  assert.deepEqual(deriveVirtualMeters(store, 'installation'), []);
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

test('ancestor residual never claims an unmetered asset below a directly measured child board', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const root = store.electricalAssets[0]!;
  const gridId = store.gridSupplies[0]!.id;
  root.electrical_source = { kind: 'GRID', gridSupplyId: gridId };
  const child = {
    ...root,
    id: 'child-db',
    asset_name: 'Measured child DB',
    display_code: 'ESS-DB-001',
    type_code: 'DB' as const,
    asset_type: 'DB' as const,
    meters: [],
    meter_present: false,
    electrical_source: { kind: 'BOARD' as const, boardId: root.id },
  };
  store.electricalAssets.push(child);
  const asset = store.siteAssets[0]!;
  asset.electrical_source = { kind: 'BOARD', boardId: child.id };
  asset.metering_state = { kind: 'UNMETERED' };
  store.meterDevices = [{
    id: 'root-total-meter', installationId: 'installation', installedOnBoardId: root.id,
    deviceFamily: 'OTHER', deviceModel: 'OTHER', customManufacturerName: 'Example',
    customModelName: 'Boundary meter', serialNumber: 'boundary',
    displayName: { value: 'ESS-METER-ROOT', generatedValue: 'ESS-METER-ROOT', isOverridden: false, ruleVersion: 1 },
    channels: [
      { id: 'root-total', ordinal: 1, purpose: 'MAIN_SUPPLY', capabilities: { current: true } },
      { id: 'child-direct', ordinal: 2, purpose: 'SUB_CIRCUIT', capabilities: { current: true } },
    ],
  }];
  store.measurementAssignments = [
    {
      id: 'root-total-assignment', installationId: 'installation', meterId: 'root-total-meter',
      channelIds: ['root-total'], phaseMode: 'SINGLE_PHASE', target: { kind: 'BOARD', boardId: root.id },
      direction: 'CONSUMPTION', status: 'CONFIRMED',
    },
    {
      id: 'child-direct-assignment', installationId: 'installation', meterId: 'root-total-meter',
      channelIds: ['child-direct'], phaseMode: 'SINGLE_PHASE', target: { kind: 'BOARD', boardId: child.id },
      direction: 'CONSUMPTION', status: 'CONFIRMED',
    },
  ];
  assert.equal(deriveVirtualMeters(store, 'installation').some((item) => item.parentNodeId === root.id), true);
  const row = allAssetMeteringRows(store, 'installation').find((item) => item.id === asset.id);
  assert.equal(row?.state, 'UNMETERED');
  assert.equal(row?.virtualMeterId, undefined);
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

test('cycle-safe parent choices exclude the edited board and all descendants', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const root = store.electricalAssets[0]!;
  const child = {
    ...root, id: 'child', asset_name: 'Child', display_code: 'ESS-DB-001',
    type_code: 'DB' as const, asset_type: 'DB' as const, meters: [], meter_present: false,
    electrical_source: { kind: 'BOARD' as const, boardId: root.id },
  };
  const grandchild = {
    ...child, id: 'grandchild', asset_name: 'Grandchild', display_code: 'ESS-DB-002',
    electrical_source: { kind: 'BOARD' as const, boardId: child.id },
  };
  const independent = {
    ...child, id: 'independent', asset_name: 'Independent', display_code: 'ESS-DB-003',
    electrical_source: { kind: 'GRID' as const, gridSupplyId: store.gridSupplies[0]!.id },
  };
  const candidates = cycleSafeBoardCandidates([root, child, grandchild, independent], root.id);
  assert.deepEqual(candidates.map((item) => item.id), ['independent']);
  assert.deepEqual(
    cycleSafeBoardCandidates([root, child], undefined).map((item) => item.id),
    [root.id, child.id],
  );
});

test('one meter can expose BOARD, GRID_BOUNDARY, SITE_ASSET, and explicit TBC targets with exact rules', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const root = store.electricalAssets[0]!;
  const gridId = store.gridSupplies[0]!.id;
  root.electrical_source = { kind: 'GRID', gridSupplyId: gridId };
  const child = {
    ...root, id: 'child-board', asset_name: 'Child Board', display_code: 'ESS-DB-001',
    type_code: 'DB' as const, asset_type: 'DB' as const, meters: [], meter_present: false,
    electrical_source: { kind: 'BOARD' as const, boardId: root.id },
  };
  store.electricalAssets.push(child);
  const asset = store.siteAssets[0]!;
  asset.electrical_source = { kind: 'BOARD', boardId: child.id };
  const meter = {
    id: 'mapping-meter', installationId: 'installation', installedOnBoardId: root.id,
    deviceFamily: 'OTHER' as const, deviceModel: 'OTHER' as const,
    customManufacturerName: 'Example', customModelName: 'Five Channel', serialNumber: 'SERIAL',
    displayName: { value: 'ESS-METER-001', generatedValue: 'ESS-METER-001', isOverridden: false, ruleVersion: 1 as const },
    channels: [
      { id: 'main-grid', ordinal: 1, purpose: 'MAIN_SUPPLY' as const, capabilities: { current: true } },
      { id: 'main-board', ordinal: 2, purpose: 'MAIN_SUPPLY' as const, capabilities: { current: true } },
      { id: 'sub-board', ordinal: 3, purpose: 'SUB_CIRCUIT' as const, capabilities: { current: true } },
      { id: 'sub-asset', ordinal: 4, purpose: 'SUB_CIRCUIT' as const, capabilities: { current: true } },
      { id: 'sub-tbc', ordinal: 5, purpose: 'SUB_CIRCUIT' as const, capabilities: { current: true } },
    ],
  };
  store.meterDevices = [meter];
  const assignments = [
    { id: 'a-grid', channelIds: ['main-grid'], target: { kind: 'GRID_BOUNDARY' as const, gridSupplyId: gridId }, status: 'CONFIRMED' as const },
    { id: 'a-board-total', channelIds: ['main-board'], target: { kind: 'BOARD' as const, boardId: root.id }, status: 'CONFIRMED' as const },
    { id: 'a-child', channelIds: ['sub-board'], target: { kind: 'BOARD' as const, boardId: child.id }, status: 'CONFIRMED' as const },
    { id: 'a-asset', channelIds: ['sub-asset'], target: { kind: 'SITE_ASSET' as const, siteAssetId: asset.id }, status: 'CONFIRMED' as const },
    { id: 'a-tbc', channelIds: ['sub-tbc'], target: { kind: 'TBC' as const }, status: 'TBC' as const },
  ].map((assignment) => ({
    ...assignment,
    installationId: 'installation', meterId: meter.id,
    phaseMode: 'SINGLE_PHASE' as const, direction: 'CONSUMPTION' as const,
  }));
  replaceMeterMeasurementAssignments(store, meter.id, assignments);
  assert.deepEqual(
    store.measurementAssignments.map((item) => item.target.kind),
    ['GRID_BOUNDARY', 'BOARD', 'BOARD', 'SITE_ASSET', 'TBC'],
  );
  assert.deepEqual(asset.metering_state, {
    kind: 'METERED', measurementAssignmentIds: ['a-asset'],
  });

  assert.throws(() => replaceMeterMeasurementAssignments(store, meter.id, [{
    ...assignments[1]!, id: 'bad-main-child', target: { kind: 'BOARD', boardId: child.id },
  }]), /installed-on board/);
  assert.throws(() => replaceMeterMeasurementAssignments(store, meter.id, [{
    ...assignments[2]!, id: 'bad-phase', phaseMode: 'THREE_PHASE', channelIds: ['sub-board'],
  }]), /phase mode/);
  assert.throws(() => replaceMeterMeasurementAssignments(store, meter.id, [
    { ...assignments[2]!, id: 'duplicate-a', channelIds: ['sub-board'] },
    { ...assignments[3]!, id: 'duplicate-b', channelIds: ['sub-board'] },
  ]), /only one measurement assignment/);
});

test('meter assignment save requires every active channel exactly once while SPARE stays exempt', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const meter = store.meterDevices[0]!;
  meter.channels = [
    { id: 'active', ordinal: 1, purpose: 'SUB_CIRCUIT', capabilities: { current: true } },
    { id: 'spare', ordinal: 2, purpose: 'SPARE', capabilities: { current: true } },
  ];
  const before = JSON.stringify(store);
  assert.throws(
    () => replaceMeterMeasurementAssignments(store, meter.id, []),
    /Every non-spare meter channel/,
  );
  assert.equal(JSON.stringify(store), before);
  replaceMeterMeasurementAssignments(store, meter.id, [{
    id: 'active-tbc', installationId: 'installation', meterId: meter.id,
    channelIds: ['active'], phaseMode: 'SINGLE_PHASE', target: { kind: 'TBC' },
    direction: 'BIDIRECTIONAL', status: 'TBC',
  }]);
  assert.deepEqual(store.measurementAssignments.map((item) => item.channelIds), [['active']]);
});

test('readiness exposes every absent active channel as CHANNEL_UNASSIGNED', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const meter = store.meterDevices[0]!;
  meter.channels = [
    { id: 'active-1', ordinal: 1, purpose: 'MAIN_SUPPLY', capabilities: { current: true } },
    { id: 'active-2', ordinal: 2, purpose: 'SUB_CIRCUIT', capabilities: { current: true } },
    { id: 'spare', ordinal: 3, purpose: 'SPARE', capabilities: { current: true } },
  ];
  const issues = installationReadiness(store, 'installation').issues
    .filter((item) => item.code === 'CHANNEL_UNASSIGNED');
  assert.deepEqual(issues.map((item) => item.entityId), ['active-1', 'active-2']);
  assert.ok(issues.every((item) => item.field === 'measurementAssignments'));
});

test('one site asset cannot receive two direct assignments and rejection is atomic', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const meter = store.meterDevices[0]!;
  const board = store.electricalAssets[0]!;
  const asset = store.siteAssets[0]!;
  asset.electrical_source = { kind: 'BOARD', boardId: board.id };
  meter.channels = [
    { id: 'direct-1', ordinal: 1, purpose: 'SUB_CIRCUIT', capabilities: { current: true } },
    { id: 'direct-2', ordinal: 2, purpose: 'SUB_CIRCUIT', capabilities: { current: true } },
  ];
  const before = JSON.stringify(store);
  assert.throws(() => replaceMeterMeasurementAssignments(store, meter.id, [
    {
      id: 'direct-a', installationId: 'installation', meterId: meter.id,
      channelIds: ['direct-1'], phaseMode: 'SINGLE_PHASE',
      target: { kind: 'SITE_ASSET', siteAssetId: asset.id }, direction: 'CONSUMPTION', status: 'CONFIRMED',
    },
    {
      id: 'direct-b', installationId: 'installation', meterId: meter.id,
      channelIds: ['direct-2'], phaseMode: 'SINGLE_PHASE',
      target: { kind: 'SITE_ASSET', siteAssetId: asset.id }, direction: 'CONSUMPTION', status: 'CONFIRMED',
    },
  ]), /only one direct measurement assignment/);
  assert.equal(JSON.stringify(store), before);
});

test('asset metering transition validates before mutation and removes exact assignments together', () => {
  const store = normalizeCanonicalStore(storeFixture());
  const asset = store.siteAssets[0]!;
  const meter = store.meterDevices[0]!;
  const assignment = {
    id: 'asset-assignment', installationId: 'installation', meterId: meter.id,
    channelIds: [meter.channels[0]!.id], phaseMode: 'SINGLE_PHASE' as const,
    target: { kind: 'SITE_ASSET' as const, siteAssetId: asset.id },
    direction: 'CONSUMPTION' as const, status: 'CONFIRMED' as const,
  };
  store.measurementAssignments = [assignment];
  asset.metering_state = { kind: 'METERED', measurementAssignmentIds: [assignment.id] };
  const before = JSON.stringify(store);
  assert.throws(
    () => setAssetMeteringState(
      store,
      asset.id,
      { kind: 'METERED', measurementAssignmentIds: ['missing'] },
      [],
    ),
    /every selected assignment/,
  );
  assert.equal(JSON.stringify(store), before);

  setAssetMeteringState(store, asset.id, { kind: 'UNMETERED' });
  assert.deepEqual(asset.metering_state, { kind: 'UNMETERED' });
  assert.equal(store.measurementAssignments.length, 1);
  assert.deepEqual(store.measurementAssignments[0]!.target, { kind: 'TBC' });
  assert.equal(store.measurementAssignments[0]!.direction, 'CONSUMPTION');
});
