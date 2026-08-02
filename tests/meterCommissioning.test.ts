import assert from 'node:assert/strict';
import test from 'node:test';
import {
  channelAfterPurposeChange,
  channelsAfterDeviceTypeChange,
} from '../src/domain/meterCommissioning';

test('switching a fixed meter to Other never defaults the custom definition to three', () => {
  const a3 = Array.from({ length: 3 }, (_, index) => ({ ordinal: index + 1 }));
  assert.deepEqual(channelsAfterDeviceTypeChange('A3RM', 'Other', a3), []);
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
