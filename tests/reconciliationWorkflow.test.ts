import assert from 'node:assert/strict';
import test from 'node:test';
import { readinessIssueKey, reconciliationProgress } from '../src/domain/reconciliationWorkflow';

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
