import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isInstallHubSchedulerNotificationData,
  listenForInstallHubSchedulerNotifications,
  type SchedulerNotificationListenerDependencies,
} from '../src/services/schedulerNotificationRefresh';

const validData = {
  type: 'scheduler',
  notificationKind: 'assigned',
  eventId: 'event-1',
  sourceApp: 'installhub',
  sourceType: 'installation',
  sourceId: 'installation-1',
  scheduledStartAt: '2026-09-08T01:00:00.000Z',
} as const;

const notification = (data: Record<string, unknown>, identifier?: string) => ({
  request: { identifier, content: { data } },
});

const response = (data: Record<string, unknown>, identifier?: string) => ({
  notification: notification(data, identifier),
});

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

test('Scheduler refresh accepts only complete InstallHub installation payloads', () => {
  assert.equal(isInstallHubSchedulerNotificationData(validData), true);
  for (const value of [
    null,
    [],
    { ...validData, type: 'other' },
    { ...validData, notificationKind: 'unknown' },
    { ...validData, eventId: '  ' },
    { ...validData, sourceApp: 'ecoaudit' },
    { ...validData, sourceType: 'audit' },
    { ...validData, sourceId: '' },
    { ...validData, scheduledStartAt: null },
  ]) {
    assert.equal(isInstallHubSchedulerNotificationData(value), false);
  }
});

test('live receipt, response, and a cold-start response request refresh and clean up listeners', async () => {
  let received: ((value: ReturnType<typeof notification>) => void) | undefined;
  let responded: ((value: ReturnType<typeof response>) => void) | undefined;
  let receivedRemovals = 0; let responseRemovals = 0; let clears = 0;
  const refreshedInstallationIds: string[] = [];
  const dependencies: SchedulerNotificationListenerDependencies = {
    addNotificationReceivedListener: (listener) => {
      received = listener;
      return { remove: () => { receivedRemovals += 1; } };
    },
    addNotificationResponseReceivedListener: (listener) => {
      responded = listener;
      return { remove: () => { responseRemovals += 1; } };
    },
    getLastNotificationResponse: async () => response(validData, 'cold-1'),
    clearLastNotificationResponse: async () => { clears += 1; },
  };
  const cleanup = listenForInstallHubSchedulerNotifications(
    dependencies,
    (data) => { refreshedInstallationIds.push(data.sourceId); },
  );
  received?.(notification(validData, 'received-1'));
  received?.(notification({ ...validData, sourceApp: 'ecoaudit' }, 'foreign-1'));
  responded?.(response({ ...validData, notificationKind: 'changed' }, 'response-1'));
  responded?.(response(validData, 'received-1'));
  responded?.(response({ ...validData, type: 'other' }, 'foreign-2'));
  await settle();
  assert.deepEqual(refreshedInstallationIds, [
    'installation-1',
    'installation-1',
    'installation-1',
  ]);
  assert.equal(clears, 1);

  cleanup();
  assert.equal(receivedRemovals, 1);
  assert.equal(responseRemovals, 1);
  received?.(notification(validData, 'received-after-cleanup'));
  responded?.(response(validData, 'response-after-cleanup'));
  assert.equal(refreshedInstallationIds.length, 3);
});

test('foreign cold-start responses remain available and do not refresh', async () => {
  let clears = 0; let refreshes = 0;
  const dependencies: SchedulerNotificationListenerDependencies = {
    addNotificationReceivedListener: () => ({ remove: () => {} }),
    addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
    getLastNotificationResponse: async () => response({ ...validData, sourceType: 'audit' }),
    clearLastNotificationResponse: async () => { clears += 1; },
  };
  const cleanup = listenForInstallHubSchedulerNotifications(
    dependencies,
    () => { refreshes += 1; },
  );
  await settle(); cleanup();
  assert.equal(refreshes, 0);
  assert.equal(clears, 0);
});

test('cleanup prevents a delayed cold-start lookup from requesting refresh', async () => {
  let resolveLast!: (value: ReturnType<typeof response>) => void;
  const last = new Promise<ReturnType<typeof response>>((resolve) => { resolveLast = resolve; });
  let clears = 0; let refreshes = 0;
  const dependencies: SchedulerNotificationListenerDependencies = {
    addNotificationReceivedListener: () => ({ remove: () => {} }),
    addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
    getLastNotificationResponse: () => last,
    clearLastNotificationResponse: async () => { clears += 1; },
  };
  const cleanup = listenForInstallHubSchedulerNotifications(
    dependencies,
    () => { refreshes += 1; },
  );
  cleanup(); resolveLast(response(validData)); await settle();
  assert.equal(refreshes, 0);
  assert.equal(clears, 0);
});

test('a duplicate cold-start response is still cleared after its live response was handled', async () => {
  let resolveLast!: (value: ReturnType<typeof response>) => void;
  const last = new Promise<ReturnType<typeof response>>((resolve) => { resolveLast = resolve; });
  let responded: ((value: ReturnType<typeof response>) => void) | undefined;
  let clears = 0; let refreshes = 0;
  const dependencies: SchedulerNotificationListenerDependencies = {
    addNotificationReceivedListener: () => ({ remove: () => {} }),
    addNotificationResponseReceivedListener: (listener) => {
      responded = listener;
      return { remove: () => {} };
    },
    getLastNotificationResponse: () => last,
    clearLastNotificationResponse: async () => { clears += 1; },
  };
  const cleanup = listenForInstallHubSchedulerNotifications(
    dependencies,
    () => { refreshes += 1; },
  );
  responded?.(response(validData, 'shared-response'));
  resolveLast(response(validData, 'shared-response'));
  await settle(); cleanup();
  assert.equal(refreshes, 1);
  assert.equal(clears, 1);
});

test('a response-listener registration failure removes the receipt listener', () => {
  let removals = 0;
  const dependencies: SchedulerNotificationListenerDependencies = {
    addNotificationReceivedListener: () => ({ remove: () => { removals += 1; } }),
    addNotificationResponseReceivedListener: () => { throw new Error('native listener failed'); },
    getLastNotificationResponse: async () => null,
    clearLastNotificationResponse: async () => {},
  };
  assert.throws(
    () => listenForInstallHubSchedulerNotifications(dependencies, () => {}),
    /native listener failed/,
  );
  assert.equal(removals, 1);
});
