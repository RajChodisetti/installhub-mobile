import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeReplacementMeterNumbers,
  plannedReplacementMeterNumber,
  replacementMeterNumbersFromStored,
  replacementMeterSuggestions,
  storedReplacementMeterNumbers,
} from '../src/domain/replacementMeterPlanning';
import type { MeterDevice } from '../src/types';

test('M2 replacement planning supports multiple deduplicated meter numbers', () => {
  assert.deepEqual(
    normalizeReplacementMeterNumbers([' WW-100 ', 'ww-100', 'WW-200']),
    ['WW-100', 'WW-200'],
  );
  assert.equal(storedReplacementMeterNumbers(['WW-100', 'WW-200']), 'WW-100\nWW-200');
  assert.deepEqual(replacementMeterNumbersFromStored('WW-100\nWW-200'), ['WW-100', 'WW-200']);
  assert.equal(plannedReplacementMeterNumber('WW-100\nWW-200', ' ww-200 '), 'WW-200');
  assert.equal(plannedReplacementMeterNumber('WW-100\nWW-200', 'WW-300'), null);
  assert.equal(
    storedReplacementMeterNumbers(Array.from({ length: 51 }, () => 'WW-100')),
    'WW-100',
  );
  assert.throws(
    () => storedReplacementMeterNumbers(Array.from({ length: 51 }, (_, index) => `WW-${index}`)),
    /at most 50 unique meters/,
  );
  assert.throws(
    () => storedReplacementMeterNumbers(['X'.repeat(201)]),
    /at most 200 characters/,
  );
  assert.throws(
    () => storedReplacementMeterNumbers(Array.from({ length: 50 }, (_, index) => (
      `${String(index).padStart(3, '0')}${'X'.repeat(197)}`
    ))),
    /at most 10,000 characters in total/,
  );
});

test('known site meters provide serial-number replacement suggestions', () => {
  const active: MeterDevice = {
    id: 'meter-1',
    installationId: 'installation-1',
    installedOnBoardId: 'board-1',
    deviceFamily: 'WATTWATCHERS',
    deviceModel: 'A6M',
    deviceNumber: 'TAG-1',
    serialNumber: 'WW-100',
    displayName: {
      value: 'SITE-Z01-M001',
      generatedValue: 'SITE-Z01-M001',
      isOverridden: false,
      ruleVersion: 1,
    },
    channels: [],
  };
  assert.deepEqual(replacementMeterSuggestions([
    active,
    { ...active, id: 'meter-inactive', serialNumber: 'WW-OLD', lifecycleState: 'INACTIVE' },
    { ...active, id: 'meter-planned', serialNumber: 'WW-PLANNED', lifecycleState: 'PLANNED' },
    { ...active, id: 'meter-duplicate', serialNumber: ' ww-100 ' },
    { ...active, id: 'meter-blank', serialNumber: '   ' },
  ]), [{
    meterId: 'meter-1',
    meterNumber: 'WW-100',
    label: 'WW-100 · site tag TAG-1 · A6M',
  }]);
});
