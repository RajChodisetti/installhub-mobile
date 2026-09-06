import { rejectedMetadataAttemptsForInstallation, resolvedMetadataConflictsForInstallation } from './metadataBackupRejection';
import { sha256 } from 'js-sha256';
import { canonicalJsonStringify } from '../domain/installationV2';
import type { AppDataStore, AssignedWorkRecoveryCheckout } from '../types';
import { assignedWorkTreeReplacementHasNoRetainedScreen } from './assignedWorkNavigationFence';

export interface ConflictRecoveryBaseline {
  installationId: string;
  actorUserId: string;
  snapshotSha256: string;
}

/** Includes local-only fields/receipts and original IDs; never use a wire payload for preservation. */
export function conflictRecoverySnapshot(store: AppDataStore, id: string) {
  return {
    installation: store.installations.find((item) => item.id === id),
    gridSupplies: store.gridSupplies.filter((item) => item.installationId === id),
    zones: store.zones.filter((item) => item.audit_id === id),
    electricalAssets: store.electricalAssets.filter((item) => item.audit_id === id),
    siteAssets: store.siteAssets.filter((item) => item.audit_id === id),
    meterDevices: store.meterDevices.filter((item) => item.installationId === id),
    measurementAssignments: store.measurementAssignments.filter((item) => item.installationId === id),
    formSubmissions: store.formSubmissions.filter((item) => item.installation_id === id),
    siteAssetEditorDrafts: (store.siteAssetEditorDrafts ?? []).filter((item) => item.installationId === id),
    cloudSync: {
      synced_at: store.cloudSync.synced_at_by_installation[id],
      force_dirty: store.cloudSync.force_dirty_installation_ids.includes(id),
      pending_complete_attempt: store.cloudSync.pending_complete_attempts?.[id],
      pending_metadata_attempt: store.cloudSync.pending_metadata_attempts?.[id],
      conflicted_metadata_attempt: store.cloudSync.conflicted_metadata_attempts?.[id],
      rejected_metadata_attempts: rejectedMetadataAttemptsForInstallation(store, id),
      resolved_metadata_conflicts: resolvedMetadataConflictsForInstallation(store, id),
      conflicted_complete_attempt: store.cloudSync.conflicted_complete_attempts?.[id],
      upload_queue: store.cloudSync.upload_queue.filter((item) => item.installation_id === id),
      thumbnail_queue: store.cloudSync.thumbnail_queue.filter((item) => item.installation_id === id),
    },
  };
}
export const conflictRecoveryHash = (value: unknown): string => sha256(canonicalJsonStringify(value));

export function captureConflictRecoveryBaseline(store: AppDataStore, id: string, actor: string): ConflictRecoveryBaseline {
  const snapshot = conflictRecoverySnapshot(store, id);
  const item = snapshot.installation;
  if (!item || item.local_owner_user_id !== actor || item.is_imported_copy || item.import_source_server_id
    || item.assigned_work_state === 'inactive'
    || (item.assigned_work_state === 'active' && item.assigned_work_actor_user_id !== actor)) {
    throw new Error('This canonical checkout is not available to the signed-in account.');
  }
  if (item.status !== 'Draft') throw new Error('Only a Draft checkout can use this recovery action.');
  if (!item.assigned_work_refresh_conflict && item.backup_conflict?.kind !== 'CONFLICT') {
    throw new Error('This checkout no longer has a sync conflict. Refresh the job list.');
  }
  if (item.pending_completion || snapshot.cloudSync.pending_complete_attempt || snapshot.cloudSync.pending_metadata_attempt) {
    throw new Error('Resolve the pending completion or Cloud Backup confirmation before recovering.');
  }
  if (snapshot.cloudSync.upload_queue.some((row) => row.status === 'uploading')
    || snapshot.cloudSync.thumbnail_queue.some((row) => row.status === 'downloading')) {
    throw new Error('Wait for active evidence transfers to finish before recovering.');
  }
  if (!assignedWorkTreeReplacementHasNoRetainedScreen(id)) {
    throw new Error('Return to Home and close all installation editors before recovering.');
  }
  if (snapshot.siteAssetEditorDrafts.some((draft) => draft.userId !== actor)) {
    throw new Error('An editor draft belongs to another account. Keep this checkout protected for review.');
  }
  return { installationId: id, actorUserId: actor, snapshotSha256: conflictRecoveryHash(snapshot) };
}

export function assertConflictRecoveryBaseline(store: AppDataStore, baseline: ConflictRecoveryBaseline): void {
  const current = captureConflictRecoveryBaseline(store, baseline.installationId, baseline.actorUserId);
  if (current.snapshotSha256 !== baseline.snapshotSha256) {
    throw new Error('Device work changed after the recovery review. Review both versions again.');
  }
}
export type ConflictRecoveryProof = NonNullable<AssignedWorkRecoveryCheckout['reconciliation']>;
