import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignmentApprovalSignature,
  assertExactAssignmentApprovals,
  planMeterAssetTakeover,
  planSiteChannelTakeover,
  releasedAssignmentRemainder,
} from '../src/domain/meterAssignmentTakeover';
import type { AppDataStore, MeasurementAssignment, MeterDevice, SiteAsset } from '../src/types';

const assignment = (id: string, meterId: string, channelIds: string[], assetId?: string): MeasurementAssignment => ({
  id, installationId: 'installation', meterId, channelIds,
  phaseMode: channelIds.length === 1 ? 'SINGLE_PHASE' : channelIds.length === 3 ? 'THREE_PHASE' : 'OTHER',
  target: assetId ? { kind: 'SITE_ASSET', siteAssetId: assetId } : { kind: 'TBC' },
  direction: 'CONSUMPTION', status: assetId ? 'CONFIRMED' : 'TBC',
});
const approval = (...assignments: MeasurementAssignment[]) => Object.fromEntries(
  assignments.map((item) => [item.id, assignmentApprovalSignature(item)]),
);
const asset = (id: string): SiteAsset => ({
  id, audit_id: 'installation', zone_id: 'zone', asset_name: id, asset_type: 'HVAC',
  meter_present: true, created_at: '', updated_at: '',
});
const device = (id: string, channelIds: string[]): MeterDevice => ({
  id, installationId: 'installation', installedOnBoardId: 'board', deviceFamily: 'OTHER',
  deviceModel: 'OTHER', serialNumber: '', displayName: { value: id, generatedValue: id, isOverridden: false, ruleVersion: 1 },
  channels: channelIds.map((channelId, index) => ({ id: channelId, ordinal: index + 1, purpose: 'SUB_CIRCUIT', phaseLabel: 'UNKNOWN', capabilities: {} })),
});
function fixture(): AppDataStore {
  return {
    user: { id: 'owner', email: 'owner@example.test', full_name: 'Owner', role: 'admin' },
    installations: [], zones: [], electricalAssets: [], formSubmissions: [], gridSupplies: [],
    siteAssets: [asset('asset-a'), asset('asset-b'), asset('asset-c')],
    meterDevices: [device('meter-a', ['a1', 'a2', 'a3']), device('meter-b', ['b1', 'b2', 'b3'])],
    measurementAssignments: [
      assignment('mapping-a', 'meter-a', ['a1', 'a2', 'a3'], 'asset-a'),
      assignment('mapping-b', 'meter-b', ['b1', 'b2', 'b3'], 'asset-b'),
    ],
    cloudSync: { synced_at_by_installation: {}, force_dirty_installation_ids: [], upload_queue: [], thumbnail_queue: [] },
  } as AppDataStore;
}

test('consent signature matches portal and ignores channel order without mutating it', () => {
  const current = assignment('mapping', 'meter-a', ['a3', 'a1', 'a2'], 'asset-a');
  assert.equal(assignmentApprovalSignature(current), JSON.stringify({ ...current, channelIds: ['a1', 'a2', 'a3'] }));
  assert.equal(assignmentApprovalSignature(current), assignmentApprovalSignature({ ...current, channelIds: ['a2', 'a3', 'a1'] }));
  assert.deepEqual(current.channelIds, ['a3', 'a1', 'a2']);
});

test('exact consent rejects missing, stale, extra, inherited and duplicate identities', () => {
  const current = assignment('mapping', 'meter-a', ['a1'], 'asset-a');
  assert.doesNotThrow(() => assertExactAssignmentApprovals([current], approval(current)));
  assert.doesNotThrow(() => assertExactAssignmentApprovals([], {}));
  assert.throws(() => assertExactAssignmentApprovals([current]), /Approve the exact/);
  assert.throws(() => assertExactAssignmentApprovals([current], Object.create(approval(current))), /Approve the exact/);
  assert.throws(() => assertExactAssignmentApprovals([], approval(current)), /stale/);
  assert.throws(() => assertExactAssignmentApprovals([current], { ...approval(current), unrelated: 'approved' }), /stale/);
  assert.throws(() => assertExactAssignmentApprovals([current, current], approval(current)), /conflicting identities/);
  for (const changed of [
    { ...current, meterId: 'meter-b' },
    { ...current, installationId: 'other-installation' },
    { ...current, channelIds: ['a2'] },
    { ...current, phaseMode: 'OTHER' as const },
    { ...current, direction: 'GENERATION' as const },
    { ...current, target: { kind: 'SITE_ASSET' as const, siteAssetId: 'asset-b' } },
    { ...current, status: 'TBC' as const },
  ]) assert.throws(() => assertExactAssignmentApprovals([changed], approval(current)), /stale/);
});

