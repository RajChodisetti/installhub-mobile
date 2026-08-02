import assert from 'node:assert/strict';
import test from 'node:test';
import { searchEligibleMeters } from '../src/domain/meterSearch';
import type { MeterDevice } from '../src/types';

const meter = (index: number): MeterDevice => ({
  id: `meter-${String(index).padStart(4, '0')}`,
  installationId: 'installation',
  installedOnBoardId: 'board',
  deviceFamily: 'WATTWATCHERS',
  deviceModel: 'A6M',
  serialNumber: `serial-${index}`,
  displayName: {
    value: `SITE-A6M-${String(1000 - index).padStart(4, '0')}`,
    generatedValue: `SITE-A6M-${String(1000 - index).padStart(4, '0')}`,
    isOverridden: false,
    ruleVersion: 1,
  },
  channels: [],
});

test('eligible meter search deterministically caps a 1k-site result set', () => {
  const meters = Array.from({ length: 1000 }, (_, index) => meter(index));
  const first = searchEligibleMeters(meters, '', 100);
  const reordered = searchEligibleMeters([...meters].reverse(), '', 100);
  assert.equal(first.total, 1000);
  assert.equal(first.visible.length, 100);
  assert.deepEqual(first.visible.map((item) => item.id), reordered.visible.map((item) => item.id));
  assert.equal(searchEligibleMeters(meters, 'serial-777', 100).visible[0]?.id, 'meter-0777');
  const pinned = searchEligibleMeters(meters, '', 100, 'meter-0000');
  assert.equal(pinned.visible.length, 100);
  assert.equal(pinned.visible[0]?.id, 'meter-0000');
  assert.equal(pinned.selectedPinned, true);
});
