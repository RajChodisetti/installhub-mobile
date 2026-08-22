import type { StoredActiveTimeSession } from './activeTimeOutbox';
import type { AppDataStore } from '../types';
import { assignedWorkRecoveryContainsActorInstallation } from './assignedWorkRecovery';
import { assignedWorkInstallationIsVisibleToActor } from './assignedWorkPolicy';

export function activeTimeServerParentIsReady(installation: {
  cloud_backup_enabled: boolean;
  server_tree_revision?: number;
  assigned_work_state?: 'none' | 'active' | 'inactive';
  assigned_work_actor_user_id?: string;
  local_owner_user_id?: string;
}, actorUserId: string): boolean {
  return installation.cloud_backup_enabled
    && assignedWorkInstallationIsVisibleToActor({
      assigned_work_state: installation.assigned_work_state ?? 'none',
      assigned_work_actor_user_id: installation.assigned_work_actor_user_id,
      local_owner_user_id: installation.local_owner_user_id,
    }, actorUserId)
    && Number.isSafeInteger(installation.server_tree_revision)
    && Number(installation.server_tree_revision) >= 0;
}

export function activeTimeSessionMayDeliverFromLocalState(
  store: Pick<AppDataStore, 'installations' | 'assignedWorkRecoveryCheckouts'>,
  session: StoredActiveTimeSession,
  actorUserId: string,
): boolean {
  if (session.actorUserId !== actorUserId) return false;
  if (assignedWorkRecoveryContainsActorInstallation(
    store,
    actorUserId,
    session.installationId,
  )) return false;
  const installation = store.installations.find(
    (item) => item.id === session.installationId,
  );
  if (installation) return activeTimeServerParentIsReady(installation, actorUserId);
  // Ordinary actor-owned local deletion retains the Cloud Backup. Recovery
  // envelopes are checked first because their active time is support-only.
  return session.serverParentConfirmed;
}
