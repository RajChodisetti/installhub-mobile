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
import {
  auditWorkIsSuspendedForActor,
  discardAuditWorkSuspensionsForOtherActors,
  registerAuditWorkSuspension,
  resumeAuditWorkSuspensionsByReasonForAuthority,
  resumeSuspendedAuditWorkForAuthority,
  suspendAuditWorkForAuthority,
  type AuditWorkResumeAuthority,
  type AuditWorkSuspensionRegistry,
} from './auditWorkTrackingResume';
import { syncActiveTimeSessions } from './activeTimeSync';
import { installationAllowsActiveWorkTracking } from './assignedWorkPrestart';
import { assignedWorkInstallationIsVisibleToActor } from './assignedWorkPolicy';

const CHECKPOINT_INTERVAL_MS = 15_000;

interface AuditWorkTrackingContextValue {
  setFocusedRoute(route: FocusedAuditRoute | undefined): void;
}

const AuditWorkTrackingContext = createContext<AuditWorkTrackingContextValue>({
  setFocusedRoute: () => {},
});

function localInstallationVisibleToActor(
  installationId: string,
  actorUserId: string,
) {
  try {
    const installation = getStore().installations.find((item) => item.id === installationId);
    return installation
      && assignedWorkInstallationIsVisibleToActor(installation, actorUserId)
      ? installation
      : null;
  } catch {
    return null;
  }
}

function localServerParentIsConfirmed(
  installationId: string,
  actorUserId: string,
): boolean {
  const installation = localInstallationVisibleToActor(installationId, actorUserId);
  return Boolean(
    installation?.cloud_backup_enabled
    && Number.isSafeInteger(installation.server_tree_revision)
    && Number(installation.server_tree_revision) >= 0,
  );
}

export function AuditWorkTrackingProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const actorUserId = useRef<string | null>(user?.id ?? null);
  const focusedInstallationId = useRef<string | null>(null);
  const appState = useRef<AppStateStatus | null>(AppState.currentState);
  const windowFocused = useRef(true);
  const suspendedInstallations = useRef<AuditWorkSuspensionRegistry>(new Map());

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
        if (!localInstallationVisibleToActor(
          checkpoint.installationId,
          checkpoint.actorUserId,
        )) return;
        const outbox = await getActiveTimeOutboxStore();
        await outbox.save(
          checkpoint,
          localServerParentIsConfirmed(
            checkpoint.installationId,
            checkpoint.actorUserId,
          ),
        );
      },
      onPersisted: (checkpoint) => {
        void syncActiveTimeSessions(checkpoint.actorUserId);
      },
    });
  }
  const tracker = trackerRef.current;

  const applyEligibility = useCallback(() => {
    const eligibilityActorUserId = actorUserId.current;
    const installationId = focusedInstallationId.current;
    let installationIsDraft = false;
    if (installationId && eligibilityActorUserId) {
      try {
        const installation = localInstallationVisibleToActor(
          installationId,
          eligibilityActorUserId,
        );
        installationIsDraft = Boolean(
          installation
          && installationAllowsActiveWorkTracking(
            installation,
            eligibilityActorUserId,
          ),
        );
      } catch {
        installationIsDraft = false;
      }
    }
    return tracker.setEligibility({
      actorUserId: eligibilityActorUserId,
      installationId,
      installationIsDraft,
      appIsActive: appState.current === 'active',
      windowIsFocused: Platform.OS !== 'android' || windowFocused.current,
      suspended: auditWorkIsSuspendedForActor(
        suspendedInstallations.current,
        installationId,
        actorUserId.current,
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
      discardAuditWorkSuspensionsForOtherActors(
        suspendedInstallations.current,
        nextActorUserId,
      );
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
    async suspendInstallation(installationId, suppliedAuthority, reason) {
      const actorAtStart = actorUserId.current;
      if (!actorAtStart) return null;
      const authority: AuditWorkResumeAuthority = suppliedAuthority ?? {
        actorUserId: actorAtStart,
        isCurrent: () => actorUserId.current === actorAtStart,
      };
      const token = await suspendAuditWorkForAuthority(
        suspendedInstallations.current,
        installationId,
        authority,
        () => actorUserId.current,
        () => createId('audit_suspend'),
        applyEligibility,
        reason,
      );
      if (!token) return null;
      if (authority.isCurrent() && actorUserId.current === actorAtStart) {
        const outbox = await getActiveTimeOutboxStore();
        if (!authority.isCurrent() || actorUserId.current !== actorAtStart) {
          suspendedInstallations.current.delete(token.tokenId);
          await applyEligibility().catch(() => undefined);
          return null;
        }
        await outbox.setServerParentConfirmed(
          actorAtStart,
          installationId,
          localServerParentIsConfirmed(installationId, actorAtStart),
        );
      }
      if (!authority.isCurrent() || actorUserId.current !== actorAtStart) {
        suspendedInstallations.current.delete(token.tokenId);
        await applyEligibility().catch(() => undefined);
        return null;
      }
      void syncActiveTimeSessions(actorAtStart);
      return token;
    },
    async resumeInstallation(target, authority) {
      if (!authority) return false;
      return resumeSuspendedAuditWorkForAuthority(
        suspendedInstallations.current,
        target,
        authority,
        () => actorUserId.current,
        applyEligibility,
      );
    },
    async resumeInstallationReasons(installationId, reasons, authority) {
      return resumeAuditWorkSuspensionsByReasonForAuthority(
        suspendedInstallations.current,
        installationId,
        reasons,
        authority,
        () => actorUserId.current,
        applyEligibility,
      );
    },
    async closeBeforeLogout() {
      const installationId = focusedInstallationId.current;
      if (installationId && actorUserId.current) {
        registerAuditWorkSuspension(
          suspendedInstallations.current,
          installationId,
          actorUserId.current,
          createId('audit_logout'),
          'logout',
        );
      }
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
