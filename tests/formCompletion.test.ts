import assert from 'node:assert/strict';
import test from 'node:test';
import { completeFormSubmissionInStore } from '../src/domain/formCompletion';
import { installationReadiness, installationValidationIssues } from '../src/domain/installationV2';
import { requiredFormProgress } from '../src/forms/catalog';
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

test('WW form completes without optional board context and creates no meter', () => {
  const store = fixture(wwForm());
  const completed = completeFormSubmissionInStore(store, 'form', timestamp, () => {
    throw new Error('must not project a meter without its board');
  });
  assert.equal(completed.status, 'Completed');
  assert.equal(completed.board_id, undefined);
  assert.equal(store.meterDevices.length, 0);
});

test('WW completion clears stale optional meter context before projecting a new stable meter', () => {
  const store = fixture(wwForm('board', 'meter-deleted'));
  const completed = completeFormSubmissionInStore(store, 'form', timestamp, () => 'meter-new');
  assert.equal(completed.status, 'Completed');
  assert.equal(completed.meter_id, 'meter-new');
  assert.equal(store.meterDevices[0].id, 'meter-new');
});

test('WW completion with no optional model captures evidence without projecting a guessed device', () => {
  const form = wwForm('board');
  delete form.answers['device.type'];
  const store = fixture(form);
  const completed = completeFormSubmissionInStore(store, 'form', timestamp, () => {
    throw new Error('must not infer an unrecorded model');
  });
  assert.equal(completed.status, 'Completed');
  assert.equal(store.meterDevices.length, 0);
});

test('visible safe-to-proceed No hard-blocks completion without mutating the store', () => {
  const form = wwForm('board');
  const safeProgress = requiredFormProgress(form);
  form.answers['prestart.safe_to_proceed'] = 'no';
  const blockedProgress = requiredFormProgress(form);
  const store = fixture(form);
  const before = JSON.stringify(store);
  assert.throws(
    () => completeFormSubmissionInStore(store, 'form', timestamp, () => 'meter-new'),
    /must be Yes before the form can be completed/,
  );
  assert.equal(JSON.stringify(store), before);
  assert.equal(blockedProgress.total, safeProgress.total);
  assert.deepEqual(blockedProgress, { done: 0, total: 0 });
});

test('replacement validation is enforced atomically below the screen', () => {
  const form: FormSubmission = {
    ...wwForm(), form_type: 'comms-fault',
    answers: { 'prestart.safe_to_proceed': 'yes', 'works.replace_device': 'yes' },
  };
  const store = fixture(form);
  const before = JSON.stringify(store);
  assert.throws(() => completeFormSubmissionInStore(store, 'form', timestamp, () => 'unused'), /New Meter \/ Device Type/);
  assert.equal(JSON.stringify(store), before);
});

test('an unrecorded planned M2 meter is safely captured on its selected board then replaced atomically', () => {
  const form: FormSubmission = {
    ...wwForm('board'),
    form_type: 'comms-fault',
    answers: {
      'prestart.safe_to_proceed': 'yes',
      'existing.device_type': 'A3RM',
      'existing.device_id': 'OLD-PLANNED-100',
      'works.replace_device': 'yes',
      'works.new_device_type': 'A6M',
      'works.new_device_id': 'NEW-DEVICE-200',
      'works.new_sensor_rating': '120A',
    },
  };
  const store = fixture(form);
  const completed = completeFormSubmissionInStore(
    store,
    'form',
    '2026-08-02T03:00:00.000Z',
    () => 'replacement-location',
  );

  assert.equal(completed.meter_id, 'replacement-location');
  assert.equal(store.electricalAssets[0].meters.length, 1);
  assert.equal(store.electricalAssets[0].meters[0].device_id, 'NEW-DEVICE-200');
  assert.equal(store.electricalAssets[0].meters[0].device_type, 'A6M');
  assert.equal(store.electricalAssets[0].meters[0].lifecycle_state, 'ACTIVE');
  assert.equal(store.meterDevices[0].serialNumber, 'NEW-DEVICE-200');
  assert.equal(store.meterDevices[0].lifecycleState, 'ACTIVE');
  assert.equal(store.meterDevices[0].channels.length, 6);
  assert.deepEqual(
    store.meterDevices[0].channels.map((channel) => channel.sensorRating),
    Array(6).fill('120A'),
  );
  assert.equal(completed.answers['existing.device_id'], 'OLD-PLANNED-100');
});

