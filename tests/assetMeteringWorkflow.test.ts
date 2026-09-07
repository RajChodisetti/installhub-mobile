import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assetMeteringChannelDescription,
  assetMeteringChannelGroupComplete,
  assetMeteringDeviceChoices,
  assetMeteringSelectionAfterToggle,
  compatibleAssetMeteringChannelIds,
  historicalAssetMeteringSelectionIsReadOnly,
  meteringRemovalPreview,
  resolveDeviceCommissioningDetour,
} from '../src/domain/assetMeteringWorkflow';
import { assignmentApprovalSignature } from '../src/domain/meterAssignmentTakeover';
import type { MeasurementAssignment, MeterDevice } from '../src/types';

test('device detour preserves the exact draft and selects only one newly eligible meter', () => {
  const draft = { name: 'Partially entered chiller', comments: 'keep me', source: 'board-1' };
  const success = resolveDeviceCommissioningDetour({
    draft,
    beforeMeterIds: ['meter-old'],
    eligibleAfterMeterIds: ['meter-old', 'meter-new'],
    outcome: 'SUCCESS',
  });
  assert.equal(success.draft, draft);
  assert.equal(success.newMeterId, 'meter-new');

  for (const outcome of ['CANCELLED', 'FAILED'] as const) {
    const result = resolveDeviceCommissioningDetour({
      draft,
      beforeMeterIds: ['meter-old'],
      eligibleAfterMeterIds: ['meter-old'],
      outcome,
    });
    assert.equal(result.draft, draft);
    assert.equal(result.newMeterId, undefined);
  }
  assert.equal(resolveDeviceCommissioningDetour({
    draft,
    beforeMeterIds: ['meter-old'],
    eligibleAfterMeterIds: ['meter-old', 'meter-a', 'meter-b'],
    outcome: 'SUCCESS',
  }).newMeterId, undefined, 'ambiguous additions are never auto-selected');
});

test('quick asset mapping enforces exact phase channel counts before save', () => {
  assert.deepEqual(assetMeteringSelectionAfterToggle({
    phaseMode: 'SINGLE_PHASE', selectedChannelIds: ['ch-1'], channelId: 'ch-2',
  }), ['ch-2']);
  assert.equal(assetMeteringChannelGroupComplete('SINGLE_PHASE', ['ch-2']), true);
  assert.equal(assetMeteringChannelGroupComplete('SINGLE_PHASE', ['ch-1', 'ch-2']), false);

  let threePhase: string[] = [];
  for (const channelId of ['ch-1', 'ch-2', 'ch-3', 'ch-4']) {
    threePhase = assetMeteringSelectionAfterToggle({
      phaseMode: 'THREE_PHASE', selectedChannelIds: threePhase, channelId,
    });
  }
  assert.deepEqual(threePhase, ['ch-1', 'ch-2', 'ch-3']);
  assert.equal(assetMeteringChannelGroupComplete('THREE_PHASE', threePhase), true);
  assert.equal(assetMeteringChannelGroupComplete('THREE_PHASE', ['ch-1', 'ch-2']), false);
  assert.equal(assetMeteringChannelGroupComplete('OTHER', []), false);
  assert.equal(assetMeteringChannelGroupComplete('OTHER', ['ch-1', 'ch-2']), true);
});

test('metering transition preview names every exact assignment and released channel', () => {
  const meter: MeterDevice = {
    id: 'meter-1', installationId: 'installation-1', installedOnBoardId: 'board-1',
    deviceFamily: 'WATTWATCHERS', deviceModel: 'A3RM', serialNumber: 'SERIAL',
    displayName: { value: 'METER-001', generatedValue: 'METER-001', isOverridden: false, ruleVersion: 1 },
    channels: [
      { id: 'ch-1', ordinal: 1, purpose: 'SUB_CIRCUIT' },
      { id: 'ch-2', ordinal: 2, purpose: 'SUB_CIRCUIT' },
      { id: 'ch-3', ordinal: 3, purpose: 'SPARE' },
    ],
  };
  const assignments: MeasurementAssignment[] = [{
    id: 'assignment-1', installationId: 'installation-1', meterId: meter.id,
    channelIds: ['ch-2', 'ch-1'], phaseMode: 'OTHER',
    target: { kind: 'SITE_ASSET', siteAssetId: 'asset-1' },
    direction: 'CONSUMPTION', status: 'CONFIRMED',
  }];
  assert.deepEqual(
    meteringRemovalPreview(
      { kind: 'METERED', measurementAssignmentIds: ['assignment-1'] },
      assignments,
      [meter],
    ),
    {
      assignmentIds: ['assignment-1'],
      channelLabels: ['METER-001 · Ch 1', 'METER-001 · Ch 2'],
    },
  );
  assert.deepEqual(meteringRemovalPreview({ kind: 'TBC' }, assignments, [meter]), {
    assignmentIds: [], channelLabels: [],
  });
});

