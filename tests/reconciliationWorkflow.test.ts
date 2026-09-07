import assert from 'node:assert/strict';
import test from 'node:test';
import {
  partitionReadinessIssues,
  readinessIssueKey,
  reconciliationIssueWhy,
  reconciliationProgress,
  summarizeReadinessIssues,
} from '../src/domain/reconciliationWorkflow';
import type { MeasurementAssignment, ReadinessIssue, SiteAsset } from '../src/types';

test('reconciliation progress tracks resolved, remaining, and newly introduced issues', () => {
  const baseline = ['a', 'b', 'c'];
  assert.deepEqual(reconciliationProgress(baseline, ['b', 'c', 'd']), {
    total: 4,
    resolved: 1,
    remaining: 3,
    percent: 25,
  });
  assert.deepEqual(reconciliationProgress([], []), {
    total: 0, resolved: 0, remaining: 0, percent: 100,
  });
});

test('readiness issue keys remain stable across message copy changes', () => {
  const first = readinessIssueKey({
    code: 'CHANNEL_UNASSIGNED', severity: 'ERROR', entityType: 'channel',
    entityId: 'channel-1', field: 'measurementAssignments', message: 'First copy',
  });
  const second = readinessIssueKey({
    code: 'CHANNEL_UNASSIGNED', severity: 'ERROR', entityType: 'channel',
    entityId: 'channel-1', field: 'measurementAssignments', message: 'Updated copy',
  });
  assert.equal(first, second);
});

test('reconciliation errors include short user-understandable reasons', () => {
  const issue = (code: string, entityType: ReadinessIssue['entityType']): ReadinessIssue => ({
    code, severity: 'ERROR', entityType, entityId: 'fixture', message: 'Technical detail',
  });
  assert.equal(
    reconciliationIssueWhy(issue('SUPPLY_TBC', 'board')),
    'This switchboard was saved without a confirmed incoming connection or parent switchboard.',
  );
  assert.equal(
    reconciliationIssueWhy(issue('SUPPLY_TBC', 'site_asset')),
    'This asset was saved without a confirmed incoming connection or supplying switchboard.',
  );
  assert.equal(
    reconciliationIssueWhy({ ...issue('METERING_STATE_INVALID', 'site_asset'), field: 'meteringState' }),
    'This asset was saved without confirming whether it is metered or unmetered.',
  );
  assert.equal(
    reconciliationIssueWhy(issue('MEASUREMENT_TARGET_TBC', 'measurement_assignment')),
    'This channel group was saved without confirming what it measures.',
  );
  assert.equal(
    reconciliationIssueWhy(issue('CHANNEL_DUPLICATE_ASSIGNMENT', 'measurement_assignment')),
    'The same device channel is included in more than one measurement group, so its reading would be counted twice.',
  );
  assert.equal(
    reconciliationIssueWhy(issue('SENSOR_RATING_INVALID', 'meter')),
    'The saved CT or Rogowski rating is missing or does not match this device type.',
  );
  assert.match(reconciliationIssueWhy(issue('UNKNOWN', 'installation')), /current installation rules/);
});

test('reconciliation contains only explicit unresolved choices while diagnostics stay separate', () => {
  const issue = (
    code: string,
    entityType: ReadinessIssue['entityType'],
    entityId: string,
    field?: string,
  ): ReadinessIssue => ({
    code,
    severity: 'ERROR',
    entityType,
    entityId,
    field,
    message: 'Fixture',
  });
  const siteAssets = [
    { id: 'asset-tbc', metering_state: { kind: 'TBC' as const } },
    { id: 'asset-invalid', metering_state: { kind: 'UNMETERED' as const } },
  ] satisfies Array<Pick<SiteAsset, 'id' | 'metering_state'>>;
  const measurementAssignments = [
    {
      id: 'assignment-tbc',
      status: 'TBC' as const,
      target: { kind: 'TBC' as const },
    },
    {
      id: 'assignment-invalid',
      status: 'CONFIRMED' as const,
      target: { kind: 'BOARD' as const, boardId: 'missing-board' },
    },
  ] satisfies Array<Pick<MeasurementAssignment, 'id' | 'status' | 'target'>>;
  const issues = [
    issue('SUPPLY_TBC', 'board', 'board-tbc'),
    issue('METERING_STATE_INVALID', 'site_asset', 'asset-tbc', 'meteringState'),
    issue('METERING_STATE_INVALID', 'site_asset', 'asset-tbc', 'meteringState.measurementAssignmentIds'),
    issue('MEASUREMENT_TARGET_TBC', 'measurement_assignment', 'assignment-tbc', 'targetConfirmation'),
    issue('METERING_STATE_INVALID', 'site_asset', 'asset-invalid'),
    issue('MEASUREMENT_TARGET_TBC', 'measurement_assignment', 'assignment-invalid', 'target'),
    issue('CHANNEL_UNASSIGNED', 'channel', 'channel-1'),
  ];

  const partition = partitionReadinessIssues(issues, {
    siteAssets,
    measurementAssignments,
  });
  assert.deepEqual(
    partition.reconciliation.map((item) => item.entityId),
    ['board-tbc', 'asset-tbc', 'assignment-tbc'],
  );
  assert.deepEqual(
    partition.validation.map((item) => item.entityId),
    ['asset-tbc', 'asset-invalid', 'assignment-invalid', 'channel-1'],
  );
});

test('workspace readiness summary coalesces repeated checks into stable human groups', () => {
  const issue = (
    entityType: ReadinessIssue['entityType'],
    severity: ReadinessIssue['severity'] = 'ERROR',
  ): ReadinessIssue => ({
    code: 'FIXTURE',
    severity,
    entityType,
    entityId: `${entityType}-${severity}`,
    message: 'Fixture',
  });
  assert.deepEqual(summarizeReadinessIssues([
    issue('channel'),
    issue('meter'),
    issue('measurement_assignment', 'WARNING'),
    issue('site_asset'),
    issue('board'),
    issue('grid_supply'),
    issue('form', 'WARNING'),
  ]), [
    { id: 'SITE_GRID', label: 'Site and incoming grid', count: 1, blocking: 1, warnings: 0 },
    { id: 'SWITCHBOARDS', label: 'Switchboards and supply links', count: 1, blocking: 1, warnings: 0 },
    { id: 'ASSET_METERING', label: 'Assets and metering', count: 1, blocking: 1, warnings: 0 },
    { id: 'DEVICES_CHANNELS', label: 'Devices and channels', count: 3, blocking: 2, warnings: 1 },
    { id: 'FIELD_FORMS', label: 'Field forms', count: 1, blocking: 0, warnings: 1 },
  ]);
  assert.deepEqual(summarizeReadinessIssues([]), []);
});
