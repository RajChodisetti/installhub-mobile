import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAuditWorkTracker,
  focusedAuditInstallationId,
  type AuditWorkEligibility,
  type AuditWorkSessionCheckpoint,
} from '../src/services/auditWorkTrackingPolicy';

const eligible = (installationId = 'inst_1'): AuditWorkEligibility => ({
  actorUserId: 'user_1',
  installationId,
  installationIsDraft: true,
  appIsActive: true,
  windowIsFocused: true,
  suspended: false,
});

function harness(persistOverride?: (value: AuditWorkSessionCheckpoint) => Promise<void>) {
  let monotonicMilliseconds = 0;
  let wallMilliseconds = Date.parse('2026-08-15T12:00:00.000Z');
  let sessionSequence = 0;
  const persisted: AuditWorkSessionCheckpoint[] = [];
  const tracker = createAuditWorkTracker({
    createSessionId: () => `session_${++sessionSequence}`,
    monotonicNow: () => monotonicMilliseconds,
    wallTimeNow: () => new Date(wallMilliseconds).toISOString(),
    persist: persistOverride ?? (async (value) => { persisted.push(value); }),
  });
  return {
    tracker,
    persisted,
    advance(milliseconds: number) {
      monotonicMilliseconds += milliseconds;
      wallMilliseconds += milliseconds;
    },
  };
}

test('focused route selection uses only direct audit-route installation params', () => {
  assert.equal(focusedAuditInstallationId({
    name: 'InstallationDetail',
    params: { installationId: 'inst_1' },
  }), 'inst_1');
  assert.equal(focusedAuditInstallationId({
    name: 'FormEditor',
    params: { formId: 'form_1', installationId: 'inst_1' },
  }), 'inst_1');
  assert.equal(focusedAuditInstallationId({
    name: 'Settings',
    params: { installationId: 'inst_hidden_under_settings' },
  }), null);
  assert.equal(focusedAuditInstallationId({ name: 'InstallationForm' }), null);
});

test('same-installation screen changes remain one continuous session', async () => {
  const { tracker, persisted, advance } = harness();
  await tracker.setEligibility(eligible());
  advance(2_000);
  await tracker.setEligibility(eligible());
  advance(3_000);
  await tracker.setEligibility({ ...eligible(), installationId: null });

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].sessionId, 'session_1');
  assert.equal(persisted[0].activeMilliseconds, 5_000);
  assert.ok(persisted[0].endedAt);
});

test('background, inactive, and Android blur gaps are never counted', async () => {
  const { tracker, persisted, advance } = harness();
  await tracker.setEligibility(eligible());
  advance(5_000);
  await tracker.setEligibility({ ...eligible(), appIsActive: false });
  advance(60_000);
  await tracker.setEligibility(eligible());
  advance(2_000);
  await tracker.setEligibility({ ...eligible(), windowIsFocused: false });

  assert.deepEqual(persisted.map((item) => item.activeMilliseconds), [5_000, 2_000]);
  assert.notEqual(persisted[0].sessionId, persisted[1].sessionId);
});

test('completed installations stop immediately and reopening starts a new session', async () => {
  const { tracker, persisted, advance } = harness();
  await tracker.setEligibility(eligible());
  advance(4_000);
  await tracker.setEligibility({ ...eligible(), installationIsDraft: false });
  advance(20_000);
  await tracker.checkpoint();
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].activeMilliseconds, 4_000);

  await tracker.setEligibility(eligible());
  advance(1_500);
  await tracker.close();
  assert.deepEqual(persisted.map((item) => item.activeMilliseconds), [4_000, 1_500]);
});

test('failed pause persistence retries the captured cutoff without absorbing background time', async () => {
  const persisted: AuditWorkSessionCheckpoint[] = [];
  let failNext = true;
  const setup = harness(async (value) => {
    if (failNext) {
      failNext = false;
      throw new Error('storage unavailable');
    }
    persisted.push(value);
  });
  await setup.tracker.setEligibility(eligible());
  setup.advance(1_000);
  await assert.rejects(
    setup.tracker.setEligibility({ ...eligible(), appIsActive: false }),
    /storage unavailable/,
  );
  setup.advance(60_000);
  await setup.tracker.setEligibility(eligible());
  setup.advance(2_000);
  await setup.tracker.close();

  assert.equal(persisted.length, 2);
  assert.deepEqual(persisted.map((item) => item.activeMilliseconds), [1_000, 2_000]);
  assert.equal(persisted[0].lastActiveAt, '2026-08-15T12:00:01.000Z');
  assert.equal(persisted[0].endedAt, '2026-08-15T12:00:01.000Z');
  assert.equal(persisted[1].startedAt, '2026-08-15T12:01:01.000Z');
  assert.notEqual(persisted[0].sessionId, persisted[1].sessionId);
});