function device(
  id: string,
  model: MeterDevice['deviceModel'],
  channels: MeterDevice['channels'],
): MeterDevice {
  return {
    id,
    installationId: 'installation-1',
    installedOnBoardId: 'board-1',
    deviceFamily: model === 'OTHER' ? 'OTHER' : 'WATTWATCHERS',
    deviceModel: model,
    serialNumber: `${id}-serial`,
    displayName: {
      value: id,
      generatedValue: id,
      isOverridden: false,
      ruleVersion: 1,
    },
    channels,
  };
}

test('asset choices enforce A3RM topology and distinguish current, TBC, and occupied channels', () => {
  const meter = device('a3', 'A3RM', [1, 2, 3].map((ordinal) => ({
    id: `a3:${ordinal}`,
    ordinal,
    purpose: 'SUB_CIRCUIT',
    sensorRating: '3000A – 9cm',
  })));
  const own: MeasurementAssignment = {
    id: 'own', installationId: 'installation-1', meterId: meter.id,
    channelIds: ['a3:1'], phaseMode: 'SINGLE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: 'asset-current' },
    direction: 'CONSUMPTION', status: 'CONFIRMED',
  };
  const occupied: MeasurementAssignment = {
    ...own, id: 'occupied', channelIds: ['a3:2'],
    target: { kind: 'SITE_ASSET', siteAssetId: 'asset-other' },
  };
  const tbc: MeasurementAssignment = {
    ...own, id: 'tbc', channelIds: ['a3:3'], target: { kind: 'TBC' }, status: 'TBC',
  };

  const [choice] = assetMeteringDeviceChoices({
    meters: [meter], assignments: [own, occupied, tbc],
    supplyingBoardId: 'board-1', assetId: 'asset-current',
  });
  assert.equal(choice?.topologyIssue, undefined);
  assert.equal(choice?.selectable, true);
  assert.deepEqual(choice?.channels.map((channel) => channel.availability), [
    'CURRENT', 'TAKEOVER_REQUIRED', 'TBC_ASSIGNMENT',
  ]);
  assert.equal(choice?.availableCount, 0);
  assert.equal(choice?.currentCount, 1);
  assert.equal(choice?.tbcCount, 1);
  assert.equal(choice?.directlySelectableCount, 2);
  assert.equal(choice?.occupiedCount, 1);
  assert.equal(choice?.takeoverCount, 1);
  assert.deepEqual(compatibleAssetMeteringChannelIds({
    selectedChannelIds: ['a3:1', 'a3:2', 'a3:3', 'stale'],
    deviceChoice: choice,
  }), ['a3:1', 'a3:3']);

  const [approved] = assetMeteringDeviceChoices({
    meters: [meter], assignments: [own, occupied, tbc],
    supplyingBoardId: 'board-1', assetId: 'asset-current',
    takeoverApprovals: { [occupied.id]: assignmentApprovalSignature(occupied) },
  });
  assert.equal(approved?.channels[1]?.availability, 'TAKEOVER_APPROVED');
  assert.equal(approved?.channels[1]?.selectable, true);
});

