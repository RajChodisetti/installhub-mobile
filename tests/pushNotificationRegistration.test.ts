import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  buildNotificationDeviceDeletePath,
  createPushRegistrationGenerationCoordinator,
  getOrCreateStableDeviceId,
  incrementPersistedRegistrationGeneration,
  readPersistedRegistrationGeneration,
  registerPushNotificationDevice,
  resolvePushProjectId,
  unregisterExistingPushNotificationDevice,
  type PushNotificationRegistrationDependencies,
} from '../src/services/pushNotificationRegistration';

function registrationDependencies(
  overrides: Partial<PushNotificationRegistrationDependencies> = {},
) {
  const events: string[] = [];
  const registrations: Array<{ deviceId: string; input: unknown }> = [];
  const dependencies: PushNotificationRegistrationDependencies = {
    platform: 'ios',
    isPhysicalDevice: true,
    projectId: 'project-123',
    registrationGeneration: 7,
    ensureAndroidChannel: async () => { events.push('channel'); },
    getPermissionStatus: async () => {
      events.push('permission:get');
      return 'granted';
    },
    requestPermission: async () => {
      events.push('permission:request');
      return 'granted';
    },
    getExpoPushToken: async (input) => {
      events.push(`token:${input.projectId}`);
      return 'ExponentPushToken[test]';
    },
    getOrCreateDeviceId: async () => {
      events.push('device-id');
      return 'device-123';
    },
    registerDevice: async (deviceId, input) => {
      events.push('register');
      registrations.push({ deviceId, input });
    },
    ...overrides,
  };
  return { dependencies, events, registrations };
}

test('Android creates its channel before requesting permission and registers the Expo token', async () => {
  const fixture = registrationDependencies({
    platform: 'android',
    getPermissionStatus: async () => {
      fixture.events.push('permission:get');
      return 'undetermined';
    },
    requestPermission: async () => {
      fixture.events.push('permission:request');
      return 'granted';
    },
  });

  assert.equal(await registerPushNotificationDevice(fixture.dependencies), 'registered');
  assert.deepEqual(fixture.events, [
    'channel',
    'permission:get',
    'permission:request',
    'token:project-123',
    'device-id',
    'register',
  ]);
  assert.deepEqual(fixture.registrations, [{
    deviceId: 'device-123',
    input: {
      expoPushToken: 'ExponentPushToken[test]',
      platform: 'android',
      projectId: 'project-123',
      registrationGeneration: 7,
    },
  }]);
});

test('permission denial, simulators, and a missing project ID stop without backend writes', async () => {
  const denied = registrationDependencies({
    getPermissionStatus: async () => 'denied',
    requestPermission: async () => 'denied',
  });
  assert.equal(await registerPushNotificationDevice(denied.dependencies), 'permission-denied');
  assert.deepEqual(denied.registrations, []);

  const simulator = registrationDependencies({ isPhysicalDevice: false });
  assert.equal(await registerPushNotificationDevice(simulator.dependencies), 'simulator');
  assert.deepEqual(simulator.events, []);
  assert.deepEqual(simulator.registrations, []);

  const missingProject = registrationDependencies({ projectId: '  ' });
  assert.equal(
    await registerPushNotificationDevice(missingProject.dependencies),
    'missing-project-id',
  );
  assert.deepEqual(missingProject.registrations, []);
});

test('project ID resolution falls back when expoConfig contains an empty value', () => {
  assert.equal(resolvePushProjectId('  ', 'eas-project'), 'eas-project');
  assert.equal(resolvePushProjectId('expo-project', 'eas-project'), 'expo-project');
  assert.equal(resolvePushProjectId(undefined, null), null);
});

