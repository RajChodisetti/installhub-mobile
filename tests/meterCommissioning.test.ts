import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addCustomMeterChannel,
  answersWithCanonicalBoardContext,
  canonicalWwSwitchboardTypeAnswer,
  channelAfterPurposeChange,
  channelAfterSensorRatingChange,
  channelWithModelValidSensor,
  channelsAfterDeviceTypeChange,
  deviceLabelPrefix,
  energyFlowLabel,
  humanDeviceLabel,
  measuredItemTypeLabel,
  meterFromInstallationForm,
  meterChannelPurposeLabel,
  meterChannelsNeedLayoutRepair,
  normalizedMeterEditorChannels,
  phaseGroupingLabel,
  removeCustomMeterChannel,
  showsWattwatchersCommissioningSections,
  siteAssetTargetIdsOwnedByOtherMeters,
} from '../src/domain/meterCommissioning';
import type { ElectricalAsset, FormSubmission } from '../src/types';

test('new device names are suggested from site, zone, and type within the API limit', () => {
  const prefix = deviceLabelPrefix('Redgum Factory', 'Boiler Room');
  assert.equal(prefix, 'Redgum Factory - Boiler Room');
  assert.equal(
    humanDeviceLabel(prefix, 'A6M', 'WW-260805-01'),
    'Redgum Factory - Boiler Room - A6M - WW-260805-01',
  );
  const long = humanDeviceLabel(
    'A very long customer site and exceptionally descriptive plant zone name',
    'A3RM',
    'SERIAL-260805-1234567890',
  );
  assert.equal(long.length <= 64, true);
  assert.equal(long.endsWith(' - A3RM - AL-260805-1234567890'), true);
});

test('switching a fixed meter to Other preserves the portal channel suggestions', () => {
  const a3 = Array.from({ length: 3 }, (_, index) => ({ ordinal: index + 1 }));
  assert.deepEqual(channelsAfterDeviceTypeChange('A3RM', 'Other', a3), [
    { ordinal: 1, purpose: 'SPARE' },
    { ordinal: 2, purpose: 'SPARE' },
    { ordinal: 3, purpose: 'SPARE' },
  ]);
});

test('device-model and sensor changes discard incompatible hidden sensor metadata', () => {
  const stale = {
    id: 'channel-1',
    ordinal: 1,
    purpose: 'SUB_CIRCUIT' as const,
    rogowski_size: '3000A – 9cm',
    ct_ratio: '120A',
  };

  assert.deepEqual(
    channelsAfterDeviceTypeChange('A6M', 'A3RM', [stale])[0],
    { id: 'channel-1', ordinal: 1, purpose: 'SUB_CIRCUIT' },
  );
  assert.deepEqual(
    channelWithModelValidSensor('A6M', stale),
    { id: 'channel-1', ordinal: 1, purpose: 'SUB_CIRCUIT', ct_ratio: '120A' },
  );
  assert.deepEqual(
    channelWithModelValidSensor('A3RM', stale),
    { id: 'channel-1', ordinal: 1, purpose: 'SUB_CIRCUIT', rogowski_size: '3000A – 9cm' },
  );
  assert.deepEqual(
    channelAfterSensorRatingChange('A6M', stale, '400A'),
    { id: 'channel-1', ordinal: 1, purpose: 'SUB_CIRCUIT', ct_ratio: '400A' },
  );
  assert.deepEqual(
    channelAfterSensorRatingChange('A3RM', stale, '3000A – 20cm'),
    { id: 'channel-1', ordinal: 1, purpose: 'SUB_CIRCUIT', rogowski_size: '3000A – 20cm' },
  );
  assert.deepEqual(
    channelAfterSensorRatingChange('A6M', stale, ''),
    { id: 'channel-1', ordinal: 1, purpose: 'SUB_CIRCUIT', ct_ratio: '' },
  );
});

test('direct Other meter capture excludes Wattwatchers-only commissioning sections', () => {
  assert.equal(showsWattwatchersCommissioningSections('Other'), false);
  assert.equal(showsWattwatchersCommissioningSections('A3RM'), true);
  assert.equal(showsWattwatchersCommissioningSections('A6M'), true);
});

