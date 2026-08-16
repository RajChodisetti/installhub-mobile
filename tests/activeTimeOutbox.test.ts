import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVE_TIME_OUTBOX_KEY,
  createActiveTimeOutboxStore,
  type ActiveTimeStorageAdapter,
} from '../src/services/activeTimeOutbox';
import type { AuditWorkSessionCheckpoint } from '../src/services/auditWorkTrackingPolicy';

function memoryStorage(initial?: string): ActiveTimeStorageAdapter & { value: string | null } {
  return {
    value: initial ?? null,
    async getItem(key) {
      assert.equal(key, ACTIVE_TIME_OUTBOX_KEY);
      return this.value;
    },
    async setItem(key, value) {
      assert.equal(key, ACTIVE_TIME_OUTBOX_KEY);
      this.value = value;
    },
  };
}

const checkpoint = (
  revision: number,
  endedAt: string | null = null,
  actorUserId = 'user_1',
): AuditWorkSessionCheckpoint => ({
  sessionId: 'session_1',
  actorUserId,
  installationId: 'inst_1',
  revision,
  activeMilliseconds: revision * 1_000,
  startedAt: '2026-08-15T12:00:00.000Z',
  lastActiveAt: `2026-08-15T12:00:0${revision}.000Z`,
  endedAt,
});

test('CAS acknowledgement never removes a newer in-flight local revision', async () => {
  const store = createActiveTimeOutboxStore(memoryStorage());
  await store.save(checkpoint(1), true);
  await store.save(checkpoint(2, '2026-08-15T12:00:02.000Z'), true);

  await store.acknowledge('user_1', 'session_1', 1, 1);
  let pending = await store.pending('user_1');
  assert.equal(pending.length, 1);
  assert.equal(pending[0].revision, 2);
  assert.equal(pending[0].acknowledgedRevision, 1);

  await store.acknowledge('user_1', 'session_1', 2, 2);
  pending = await store.pending('user_1');
  assert.deepEqual(pending, []);
});

test('open acknowledged sessions remain for later heartbeat revisions', async () => {
  const store = createActiveTimeOutboxStore(memoryStorage());
  await store.save(checkpoint(1));
  await store.acknowledge('user_1', 'session_1', 1, 1);

  assert.equal((await store.pending('user_1')).length, 0);
  assert.equal((await store.read()).sessions.length, 1);

  await store.save(checkpoint(2));
  assert.equal((await store.pending('user_1')).length, 1);
});

test('restart closes interrupted sessions at the last checkpoint without adding time', async () => {
  const store = createActiveTimeOutboxStore(memoryStorage());
  await store.save(checkpoint(3));
  await store.closeInterrupted('user_1');

  const [closed] = await store.pending('user_1');
  assert.equal(closed.revision, 4);
  assert.equal(closed.activeMilliseconds, 3_000);
  assert.equal(closed.endedAt, closed.lastActiveAt);
});

test('pending delivery is partitioned by actor and parent confirmation survives local deletion', async () => {
  const store = createActiveTimeOutboxStore(memoryStorage());
  await store.save(checkpoint(1), false);
  await store.save({
    ...checkpoint(1, null, 'user_2'),
    sessionId: 'session_2',
  }, false);
  await store.setServerParentConfirmed('user_1', 'inst_1', true);

  const userOne = await store.pending('user_1');
  const userTwo = await store.pending('user_2');
  assert.equal(userOne.length, 1);
  assert.equal(userOne[0].serverParentConfirmed, true);
  assert.equal(userTwo.length, 1);
  assert.equal(userTwo[0].serverParentConfirmed, false);
});