test('released remainder retains identity/direction and normalizes phase while keeping explicit Other', () => {
  const current = { ...assignment('mapping', 'meter-a', ['a1', 'a2', 'a3'], 'asset-a'), direction: 'GENERATION' as const };
  const before = structuredClone(current);
  const remainder = releasedAssignmentRemainder(current, new Set(['a1', 'a2']));
  assert.deepEqual(remainder, { ...current, channelIds: ['a3'], phaseMode: 'SINGLE_PHASE', target: { kind: 'TBC' }, status: 'TBC' });
  assert.equal(releasedAssignmentRemainder(current, new Set(['a1']))?.phaseMode, 'OTHER');
  assert.equal(releasedAssignmentRemainder({ ...current, phaseMode: 'OTHER' }, new Set(['a1', 'a2']))?.phaseMode, 'OTHER');
  assert.equal(releasedAssignmentRemainder(current, new Set(current.channelIds)), null);
  assert.deepEqual(current, before);
});

test('meter takeover requires exact other-meter consent and keeps its released channels TBC', () => {
  const store = fixture();
  const before = structuredClone(store);
  const incoming = assignment('replacement', 'meter-a', ['a1'], 'asset-b');
  const conflict = store.measurementAssignments[1]!;
  assert.throws(() => planMeterAssetTakeover(store, 'meter-a', [incoming]), /Approve the exact/);
  const remaining = planMeterAssetTakeover(store, 'meter-a', [incoming], approval(conflict));
  assert.deepEqual(remaining, [{ ...conflict, target: { kind: 'TBC' }, status: 'TBC' }]);
  assert.deepEqual(store, before);
  remaining[0]!.channelIds.pop();
  assert.deepEqual(store, before);
});

test('meter takeover leaves unrelated installation records intact and rejects wrong identities', () => {
  const store = fixture();
  const unrelated = { ...assignment('foreign', 'foreign-meter', ['foreign-channel']), installationId: 'foreign-installation' };
  store.measurementAssignments.push(unrelated);
  const remaining = planMeterAssetTakeover(store, 'meter-a', []);
  assert.deepEqual(remaining, [store.measurementAssignments[1], unrelated]);
  const incoming = assignment('incoming', 'meter-a', ['a1'], 'asset-c');
  assert.throws(() => planMeterAssetTakeover(store, 'missing', [incoming]), /unavailable/);
  assert.throws(() => planMeterAssetTakeover(store, 'meter-a', [{ ...incoming, meterId: 'meter-b' }]), /selected meter/);
  assert.throws(() => planMeterAssetTakeover(store, 'meter-a', [{ ...incoming, installationId: 'foreign' }]), /selected meter/);
  store.siteAssets.find(item => item.id === 'asset-c')!.audit_id = 'foreign';
  assert.throws(() => planMeterAssetTakeover(store, 'meter-a', [incoming]), /unavailable in this installation/);
});

test('meter takeover rejects a changed conflict even if its ID is unchanged', () => {
  const store = fixture();
  const approved = approval(store.measurementAssignments[1]!);
  store.measurementAssignments[1]!.direction = 'GENERATION';
  const incoming = assignment('incoming', 'meter-a', ['a1'], 'asset-b');
  assert.throws(() => planMeterAssetTakeover(store, 'meter-a', [incoming], approved), /stale/);
  store.measurementAssignments[1]!.installationId = 'foreign';
  assert.throws(() => planMeterAssetTakeover(store, 'meter-a', [incoming], approved), /another installation/);
});

test('site takeover releases own previous mapping and the displaced remainder without mutating assets', () => {
  const store = fixture();
  const before = structuredClone(store);
  const conflict = store.measurementAssignments[0]!;
  const selected = new Set(['a1']);
  assert.throws(() => planSiteChannelTakeover(store, 'asset-b', selected), /Approve the exact/);
  const plan = planSiteChannelTakeover(store, 'asset-b', selected, approval(conflict));
  assert.deepEqual(plan.displacedAssetIds, ['asset-a']);
  assert.deepEqual(plan.assignments, [
    { ...conflict, channelIds: ['a2', 'a3'], phaseMode: 'OTHER', target: { kind: 'TBC' }, status: 'TBC' },
    { ...store.measurementAssignments[1], target: { kind: 'TBC' }, status: 'TBC' },
  ]);
  assert.deepEqual(store, before);
});