test('channel measurement choices use plain field-facing labels without changing canonical values', () => {
  assert.equal(meterChannelPurposeLabel('MAIN_SUPPLY'), 'Main board supply');
  assert.equal(meterChannelPurposeLabel('SUB_CIRCUIT'), 'Sub-circuit / asset');
  assert.equal(meterChannelPurposeLabel('SPARE'), 'Spare / unused');
  assert.equal(phaseGroupingLabel('THREE_PHASE'), 'Three phase — select 3 channels');
  assert.equal(energyFlowLabel('BIDIRECTIONAL'), 'Bidirectional');
  assert.equal(measuredItemTypeLabel('GRID_BOUNDARY'), 'Incoming grid connection');
  assert.equal(measuredItemTypeLabel('SITE_ASSET'), 'Site asset');
  assert.equal(measuredItemTypeLabel('TBC'), 'To be confirmed');
});

test('custom channel definitions persist while fixed models keep exact positive ordinals', () => {
  const custom = [{ id: 'custom-7', ordinal: 7, capabilities: { pulse: true } }];
  assert.deepEqual(channelsAfterDeviceTypeChange('Other', 'Other', custom), [
    { id: 'custom-7', ordinal: 1, purpose: 'SPARE', capabilities: { pulse: true } },
  ]);
  assert.deepEqual(channelsAfterDeviceTypeChange('Other', 'Other', []), [
    { ordinal: 1, purpose: 'SPARE' },
  ]);
  assert.deepEqual(
    channelsAfterDeviceTypeChange('Other', 'A3RM', custom).map((channel) => channel.ordinal),
    [1, 2, 3],
  );
});

test('channel editor repair, add, and remove behavior matches portal channel identity rules', () => {
  assert.equal(meterChannelsNeedLayoutRepair('A3RM', [
    { ordinal: 1 }, { ordinal: 2 }, { ordinal: 3 },
  ]), false);
  assert.equal(meterChannelsNeedLayoutRepair('A3RM', [{ ordinal: 1 }]), true);
  assert.equal(meterChannelsNeedLayoutRepair('Other', [{ ordinal: 4 }]), true);

  const normalized = normalizedMeterEditorChannels('meter-1', [
    { ordinal: 4, purpose: 'SUB_CIRCUIT' },
    { id: 'meter-1:1', ordinal: 9 },
  ]);
  assert.deepEqual(normalized, [
    { id: 'meter-1:1', ordinal: 1, purpose: 'SUB_CIRCUIT' },
    { id: 'meter-1:2', ordinal: 2, purpose: 'SPARE' },
  ]);

  const added = addCustomMeterChannel('meter-1', normalized);
  assert.deepEqual(added.at(-1), { id: 'meter-1:3', ordinal: 3, purpose: 'SPARE' });
  const removed = removeCustomMeterChannel('meter-1', added, 1);
  assert.equal(removed.removedChannelId, 'meter-1:2');
  assert.deepEqual(removed.channels.map(({ id, ordinal }) => ({ id, ordinal })), [
    { id: 'meter-1:1', ordinal: 1 },
    { id: 'meter-1:3', ordinal: 2 },
  ]);
  assert.deepEqual(addCustomMeterChannel('meter-1', removed.channels).at(-1), {
    id: 'meter-1:2', ordinal: 3, purpose: 'SPARE',
  });
});

test('choosing SPARE clears incompatible load and sensor details', () => {
  assert.deepEqual(
    channelAfterPurposeChange({
      id: 'channel-1',
      ordinal: 1,
      purpose: 'SUB_CIRCUIT',
      capabilities: { current: true },
      phase_label: 'L1',
      load_type: 'HVAC',
      rogowski_size: '3000A - 9cm',
      ct_ratio: '120A',
      description: 'Chiller',
    }, 'SPARE'),
    {
      id: 'channel-1',
      ordinal: 1,
      purpose: 'SPARE',
      capabilities: { current: true },
      phase_label: undefined,
      load_type: undefined,
      custom_load_type_name: undefined,
      rogowski_size: undefined,
      ct_ratio: undefined,
      description: undefined,
    },
  );
});

test('site asset target candidates exclude other meter owners but retain this meter owner', () => {
  const unavailable = siteAssetTargetIdsOwnedByOtherMeters([
    { meterId: 'meter-current', target: { kind: 'SITE_ASSET', siteAssetId: 'asset-current' } },
    { meterId: 'meter-other', target: { kind: 'SITE_ASSET', siteAssetId: 'asset-other' } },
    { meterId: 'meter-other', target: { kind: 'BOARD', boardId: 'board-1' } },
  ], 'meter-current');

  assert.equal(unavailable.has('asset-current'), false);
  assert.equal(unavailable.has('asset-other'), true);
  assert.equal(unavailable.size, 1);
});