test('unrecorded M2 completion refuses to duplicate a meter added while the form was open', () => {
  const form: FormSubmission = {
    ...wwForm('board'),
    form_type: 'comms-fault',
    answers: {
      'prestart.safe_to_proceed': 'yes',
      'existing.device_type': 'A3RM',
      'existing.device_id': 'OLD-PLANNED-100',
      'works.replace_device': 'yes',
      'works.new_device_type': 'A6M',
      'works.new_device_id': 'NEW-DEVICE-200',
      'works.new_sensor_rating': '120A',
    },
  };
  const store = fixture(form);
  store.meterDevices.push({
    id: 'now-recorded',
    installationId: 'installation',
    installedOnBoardId: 'board',
    deviceFamily: 'WATTWATCHERS',
    deviceModel: 'A3RM',
    serialNumber: 'OLD-PLANNED-100',
    displayName: { value: 'OLD-PLANNED-100', generatedValue: 'OLD-PLANNED-100', isOverridden: false, ruleVersion: 1 },
    channels: [],
  });
  assert.throws(
    () => completeFormSubmissionInStore(store, 'form', timestamp, () => 'must-not-allocate'),
    /now in the site data/,
  );
});

test('unrecorded M2 completion ignores non-active planned and historical meter rows', () => {
  for (const lifecycleState of ['PLANNED', 'INACTIVE'] as const) {
    const form: FormSubmission = {
      ...wwForm('board'),
      form_type: 'comms-fault',
      answers: {
        'prestart.safe_to_proceed': 'yes',
        'existing.device_type': 'A3RM',
        'existing.device_id': 'OLD-PLANNED-100',
        'works.replace_device': 'yes',
        'works.new_device_type': 'A6M',
        'works.new_device_id': `NEW-${lifecycleState}`,
        'works.new_sensor_rating': '120A',
      },
    };
    const store = fixture(form);
    store.meterDevices.push({
      id: `hidden-${lifecycleState}`,
      installationId: 'installation',
      installedOnBoardId: 'board',
      deviceFamily: 'WATTWATCHERS',
      deviceModel: 'A3RM',
      serialNumber: 'OLD-PLANNED-100',
      lifecycleState,
      displayName: { value: 'historical', generatedValue: 'historical', isOverridden: false, ruleVersion: 1 },
      channels: [],
    });

    const completed = completeFormSubmissionInStore(
      store,
      'form',
      timestamp,
      () => `replacement-${lifecycleState}`,
    );

    assert.equal(completed.meter_id, `replacement-${lifecycleState}`);
    assert.equal(store.meterDevices.find((meter) => meter.id === completed.meter_id)?.lifecycleState, 'ACTIVE');
  }
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
  assert.equal(store.meterDevices[0]!.displayName.ruleVersion, 4);
  assert.equal(store.meterDevices[0]!.displayName.provisional, true);
  assert.match(store.meterDevices[0]!.displayName.value, /-PLA-S-01-01-A3RM-METER$/);
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
    installationValidationIssues(store, 'installation')
      .filter((issue) => issue.code === 'CHANNEL_UNASSIGNED')
      .map((issue) => issue.entityId),
    ['meter-stable:1', 'meter-stable:2'],
  );
  assert.equal(installationReadiness(store, 'installation').issues.some((issue) => issue.code === 'CHANNEL_UNASSIGNED'), false);

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
