import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../context/AppProviders';
import { getStore, subscribeStore } from '../data/seed';
import {
  NetworkError,
  assertCurrentCloudSessionAuthority,
  captureCloudSessionAuthority,
  cloudConnectionErrorMessage,
} from '../api/apiClient';
import {
  runCloudBackup,
  type CloudBackupRunAuthority,
  type SyncProgress,
} from './syncService';
import { resetFailedUploadsForRetry, syncAssignedInstallations } from '../repositories';
import { runThumbnailDownloadWorker } from './thumbnailCache';
import { captureAuthenticatedCloudActionLease } from './authenticatedCloudAction';
import { syncActiveTimeSessions } from './activeTimeSync';
import {
  actorForCurrentAssignedWorkAuthority,
  assertCurrentAssignedWorkAuthority,
  captureAssignedWorkMutationAuthority,
  type AssignedWorkMutationAuthority,
} from './assignedWorkMutationGuard';
import { lastSyncedAtSecureStoreKey, lastConfirmedBackupAtSecureStoreKey } from './syncStatusStorage';
import { shouldRecordConfirmedBackup } from './backupOutcome';
import { captureForegroundRejectedMetadataRetry, type ForegroundRejectedMetadataRetry } from './foregroundRejectedMetadataRetry';
import { listenForInstallHubSchedulerNotifications } from './schedulerNotificationRefresh';

const defaultProgress: SyncProgress = {
  phase: 'idle',
  uploaded: 0,
  total: 0,
  failedCount: 0,
};

interface SyncStatusValue {
  syncing: boolean;
  progress: SyncProgress;
  lastSyncedAt: string | null;
  lastConfirmedBackupAt: string | null;
  triggerSync: () => Promise<SyncProgress>;
  triggerSyncAfterServerChange: (installationId?: string) => Promise<SyncProgress>;
  retrySync: () => Promise<SyncProgress>;
}

const SyncStatusContext = createContext<SyncStatusValue>({
  syncing: false,
  progress: defaultProgress,
  lastSyncedAt: null,
  lastConfirmedBackupAt: null,
  triggerSync: async () => defaultProgress,
  triggerSyncAfterServerChange: async () => defaultProgress,
  retrySync: async () => defaultProgress,
});

type AuthenticatedSyncFlight = {
  actorUserId: string;
  authority: AssignedWorkMutationAuthority;
  promise: Promise<SyncProgress>;
};

type AutomaticSyncScope = Pick<
  AuthenticatedSyncFlight,
  'actorUserId' | 'authority'
> & { installationId?: string };

type TrailingServerChangeSync = AutomaticSyncScope & {
  after: AuthenticatedSyncFlight;
  promise: Promise<SyncProgress>;
};

export function useSyncStatus(): SyncStatusValue {
  return useContext(SyncStatusContext);
}

