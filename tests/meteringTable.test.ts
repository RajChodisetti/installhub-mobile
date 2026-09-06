import assert from 'node:assert/strict';
import test from 'node:test';
import type { AllAssetMeteringRow } from '../src/domain/installationV2';
import type { ElectricalAsset, GridSupply, MeasurementAssignment, MeterDevice, ReadinessIssue, SiteAsset } from '../src/types';
import { meterRegistryIssues, meterRegistryMatches, meteringCoverageMatches, meteringTargetDetail } from '../src/domain/meteringTable';

const meter = { id: 'meter-a', installationId: 'i', installedOnBoardId: 'b', deviceFamily: 'OTHER', displayName: { value: 'Plant device', generatedValue: 'Meter 1', isOverridden: true, ruleVersion: 2 }, deviceModel: 'OTHER',
  serialNumber: 'ABC-123', deviceNumber: 'Tag42', customManufacturerName: 'Vendor', customModelName: 'Model-X',
  channels: [{ id: 'ch-a', ordinal: 1, purpose: 'SUB_CIRCUIT' }] } as MeterDevice;

test('registry search matches device identities, serial, tag and custom model independently of asset coverage', () => {
  for (const query of ['', '  plant ', 'abc-123', 'tag42', 'model-x', 'vendor', 'METER-A']) assert.equal(meterRegistryMatches(meter, query), true, query);
  assert.equal(meterRegistryMatches(meter, 'missing asset'), false);
});

test('confirmed-unmetered coverage includes virtual residual without including mapping issues or TBC', () => {
  for (const state of ['DIRECT', 'VIRTUAL', 'UNMETERED', 'TBC', 'MAPPING_ISSUE'] as const) {
    const row = { state } as AllAssetMeteringRow;
    assert.equal(meteringCoverageMatches(row, 'CONFIRMED_UNMETERED'), state === 'VIRTUAL' || state === 'UNMETERED');
    assert.equal(meteringCoverageMatches(row, 'ALL'), true);
    assert.equal(meteringCoverageMatches(row, state), true);
  }
});

test('meter diagnostics attach only to exact meter, channel and assignment IDs', () => {
  const assignments = [{ id: 'assignment-a', meterId: meter.id }] as MeasurementAssignment[];
  const issues = [
    { entityType: 'meter', entityId: meter.id }, { entityType: 'channel', entityId: 'ch-a' },
    { entityType: 'measurement_assignment', entityId: 'assignment-a' }, { entityType: 'channel', entityId: 'foreign' },
  ] as ReadinessIssue[];
  assert.deepEqual(meterRegistryIssues(meter, assignments, issues), issues.slice(0, 3));
  assert.deepEqual(meterRegistryIssues(meter, assignments, []), []);
});

test('exact target links preserve their own zone, grid and missing identities', () => {
  const boards = [{ id: 'b', audit_id: 'i', zone_id: 'zb', display_code: 'DB1', asset_name: 'Board' }] as ElectricalAsset[];
  const assets = [{ id: 'a', audit_id: 'i', zone_id: 'za', display_code: 'AC1', asset_name: 'Asset' }] as SiteAsset[];
  const grids = [{ id: 'g', installationId: 'i', name: 'Incoming' }] as GridSupply[];
  assert.deepEqual(meteringTargetDetail({ kind: 'BOARD', boardId: 'b' }, 'i', boards, assets, grids).destination, { kind: 'BOARD', id: 'b', zoneId: 'zb' });
  assert.deepEqual(meteringTargetDetail({ kind: 'SITE_ASSET', siteAssetId: 'a' }, 'i', boards, assets, grids).destination, { kind: 'SITE_ASSET', id: 'a', zoneId: 'za' });
  assert.equal(meteringTargetDetail({ kind: 'GRID_BOUNDARY', gridSupplyId: 'g' }, 'i', boards, assets, grids).destination?.kind, 'GRID_BOUNDARY');
  for (const target of [{ kind: 'BOARD', boardId: 'b' }, { kind: 'SITE_ASSET', siteAssetId: 'a' }, { kind: 'GRID_BOUNDARY', gridSupplyId: 'g' }] as const) {
    const result = meteringTargetDetail(target, 'foreign', boards, assets, grids);
    assert.equal(result.destination, undefined);
    assert.ok(result.id);
    assert.match(result.label, /Missing/);
  }
  assert.match(meteringTargetDetail({ kind: 'TBC' }, 'i', boards, assets, grids).label, /blocks completion/);
});
