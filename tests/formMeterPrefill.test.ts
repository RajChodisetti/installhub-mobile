import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commsFaultIdentityAnswersForMeter,
  installationFormAnswersForMeter,
  isCanonicalBoardAnswerKey,
} from '../src/domain/formMeterPrefill';
import { meterDeviceFromLegacy } from '../src/domain/installationV2';
import { meterFromInstallationForm } from '../src/domain/meterCommissioning';
import type { ElectricalAsset, FormSubmission, MeterDevice } from '../src/types';

const timestamp = '2026-08-02T00:00:00.000Z';

const canonicalMeter: MeterDevice = {
  id: 'meter-1', installationId: 'installation-1', installedOnBoardId: 'board-1',
  deviceFamily: 'WATTWATCHERS', deviceModel: 'A6M', deviceNumber: 'D-42',
  serialNumber: 'SERIAL-42',
  displayName: {
    value: 'A6M Auditor', generatedValue: 'A6M Auditor', isOverridden: false,
    ruleVersion: 1,
  },
  channels: [
    { id: 'meter-1:1', ordinal: 1, purpose: 'MAIN_SUPPLY', sensorRating: '120A', description: 'Incoming mains' },
    { id: 'meter-1:2', ordinal: 2, purpose: 'SUB_CIRCUIT', loadTypeCode: 'HVAC', sensorRating: '120A', description: 'Chiller' },
    { id: 'meter-1:3', ordinal: 3, purpose: 'SPARE' },
    { id: 'meter-1:4', ordinal: 4, purpose: 'SUB_CIRCUIT', loadTypeCode: 'OTHER', customLoadTypeName: 'Refrigeration', sensorRating: '200A', description: 'Cold room' },
    { id: 'meter-1:5', ordinal: 5, purpose: 'SUB_CIRCUIT', loadTypeCode: 'EV_CHARGER', sensorRating: '60A', description: 'Fleet charger' },
    { id: 'meter-1:6', ordinal: 6, purpose: 'SUB_CIRCUIT', loadTypeCode: 'POWER_OUTLET', sensorRating: '60A', description: 'Workshop outlets' },
  ],
};

test('Comms Fault prefill keeps a distinct device number separate from the serial', () => {
  assert.deepEqual(commsFaultIdentityAnswersForMeter(canonicalMeter), {
    'existing.device_id': 'SERIAL-42',
    'existing.device_number': 'D-42',
    'existing.device_type': 'A6M',
  });
  assert.equal(
    commsFaultIdentityAnswersForMeter({
      ...canonicalMeter,
      deviceNumber: undefined,
    })['existing.device_number'],
    'SERIAL-42',
  );
});

test('known-board report answers stay stored but are not separate editable WW questions', () => {
  for (const key of [
    'auditor.switchboard_name',
    'auditor.switchboard_location',
    'auditor.switchboard_type',
    'auditor.site_nmi',
  ]) {
    assert.equal(isCanonicalBoardAnswerKey('ww-installation', key), true);
  }
  assert.equal(isCanonicalBoardAnswerKey('ww-installation', 'device.id'), false);
  assert.equal(isCanonicalBoardAnswerKey('comms-fault', 'auditor.switchboard_name'), false);
});

test('existing canonical meter context prefills WW identity, purpose, load, rating, and description', () => {
  const answers = installationFormAnswersForMeter(canonicalMeter);
  assert.equal(answers['device.type'], 'A6M');
  assert.equal(answers['device.id'], 'SERIAL-42');
  assert.equal(answers['device.number'], 'D-42');
  assert.equal(answers['device.name'], 'A6M Meter');
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((ordinal) => answers[`channel.${ordinal}.purpose`]),
    [
      'Main board supply', 'Sub-circuit / asset', 'Spare / unused',
      'Sub-circuit / asset', 'Sub-circuit / asset', 'Sub-circuit / asset',
    ],
  );
  assert.equal(answers['channel.1.load'], 'Mains Supply');
  assert.equal(answers['channel.1.rating'], '120A');
  assert.equal(answers['channel.1.description'], 'Incoming mains');
  assert.equal(answers['channel.2.load'], 'HVAC');
  assert.equal(answers['channel.3.load'], undefined);
  assert.equal(answers['channel.4.load'], 'Other');
  assert.equal(answers['channel.4.custom_load_type'], 'Refrigeration');
  assert.equal(answers['channel.5.load'], 'Other');
  assert.equal(answers['channel.5.custom_load_type'], 'EV Charger');
  assert.equal(answers['channel.6.load'], 'General Power');
});

