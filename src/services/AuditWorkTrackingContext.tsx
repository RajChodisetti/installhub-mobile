import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { useAuth } from '../context/AppProviders';
import { getStore, subscribeStore } from '../data/seed';
import { createId } from '../utils';
import { getActiveTimeOutboxStore } from './activeTimeOutbox';
import {
  createAuditWorkTracker,
  focusedAuditInstallationId,
  type AuditWorkTracker,
  type FocusedAuditRoute,
} from './auditWorkTrackingPolicy';
import { registerAuditWorkTrackingRuntime } from './auditWorkTrackingBridge';
import { syncActiveTimeSessions } from './activeTimeSync';

const CHECKPOINT_INTERVAL_MS = 15_000;

interface AuditWorkTrackingContextValue {
  setFocusedRoute(route: FocusedAuditRoute | undefined): void;
}

const AuditWorkTrackingContext = createContext<AuditWorkTrackingContextValue>({
  setFocusedRoute: () => {},
});

function localServerParentIsConfirmed(installationId: string): boolean {
  try {
    const installation = getStore().installations.find((item) => item.id === installationId);
    return Boolean(
      installation?.cloud_backup_enabled
      && installation.assigned_work_state !== 'inactive'
      && Number.isSafeInteger(installation.server_tree_revision)
      && Number(installation.server_tree_revision) >= 0,
    );
  } catch {
    return false;
  }
}

export function AuditWorkTrackingProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const actorUserId = useRef<string | null>(user?.id ?? null);
  const focusedInstallationId = useRef<string | null>(null);
  const appState = useRef<AppStateStatus | null>(AppState.currentState);
  const windowFocused = useRef(true);
  const suspendedInstallations = useRef(new Set<string>());

  const trackerRef = useRef<AuditWorkTracker | null>(null);
  if (!trackerRef.current) {
    trackerRef.current = createAuditWorkTracker({
      createSessionId: () => createId('active_time'),
      monotonicNow: () => (
        typeof globalThis.performance?.now === 'function'
          ? globalThis.performance.now()
          : Date.now()
      ),
      wallTimeNow: () => new Date().toISOString(),
      persist: async (checkpoint) => {
        const outbox = await getActiveTimeOutboxStore();
        await outbox.save(
          checkpoint,
          localServerParentIsConfirmed(checkpoint.installationId),
        );
      },
      onPersisted: (checkpoint) => {
        void syncActiveTimeSessions(checkpoint.actorUserId);
      },
    });
  }
  const tracker = trackerRef.current;

  const applyEligibility = useCallback(() => {
    const installationId = focusedInstallationId.current;
    let installationIsDraft = false;
    if (installationId) {
      try {
        installationIsDraft = getStore().installations.some(
          (item) => item.id === installationId
            && item.status === 'Draft'
            && item.assigned_work_state !== 'inactive',
        );
      } catch {
        installationIsDraft = false;
      }
    }
    return tracker.setEligibility({
      actorUserId: actorUserId.current,
      installationId,
      installationIsDraft,
      appIsActive: appState.current === 'active',
      windowIsFocused: Platform.OS !== 'android' || windowFocused.current,
      suspended: Boolean(
        installationId && suspendedInstallations.current.has(installationId),
      ),
    });
  }, [tracker]);

  const setFocusedRoute = useCallback((route: FocusedAuditRoute | undefined) => {
    focusedInstallationId.current = focusedAuditInstallationId(route);
    void applyEligibility().catch(() => {});
  }, [applyEligibility]);

  useEffect(() => {
    const nextActorUserId = user?.id ?? null;
    if (actorUserId.current !== nextActorUserId) {
      actorUserId.current = nextActorUserId;
      suspendedInstallations.current.clear();
    }
    void (async () => {
      if (nextActorUserId) {
        const outbox = await getActiveTimeOutboxStore();
        await outbox.closeInterrupted(nextActorUserId);
      }
      await applyEligibility();
      if (nextActorUserId) await syncActiveTimeSessions(nextActorUserId);
    })().catch(() => {});
  }, [applyEligibility, user?.id]);

  useEffect(() => {
    const change = AppState.addEventListener('change', (next: AppStateStatus) => {
      appState.current = next;
      void applyEligibility().catch(() => {});
      if (next === 'active' && actorUserId.current) {
        void syncActiveTimeSessions(actorUserId.current);
      }
    });
    const focus = Platform.OS === 'android'
      ? AppState.addEventListener('focus', () => {
          windowFocused.current = true;
          void applyEligibility().catch(() => {});
          if (actorUserId.current) void syncActiveTimeSessions(actorUserId.current);
        })
      : null;
    const blur = Platform.OS === 'android'
      ? AppState.addEventListener('blur', () => {
          windowFocused.current = false;
          void applyEligibility().catch(() => {});
        })
      : null;
    return () => {
      change.remove();
      focus?.remove();
      blur?.remove();
    };
  }, [applyEligibility]);

  useEffect(() => subscribeStore(() => {
    void applyEligibility().catch(() => {});
  }), [applyEligibility]);

  useEffect(() => {
    const interval = setInterval(() => {
      void tracker.checkpoint().catch(() => {});
    }, CHECKPOINT_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [tracker]);

  useEffect(() => registerAuditWorkTrackingRuntime({
    async suspendInstallation(installationId) {
      suspendedInstallations.current.add(installationId);
      await applyEligibility();
      if (actorUserId.current) {
        const outbox = await getActiveTimeOutboxStore();
        await outbox.setServerParentConfirmed(
          actorUserId.current,
          installationId,
          localServerParentIsConfirmed(installationId),
        );
      }
      if (actorUserId.current) void syncActiveTimeSessions(actorUserId.current);
    },
    async resumeInstallation(installationId) {
      suspendedInstallations.current.delete(installationId);
      await applyEligibility();
    },
    async closeBeforeLogout() {
      const installationId = focusedInstallationId.current;
      if (installationId) suspendedInstallations.current.add(installationId);
      await applyEligibility();
      if (actorUserId.current) void syncActiveTimeSessions(actorUserId.current);
    },
  }), [applyEligibility]);

  useEffect(() => () => {
    void tracker.close().catch(() => {});
  }, [tracker]);

  const value = useMemo(() => ({ setFocusedRoute }), [setFocusedRoute]);
  return (
    <AuditWorkTrackingContext.Provider value={value}>
      {children}
    </AuditWorkTrackingContext.Provider>
  );
}

export function useAuditWorkTracking(): AuditWorkTrackingContextValue {
  return useContext(AuditWorkTrackingContext);
}
