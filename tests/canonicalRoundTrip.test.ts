import assert from 'node:assert/strict';
import test from 'node:test';
import type { RemoteInstallationTree } from '../src/api/apiClient';
import { normalizeCanonicalStore } from '../src/domain/installationV2';
import type { InstallationBackupTree } from '../src/repositories/cloudSyncRepository';
import { buildBackupPayload } from '../src/services/backupMedia';
import {
  assertRemoteInstallationIdentity,
  validateCanonicalRemoteTreeIds,
} from '../src/services/remoteInstallationValidation';
import type { AppDataStore } from '../src/types';

test('golden canonical tree preserves semantics through normalize, wire, and import preflight', () => {
  const timestamp = '2026-08-01T00:00:00.000Z';
  const store = normalizeCanonicalStore({
    schemaVersion: 3,
    user: { id: 'user', email: 'field@example.test', full_name: 'Field', role: 'admin' },
    installations: [{
      id: 'installation', client_id: 'client-1', client_site_id: 'site-1',
      client_name: 'Client', site_name: 'Golden Site',
      site_address: '1 Example Road, Sydney NSW 2000',
      customer_name: 'End Customer', maas: null, service_type: 'Metering installation',
      metering_solution_type: 'Multi-circuit monitoring', planned_meter_type: 'Wattwatchers',
      site_locality: 'Sydney', site_state: 'NSW', site_postcode: '2000', site_country_code: 'AU',
      site_latitude: -33.8688, site_longitude: 151.2093,
      site_geocode_provider: 'geoapify', site_geocode_place_id: 'place-1',
      site_address_source: 'suggested', site_geocoding_status: 'resolved',
      site_contact_name: 'Site Contact', site_contact_phone: '+61 400 000 001',
      site_contact_email: 'contact@example.test', fergus_job_number: 'FERGUS-1',
      quote_number: 'Q-1', job_comments: 'Install the planned monitoring.',
      access_information: 'Collect keys from reception.', warranty_device: null,
      monitoring_installed: false, hardware_installed: true, solar_capacity_kw: 42.5,
      additional_monitoring_required: true,
      additional_monitoring_hardware: 'One additional current transformer.',
      inspector_name: 'Field', audit_date: '2026-08-01', status: 'Draft',
      external_key: 'server:installation', site_code: 'Legacy Site Code / 2024', timezone: 'Australia/Sydney',
      tree_schema_version: 2, tree_revision: 3,
      cloud_backup_enabled: true, created_at: timestamp, updated_at: timestamp,
    }],
    gridSupplies: [{ id: 'grid', installationId: 'installation', name: 'Grid', isDefault: true }],
    zones: [{
      id: 'zone', audit_id: 'installation', zone_code: 'PLANT', zone_name: 'Plant', zone_description: '', photos: [],
      created_at: timestamp, updated_at: timestamp,
    }],
    electricalAssets: [{
      id: 'board', audit_id: 'installation', zone_id: 'zone', asset_name: 'Main',
      display_code: 'GS-MSB-001', display_code_meta: {
        value: 'GS-MSB-001', generatedValue: 'GS-MSB-001', isOverridden: false,
        ruleVersion: 1, provisional: true,
      }, asset_type: 'MSB', type_code: 'MSB',
      electrical_source: { kind: 'GRID', gridSupplyId: 'grid' },
      meter_present: false, meters: [], created_at: timestamp, updated_at: timestamp,
    }],
    siteAssets: [{
      id: 'asset', audit_id: 'installation', zone_id: 'zone', asset_name: 'Load',
      display_code: 'GS-HVAC-001', display_code_meta: {
        value: 'GS-HVAC-001', generatedValue: 'GS-HVAC-001', isOverridden: false,
        ruleVersion: 1, provisional: true,
      }, asset_type: 'HVAC', type_code: 'HVAC',
      electrical_source: { kind: 'BOARD', boardId: 'board' },
      metering_state: { kind: 'UNMETERED' }, meter_present: false,
      created_at: timestamp, updated_at: timestamp,
    }],
    meterDevices: [],
    measurementAssignments: [],
    formSubmissions: [],
    cloudSync: {
      synced_at_by_installation: {}, force_dirty_installation_ids: [],
      upload_queue: [], thumbnail_queue: [],
    },
  } satisfies AppDataStore);
  store.meterDevices.push({
    id: 'meter',
    installationId: 'installation',
    installedOnBoardId: 'board',
    deviceFamily: 'WATTWATCHERS',
    deviceModel: 'A3RM',
    customName: 'Boiler Meter',
    serialNumber: 'SERIAL-1',
    displayName: {
      value: 'GS-A3RM-001', generatedValue: 'GS-A3RM-001',
      isOverridden: false, ruleVersion: 1,
    },
    channels: [1, 2, 3].map((ordinal) => ({
      id: `meter:${ordinal}`, ordinal, purpose: 'SPARE' as const,
    })),
    commissioningData: {
      classification: 'Electricity meter',
      coverage: 'Main incoming supply',
      prestart: { safeAccess: true, safeToProceed: true },
      verification: { voltageChecked: true, communicationsOk: true },
      commissioning: { deviceOnline: true, channelsReporting: true },
    },
  });
  store.electricalAssets[0]!.meter_present = true;
  const backupTree: InstallationBackupTree = {
    treeSchemaVersion: 2,
    baseTreeRevision: 3,
    installation: store.installations[0]!,
    gridSupplies: store.gridSupplies,
    zones: store.zones,
    electricalAssets: store.electricalAssets,
    siteAssets: store.siteAssets,
    meterDevices: store.meterDevices,
    measurementAssignments: store.measurementAssignments,
    formSubmissions: store.formSubmissions,
    watermark: timestamp,
  };
  const wire = buildBackupPayload(backupTree, [], 'complete');
  assert.equal(wire.installation.siteCountryCode, 'AU');
  assert.equal(wire.installation.siteCode, 'Legacy Site Code / 2024');
  assert.equal(wire.installation.clientId, 'client-1');
  assert.equal(wire.installation.clientSiteId, 'site-1');
  assert.equal(wire.installation.customerName, 'End Customer');
  assert.equal(wire.installation.maas, null);
  assert.equal(wire.installation.siteState, 'NSW');
  assert.equal(wire.installation.sitePostcode, '2000');
  assert.equal(wire.installation.siteLatitude, -33.8688);
  assert.equal(wire.installation.siteLongitude, 151.2093);
  assert.equal(wire.installation.siteGeocodeProvider, 'geoapify');
  assert.equal(wire.installation.siteGeocodePlaceId, 'place-1');
  assert.equal(wire.installation.siteAddressSource, 'suggested');
  assert.equal(wire.installation.siteGeocodeStatus, 'resolved');
  assert.match(String(wire.installation.siteAddressFingerprint), /^[0-9a-f]{64}$/);
  assert.equal(wire.installation.accessInformation, 'Collect keys from reception.');
  assert.equal(wire.installation.monitoringInstalled, false);
  assert.equal(wire.installation.solarCapacityKw, 42.5);
  assert.equal(wire.zones[0]?.zoneCode, 'PLANT');
  assert.equal(wire.meterDevices[0]?.customName, 'Boiler Meter');
  const remote = {
    ...wire,
    treeRevision: 3,
    recordVersionNumber: 0,
    installation: {
      ...wire.installation,
      treeRevision: 3,
      recordVersionNumber: 0,
    },
    serverDerived: { virtualMeterDefinitions: [] },
  } as unknown as RemoteInstallationTree;
  validateCanonicalRemoteTreeIds(remote);
  assertRemoteInstallationIdentity(remote, 'installation');
  assert.deepEqual(wire.electricalAssets[0]?.electricalSource, {
    kind: 'GRID', gridSupplyId: 'grid',
  });
  assert.deepEqual(wire.siteAssets[0]?.electricalSource, {
    kind: 'BOARD', boardId: 'board',
  });
  assert.deepEqual(wire.siteAssets[0]?.meteringState, { kind: 'UNMETERED' });
  assert.deepEqual(wire.meterDevices[0]?.commissioningData, {
    classification: 'Electricity meter',
    coverage: 'Main incoming supply',
    prestart: { safeAccess: true, safeToProceed: true },
    verification: { voltageChecked: true, communicationsOk: true },
    commissioning: { deviceOnline: true, channelsReporting: true },
  });

  const repairedCountryWire = buildBackupPayload({
    ...backupTree,
    installation: { ...backupTree.installation, site_country_code: null },
  }, [], 'complete');
  assert.equal(repairedCountryWire.installation.siteCountryCode, 'AU');

  store.meterDevices[0]!.commissioningData!.prestart!.additionalHazards =
    'no' as unknown as boolean;
  assert.throws(
    () => buildBackupPayload(backupTree, [], 'complete'),
    /commissioningData\.prestart\.additionalHazards must be a boolean/,
  );
});