test('rotation exchanges the listener native token for a fresh Expo token', async () => {
  const nativeToken = { type: 'ios', data: 'rolled-apns-token' };
  let exchangeInput: unknown;
  const fixture = registrationDependencies({
    devicePushToken: nativeToken,
    getExpoPushToken: async (input) => {
      exchangeInput = input;
      return 'ExponentPushToken[rotated]';
    },
  });

  assert.equal(await registerPushNotificationDevice(fixture.dependencies), 'registered');
  assert.deepEqual(exchangeInput, {
    projectId: 'project-123',
    devicePushToken: nativeToken,
  });
  assert.deepEqual(fixture.registrations[0]?.input, {
    expoPushToken: 'ExponentPushToken[rotated]',
    platform: 'ios',
    projectId: 'project-123',
    registrationGeneration: 7,
  });
});

test('a superseded authenticated session cannot write after token exchange', async () => {
  let current = true;
  const fixture = registrationDependencies({
    isCurrent: () => current,
    getExpoPushToken: async () => {
      current = false;
      return 'ExponentPushToken[stale]';
    },
  });

  assert.equal(await registerPushNotificationDevice(fixture.dependencies), 'cancelled');
  assert.deepEqual(fixture.registrations, []);
});

test('stable device IDs are securely reused rather than regenerated', async () => {
  let stored: string | null = null;
  let creates = 0;
  const dependencies = {
    read: async () => stored,
    write: async (value: string) => { stored = value; },
    create: () => {
      creates += 1;
      return 'random-device-id';
    },
  };

  assert.equal(await getOrCreateStableDeviceId(dependencies), 'random-device-id');
  assert.equal(await getOrCreateStableDeviceId(dependencies), 'random-device-id');
  assert.equal(creates, 1);
});

test('registration generations persist and increment across remounts and process restarts', async () => {
  let stored: string | null = null;
  const writes: string[] = [];
  const storage = {
    read: async () => stored,
    write: async (value: string) => {
      stored = value;
      writes.push(value);
    },
  };

  assert.equal(await readPersistedRegistrationGeneration(storage), null);
  assert.equal(await incrementPersistedRegistrationGeneration(storage), 1);

  const firstProcess = createPushRegistrationGenerationCoordinator(storage);
  const remountedLifecycle = firstProcess.beginLifecycle();
  assert.equal(await remountedLifecycle.generation, 2);
  remountedLifecycle.dispose();
  assert.equal(await firstProcess.captureAndInvalidateCurrent(), 2);

  const restartedProcess = createPushRegistrationGenerationCoordinator(storage);
  assert.equal(await restartedProcess.beginLifecycle().generation, 3);
  assert.equal(stored, '3');
  assert.deepEqual(writes, ['1', '2', '3']);
});

test('same lifecycle retries and native-token rollover reuse one generation', async () => {
  let stored: string | null = null;
  const coordinator = createPushRegistrationGenerationCoordinator({
    read: async () => stored,
    write: async (value) => { stored = value; },
  });
  const lifecycle = coordinator.beginLifecycle();
  const generation = await lifecycle.generation;
  const registrations: Array<{ token: string; generation: number }> = [];

  const failedAttempt = registrationDependencies({
    registrationGeneration: generation,
    registerDevice: async (_deviceId, input) => {
      registrations.push({
        token: input.expoPushToken,
        generation: input.registrationGeneration,
      });
      throw new Error('temporary network failure');
    },
  });
  await assert.rejects(
    registerPushNotificationDevice(failedAttempt.dependencies),
    /temporary network failure/,
  );

  const nativeToken = { type: 'android', data: 'rotated-native-token' };
  const rolloverAttempt = registrationDependencies({
    registrationGeneration: generation,
    devicePushToken: nativeToken,
    getExpoPushToken: async (input) => {
      assert.equal(input.devicePushToken, nativeToken);
      return 'ExponentPushToken[after-rollover]';
    },
    registerDevice: async (_deviceId, input) => {
      registrations.push({
        token: input.expoPushToken,
        generation: input.registrationGeneration,
      });
    },
  });
  assert.equal(
    await registerPushNotificationDevice(rolloverAttempt.dependencies),
    'registered',
  );

  assert.deepEqual(registrations, [
    { token: 'ExponentPushToken[test]', generation: 1 },
    { token: 'ExponentPushToken[after-rollover]', generation: 1 },
  ]);
  assert.equal(stored, '1');
});

