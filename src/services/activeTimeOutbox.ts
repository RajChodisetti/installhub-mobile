import type { AuditWorkSessionCheckpoint } from './auditWorkTrackingPolicy';

export const ACTIVE_TIME_OUTBOX_KEY = 'installhub.mobile.active-time.v1';

export interface StoredActiveTimeSession extends AuditWorkSessionCheckpoint {
  acknowledgedRevision: number;
  serverParentConfirmed: boolean;
}

export interface ActiveTimeOutboxDocument {
  version: 1;
  sessions: StoredActiveTimeSession[];
}

export interface ActiveTimeStorageAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export interface ActiveTimeOutboxStore {
  save(
    checkpoint: AuditWorkSessionCheckpoint,
    serverParentConfirmed?: boolean,
  ): Promise<void>;
  setServerParentConfirmed(
    actorUserId: string,
    installationId: string,
    confirmed: boolean,
  ): Promise<void>;
  closeInterrupted(actorUserId: string): Promise<void>;
  pending(actorUserId: string): Promise<StoredActiveTimeSession[]>;
  acknowledge(
    actorUserId: string,
    sessionId: string,
    sentRevision: number,
    serverRevision: number,
    assertCurrent?: () => void,
  ): Promise<void>;
  read(): Promise<ActiveTimeOutboxDocument>;
}

const emptyDocument = (): ActiveTimeOutboxDocument => ({ version: 1, sessions: [] });

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && Number.isFinite(Date.parse(value));
}

function normalizeSession(value: unknown): StoredActiveTimeSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<StoredActiveTimeSession>;
  if (
    typeof record.sessionId !== 'string' || !record.sessionId
    || typeof record.actorUserId !== 'string' || !record.actorUserId
    || typeof record.installationId !== 'string' || !record.installationId
    || !Number.isSafeInteger(record.revision) || Number(record.revision) < 0
    || !Number.isSafeInteger(record.activeMilliseconds) || Number(record.activeMilliseconds) < 0
    || !validTimestamp(record.startedAt)
    || !validTimestamp(record.lastActiveAt)
    || (record.endedAt !== null && !validTimestamp(record.endedAt))
  ) return null;
  const revision = Number(record.revision);
  const acknowledgedRevision = Number.isSafeInteger(record.acknowledgedRevision)
    ? Math.max(0, Math.min(revision, Number(record.acknowledgedRevision)))
    : 0;
  return {
    sessionId: record.sessionId,
    actorUserId: record.actorUserId,
    installationId: record.installationId,
    revision,
    activeMilliseconds: Number(record.activeMilliseconds),
    startedAt: record.startedAt,
    lastActiveAt: record.lastActiveAt,
    endedAt: record.endedAt,
    acknowledgedRevision,
    serverParentConfirmed: record.serverParentConfirmed === true,
  };
}

export function parseActiveTimeOutbox(raw: string | null): ActiveTimeOutboxDocument {
  if (!raw) return emptyDocument();
  try {
    const parsed = JSON.parse(raw) as Partial<ActiveTimeOutboxDocument>;
    if (parsed.version !== 1 || !Array.isArray(parsed.sessions)) return emptyDocument();
    return {
      version: 1,
      sessions: parsed.sessions
        .map(normalizeSession)
        .filter((session): session is StoredActiveTimeSession => Boolean(session)),
    };
  } catch {
    return emptyDocument();
  }
}