export function SyncStatusProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress>(defaultProgress);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [lastConfirmedBackupAt, setLastConfirmedBackupAt] = useState<string | null>(null);
  const activeSync = useRef<AuthenticatedSyncFlight | null>(null);
  const trailingServerChangeSync = useRef<TrailingServerChangeSync | null>(null);

  useEffect(() => {
    const actorUserId = user?.id;
    let current = true;
    setLastSyncedAt(null);
    setLastConfirmedBackupAt(null);
    setProgress(defaultProgress);
    if (!actorUserId) return () => { current = false; };
    Promise.all([
      SecureStore.getItemAsync(lastSyncedAtSecureStoreKey(actorUserId)),
      SecureStore.getItemAsync(lastConfirmedBackupAtSecureStoreKey(actorUserId)),
    ]).then(([checkedAt, confirmedAt]) => {
        if (current && user?.id === actorUserId) {
          setLastSyncedAt((latest) => latest && (!checkedAt || latest > checkedAt) ? latest : checkedAt);
          setLastConfirmedBackupAt((latest) => latest && (!confirmedAt || latest > confirmedAt) ? latest : confirmedAt);
        }
      })
      .catch(() => {});
    return () => { current = false; };
  }, [user?.id]);

  const startSync = useCallback((foreground?: {
    actorUserId: string;
    authority: AssignedWorkMutationAuthority;
    descriptor: ForegroundRejectedMetadataRetry;
  }, automaticScope?: AutomaticSyncScope): Promise<SyncProgress> => {
    const actorUserId = foreground?.actorUserId ?? automaticScope?.actorUserId ?? user?.id;
    if (!actorUserId) return Promise.resolve(defaultProgress);
    const authority = foreground?.authority
      ?? automaticScope?.authority
      ?? captureAssignedWorkMutationAuthority();
    try {
      assertCurrentAssignedWorkAuthority(authority, actorUserId);
    } catch {
      return Promise.resolve(defaultProgress);
    }
    const currentFlight = activeSync.current;
    if (
      !foreground && !automaticScope && currentFlight
      && currentFlight.actorUserId === actorUserId
      && actorForCurrentAssignedWorkAuthority(currentFlight.authority) === actorUserId
    ) {
      return currentFlight.promise;
    }
    const priorFlight = currentFlight?.promise;
    let flight: AuthenticatedSyncFlight | null = null;
    const operation = (async () => {
      try {
        // A manual retry never joins an automatic flight: its click-time scope
        // must reach its own run. A different login likewise waits, then proves
        // its exact initiating authority again before any work.
        if (priorFlight) await priorFlight.catch(() => undefined);
        assertCurrentAssignedWorkAuthority(authority, actorUserId);
        const cloudAuthority = await captureCloudSessionAuthority();
        assertCurrentAssignedWorkAuthority(authority, actorUserId);
        if (!cloudAuthority) return defaultProgress;
        assertCurrentCloudSessionAuthority(cloudAuthority, actorUserId);
        if (foreground) {
          await resetFailedUploadsForRetry(actorUserId);
          assertCurrentAssignedWorkAuthority(authority, actorUserId);
          assertCurrentCloudSessionAuthority(cloudAuthority, actorUserId);
        }
        let assignmentError: unknown;
        const backupAuthority: CloudBackupRunAuthority = {
          identity: foreground?.descriptor ?? authority,
          rejectedMetadataRetry: foreground?.descriptor,
          actorUserId,
          cloudAuthority,
          assignedWorkAuthority: authority,
          assertAdditionalAuthority: () => {
            assertCurrentAssignedWorkAuthority(authority, actorUserId);
          },
          beforeNewBackups: async () => {
            try {
              await syncAssignedInstallations(
                actorUserId,
                cloudAuthority,
                automaticScope?.installationId,
              );
            }
            catch (error) { assignmentError = error; }
            assertCurrentAssignedWorkAuthority(authority, actorUserId);
            assertCurrentCloudSessionAuthority(cloudAuthority, actorUserId);
          },
        };
        setSyncing(true);
        // Durable metadata/final requests recover inside the single-flight
        // before ordinary assignment refresh can compare an old local base.
        assertCurrentAssignedWorkAuthority(authority, actorUserId);
        const result = await runCloudBackup(
          (nextProgress) => {
            if (
              actorForCurrentAssignedWorkAuthority(authority) === actorUserId
            ) {
              setProgress(nextProgress);
            }
          },
          backupAuthority,
        );
        assertCurrentAssignedWorkAuthority(authority, actorUserId);
        assertCurrentCloudSessionAuthority(cloudAuthority, actorUserId);
        void syncActiveTimeSessions(actorUserId, cloudAuthority);
        if (assignmentError && result.phase === 'done') {
          const assignmentProgress: SyncProgress = {
            phase: assignmentError instanceof NetworkError ? 'offline' : 'error',
            uploaded: result.uploaded,
            total: result.total,
            failedCount: result.failedCount,
            lastError: cloudConnectionErrorMessage(assignmentError),
          };
          setProgress(assignmentProgress);
          return assignmentProgress;
        }
        if (result.phase === 'done') {
          const now = new Date().toISOString();
          await SecureStore.setItemAsync(lastSyncedAtSecureStoreKey(actorUserId), now);
          assertCurrentAssignedWorkAuthority(authority, actorUserId);
          assertCurrentCloudSessionAuthority(cloudAuthority, actorUserId);
          setLastSyncedAt(now);
          if (shouldRecordConfirmedBackup(result)) {
            await SecureStore.setItemAsync(lastConfirmedBackupAtSecureStoreKey(actorUserId), now);
            assertCurrentAssignedWorkAuthority(authority, actorUserId);
            assertCurrentCloudSessionAuthority(cloudAuthority, actorUserId);
            setLastConfirmedBackupAt(now);
          }
        }
        return result;
      } catch (error) {
        const failed: SyncProgress = {
          phase: 'error',
          uploaded: 0,
          total: 0,
          failedCount: 0,
          lastError: cloudConnectionErrorMessage(error),
        };
        if (actorForCurrentAssignedWorkAuthority(authority) === actorUserId) {
          setProgress(failed);
        }
        return failed;
      } finally {
        if (flight && activeSync.current === flight) setSyncing(false);
      }
    })();
    flight = { actorUserId, authority, promise: operation };
    activeSync.current = flight;
    void operation.finally(() => {
      if (flight && activeSync.current === flight) activeSync.current = null;
    });
    return operation;
  }, [user?.id]);

  // Automatic callers cannot supply a foreground descriptor.
  const triggerSync = useCallback(() => startSync(), [startSync]);

  // A server-change signal must not merely join a pull that may already have
  // captured older server state. Coalesce one actor-fenced follow-up run behind
  // that exact flight while preserving the normal backup-recovery-before-pull
  // sequence inside startSync.
  const triggerSyncAfterServerChange = useCallback((installationId?: string): Promise<SyncProgress> => {
    const actorUserId = user?.id;
    if (!actorUserId) return Promise.resolve(defaultProgress);
    const authority = captureAssignedWorkMutationAuthority();
    try {
      assertCurrentAssignedWorkAuthority(authority, actorUserId);
    } catch {
      return Promise.resolve(defaultProgress);
    }
    const scope = { actorUserId, authority, installationId };
    const currentFlight = activeSync.current;
    if (!currentFlight) return startSync(undefined, scope);

    const queued = trailingServerChangeSync.current;
    if (
      queued
      && queued.after === currentFlight
      && queued.actorUserId === actorUserId
      && queued.installationId === installationId
      && actorForCurrentAssignedWorkAuthority(queued.authority) === actorUserId
    ) {
      return queued.promise;
    }

    let trailing: TrailingServerChangeSync;
    const startAfterCurrent = () => startSync(undefined, scope);
    const promise = currentFlight.promise
      .then(startAfterCurrent, startAfterCurrent)
      .finally(() => {
        if (trailingServerChangeSync.current === trailing) {
          trailingServerChangeSync.current = null;
        }
      });
    trailing = { ...scope, after: currentFlight, promise };
    trailingServerChangeSync.current = trailing;
    return promise;
  }, [startSync, user?.id]);

  const retrySync = useCallback(async (): Promise<SyncProgress> => {
    const actorUserId = user?.id;
    let authority: AssignedWorkMutationAuthority | undefined;
    try {
      if (!actorUserId) throw new Error('Sign in again before retrying Cloud Backup.');
      authority = captureAssignedWorkMutationAuthority();
      assertCurrentAssignedWorkAuthority(authority, actorUserId);
      // Capture the exact actor-owned, opted-in rejected records before ANY await.
      const descriptor = captureForegroundRejectedMetadataRetry(getStore(), actorUserId);
      assertCurrentAssignedWorkAuthority(authority, actorUserId);
      return startSync({ actorUserId, authority, descriptor });
    } catch (error) {
      const failed: SyncProgress = {
        phase: 'error', uploaded: 0, total: 0, failedCount: 0,
        lastError: cloudConnectionErrorMessage(error),
      };
      // A stale callback resolves safely but cannot publish into another login.
      if (actorUserId && authority && actorForCurrentAssignedWorkAuthority(authority) === actorUserId) setProgress(failed);
      return failed;
    }
  }, [startSync, user?.id]);

  useEffect(() => {
    if (!user) return undefined;
    const thumbnailActorUserId = user.id;
    const triggerThumbnailWorker = () => {
      const leasePromise = captureAuthenticatedCloudActionLease();
      void leasePromise.then((lease) => {
        if (lease.actorUserId !== thumbnailActorUserId) return;
        lease.assertCurrent();
        return runThumbnailDownloadWorker(lease);
      }).catch(() => {});
    };
    triggerThumbnailWorker();
    void triggerSync();
    const appState = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        triggerThumbnailWorker();
        void triggerSync();
      }
    });
    const interval = setInterval(() => void triggerSync(), 15 * 60 * 1000);
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeStore(() => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void triggerSync(), 5_000);
    });
    return () => {
      appState.remove();
      clearInterval(interval);
      if (debounce) clearTimeout(debounce);
      unsubscribe();
    };
  }, [triggerSync, user]);

  useEffect(() => {
    if (!user) return undefined;
    return listenForInstallHubSchedulerNotifications({
      addNotificationReceivedListener: (listener) => (
        Notifications.addNotificationReceivedListener(listener)
      ),
      addNotificationResponseReceivedListener: (listener) => (
        Notifications.addNotificationResponseReceivedListener(listener)
      ),
      getLastNotificationResponse: () => Notifications.getLastNotificationResponseAsync(),
      clearLastNotificationResponse: () => Notifications.clearLastNotificationResponseAsync(),
    }, (notification) => {
      void triggerSyncAfterServerChange(notification.sourceId);
    });
  }, [triggerSyncAfterServerChange, user?.id]);

  useEffect(() => {
    if (progress.phase !== 'offline') return undefined;
    const retry = setInterval(() => void triggerSync(), 30_000);
    return () => clearInterval(retry);
  }, [progress.phase, triggerSync]);

  return (
    <SyncStatusContext.Provider value={{
      syncing,
      progress,
      lastSyncedAt,
      lastConfirmedBackupAt,
      triggerSync,
      triggerSyncAfterServerChange,
      retrySync,
    }}>
      {children}
    </SyncStatusContext.Provider>
  );
}
