import assert from 'node:assert/strict';
import test from 'node:test';
import { projectOperationalDiagnostic } from '../src/services/operationalDiagnosticsPolicy';

test('operational diagnostics projection keeps only approved non-evidence fields', () => {
  const projected = projectOperationalDiagnostic({
    kind: 'SYNC',
    recordedAt: '2026-08-01T00:00:00.000Z',
    outcome: 'CONFLICT',
    conflict: true,
    schemaVersion: 2,
    latencyMs: 1234,
    answers: { secret: 'customer answer' },
    photoUri: 'file:///private/evidence.jpg',
    token: 'access-token',
    clientName: 'Private Customer',
    recoveryPayload: 'encrypted-payload',
    recoveryKey: 'device-key',
  });
  assert.deepEqual(projected, {
    kind: 'SYNC',
    recordedAt: '2026-08-01T00:00:00.000Z',
    outcome: 'CONFLICT',
    conflict: true,
    schemaVersion: 2,
    latencyMs: 1234,
  });
  const serialized = JSON.stringify(projected);
  assert.doesNotMatch(serialized, /answer|file:|token|customer|payload|key/i);
});

test('completion rejection codes are bounded and never retain arbitrary server text', () => {
  assert.deepEqual(projectOperationalDiagnostic({
    kind: 'COMPLETION_REJECTED',
    recordedAt: '2026-08-01T00:00:00.000Z',
    code: 'PHASE_GROUP_INVALID',
    message: 'customer-specific detail',
  }), {
    kind: 'COMPLETION_REJECTED',
    recordedAt: '2026-08-01T00:00:00.000Z',
    code: 'PHASE_GROUP_INVALID',
  });
  assert.equal(projectOperationalDiagnostic({
    kind: 'COMPLETION_REJECTED',
    recordedAt: '2026-08-01T00:00:00.000Z',
    code: 'free form private response',
  })?.kind, 'COMPLETION_REJECTED');
  assert.equal((projectOperationalDiagnostic({
    kind: 'COMPLETION_REJECTED',
    recordedAt: '2026-08-01T00:00:00.000Z',
    code: 'free form private response',
  }) as { code: string }).code, 'UNKNOWN');
});
