import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { apiClient } from '../api/apiClient';
import {
  createPushRegistrationGenerationCoordinator,
  getOrCreateStableDeviceId,
  registerPushNotificationDevice,
  resolvePushProjectId,
  unregisterExistingPushNotificationDevice,
  type PushNotificationRegistrationResult,
} from './pushNotificationRegistration';

export const SCHEDULER_NOTIFICATION_CHANNEL_ID = 'scheduler';
export const PUSH_NOTIFICATION_DEVICE_ID_KEY = 'installhub.notifications.device-id.v1';
export const PUSH_NOTIFICATION_REGISTRATION_GENERATION_KEY =
  'installhub.notifications.registration-generation.v1';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function configuredProjectId(): string | null {
  const expoProjectId = Constants.expoConfig?.extra?.eas?.projectId;
  const easProjectId = Constants.easConfig?.projectId;
  return resolvePushProjectId(expoProjectId, easProjectId);
}

async function readStoredDeviceId(): Promise<string | null> {
  return SecureStore.getItemAsync(PUSH_NOTIFICATION_DEVICE_ID_KEY).catch(() => null);
}

let stableDeviceIdPromise: Promise<string> | null = null;

function stableDeviceId(): Promise<string> {
  if (!stableDeviceIdPromise) {
    stableDeviceIdPromise = getOrCreateStableDeviceId({
      read: readStoredDeviceId,
      write: (deviceId) => SecureStore.setItemAsync(
        PUSH_NOTIFICATION_DEVICE_ID_KEY,
        deviceId,
        { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
      ),
      create: Crypto.randomUUID,
    }).catch((error) => {
      stableDeviceIdPromise = null;
      throw error;
    });
  }
  return stableDeviceIdPromise;
}

const registrationGenerationCoordinator = createPushRegistrationGenerationCoordinator({
  read: () => SecureStore.getItemAsync(PUSH_NOTIFICATION_REGISTRATION_GENERATION_KEY),
  write: (registrationGeneration) => SecureStore.setItemAsync(
    PUSH_NOTIFICATION_REGISTRATION_GENERATION_KEY,
    registrationGeneration,
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  ),
});

async function ensureSchedulerAndroidChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync(SCHEDULER_NOTIFICATION_CHANNEL_ID, {
    name: 'Scheduled work',
    description: 'New and updated Field App Complete work assignments.',
    importance: Notifications.AndroidImportance.HIGH,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    enableVibrate: true,
    showBadge: true,
  });
}

let registrationQueue: Promise<void> = Promise.resolve();
let activeRegistrationAbortController: AbortController | null = null;

const REGISTRATION_QUEUE_LOGOUT_WAIT_MS = 750;
const DEVICE_DELETE_LOGOUT_WAIT_MS = 2_000;

function enqueueRegistration<T>(operation: () => Promise<T>): Promise<T> {
  const result = registrationQueue.then(operation, operation);
  registrationQueue = result.then(() => undefined, () => undefined);
  return result;
}

export interface AuthenticatedPushNotificationSession {
  refresh: (
    devicePushToken?: Notifications.DevicePushToken,
  ) => Promise<PushNotificationRegistrationResult>;
  dispose: () => void;
}

export function beginAuthenticatedPushNotificationSession(): AuthenticatedPushNotificationSession {
  const lifecycle = registrationGenerationCoordinator.beginLifecycle();
  const isCurrent = lifecycle.isCurrent;
  let registered = false;

  return {
    refresh: (devicePushToken) => enqueueRegistration(async () => {
      if (devicePushToken !== undefined) registered = false;
      if (registered && devicePushToken === undefined) return 'registered';
      if (!isCurrent()) return 'cancelled';

      const registrationGeneration = await lifecycle.generation;
      if (!isCurrent()) return 'cancelled';

      const abortController = new AbortController();
      activeRegistrationAbortController = abortController;
      try {
        const result = await registerPushNotificationDevice({
          platform: Platform.OS,
          isPhysicalDevice: Device.isDevice,
          projectId: configuredProjectId(),
          registrationGeneration,
          devicePushToken,
          isCurrent,
          ensureAndroidChannel: ensureSchedulerAndroidChannel,
          getPermissionStatus: async () => (await Notifications.getPermissionsAsync()).status,
          requestPermission: async () => (await Notifications.requestPermissionsAsync()).status,
          getExpoPushToken: async (input) => {
            const token = await Notifications.getExpoPushTokenAsync({
              projectId: input.projectId,
              ...(input.devicePushToken === undefined
                ? {}
                : { devicePushToken: input.devicePushToken as Notifications.DevicePushToken }),
            });
            return token.data;
          },
          getOrCreateDeviceId: stableDeviceId,
          registerDevice: async (deviceId, input) => {
            await apiClient.putNotificationDevice(deviceId, input, abortController.signal);
          },
        });
        if (result === 'registered') registered = true;
        return result;
      } finally {
        if (activeRegistrationAbortController === abortController) {
          activeRegistrationAbortController = null;
        }
      }
    }),
    dispose: lifecycle.dispose,
  };
}

function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error('Push notification cleanup timed out.'));
    }, timeoutMs);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function listenForPushTokenRotation(
  listener: (devicePushToken: Notifications.DevicePushToken) => void,
): () => void {
  const subscription = Notifications.addPushTokenListener(listener);
  return () => subscription.remove();
}

export async function unregisterPushDeviceBeforeLogout(): Promise<void> {
  const registrationGeneration =
    registrationGenerationCoordinator.captureAndInvalidateCurrent();
  activeRegistrationAbortController?.abort();
  await withTimeout(registrationQueue, REGISTRATION_QUEUE_LOGOUT_WAIT_MS).catch(() => {});

  const deleteAbortController = new AbortController();
  await withTimeout(
    unregisterExistingPushNotificationDevice({
      readDeviceId: readStoredDeviceId,
      readRegistrationGeneration: () => registrationGeneration,
      unregisterDevice: async (deviceId, generation) => {
        await apiClient.deleteNotificationDevice(
          deviceId,
          generation,
          deleteAbortController.signal,
        );
      },
    }),
    DEVICE_DELETE_LOGOUT_WAIT_MS,
    () => deleteAbortController.abort(),
  );
}
