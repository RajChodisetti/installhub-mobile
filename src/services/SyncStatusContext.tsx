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
import { useAuth } from '../context/AppProviders';
import { subscribeStore } from '../data/seed';
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

const lastSyncedKey = (actorUserId: string) => `ih_last_synced_at:${actorUserId}`;
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
  triggerSync: () => Promise<SyncProgress>;
  retrySync: () => Promise<SyncProgress>;
}

const SyncStatusContext = createContext<SyncStatusValue>({
  syncing: false,
  progress: defaultProgress,
  lastSyncedAt: null,
  triggerSync: async () => defaultProgress,
  retrySync: async () => defaultProgress,
});

type AuthenticatedSyncFlight = {
  actorUserId: string;
  authority: AssignedWorkMutationAuthority;
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
  const activeSync = useRef<AuthenticatedSyncFlight | null>(null);

  useEffect(() => {
    const actorUserId = user?.id;
    let current = true;
    setLastSyncedAt(null);
    setProgress(defaultProgress);
    if (!actorUserId) return () => { current = false; };
    SecureStore.getItemAsync(lastSyncedKey(actorUserId))
      .then((value) => {
        if (current && user?.id === actorUserId) setLastSyncedAt(value);
      })
      .catch(() => {});
    return () => { current = false; };
  }, [user?.id]);

  const triggerSync = useCallback((): Promise<SyncProgress> => {
    const actorUserId = user?.id;
    if (!actorUserId) return Promise.resolve(defaultProgress);
    const authority = captureAssignedWorkMutationAuthority();
    try {
      assertCurrentAssignedWorkAuthority(authority, actorUserId);
    } catch {
      return Promise.resolve(defaultProgress);
    }
    const currentFlight = activeSync.current;
    if (
      currentFlight
      && currentFlight.actorUserId === actorUserId
      && actorForCurrentAssignedWorkAuthority(currentFlight.authority) === actorUserId
    ) {
      return currentFlight.promise;
    }
    const priorFlight = currentFlight?.promise;
    let flight: AuthenticatedSyncFlight | null = null;
    const operation = (async () => {
      try {
        // A new login never joins work started by an older auth generation. Wait
        // for that stale flight to unwind before touching the process-wide backup
        // single-flight, then authenticate this exact actor generation again.
        if (priorFlight) await priorFlight.catch(() => undefined);
        assertCurrentAssignedWorkAuthority(authority, actorUserId);
        const cloudAuthority = await captureCloudSessionAuthority();
        assertCurrentAssignedWorkAuthority(authority, actorUserId);
        if (!cloudAuthority) return defaultProgress;
        assertCurrentCloudSessionAuthority(cloudAuthority, actorUserId);
        const backupAuthority: CloudBackupRunAuthority = {
          identity: authority,
          actorUserId,
          cloudAuthority,
          assignedWorkAuthority: authority,
          assertAdditionalAuthority: () => {
            assertCurrentAssignedWorkAuthority(authority, actorUserId);
          },
        };
        setSyncing(true);
        let assignmentError: unknown;
        try {
          await syncAssignedInstallations(actorUserId, cloudAuthority);
        } catch (error) {
          assignmentError = error;
        }
        // A stale assignment pull must never fall through to Cloud Backup
        // after logout/login has replaced the authenticated API session.
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
          await SecureStore.setItemAsync(lastSyncedKey(actorUserId), now);
          assertCurrentAssignedWorkAuthority(authority, actorUserId);
          setLastSyncedAt(now);
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

  const retrySync = useCallback(async () => {
    const actorUserId = user?.id;
    if (!actorUserId) {
      throw new Error('Sign in again before retrying Cloud Backup.');
    }
    await resetFailedUploadsForRetry(actorUserId);
    return triggerSync();
  }, [triggerSync, user?.id]);

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
    if (progress.phase !== 'offline') return undefined;
    const retry = setInterval(() => void triggerSync(), 30_000);
    return () => clearInterval(retry);
  }, [progress.phase, triggerSync]);

  return (
    <SyncStatusContext.Provider value={{
      syncing,
      progress,
      lastSyncedAt,
      triggerSync,
      retrySync,
    }}>
      {children}
    </SyncStatusContext.Provider>
  );
}
