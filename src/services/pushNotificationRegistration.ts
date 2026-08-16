export type PushNotificationPlatform = 'ios' | 'android';

export interface PushNotificationDeviceRegistration {
  expoPushToken: string;
  platform: PushNotificationPlatform;
  projectId: string;
  registrationGeneration: number;
}

export type PushNotificationRegistrationResult =
  | 'registered'
  | 'permission-denied'
  | 'simulator'
  | 'missing-project-id'
  | 'unsupported-platform'
  | 'cancelled';

export interface PushNotificationRegistrationDependencies {
  platform: string;
  isPhysicalDevice: boolean;
  projectId: string | null | undefined;
  registrationGeneration: number;
  devicePushToken?: unknown;
  isCurrent?: () => boolean;
  ensureAndroidChannel: () => Promise<void>;
  getPermissionStatus: () => Promise<string>;
  requestPermission: () => Promise<string>;
  getExpoPushToken: (input: {
    projectId: string;
    devicePushToken?: unknown;
  }) => Promise<string>;
  getOrCreateDeviceId: () => Promise<string>;
  registerDevice: (
    deviceId: string,
    input: PushNotificationDeviceRegistration,
  ) => Promise<void>;
}

export interface StableDeviceIdDependencies {
  read: () => Promise<string | null>;
  write: (deviceId: string) => Promise<void>;
  create: () => string;
}

export interface PushNotificationUnregistrationDependencies {
  readDeviceId: () => Promise<string | null>;
  readRegistrationGeneration: () => Promise<number | null>;
  unregisterDevice: (
    deviceId: string,
    registrationGeneration: number,
  ) => Promise<void>;
}

export interface RegistrationGenerationStorageDependencies {
  read: () => Promise<string | null>;
  write: (registrationGeneration: string) => Promise<void>;
}

export interface PushRegistrationGenerationLifecycle {
  generation: Promise<number>;
  isCurrent: () => boolean;
  dispose: () => void;
}

export interface PushRegistrationGenerationCoordinator {
  beginLifecycle: () => PushRegistrationGenerationLifecycle;
  captureAndInvalidateCurrent: () => Promise<number | null>;
}

function supportedPlatform(value: string): PushNotificationPlatform | null {
  return value === 'ios' || value === 'android' ? value : null;
}

function assertRegistrationGeneration(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Push notification registration generation must be a positive integer.');
  }
}

function parseStoredRegistrationGeneration(value: string | null): number | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (!/^[1-9]\d*$/.test(normalized)) {
    throw new Error('Stored push notification registration generation is invalid.');
  }
  const parsed = Number(normalized);
  assertRegistrationGeneration(parsed);
  return parsed;
}

export async function readPersistedRegistrationGeneration(
  dependencies: RegistrationGenerationStorageDependencies,
): Promise<number | null> {
  return parseStoredRegistrationGeneration(await dependencies.read());
}

export async function incrementPersistedRegistrationGeneration(
  dependencies: RegistrationGenerationStorageDependencies,
): Promise<number> {
  const current = await readPersistedRegistrationGeneration(dependencies);
  const next = (current ?? 0) + 1;
  assertRegistrationGeneration(next);
  await dependencies.write(String(next));
  return next;
}

export function createPushRegistrationGenerationCoordinator(
  dependencies: RegistrationGenerationStorageDependencies,
): PushRegistrationGenerationCoordinator {
  let storageQueue: Promise<void> = Promise.resolve();
  let currentLifecycle: {
    id: number;
    generation: Promise<number>;
  } | null = null;
  let nextLifecycleId = 0;

  const enqueueStorage = <T,>(operation: () => Promise<T>): Promise<T> => {
    const result = storageQueue.then(operation, operation);
    storageQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    beginLifecycle: () => {
      const id = ++nextLifecycleId;
      const generation = enqueueStorage(
        () => incrementPersistedRegistrationGeneration(dependencies),
      );
      // A lifecycle can start while the app is backgrounded, before refresh awaits
      // this promise. Attach a handler now so a storage error is never unhandled.
      void generation.catch(() => {});
      currentLifecycle = { id, generation };

      return {
        generation,
        isCurrent: () => currentLifecycle?.id === id,
        dispose: () => {
          if (currentLifecycle?.id === id) currentLifecycle = null;
        },
      };
    },
    captureAndInvalidateCurrent: () => {
      const generation = currentLifecycle?.generation ?? enqueueStorage(
        () => readPersistedRegistrationGeneration(dependencies),
      );
      currentLifecycle = null;
      return generation;
    },
  };
}

export function buildNotificationDeviceDeletePath(
  deviceId: string,
  registrationGeneration: number,
): string {
  assertRegistrationGeneration(registrationGeneration);
  return `/v1/notifications/devices/${encodeURIComponent(deviceId)}?registrationGeneration=${
    encodeURIComponent(String(registrationGeneration))
  }`;
}

export function resolvePushProjectId(
  expoConfigProjectId: unknown,
  easConfigProjectId: unknown,
): string | null {
  for (const value of [expoConfigProjectId, easConfigProjectId]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export async function getOrCreateStableDeviceId(
  dependencies: StableDeviceIdDependencies,
): Promise<string> {
  const existing = (await dependencies.read())?.trim();
  if (existing) return existing;

  const created = dependencies.create().trim();
  if (!created) throw new Error('A stable notification device ID could not be created.');
  await dependencies.write(created);
  return created;
}

export async function registerPushNotificationDevice(
  dependencies: PushNotificationRegistrationDependencies,
): Promise<PushNotificationRegistrationResult> {
  const platform = supportedPlatform(dependencies.platform);
  if (!platform) return 'unsupported-platform';

  const isCurrent = dependencies.isCurrent ?? (() => true);
  if (!isCurrent()) return 'cancelled';

  if (platform === 'android') {
    await dependencies.ensureAndroidChannel();
  }
  if (!isCurrent()) return 'cancelled';

  if (!dependencies.isPhysicalDevice) return 'simulator';

  let permissionStatus = await dependencies.getPermissionStatus();
  if (permissionStatus !== 'granted') {
    permissionStatus = await dependencies.requestPermission();
  }
  if (permissionStatus !== 'granted') return 'permission-denied';
  if (!isCurrent()) return 'cancelled';

  const projectId = dependencies.projectId?.trim();
  if (!projectId) return 'missing-project-id';
  assertRegistrationGeneration(dependencies.registrationGeneration);

  const expoPushToken = await dependencies.getExpoPushToken({
    projectId,
    ...(dependencies.devicePushToken === undefined
      ? {}
      : { devicePushToken: dependencies.devicePushToken }),
  });
  if (!isCurrent()) return 'cancelled';

  const deviceId = await dependencies.getOrCreateDeviceId();
  if (!isCurrent()) return 'cancelled';

  await dependencies.registerDevice(deviceId, {
    expoPushToken,
    platform,
    projectId,
    registrationGeneration: dependencies.registrationGeneration,
  });
  return 'registered';
}

export async function unregisterExistingPushNotificationDevice(
  dependencies: PushNotificationUnregistrationDependencies,
): Promise<boolean> {
  const deviceId = (await dependencies.readDeviceId())?.trim();
  if (!deviceId) return false;
  const registrationGeneration = await dependencies.readRegistrationGeneration();
  if (registrationGeneration === null) return false;
  assertRegistrationGeneration(registrationGeneration);
  await dependencies.unregisterDevice(deviceId, registrationGeneration);
  return true;
}
