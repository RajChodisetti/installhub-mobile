import assert from 'node:assert/strict';
import test from 'node:test';
import { completeFormSubmissionInStore } from '../src/domain/formCompletion';
import { installationReadiness } from '../src/domain/installationV2';
import type { AppDataStore, FormSubmission } from '../src/types';

const timestamp = '2026-08-02T00:00:00.000Z';

function fixture(form: FormSubmission): AppDataStore {
  return {
    user: { id: 'user', email: 'field@example.test', full_name: 'Field User', role: 'admin' },
    installations: [{
      id: 'installation', client_name: 'Client', site_name: 'Site', site_address: 'Address',
      inspector_name: 'Field User', audit_date: '2026-08-02', timezone: 'Australia/Sydney',
      status: 'Draft', cloud_backup_enabled: false, external_key: 'local:installation',
      tree_revision: 0, created_at: timestamp, updated_at: timestamp,
    }],
    gridSupplies: [{ id: 'grid', installationId: 'installation', name: 'Grid', isDefault: true }],
    zones: [{ id: 'zone', audit_id: 'installation', zone_name: 'Plant', zone_description: '', photos: [], created_at: timestamp, updated_at: timestamp }],
    electricalAssets: [{
      id: 'board', audit_id: 'installation', zone_id: 'zone', asset_name: 'Canonical Board',
      display_code: 'SITE-MSB-001', asset_type: 'MSB', location_description: 'Plant room',
      site_nmi: 'NMI-1', electrical_source: { kind: 'GRID', gridSupplyId: 'grid' },
      meter_present: false, meters: [], created_at: timestamp, updated_at: timestamp,
    }],
    siteAssets: [], meterDevices: [], measurementAssignments: [], formSubmissions: [form],
    cloudSync: { synced_at_by_installation: {}, force_dirty_installation_ids: [], upload_queue: [], thumbnail_queue: [] },
  };
}

function wwForm(boardId?: string, meterId?: string): FormSubmission {
  return {
    id: 'form', form_type: 'ww-installation', schema_version: 2, status: 'Draft',
    installation_id: 'installation', board_id: boardId, meter_id: meterId,
    answers: {
      'auditor.switchboard_name': 'Stale copy',
      'prestart.site_induction': 'yes',
      'prestart.safe_access': 'yes',
      'prestart.correct_ppe': 'no',
      'prestart.live_points': 'yes',
      'prestart.can_isolate': 'no',
      'prestart.additional_hazards': 'no',
      'prestart.safe_to_proceed': 'yes',
      'device.type': 'A3RM', 'device.id': 'SERIAL', 'device.number': 'D-1',
      'channel.1.load': 'Mains Supply', 'channel.1.rating': '3000A - 9cm',
      'channel.2.load': 'HVAC', 'channel.2.rating': '3000A - 9cm',
      'channel.3.load': 'Not Used', 'channel.3.rating': '',
    },
    attachments: [], created_at: timestamp, updated_at: timestamp,
  };
}

test('WW form cannot complete without a board and leaves the store unchanged', () => {
  const store = fixture(wwForm());
  const before = JSON.stringify(store);
  assert.throws(
    () => completeFormSubmissionInStore(store, 'form', timestamp, () => 'meter-new'),
    /Choose or create the switchboard/,
  );
  assert.equal(JSON.stringify(store), before);
});

test('WW form cannot resurrect a missing linked meter and leaves the store unchanged', () => {
  const store = fixture(wwForm('board', 'meter-deleted'));
  const before = JSON.stringify(store);
  assert.throws(
    () => completeFormSubmissionInStore(store, 'form', timestamp, () => {
      throw new Error('must not allocate a replacement ID');
    }),
    /linked meter is no longer available/,
  );
  assert.equal(JSON.stringify(store), before);
});

test('WW completion atomically pins canonical board and one stable operational meter', () => {
  const store = fixture(wwForm('board'));
  const completed = completeFormSubmissionInStore(
    store,
    'form',
    '2026-08-02T01:00:00.000Z',
    () => 'meter-stable',
  );
  assert.equal(completed.status, 'Completed');
  assert.equal(completed.board_id, 'board');
  assert.equal(completed.meter_id, 'meter-stable');
  assert.equal(completed.answers['auditor.switchboard_name'], 'Canonical Board');
  assert.equal(store.meterDevices.length, 1);
  assert.equal(store.meterDevices[0]!.id, 'meter-stable');
  assert.equal(store.meterDevices[0]!.installedOnBoardId, 'board');
  assert.equal(store.meterDevices[0]!.customName, 'A3RM Meter');
  assert.equal(store.meterDevices[0]!.deviceNumber, 'D-1');
  assert.equal(store.meterDevices[0]!.displayName.ruleVersion, 2);
  assert.equal(store.meterDevices[0]!.displayName.provisional, true);
  assert.match(store.meterDevices[0]!.displayName.value, /-PLANT-01-A3RM-METER$/);
  assert.deepEqual(store.meterDevices[0]!.commissioningData?.prestart, {
    siteInduction: true,
    safeAccess: true,
    correctPpe: false,
    livePointsAware: true,
    canIsolate: false,
    additionalHazards: false,
    safeToProceed: true,
  });
  assert.ok(Object.values(store.meterDevices[0]!.commissioningData?.prestart ?? {})
    .every((value) => typeof value === 'boolean'));
  assert.equal(store.electricalAssets[0]!.meters.length, 1);
  assert.equal(store.measurementAssignments.length, 0);
  assert.deepEqual(
    installationReadiness(store, 'installation').issues
      .filter((issue) => issue.code === 'CHANNEL_UNASSIGNED')
      .map((issue) => issue.entityId),
    ['meter-stable:1', 'meter-stable:2'],
  );

  store.formSubmissions.push({
    ...wwForm('board', 'meter-stable'),
    id: 'amendment',
    supersedes_id: 'form',
    answers: {
      ...wwForm('board').answers,
      'device.id': 'D-2',
      'device.number': 'D-2',
    },
  });
  completeFormSubmissionInStore(
    store,
    'amendment',
    '2026-08-02T02:00:00.000Z',
    () => { throw new Error('must not allocate another ID'); },
  );
  assert.equal(store.meterDevices.length, 1);
  assert.equal(store.meterDevices[0]!.deviceNumber, 'D-2');
  assert.equal(store.formSubmissions.find((item) => item.id === 'amendment')?.meter_id, 'meter-stable');
});