test('completing an unchanged prefilled draft preserves canonical purpose and unsupported load identity', () => {
  const answers = installationFormAnswersForMeter(canonicalMeter);
  const board: ElectricalAsset = {
    id: 'board-1', audit_id: 'installation-1', zone_id: 'zone-1',
    asset_name: 'Main board', display_code: 'SITE-MSB-001', asset_type: 'MSB',
    meter_present: true,
    meters: [{
      id: 'meter-1', device_name: 'A6M Auditor', device_type: 'A6M',
      device_id: 'SERIAL-42', device_number: 'D-42',
      ww_channels: canonicalMeter.channels.map((channel) => ({
        id: channel.id, ordinal: channel.ordinal, purpose: channel.purpose,
      })),
    }],
    created_at: timestamp, updated_at: timestamp,
  };
  const form: FormSubmission = {
    id: 'form-1', form_type: 'ww-installation', schema_version: 2,
    status: 'Draft', installation_id: 'installation-1', board_id: board.id,
    meter_id: canonicalMeter.id, answers, attachments: [],
    created_at: timestamp, updated_at: timestamp,
  };

  const completed = meterFromInstallationForm(form, board, canonicalMeter.id);
  assert.deepEqual(completed.ww_channels?.map((channel) => channel.purpose), [
    'MAIN_SUPPLY', 'SUB_CIRCUIT', 'SPARE',
    'SUB_CIRCUIT', 'SUB_CIRCUIT', 'SUB_CIRCUIT',
  ]);
  assert.deepEqual(completed.ww_channels?.map((channel) => channel.load_type), [
    'Mains Supply', 'HVAC', undefined, 'Refrigeration', 'EV Charger', 'General Power',
  ]);
  assert.deepEqual(completed.ww_channels?.map((channel) => channel.id), [
    'meter-1:1', 'meter-1:2', 'meter-1:3',
    'meter-1:4', 'meter-1:5', 'meter-1:6',
  ]);
  const projected = meterDeviceFromLegacy('installation-1', board, completed);
  assert.deepEqual(
    projected.channels.map((channel) => ({
      code: channel.loadTypeCode ?? null,
      custom: channel.customLoadTypeName ?? null,
    })),
    [
      { code: null, custom: null },
      { code: 'HVAC', custom: null },
      { code: null, custom: null },
      { code: 'OTHER', custom: 'Refrigeration' },
      { code: 'EV_CHARGER', custom: null },
      { code: 'POWER_OUTLET', custom: null },
    ],
  );
});

test('generic Other custom load remains explicit through prefill and canonical round trip', () => {
  const meter: MeterDevice = {
    ...canonicalMeter,
    deviceModel: 'A3RM',
    channels: [
      canonicalMeter.channels[0]!,
      {
        ...canonicalMeter.channels[3]!,
        ordinal: 2,
        id: 'meter-1:2',
        customLoadTypeName: 'Other',
      },
      { id: 'meter-1:3', ordinal: 3, purpose: 'SPARE' },
    ],
  };
  const answers = installationFormAnswersForMeter(meter);
  assert.equal(answers['channel.2.load'], 'Other');
  assert.equal(answers['channel.2.custom_load_type'], 'Other');

  const board: ElectricalAsset = {
    id: 'board-1', audit_id: 'installation-1', zone_id: 'zone-1',
    asset_name: 'Main board', display_code: 'SITE-MSB-001', asset_type: 'MSB',
    meter_present: true,
    meters: [{
      id: meter.id, device_name: 'A3RM Auditor', device_type: 'A3RM',
      device_id: meter.serialNumber, device_number: meter.deviceNumber,
      ww_channels: meter.channels.map((channel) => ({
        id: channel.id, ordinal: channel.ordinal, purpose: channel.purpose,
      })),
    }],
    created_at: timestamp, updated_at: timestamp,
  };
  const form: FormSubmission = {
    id: 'form-generic-other', form_type: 'ww-installation', schema_version: 2,
    status: 'Draft', installation_id: 'installation-1', board_id: board.id,
    meter_id: meter.id, answers, attachments: [],
    created_at: timestamp, updated_at: timestamp,
  };
  const legacy = meterFromInstallationForm(form, board, meter.id);
  const projected = meterDeviceFromLegacy('installation-1', board, legacy);
  assert.equal(projected.channels[1]?.loadTypeCode, 'OTHER');
  assert.equal(projected.channels[1]?.customLoadTypeName, 'Other');
});