test('WW completion projects read-only canonical board context and one stable meter', () => {
  const timestamp = '2026-08-02T00:00:00.000Z';
  const board: ElectricalAsset = {
    id: 'board-1', audit_id: 'installation-1', zone_id: 'zone-1',
    asset_name: 'Canonical Main Board', display_code: 'SITE-MSB-001', asset_type: 'MSB',
    location_description: 'Plant room', site_nmi: 'NMI-1', meter_present: false,
    meters: [], created_at: timestamp, updated_at: timestamp,
  };
  const form: FormSubmission = {
    id: 'form-1', form_type: 'ww-installation', schema_version: 2, status: 'Draft',
    installation_id: 'installation-1', board_id: board.id,
    answers: {
      'auditor.switchboard_name': 'Stale editable copy',
      'device.type': 'A3RM', 'device.id': 'SERIAL-1', 'device.number': 'D-1',
      'device.name': 'Boiler Meter',
      'channel.1.load': 'Mains Supply', 'channel.1.rating': '3000A - 9cm',
      'channel.2.load': 'HVAC', 'channel.2.rating': '3000A - 9cm',
      'channel.3.load': 'Not Used', 'channel.3.rating': '',
    },
    attachments: [], created_at: timestamp, updated_at: timestamp,
  };
  const answers = answersWithCanonicalBoardContext(form.answers, board);
  assert.equal(answers['auditor.switchboard_name'], 'Canonical Main Board');
  assert.equal(answers['auditor.switchboard_location'], 'Plant room');
  assert.equal(answers['auditor.switchboard_type'], 'Main switchboard');
  assert.equal(answers['auditor.site_nmi'], 'NMI-1');

  const first = meterFromInstallationForm({ ...form, answers }, board, 'stable-meter');
  assert.equal(first.custom_name, 'Boiler Meter');
  assert.equal(first.device_number, 'D-1');
  board.meters = [first];
  const amended = meterFromInstallationForm({
    ...form,
    meter_id: first.id,
    answers: { ...answers, 'device.id': 'D-2', 'device.number': 'D-2' },
  }, board, first.id);
  assert.equal(amended.id, 'stable-meter');
  assert.equal(amended.device_number, 'D-2');
  assert.deepEqual(amended.ww_channels?.map((channel) => channel.purpose), [
    'MAIN_SUPPLY', 'SUB_CIRCUIT', 'SPARE',
  ]);
  assert.deepEqual(amended.ww_channels?.map((channel) => channel.id), [
    'stable-meter:1', 'stable-meter:2', 'stable-meter:3',
  ]);
});

test('WW canonical switchboard answer matches portal human labels', () => {
  assert.equal(canonicalWwSwitchboardTypeAnswer({
    asset_type: 'MSB', type_code: 'MSB', custom_type_name: undefined,
  }), 'Main switchboard');
  assert.equal(canonicalWwSwitchboardTypeAnswer({
    asset_type: 'Other', type_code: 'OTHER', custom_type_name: 'Generator board',
  }), 'Generator board');
});

test('WW completion never copies non-yes/no pre-start strings into the meter', () => {
  const timestamp = '2026-08-02T00:00:00.000Z';
  const board: ElectricalAsset = {
    id: 'board-1', audit_id: 'installation-1', zone_id: 'zone-1',
    asset_name: 'Main Board', display_code: 'SITE-MSB-001', asset_type: 'MSB',
    meter_present: false, meters: [], created_at: timestamp, updated_at: timestamp,
  };
  const form: FormSubmission = {
    id: 'form-1', form_type: 'ww-installation', schema_version: 2, status: 'Draft',
    installation_id: 'installation-1', board_id: board.id,
    answers: {
      'device.type': 'A3RM', 'device.id': 'SERIAL-1',
      'prestart.site_induction': 'yes',
      'prestart.additional_hazards': 'false',
      'prestart.safe_to_proceed': 'no',
    },
    attachments: [], created_at: timestamp, updated_at: timestamp,
  };

  const meter = meterFromInstallationForm(form, board, 'meter-1');

  assert.deepEqual(meter.ww_prestart, {
    site_induction: true,
    safe_to_proceed: false,
  });
  assert.equal(JSON.stringify(meter).includes('"additional_hazards":"false"'), false);
});