export function createActiveTimeOutboxStore(
  storage: ActiveTimeStorageAdapter,
): ActiveTimeOutboxStore {
  let operationChain: Promise<unknown> = Promise.resolve();

  const run = <T,>(operation: () => Promise<T>): Promise<T> => {
    const queued = operationChain.then(operation, operation);
    operationChain = queued.then(() => undefined, () => undefined);
    return queued;
  };

  const readWithinOperation = async () => parseActiveTimeOutbox(
    await storage.getItem(ACTIVE_TIME_OUTBOX_KEY),
  );
  const writeWithinOperation = (document: ActiveTimeOutboxDocument) =>
    storage.setItem(ACTIVE_TIME_OUTBOX_KEY, JSON.stringify(document));

  return {
    save(checkpoint, serverParentConfirmed = false) {
      return run(async () => {
        const document = await readWithinOperation();
        const index = document.sessions.findIndex((session) => (
          session.actorUserId === checkpoint.actorUserId
          && session.sessionId === checkpoint.sessionId
        ));
        const previous = index >= 0 ? document.sessions[index] : null;
        if (previous && previous.installationId !== checkpoint.installationId) {
          throw new Error('Active-time session installation identity changed.');
        }
        if (previous && checkpoint.startedAt !== previous.startedAt) {
          throw new Error('Active-time session start boundary changed.');
        }
        if (previous && checkpoint.revision < previous.revision) return;
        if (previous && checkpoint.revision === previous.revision) {
          if (previous.serverParentConfirmed !== serverParentConfirmed) {
            previous.serverParentConfirmed = serverParentConfirmed;
            await writeWithinOperation(document);
          }
          return;
        }
        if (previous && checkpoint.activeMilliseconds < previous.activeMilliseconds) {
          throw new Error('Active-time session duration regressed.');
        }
        if (previous?.endedAt && checkpoint.endedAt !== previous.endedAt) {
          throw new Error('Closed active-time session boundary changed.');
        }
        const next: StoredActiveTimeSession = {
          ...checkpoint,
          acknowledgedRevision: previous?.acknowledgedRevision ?? 0,
          serverParentConfirmed,
        };
        if (next.endedAt && next.activeMilliseconds === 0) {
          if (index >= 0) document.sessions.splice(index, 1);
        } else if (index >= 0) {
          document.sessions[index] = next;
        } else {
          document.sessions.push(next);
        }
        await writeWithinOperation(document);
      });
    },

    setServerParentConfirmed(actorUserId, installationId, confirmed) {
      return run(async () => {
        const document = await readWithinOperation();
        let changed = false;
        for (const session of document.sessions) {
          if (
            session.actorUserId === actorUserId
            && session.installationId === installationId
            && session.serverParentConfirmed !== confirmed
          ) {
            session.serverParentConfirmed = confirmed;
            changed = true;
          }
        }
        if (changed) await writeWithinOperation(document);
      });
    },

    closeInterrupted(actorUserId) {
      return run(async () => {
        const document = await readWithinOperation();
        let changed = false;
        for (const session of document.sessions) {
          if (session.actorUserId !== actorUserId || session.endedAt) continue;
          // A prior process can prove activity only through its last durable
          // checkpoint. Close there; never infer the restart/background gap.
          session.revision += 1;
          session.endedAt = session.lastActiveAt;
          changed = true;
        }
        if (changed) await writeWithinOperation(document);
      });
    },

    pending(actorUserId) {
      return run(async () => {
        const document = await readWithinOperation();
        return document.sessions
          .filter((session) => (
            session.actorUserId === actorUserId
            && session.revision > session.acknowledgedRevision
          ))
          .map((session) => ({ ...session }));
      });
    },

    acknowledge(actorUserId, sessionId, sentRevision, serverRevision, assertCurrent) {
      return run(async () => {
        assertCurrent?.();
        const document = await readWithinOperation();
        assertCurrent?.();
        const index = document.sessions.findIndex((session) => (
          session.actorUserId === actorUserId && session.sessionId === sessionId
        ));
        if (index < 0) return;
        const current = document.sessions[index];
        // A response acknowledges only the snapshot that was actually sent.
        // If a heartbeat advanced locally in flight, its higher revision stays pending.
        if (serverRevision < sentRevision) return;
        current.acknowledgedRevision = Math.max(
          current.acknowledgedRevision,
          Math.min(sentRevision, current.revision),
        );
        if (current.endedAt && current.acknowledgedRevision >= current.revision) {
          document.sessions.splice(index, 1);
        }
        assertCurrent?.();
        await writeWithinOperation(document);
      });
    },

    read() {
      return run(readWithinOperation);
    },
  };
}

let defaultStorePromise: Promise<ActiveTimeOutboxStore> | null = null;

export function getActiveTimeOutboxStore(): Promise<ActiveTimeOutboxStore> {
  if (!defaultStorePromise) {
    defaultStorePromise = import('@react-native-async-storage/async-storage')
      .then(({ default: storage }) => createActiveTimeOutboxStore(storage));
  }
  return defaultStorePromise;
}
