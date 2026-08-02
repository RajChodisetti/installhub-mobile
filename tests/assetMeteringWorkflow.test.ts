import assert from 'node:assert/strict';
import test from 'node:test';
import {
  meteringRemovalPreview,
  resolveDeviceCommissioningDetour,
} from '../src/domain/assetMeteringWorkflow';
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
