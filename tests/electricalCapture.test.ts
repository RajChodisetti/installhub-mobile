import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSiteAssetMappingBaseline, electricalSourceFromSelection, siteAssetMeteringForSave } from '../src/domain/electricalCapture';
import { structurallySavableMeterAssignments } from '../src/domain/meterCommissioning';
import { assignmentApprovalSignature } from '../src/domain/meterAssignmentTakeover';
import type { ElectricalAsset, GridSupply, MeasurementAssignment, MeterDevice } from '../src/types';

const board = { id: 'board' } as ElectricalAsset;
const grid = { id: 'grid' } as GridSupply;
const meter = { id: 'meter', channels: [
  { id: 'c1', ordinal: 1, purpose: 'SUB_CIRCUIT' },
  { id: 'c2', ordinal: 2, purpose: 'SUB_CIRCUIT' },
  { id: 'c3', ordinal: 3, purpose: 'MAIN_SUPPLY' },
  { id: 'spare', ordinal: 4, purpose: 'SPARE' },
] } as MeterDevice;
const assignment: MeasurementAssignment = {
  id: 'assignment', installationId: 'installation', meterId: 'meter', channelIds: ['c1'],
  phaseMode: 'SINGLE_PHASE', target: { kind: 'SITE_ASSET', siteAssetId: 'asset' },
  direction: 'CONSUMPTION', status: 'CONFIRMED',
};

test('optional incomplete electrical choices save TBC and confirmed IDs are preserved', () => {
  for (const key of ['TBC', 'BOARD:', 'GRID:', 'BOARD:missing', 'GRID:missing']) {
    assert.deepEqual(electricalSourceFromSelection(key, [board], [grid]), { kind: 'TBC' });
  }
  assert.deepEqual(electricalSourceFromSelection('BOARD:board', [board], [grid]), { kind: 'BOARD', boardId: 'board' });
  assert.deepEqual(electricalSourceFromSelection('GRID:grid', [board], [grid]), { kind: 'GRID', gridSupplyId: 'grid' });
});

test('site asset TBC and partial metering can save; exact metering keeps API values', () => {
  const input = { kind: 'METERED' as const, source: { kind: 'BOARD' as const, boardId: 'board' },
    selectedMeter: meter, eligibleMeterIds: ['meter'], channelIds: ['c1'],
    phaseMode: 'SINGLE_PHASE' as const, direction: '' as const, assignments: [] };
  assert.deepEqual(siteAssetMeteringForSave(input), { kind: 'METERED', meterId: 'meter',
    channelIds: ['c1'], phaseMode: 'SINGLE_PHASE', direction: 'CONSUMPTION' });
  for (const patch of [
    { channelIds: [] }, { channelIds: ['c1', 'c1'] }, { channelIds: ['c3'] },
    { channelIds: ['spare'] }, { channelIds: ['missing'] }, { eligibleMeterIds: [] },
    { eligibleChannelIds: ['c2'] },
    { assignments: [assignment] }, { source: { kind: 'TBC' as const } },
  ]) assert.deepEqual(siteAssetMeteringForSave({ ...input, ...patch }), { kind: 'TBC' });
  assert.deepEqual(siteAssetMeteringForSave({ ...input, kind: 'UNMETERED' }), { kind: 'UNMETERED' });
  assert.deepEqual(siteAssetMeteringForSave({ ...input, kind: 'TBC' }), { kind: 'TBC' });
  assert.equal(siteAssetMeteringForSave({ ...input, assignments: [assignment], previousAssignmentId: assignment.id }).kind, 'METERED');
  assert.equal(siteAssetMeteringForSave({
    ...input,
    assignments: [{ ...assignment, meterId: 'another-meter' }],
  }).kind, 'METERED', 'same channel ID on another meter does not create false occupancy');
});

test('all of the edited asset own assignments remain eligible without takeover approval', () => {
  const secondOwn = {
    ...assignment,
    id: 'assignment-two',
    channelIds: ['c2'],
  };
  const result = siteAssetMeteringForSave({
    kind: 'METERED', source: { kind: 'BOARD', boardId: 'board' },
    selectedMeter: meter, eligibleMeterIds: ['meter'], eligibleChannelIds: ['c1', 'c2'],
    channelIds: ['c1', 'c2'], phaseMode: 'OTHER', direction: 'CONSUMPTION',
    assignments: [assignment, secondOwn], assetId: 'asset',
  });
  assert.equal(result.kind, 'METERED');
});

test('partial meter groups match portal structural normalization without channel duplication', () => {
  const result = structurallySavableMeterAssignments([
    { ...assignment, id: 'empty', channelIds: [] },
    { ...assignment, channelIds: ['c1', 'c1', 'c3', 'spare', 'missing'], phaseMode: 'THREE_PHASE' },
    { ...assignment, id: 'second', channelIds: ['c1', 'c2'] },
    { ...assignment, id: 'spare-only', channelIds: ['spare'] },
  ], meter.channels);
  assert.deepEqual(result.map((row) => row.channelIds), [['c1'], ['c2']]);
  assert.ok(result.every((row) => row.target.kind === 'TBC' && row.status === 'TBC' && row.phaseMode === 'SINGLE_PHASE'));
  assert.deepEqual(structurallySavableMeterAssignments([assignment], meter.channels), [assignment]);
});

