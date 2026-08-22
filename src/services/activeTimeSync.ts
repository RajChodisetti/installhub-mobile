import {
  apiClient,
  assertCurrentCloudSessionAuthority,
  captureCloudSessionAuthority,
  cloudSessionAuthoritiesMatch,
  type CloudSessionAuthority,
} from '../api/apiClient';
import { getStore, initStore } from '../data/seed';
import {
  getActiveTimeOutboxStore,
  type StoredActiveTimeSession,
} from './activeTimeOutbox';
import { dispatchAndAcknowledgeActiveTimeForAuthority } from './activeTimeDispatchFence';
import {
  activeTimeServerParentIsReady,
  activeTimeSessionMayDeliverFromLocalState,
} from './activeTimeDeliveryPolicy';

interface ActorSyncState {
  authority: CloudSessionAuthority;
  flight: Promise<void>;
  rerun: boolean;
}

let activeSyncState: ActorSyncState | null = null;

async function sessionMayDeliver(
  session: StoredActiveTimeSession,
  authority: CloudSessionAuthority,
): Promise<boolean> {
  const actorUserId = authority.actorUserId;
  assertCurrentCloudSessionAuthority(authority, actorUserId);
  await initStore();
  assertCurrentCloudSessionAuthority(authority, actorUserId);
  return activeTimeSessionMayDeliverFromLocalState(
    getStore(),
    session,
    actorUserId,
  );
}

async function refreshKnownServerParents(
  authority: CloudSessionAuthority,
): Promise<void> {
  const actorUserId = authority.actorUserId;
  assertCurrentCloudSessionAuthority(authority, actorUserId);
  await initStore();
  assertCurrentCloudSessionAuthority(authority, actorUserId);
  const outbox = await getActiveTimeOutboxStore();
  assertCurrentCloudSessionAuthority(authority, actorUserId);
  for (const installation of getStore().installations) {
    assertCurrentCloudSessionAuthority(authority, actorUserId);
    await outbox.setServerParentConfirmed(
      actorUserId,
      installation.id,
      activeTimeServerParentIsReady(installation, actorUserId),
    );
    assertCurrentCloudSessionAuthority(authority, actorUserId);
  }
}

async function executeActiveTimeSync(authority: CloudSessionAuthority): Promise<void> {
  const actorUserId = authority.actorUserId;
  const assertCurrent = () => {
    assertCurrentCloudSessionAuthority(authority, actorUserId);
  };
  assertCurrent();
  await refreshKnownServerParents(authority);
  assertCurrent();
  const outbox = await getActiveTimeOutboxStore();
  assertCurrent();
  const pending = await outbox.pending(actorUserId);
  assertCurrent();
  for (const session of pending) {
    assertCurrent();
    if (!await sessionMayDeliver(session, authority)) continue;
    assertCurrent();
    await dispatchAndAcknowledgeActiveTimeForAuthority(
      assertCurrent,
      () => apiClient.putInstallationActiveTimeSession(
        session.installationId,
        session.sessionId,
        {
          revision: session.revision,
          activeMilliseconds: session.activeMilliseconds,
          startedAt: session.startedAt,
          lastActiveAt: session.lastActiveAt,
          endedAt: session.endedAt,
        },
        authority,
      ),
      (response) => !(
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
      ),
      (response, dispatchAuthority) => outbox.acknowledge(
        actorUserId,
        session.sessionId,
        session.revision,
        response.revision,
        dispatchAuthority,
      ),
    );
  }
}

async function runActiveTimeSyncAuthority(
  authority: CloudSessionAuthority,
): Promise<void> {
  const existing = activeSyncState;
  if (existing) {
    if (cloudSessionAuthoritiesMatch(existing.authority, authority)) {
      existing.rerun = true;
      return existing.flight;
    }
    await existing.flight.catch(() => undefined);
    assertCurrentCloudSessionAuthority(authority, authority.actorUserId);
    return runActiveTimeSyncAuthority(authority);
  }

  const state: ActorSyncState = {
    authority,
    flight: Promise.resolve(),
    rerun: false,
  };
  const operation = (async () => {
    do {
      state.rerun = false;
      await executeActiveTimeSync(authority);
    } while (state.rerun);
  })();
  state.flight = operation;
  activeSyncState = state;
  return operation.finally(() => {
    if (activeSyncState === state) activeSyncState = null;
  });
}

export async function syncActiveTimeSessions(
  actorUserId: string,
  providedAuthority?: CloudSessionAuthority,
): Promise<void> {
  if (!actorUserId) return;
  try {
    const authority = providedAuthority ?? await captureCloudSessionAuthority();
    if (!authority) return;
    assertCurrentCloudSessionAuthority(authority, actorUserId);
    await runActiveTimeSyncAuthority(authority);
  } catch {
    // Storage, network, and exact-session failures remain durable. Tracking
    // delivery never surfaces as an unhandled app-level failure.
  }
}
