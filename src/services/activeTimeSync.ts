import { apiClient } from '../api/apiClient';
import { getStore, initStore } from '../data/seed';
import {
  getActiveTimeOutboxStore,
  type StoredActiveTimeSession,
} from './activeTimeOutbox';

interface ActorSyncState {
  flight: Promise<void> | null;
  rerun: boolean;
}

const actorSyncStates = new Map<string, ActorSyncState>();

function serverParentIsReady(installation: {
  cloud_backup_enabled: boolean;
  server_tree_revision?: number;
  assigned_work_state?: 'none' | 'active' | 'inactive';
}): boolean {
  return installation.cloud_backup_enabled
    && installation.assigned_work_state !== 'inactive'
    && Number.isSafeInteger(installation.server_tree_revision)
    && Number(installation.server_tree_revision) >= 0;
}

async function sessionMayDeliver(session: StoredActiveTimeSession): Promise<boolean> {
  await initStore();
  const installation = getStore().installations.find(
    (item) => item.id === session.installationId,
  );
  if (installation) return serverParentIsReady(installation);
  // Local deletion retains the Cloud Backup. A checkpoint that already saw a
  // confirmed parent remains deliverable even after its local tree is removed.
  return session.serverParentConfirmed;
}

async function refreshKnownServerParents(actorUserId: string): Promise<void> {
  await initStore();
  const outbox = await getActiveTimeOutboxStore();
  for (const installation of getStore().installations) {
    await outbox.setServerParentConfirmed(
      actorUserId,
      installation.id,
      serverParentIsReady(installation),
    );
  }
}

async function executeActiveTimeSync(actorUserId: string): Promise<void> {
  await refreshKnownServerParents(actorUserId);
  const outbox = await getActiveTimeOutboxStore();
  const pending = await outbox.pending(actorUserId);
  for (const session of pending) {
    if (!await sessionMayDeliver(session)) continue;
    try {
      const response = await apiClient.putInstallationActiveTimeSession(
        session.installationId,
        session.sessionId,
        {
          revision: session.revision,
          activeMilliseconds: session.activeMilliseconds,
          startedAt: session.startedAt,
          lastActiveAt: session.lastActiveAt,
          endedAt: session.endedAt,
        },
      );
      if (
        response.sessionId !== session.sessionId
        || response.startedAt !== session.startedAt
        || response.revision < session.revision
        || response.activeMilliseconds < session.activeMilliseconds
        || (
          response.revision === session.revision
          && (
            response.activeMilliseconds !== session.activeMilliseconds
            || response.lastActiveAt !== session.lastActiveAt
            || response.endedAt !== session.endedAt
          )
        )
      ) continue;
      await outbox.acknowledge(
        actorUserId,
        session.sessionId,
        session.revision,
        response.revision,
      );
    } catch {
      // Network/auth failures, a missing parent (404), and lifecycle conflicts
      // all remain durable. A later Cloud Backup/foreground pass retries them.
    }
  }
}

export function syncActiveTimeSessions(actorUserId: string): Promise<void> {
  if (!actorUserId) return Promise.resolve();
  const existing = actorSyncStates.get(actorUserId);
  if (existing?.flight) {
    existing.rerun = true;
    return existing.flight;
  }

  const state: ActorSyncState = { flight: null, rerun: false };
  const operation = (async () => {
    do {
      state.rerun = false;
      try {
        await executeActiveTimeSync(actorUserId);
      } catch {
        // Storage initialization and queue reads are also retryable. Tracking
        // delivery must never surface as an unhandled app-level failure.
      }
    } while (state.rerun);
  })();
  state.flight = operation;
  actorSyncStates.set(actorUserId, state);
  return operation.finally(() => {
    if (actorSyncStates.get(actorUserId) === state) actorSyncStates.delete(actorUserId);
  });
}
