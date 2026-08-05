import assert from 'node:assert/strict';
import test from 'node:test';
import { searchAllDevices, searchEligibleMeters } from '../src/domain/meterSearch';
import type {
  DeviceSearchRecord,
} from '../src/domain/meterSearch';
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

const globalRecord = (index: number): DeviceSearchRecord => ({
  meter: {
    ...meter(index),
    id: `stable-device-${index}`,
    serialNumber: `SERIAL-${index}`,
    deviceNumber: `LEGACY-${index}`,
    displayName: {
      value: `Redgum Factory - Boiler Room - A6M ${index}`,
      generatedValue: `Redgum Factory - Boiler Room - A6M ${index}`,
      isOverridden: false,
      ruleVersion: 1,
    },
  },
  board: {
    id: `board-${index}`,
    audit_id: `installation-${index}`,
    zone_id: `zone-${index}`,
    asset_name: `Main Switchboard ${index}`,
    display_code: `Main Board ${index}`,
    asset_type: 'MSB',
    meter_present: true,
    meters: [],
    created_at: '2026-08-05T00:00:00.000Z',
    updated_at: '2026-08-05T00:00:00.000Z',
  },
  zone: {
    id: `zone-${index}`,
    audit_id: `installation-${index}`,
    zone_name: `Boiler Room ${index}`,
    zone_description: '',
    photos: [],
    created_at: '2026-08-05T00:00:00.000Z',
    updated_at: '2026-08-05T00:00:00.000Z',
  },
  installation: {
    id: `installation-${index}`,
    client_name: `Redgum Group ${index}`,
    site_name: `Redgum Factory ${index}`,
    site_address: `${index} Foundry Road`,
    inspector_name: 'Field User',
    audit_date: '2026-08-05',
    status: 'Draft',
    cloud_backup_enabled: false,
    created_at: '2026-08-05T00:00:00.000Z',
    updated_at: '2026-08-05T00:00:00.000Z',
  },
});

test('global device search finds local devices by every installer-facing identity and context', () => {
  const record = globalRecord(7);
  for (const query of [
    'stable-device-7',
    'SERIAL-7',
    'LEGACY-7',
    'Redgum Factory - Boiler Room - A6M 7',
    'Boiler Room 7',
    'Main Switchboard 7',
    'Redgum Factory 7',
    'A6M',
  ]) {
    assert.equal(searchAllDevices([record], query).visible[0]?.meter.id, 'stable-device-7', query);
  }
});

test('global device search is deterministic and bounded', () => {
  const records = [globalRecord(2), globalRecord(1), globalRecord(3)];
  const first = searchAllDevices(records, '', 2);
  const reversed = searchAllDevices([...records].reverse(), '', 2);
  assert.equal(first.total, 3);
  assert.equal(first.visible.length, 2);
  assert.deepEqual(
    first.visible.map((record) => record.meter.id),
    reversed.visible.map((record) => record.meter.id),
  );
});