test('overlapping old logout and new lifecycle preserve monotonic ordering', async () => {
  let stored: string | null = null;
  let releaseFirstWrite: (() => void) | undefined;
  const firstWriteGate = new Promise<void>((resolve) => {
    releaseFirstWrite = resolve;
  });
  const writes: string[] = [];
  const coordinator = createPushRegistrationGenerationCoordinator({
    read: async () => stored,
    write: async (value) => {
      writes.push(`start:${value}`);
      if (value === '1') await firstWriteGate;
      stored = value;
      writes.push(`finish:${value}`);
    },
  });

  const oldLifecycle = coordinator.beginLifecycle();
  const oldLogoutGeneration = coordinator.captureAndInvalidateCurrent();
  const newLifecycle = coordinator.beginLifecycle();
  assert.equal(oldLifecycle.isCurrent(), false);
  assert.equal(newLifecycle.isCurrent(), true);

  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ['start:1']);
  releaseFirstWrite?.();

  assert.equal(await oldLifecycle.generation, 1);
  assert.equal(await oldLogoutGeneration, 1);
  assert.equal(await newLifecycle.generation, 2);
  assert.equal(stored, '2');
  assert.deepEqual(writes, [
    'start:1',
    'finish:1',
    'start:2',
    'finish:2',
  ]);
});

test('logout unregisters only when a stable device ID already exists', async () => {
  const deleted: Array<{ deviceId: string; generation: number }> = [];
  assert.equal(await unregisterExistingPushNotificationDevice({
    readDeviceId: async () => null,
    readRegistrationGeneration: async () => 4,
    unregisterDevice: async (deviceId, generation) => {
      deleted.push({ deviceId, generation });
    },
  }), false);
  assert.equal(deleted.length, 0);

  assert.equal(await unregisterExistingPushNotificationDevice({
    readDeviceId: async () => 'device-123',
    readRegistrationGeneration: async () => 4,
    unregisterDevice: async (deviceId, generation) => {
      deleted.push({ deviceId, generation });
    },
  }), true);
  assert.deepEqual(deleted, [{ deviceId: 'device-123', generation: 4 }]);
  assert.equal(
    buildNotificationDeviceDeletePath('device /123', 4),
    '/v1/notifications/devices/device%20%2F123?registrationGeneration=4',
  );

  const apiClient = readFileSync(
    new URL('../src/api/apiClient.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    apiClient,
    /buildNotificationDeviceDeletePath\(deviceId, registrationGeneration\)/,
  );
});

test('Expo config and runtime use the scheduler channel and build identity', () => {
  const app = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8')) as {
    expo: {
      plugins: Array<string | [string, Record<string, unknown>]>;
      ios: { buildNumber: string; infoPlist: Record<string, unknown> };
      android: { versionCode: number };
    };
  };
  const plugin = app.expo.plugins.find(
    (entry) => Array.isArray(entry) && entry[0] === 'expo-notifications',
  );
  assert.ok(Array.isArray(plugin));
  assert.equal(plugin[1].defaultChannel, 'scheduler');

  const locationPlugin = app.expo.plugins.find(
    (entry) => Array.isArray(entry) && entry[0] === 'expo-location',
  );
  assert.ok(Array.isArray(locationPlugin));
  assert.equal(typeof locationPlugin[1].motionUsagePermission, 'string');
  assert.match(
    String(locationPlugin[1].motionUsagePermission),
    /Field App Complete/,
  );

  const runtime = readFileSync(
    new URL('../src/services/pushNotifications.ts', import.meta.url),
    'utf8',
  );
  assert.ok(runtime.includes("SCHEDULER_NOTIFICATION_CHANNEL_ID = 'scheduler'"));
  assert.ok(runtime.includes(
    "'installhub.notifications.registration-generation.v1'",
  ));
  assert.ok(
    runtime.indexOf('await lifecycle.generation')
      < runtime.indexOf('await registerPushNotificationDevice'),
  );

  assert.equal(app.expo.ios.buildNumber, '3');
  assert.equal(app.expo.android.versionCode, 2);
});