test('unchanged unavailable historical mappings survive optional asset edits, but deliberate mapping edits do not', () => {
  const source = { kind: 'BOARD' as const, boardId: 'child-board' };
  const input = { kind: 'METERED' as const, source, previousSource: source,
    selectedMeter: meter, selectedMeterId: meter.id, eligibleMeterIds: [], channelIds: ['c1'],
    phaseMode: assignment.phaseMode, direction: assignment.direction, assignments: [assignment],
    previousAssignmentId: assignment.id, previousAssignment: assignment };
  const retained = siteAssetMeteringForSave(input);
  assert.equal(retained.kind, 'METERED');
  if (retained.kind === 'METERED') assert.deepEqual(retained.preserveMapping, { assignment, source });
  assert.equal(siteAssetMeteringForSave({ ...input, selectedMeter: undefined }).kind, 'METERED');
  for (const patch of [
    { source: { kind: 'BOARD' as const, boardId: 'changed' } }, { channelIds: ['c2'] },
    { direction: 'GENERATION' as const }, { selectedMeterId: 'another-unavailable' }, { kind: 'TBC' as const },
  ]) assert.equal(siteAssetMeteringForSave({ ...input, ...patch }).kind, 'TBC');
});

test('save preserves an unchanged incompatible channel on an otherwise eligible device until deliberate remapping', () => {
  const source = { kind: 'BOARD' as const, boardId: 'board' };
  const input = {
    kind: 'METERED' as const,
    source,
    previousSource: source,
    selectedMeter: meter,
    selectedMeterId: meter.id,
    eligibleMeterIds: [meter.id],
    eligibleChannelIds: ['c2'],
    channelIds: assignment.channelIds,
    phaseMode: assignment.phaseMode,
    direction: assignment.direction,
    assignments: [assignment],
    previousAssignmentId: assignment.id,
    previousAssignment: assignment,
  };
  const preserved = siteAssetMeteringForSave(input);
  assert.equal(preserved.kind, 'METERED');
  if (preserved.kind === 'METERED') assert.deepEqual(preserved.preserveMapping, { assignment, source });

  assert.deepEqual(siteAssetMeteringForSave({ ...input, channelIds: ['c2'] }), {
    kind: 'METERED', meterId: meter.id, channelIds: ['c2'],
    phaseMode: 'SINGLE_PHASE', direction: 'CONSUMPTION',
  });
});

test('site capture only accepts exact current approved conflicts and retains the approval for atomic save', () => {
  const input = { kind: 'METERED' as const, source: { kind: 'BOARD' as const, boardId: 'board' },
    selectedMeter: meter, eligibleMeterIds: ['meter'], channelIds: ['c1'],
    phaseMode: assignment.phaseMode, direction: assignment.direction, assignments: [assignment] };
  const approvals = { [assignment.id]: assignmentApprovalSignature(assignment) };
  const allowed = siteAssetMeteringForSave({ ...input, takeoverApprovals: approvals });
  assert.equal(allowed.kind, 'METERED');
  if (allowed.kind === 'METERED') assert.deepEqual(allowed.takeoverApprovals, approvals);
  assert.equal(siteAssetMeteringForSave({ ...input, takeoverApprovals: { [assignment.id]: 'stale' } }).kind, 'TBC');
  assert.equal(siteAssetMeteringForSave({ ...input, assignments: [{ ...assignment, target: { kind: 'BOARD', boardId: 'board' } }], takeoverApprovals: approvals }).kind, 'TBC');
});

test('asset editor baseline rejects changed, removed or newly created owned mappings for every save state', () => {
  const before = JSON.stringify(assignment);
  assert.doesNotThrow(() => assertSiteAssetMappingBaseline('asset', [assignment], [structuredClone(assignment)]));
  assert.throws(() => assertSiteAssetMappingBaseline('asset', [{ ...assignment, direction: 'GENERATION' }], [assignment]));
  assert.throws(() => assertSiteAssetMappingBaseline('asset', [], [assignment]));
  assert.throws(() => assertSiteAssetMappingBaseline('asset', [assignment], []));
  assert.throws(() => assertSiteAssetMappingBaseline('asset', [assignment], [{ ...assignment, target: { kind: 'SITE_ASSET', siteAssetId: 'foreign' } }]));
  assert.equal(JSON.stringify(assignment), before);
});

test('asset baseline ignores unrelated mappings and harmless physical channel ordering', () => {
  const group = { ...assignment, channelIds: ['c1', 'c2'], phaseMode: 'OTHER' as const };
  assert.doesNotThrow(() => assertSiteAssetMappingBaseline('asset', [
    { ...group, channelIds: ['c2', 'c1'] },
    { ...assignment, id: 'unrelated', target: { kind: 'TBC' } },
  ], [group]));
});

test('unchanged missing supply normalizes to TBC without erasing its historical device mapping', () => {
  const source = { kind: 'BOARD' as const, boardId: 'missing-board' };
  const input = { kind: 'METERED' as const, source: { kind: 'TBC' as const }, draftSource: source,
    previousSource: source, previousAssignment: assignment, previousAssignmentId: assignment.id,
    selectedMeterId: assignment.meterId, selectedMeter: undefined, eligibleMeterIds: [],
    channelIds: assignment.channelIds, phaseMode: assignment.phaseMode, direction: assignment.direction,
    assignments: [assignment] };
  const preserved = siteAssetMeteringForSave(input);
  assert.equal(preserved.kind, 'METERED');
  if (preserved.kind === 'METERED') assert.deepEqual(preserved.preserveMapping?.normalizedSource, { kind: 'TBC' });
  assert.deepEqual(siteAssetMeteringForSave({ ...input, draftSource: { kind: 'TBC' } }), { kind: 'TBC' });
});
