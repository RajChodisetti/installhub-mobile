import assert from 'node:assert/strict';
import test from 'node:test';
import {
  answersWithCanonicalBoardContext,
  channelAfterPurposeChange,
  channelsAfterDeviceTypeChange,
  deviceLabelPrefix,
  energyFlowLabel,
  humanDeviceLabel,
  measuredItemTypeLabel,
  meterFromInstallationForm,
  meterChannelPurposeLabel,
  phaseGroupingLabel,
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

test('switching a fixed meter to Other never defaults the custom definition to three', () => {
  const a3 = Array.from({ length: 3 }, (_, index) => ({ ordinal: index + 1 }));
  assert.deepEqual(channelsAfterDeviceTypeChange('A3RM', 'Other', a3), []);
});

test('direct Other meter capture excludes Wattwatchers-only commissioning sections', () => {
  assert.equal(showsWattwatchersCommissioningSections('Other'), false);
  assert.equal(showsWattwatchersCommissioningSections('A3RM'), true);
  assert.equal(showsWattwatchersCommissioningSections('A6M'), true);
});

test('channel measurement choices use plain field-facing labels without changing canonical values', () => {
  assert.equal(meterChannelPurposeLabel('MAIN_SUPPLY'), 'Main supply');
  assert.equal(meterChannelPurposeLabel('SUB_CIRCUIT'), 'Sub-circuit or site asset');
  assert.equal(meterChannelPurposeLabel('SPARE'), 'Spare / unused');
  assert.equal(phaseGroupingLabel('THREE_PHASE'), 'Three phase · 3 channels');
  assert.equal(energyFlowLabel('BIDIRECTIONAL'), 'Can consume or generate');
  assert.equal(measuredItemTypeLabel('GRID_BOUNDARY'), 'Incoming grid connection');
  assert.equal(measuredItemTypeLabel('TBC'), 'To be confirmed');
});

test('custom channel definitions persist while fixed models keep exact positive ordinals', () => {
  const custom = [{ id: 'custom-7', ordinal: 7, capabilities: { pulse: true } }];
  assert.equal(channelsAfterDeviceTypeChange('Other', 'Other', custom), custom);
  assert.deepEqual(
    channelsAfterDeviceTypeChange('Other', 'A3RM', custom).map((channel) => channel.ordinal),
    [1, 2, 3],
  );
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
      phase_label: 'L1',
      load_type: undefined,
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
  assert.equal(answers['auditor.switchboard_type'], 'MSB');
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