test('site takeover accepts TBC channels without consent and discards fully claimed remainder', () => {
  const store = fixture();
  store.measurementAssignments[0] = assignment('unresolved', 'meter-a', ['a1']);
  const plan = planSiteChannelTakeover(store, 'asset-c', new Set(['a1']));
  assert.deepEqual(plan.assignments, [store.measurementAssignments[1]]);
  assert.deepEqual(plan.displacedAssetIds, []);
});

test('site reselecting its own channels needs no consent and releases only unclaimed remainder', () => {
  const store = fixture();
  const plan = planSiteChannelTakeover(store, 'asset-a', new Set(['a1', 'a2']));
  assert.deepEqual(plan.assignments[0], {
    ...store.measurementAssignments[0], channelIds: ['a3'], phaseMode: 'SINGLE_PHASE', target: { kind: 'TBC' }, status: 'TBC',
  });
  assert.deepEqual(plan.displacedAssetIds, []);
});

test('site takeover cannot take Board/Grid assignments even with their signatures', () => {
  for (const target of [{ kind: 'BOARD', boardId: 'board' }, { kind: 'GRID_BOUNDARY', gridSupplyId: 'grid' }] as const) {
    const store = fixture();
    const conflict = { ...store.measurementAssignments[0]!, target };
    store.measurementAssignments[0] = conflict;
    assert.throws(() => planSiteChannelTakeover(store, 'asset-c', new Set(['a1']), approval(conflict)), /cannot be taken over/);
  }
});

test('site takeover rejects unavailable or foreign displaced assets and invalid channel scope', () => {
  const store = fixture();
  const selected = new Set(['a1']);
  const approved = approval(store.measurementAssignments[0]!);
  store.siteAssets = store.siteAssets.filter(item => item.id !== 'asset-a');
  assert.throws(() => planSiteChannelTakeover(store, 'asset-c', selected, approved), /unavailable in this installation/);
  store.siteAssets.push({ ...asset('asset-a'), audit_id: 'foreign' });
  assert.throws(() => planSiteChannelTakeover(store, 'asset-c', selected, approved), /unavailable in this installation/);
  assert.throws(() => planSiteChannelTakeover(store, 'asset-c', new Set()), /Select an available/);
  assert.throws(() => planSiteChannelTakeover(store, 'asset-c', new Set(['missing'])), /unavailable/);
  assert.throws(() => planSiteChannelTakeover(store, 'asset-c', new Set(['a1', 'b1'])), /one metering device/);
  store.meterDevices[0]!.installationId = 'foreign';
  assert.throws(() => planSiteChannelTakeover(store, 'asset-c', selected, approved), /another installation/);
});

test('site takeover rejects stale and no-longer-required approvals', () => {
  const store = fixture();
  const selected = new Set(['a1']);
  const approved = approval(store.measurementAssignments[0]!);
  store.measurementAssignments[0]!.channelIds = ['a1', 'a2'];
  assert.throws(() => planSiteChannelTakeover(store, 'asset-c', selected, approved), /stale/);
  store.measurementAssignments[0]!.target = { kind: 'TBC' };
  assert.throws(() => planSiteChannelTakeover(store, 'asset-c', selected, approved), /stale/);
});

test('site takeover requires consent for every affected owner before returning a combined plan', () => {
  const store = fixture();
  const first = assignment('first-owner', 'meter-a', ['a1'], 'asset-a');
  const second = assignment('second-owner', 'meter-a', ['a2', 'a3'], 'asset-b');
  store.measurementAssignments = [first, second];
  const before = structuredClone(store);
  const selected = new Set(['a1', 'a2']);
  assert.throws(() => planSiteChannelTakeover(store, 'asset-c', selected, approval(first)), /stale/);
  assert.deepEqual(store, before);
  const plan = planSiteChannelTakeover(store, 'asset-c', selected, approval(first, second));
  assert.deepEqual(plan.displacedAssetIds, ['asset-a', 'asset-b']);
  assert.deepEqual(plan.assignments, [{ ...second, channelIds: ['a3'], target: { kind: 'TBC' }, status: 'TBC' }]);
  assert.deepEqual(store, before);
});
