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
  cloudConnectionErrorMessage,
  hasStoredCloudSession,
} from '../api/apiClient';
import { runCloudBackup, type SyncProgress } from './syncService';
import { resetFailedUploadsForRetry, syncAssignedInstallations } from '../repositories';
import { runThumbnailDownloadWorker } from './thumbnailCache';
import { syncActiveTimeSessions } from './activeTimeSync';

const LAST_SYNCED_KEY = 'ih_last_synced_at';
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

export function useSyncStatus(): SyncStatusValue {
  return useContext(SyncStatusContext);
}

export function SyncStatusProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<SyncProgress>(defaultProgress);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const activeSync = useRef<Promise<SyncProgress> | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync(LAST_SYNCED_KEY)
      .then(setLastSyncedAt)
      .catch(() => {});
  }, []);

  const triggerSync = useCallback(async () => {
    if (activeSync.current) return activeSync.current;
    const operation = (async () => {
      if (!user || !await hasStoredCloudSession()) return defaultProgress;
      setSyncing(true);
      try {
        let assignmentError: unknown;
        try {
          await syncAssignedInstallations(user.id);
        } catch (error) {
          assignmentError = error;
        }
        const result = await runCloudBackup(setProgress);
        void syncActiveTimeSessions(user.id);
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
          setLastSyncedAt(now);
          await SecureStore.setItemAsync(LAST_SYNCED_KEY, now);
        }
        return result;
      } finally {
        setSyncing(false);
      }
    })();
    activeSync.current = operation;
    try {
      return await operation;
    } finally {
      activeSync.current = null;
    }
  }, [user]);

  const retrySync = useCallback(async () => {
    await resetFailedUploadsForRetry();
    return triggerSync();
  }, [triggerSync]);

  useEffect(() => {
    if (!user) return undefined;
    void runThumbnailDownloadWorker();
    void triggerSync();
    const appState = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void runThumbnailDownloadWorker();
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