test('asset choices require exact A3RM/A6M topology and retain malformed history only explicitly', () => {
  const malformedA3 = device('a3', 'A3RM', [
    { id: 'a3:1', ordinal: 1, purpose: 'SUB_CIRCUIT' },
    { id: 'a3:3', ordinal: 3, purpose: 'SUB_CIRCUIT' },
  ]);
  const a6 = device('a6', 'A6M', [1, 2, 3, 4, 5, 6].map((ordinal) => ({
    id: `a6:${ordinal}`, ordinal, purpose: ordinal === 6 ? 'SUB_CIRCUIT' : 'SPARE',
  })));
  const choices = assetMeteringDeviceChoices({
    meters: [malformedA3, a6], assignments: [], supplyingBoardId: 'board-1',
  });
  assert.match(choices[0]?.topologyIssue ?? '', /exact ordinals 1–3/);
  assert.equal(choices[0]?.selectable, false);
  assert.equal(choices[1]?.topologyIssue, undefined);
  assert.equal(choices[1]?.channels.length, 6);
  assert.equal(choices[1]?.availableCount, 1);
  assert.deepEqual(compatibleAssetMeteringChannelIds({
    selectedChannelIds: ['a3:1'], deviceChoice: choices[0], preserveHistorical: true,
  }), ['a3:1']);
  assert.deepEqual(compatibleAssetMeteringChannelIds({
    selectedChannelIds: ['a3:1'], deviceChoice: choices[0],
  }), []);
});

test('an unchanged incompatible saved channel stays read-only when its device has another usable channel', () => {
  const meter = device('a3', 'A3RM', [
    { id: 'a3:1', ordinal: 1, purpose: 'SPARE' },
    { id: 'a3:2', ordinal: 2, purpose: 'SUB_CIRCUIT' },
    { id: 'a3:3', ordinal: 3, purpose: 'SPARE' },
  ]);
  const previous: MeasurementAssignment = {
    id: 'historical', installationId: 'installation-1', meterId: meter.id,
    channelIds: ['a3:1'], phaseMode: 'SINGLE_PHASE',
    target: { kind: 'SITE_ASSET', siteAssetId: 'asset-current' },
    direction: 'CONSUMPTION', status: 'CONFIRMED',
  };
  const [choice] = assetMeteringDeviceChoices({
    meters: [meter], assignments: [previous], supplyingBoardId: 'board-1',
    assetId: 'asset-current',
  });
  assert.equal(choice?.selectable, true, 'the second channel keeps the device generally eligible');
  assert.equal(choice?.channels[0]?.availability, 'NOT_ASSET_CHANNEL');
  assert.equal(choice?.channels[1]?.availability, 'AVAILABLE');
  assert.equal(historicalAssetMeteringSelectionIsReadOnly({
    selectionUnchanged: true, selectedChannelIds: previous.channelIds, deviceChoice: choice,
  }), true);
  assert.equal(historicalAssetMeteringSelectionIsReadOnly({
    selectionUnchanged: false, selectedChannelIds: previous.channelIds, deviceChoice: choice,
  }), false, 'a deliberate replace action may use the remaining valid channel');
});

test('custom asset channels use exact captured capabilities and do not assume three channels', () => {
  const custom = device('custom', 'OTHER', [
    { id: 'custom:1', ordinal: 1, purpose: 'SUB_CIRCUIT', capabilities: { pulse: true } },
    { id: 'custom:2', ordinal: 2, purpose: 'SUB_CIRCUIT', capabilities: { unit: '  ' } },
    { id: 'custom:3', ordinal: 3, purpose: 'SUB_CIRCUIT', capabilities: { '': 'amps' } },
    { id: 'custom:4', ordinal: 4, purpose: 'MAIN_SUPPLY', capabilities: { volts: 240 } },
  ]);
  const protectedIncompleteCapability: MeasurementAssignment = {
    id: 'custom-board-total', installationId: 'installation-1', meterId: custom.id,
    channelIds: ['custom:2'], phaseMode: 'SINGLE_PHASE',
    target: { kind: 'BOARD', boardId: 'downstream' },
    direction: 'CONSUMPTION', status: 'CONFIRMED',
  };
  const [choice] = assetMeteringDeviceChoices({
    meters: [custom], assignments: [protectedIncompleteCapability], supplyingBoardId: 'board-1',
  });
  assert.equal(choice?.topologyIssue, undefined);
  assert.equal(choice?.channels.length, 4);
  assert.deepEqual(choice?.channels.map((channel) => channel.availability), [
    'AVAILABLE', 'PROTECTED_ASSIGNMENT', 'CAPABILITY_REQUIRED', 'NOT_ASSET_CHANNEL',
  ]);
  assert.equal(choice?.availableCount, 1);
  assert.equal(assetMeteringChannelDescription(custom, custom.channels[0]!), 'pulse: true');
});

