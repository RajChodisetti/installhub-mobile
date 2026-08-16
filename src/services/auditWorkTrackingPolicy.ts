export interface AuditWorkEligibility {
  actorUserId: string | null;
  installationId: string | null;
  installationIsDraft: boolean;
  appIsActive: boolean;
  windowIsFocused: boolean;
  suspended: boolean;
}

export interface AuditWorkSessionCheckpoint {
  sessionId: string;
  actorUserId: string;
  installationId: string;
  revision: number;
  activeMilliseconds: number;
  startedAt: string;
  lastActiveAt: string;
  endedAt: string | null;
}

export interface AuditWorkTracker {
  setEligibility(next: AuditWorkEligibility): Promise<void>;
  checkpoint(): Promise<void>;
  close(): Promise<void>;
}

export interface FocusedAuditRoute {
  name: string;
  params?: unknown;
}

const AUDIT_ROUTES = new Set([
  'InstallationForm',
  'InstallationDetail',
  'DeviceSearch',
  'ZoneWorkspace',
  'BoardDetail',
  'SiteAssetDetail',
  'MeterForm',
  'DataView',
  'MeteringTable',
  'InstallationReport',
  'ClientReport',
  'PhotoPreview',
  'FormsList',
  'FormTypePicker',
  'FormEditor',
  'InstallationAccess',
  'CloudStorage',
]);

export function focusedAuditInstallationId(
  route: FocusedAuditRoute | undefined,
): string | null {
  if (!route || !AUDIT_ROUTES.has(route.name)) return null;
  if (!route.params || typeof route.params !== 'object' || Array.isArray(route.params)) return null;
  const installationId = (route.params as { installationId?: unknown }).installationId;
  return typeof installationId === 'string' && installationId.trim()
    ? installationId
    : null;
}

interface TrackerInstant {
  monotonicMilliseconds: number;
  wallTime: string;
}

interface AuditWorkTrackerOptions {
  createSessionId: () => string;
  monotonicNow: () => number;
  wallTimeNow: () => string;
  persist: (checkpoint: AuditWorkSessionCheckpoint) => Promise<void>;
  onPersisted?: (checkpoint: AuditWorkSessionCheckpoint) => void;
}

const inactiveEligibility: AuditWorkEligibility = {
  actorUserId: null,
  installationId: null,
  installationIsDraft: false,
  appIsActive: false,
  windowIsFocused: false,
  suspended: false,
};

function eligible(input: AuditWorkEligibility): input is AuditWorkEligibility & {
  actorUserId: string;
  installationId: string;
} {
  return Boolean(
    input.actorUserId
    && input.installationId
    && input.installationIsDraft
    && input.appIsActive
    && input.windowIsFocused
    && !input.suspended,
  );
}

function sameSessionTarget(
  checkpoint: AuditWorkSessionCheckpoint,
  input: AuditWorkEligibility,
): boolean {
  return checkpoint.actorUserId === input.actorUserId
    && checkpoint.installationId === input.installationId;
}

export function createAuditWorkTracker({
  createSessionId,
  monotonicNow,
  wallTimeNow,
  persist,
  onPersisted,
}: AuditWorkTrackerOptions): AuditWorkTracker {
  let state = inactiveEligibility;
  let active: AuditWorkSessionCheckpoint | null = null;
  let lastMonotonicMilliseconds = 0;
  const pendingPersistence: AuditWorkSessionCheckpoint[] = [];
  let operationChain: Promise<void> = Promise.resolve();

  const captureInstant = (): TrackerInstant => ({
    monotonicMilliseconds: monotonicNow(),
    wallTime: wallTimeNow(),
  });

  const queue = (operation: () => Promise<void>): Promise<void> => {
    const queued = operationChain.then(operation, operation);
    operationChain = queued.catch(() => {});
    return queued;
  };

  const start = (input: AuditWorkEligibility & {
    actorUserId: string;
    installationId: string;
  }, instant: TrackerInstant) => {
    active = {
      sessionId: createSessionId(),
      actorUserId: input.actorUserId,
      installationId: input.installationId,
      revision: 0,
      activeMilliseconds: 0,
      startedAt: instant.wallTime,
      lastActiveAt: instant.wallTime,
      endedAt: null,
    };
    lastMonotonicMilliseconds = instant.monotonicMilliseconds;
  };

  const flushPendingPersistence = async () => {
    while (pendingPersistence.length > 0) {
      const checkpoint = pendingPersistence[0];
      await persist(checkpoint);
      onPersisted?.(checkpoint);
      pendingPersistence.shift();
    }
  };

  const persistAt = async (instant: TrackerInstant, close: boolean) => {
    if (!active) return;
    const delta = Math.max(
      0,
      Math.round(instant.monotonicMilliseconds - lastMonotonicMilliseconds),
    );
    const wallBoundary = Date.parse(instant.wallTime) >= Date.parse(active.lastActiveAt)
      ? instant.wallTime
      : active.lastActiveAt;
    const checkpoint: AuditWorkSessionCheckpoint = {
      ...active,
      revision: active.revision + 1,
      activeMilliseconds: active.activeMilliseconds + delta,
      lastActiveAt: wallBoundary,
      endedAt: close ? wallBoundary : null,
    };
    // Advance the in-memory boundary before persistence. A concurrently queued
    // lifecycle event can never count this same interval twice.
    active = close ? null : checkpoint;
    lastMonotonicMilliseconds = instant.monotonicMilliseconds;
    // Keep the exact captured boundary until durable storage accepts it. This
    // makes a transient storage failure retryable without ever inferring time
    // spent in the background or between routes.
    pendingPersistence.push(checkpoint);
    await flushPendingPersistence();
  };

  return {
    setEligibility(next) {
      const instant = captureInstant();
      return queue(async () => {
        const keepCurrent = Boolean(active && eligible(next) && sameSessionTarget(active, next));
        let persistenceError: unknown;
        let attemptedTransitionPersistence = false;
        if (active && !keepCurrent) {
          attemptedTransitionPersistence = true;
          try {
            await persistAt(instant, true);
          } catch (error) {
            persistenceError = error;
          }
        }
        state = next;
        if (!active && eligible(state)) start(state, instant);
        if (!attemptedTransitionPersistence) {
          try {
            await flushPendingPersistence();
          } catch (error) {
            persistenceError = error;
          }
        }
        if (persistenceError) throw persistenceError;
      });
    },

    checkpoint() {
      const instant = captureInstant();
      return queue(() => (
        active ? persistAt(instant, false) : flushPendingPersistence()
      ));
    },

    close() {
      const instant = captureInstant();
      return queue(async () => {
        state = inactiveEligibility;
        if (active) await persistAt(instant, true);
        else await flushPendingPersistence();
      });
    },
  };
}
