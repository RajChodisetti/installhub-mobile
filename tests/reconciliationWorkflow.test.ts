import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readinessIssueKey,
  reconciliationProgress,
  summarizeReadinessIssues,
} from '../src/domain/reconciliationWorkflow';
import type { ReadinessIssue } from '../src/types';

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