test('cross-device duplicate channel IDs invalidate choices instead of leaking occupancy', () => {
  const left = device('left', 'OTHER', [
    { id: 'shared', ordinal: 1, purpose: 'SUB_CIRCUIT', capabilities: { current: true } },
  ]);
  const right = device('right', 'OTHER', [
    { id: 'shared', ordinal: 1, purpose: 'SUB_CIRCUIT', capabilities: { current: true } },
  ]);
  const foreignAssignment: MeasurementAssignment = {
    id: 'foreign', installationId: 'installation-1', meterId: right.id,
    channelIds: ['shared'], phaseMode: 'SINGLE_PHASE', target: { kind: 'TBC' },
    direction: 'CONSUMPTION', status: 'TBC',
  };
  const choices = assetMeteringDeviceChoices({
    meters: [left, right], assignments: [foreignAssignment], supplyingBoardId: 'board-1',
  });
  assert.ok(choices.every((choice) => choice.channels[0]?.availability === 'INVALID_TOPOLOGY'));
  assert.ok(choices.every((choice) => !choice.selectable));
});

test('meter without a configured sub-circuit channel is not offered for asset mapping', () => {
  const meter = device('a3', 'A3RM', [1, 2, 3].map((ordinal) => ({
    id: `a3:${ordinal}`, ordinal, purpose: ordinal === 1 ? 'MAIN_SUPPLY' : 'SPARE',
  })));
  const [choice] = assetMeteringDeviceChoices({
    meters: [meter], assignments: [], supplyingBoardId: 'board-1',
  });
  assert.equal(choice?.availableCount, 0);
  assert.equal(choice?.selectable, false);
});

test('asset choices include only active meters while treating historical missing lifecycle as active', () => {
  const channels = (prefix: string): MeterDevice['channels'] => [1, 2, 3].map((ordinal) => ({
    id: `${prefix}:${ordinal}`,
    ordinal,
    purpose: ordinal === 1 ? 'SUB_CIRCUIT' : 'SPARE',
  }));
  const historical = device('historical', 'A3RM', channels('historical'));
  const active = device('active', 'A3RM', channels('active'));
  active.lifecycleState = 'ACTIVE';
  const planned = device('planned', 'A3RM', channels('planned'));
  planned.lifecycleState = 'PLANNED';
  const inactive = device('inactive', 'A3RM', channels('inactive'));
  inactive.lifecycleState = 'INACTIVE';

  const choices = assetMeteringDeviceChoices({
    meters: [historical, active, planned, inactive],
    assignments: [],
    supplyingBoardId: 'board-1',
  });
  assert.deepEqual(choices.map((choice) => choice.meter.id), ['historical', 'active']);
});

test('board and Grid assignments protect an otherwise valid asset channel', () => {
  const meter = device('a3', 'A3RM', [1, 2, 3].map((ordinal) => ({
    id: `a3:${ordinal}`, ordinal, purpose: ordinal === 1 ? 'SUB_CIRCUIT' : 'SPARE',
  })));
  const protectedAssignment: MeasurementAssignment = {
    id: 'board-total', installationId: 'installation-1', meterId: meter.id,
    channelIds: ['a3:1'], phaseMode: 'SINGLE_PHASE',
    target: { kind: 'BOARD', boardId: 'downstream' },
    direction: 'CONSUMPTION', status: 'CONFIRMED',
  };
  const [choice] = assetMeteringDeviceChoices({
    meters: [meter], assignments: [protectedAssignment], supplyingBoardId: 'board-1',
  });
  assert.equal(choice?.channels[0]?.availability, 'PROTECTED_ASSIGNMENT');
  assert.equal(choice?.occupiedCount, 1);
  assert.equal(choice?.selectable, false);
});
