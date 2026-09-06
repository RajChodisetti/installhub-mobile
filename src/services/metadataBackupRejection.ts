import { sha256 } from 'js-sha256';
import type { AppDataStore, PendingMetadataBackupAttempt, RejectedMetadataBackupAttempt, ResolvedMetadataBackupConflict } from '../types';
import type { RemoteInstallationTree } from '../api/apiClient';

// These detail prefixes are emitted only by /push canonical validation or its
// rolled-back transaction. An arbitrary HTTP 400 is not a rejection receipt.
const PRECOMMIT_CODES = new Set([
  'invalid_canonical_tree', 'unsupported_tree_schema',
  'comms_replacement_meter_missing', 'comms_replacement_mapping_changed',
  'comms_replacement_state_mismatch', 'metadata_stage_cannot_complete_form',
  'multiple_comms_replacements_per_meter', 'CANONICAL_EVIDENCE_UNRESOLVED',
]);

export function metadataPrecommitRejectionCode(status: number, message: string): string | null {
  if (status !== 400) return null;
  const code = message.split(':', 1)[0]!;
  return PRECOMMIT_CODES.has(code) ? code : null;
}

export type MetadataRejectionObservation =
  | { kind: 'unchanged_preimage'; tree: RemoteInstallationTree }
  // Only a newly prepared first dispatch in this process may use absence.
  // After restart, a 404 cannot exclude an earlier commit followed by purge.
  | { kind: 'absent_first_dispatch'; installationId: string; freshFirstDispatch: true };

export function assertMetadataRejectionObservation(
  attempt: PendingMetadataBackupAttempt, observation: MetadataRejectionObservation,
): RejectedMetadataBackupAttempt['rejection_proof'] {
  if (attempt.accepted_tree_revision !== undefined
    || Object.prototype.hasOwnProperty.call(attempt, 'accepted_record_version_number')) {
    throw new Error('A metadata acknowledgement already exists. Its original request remains pending.');
  }
  if (observation.kind === 'absent_first_dispatch') {
    if (attempt.base_tree_revision !== undefined || attempt.base_remote_tree !== undefined
      || observation.installationId !== attempt.installation_id || observation.freshFirstDispatch !== true) {
      throw new Error('Metadata rejection did not prove an absent first-create installation.');
    }
    return { kind: 'absent_first_dispatch' };
  }
  const tree = observation.tree;
  const revision = tree.treeRevision ?? tree.installation.treeRevision ?? tree.installation.tree_revision;
  const digest = sha256(JSON.stringify(tree));
  if (attempt.base_tree_revision === undefined || !attempt.base_remote_tree
    || tree.treeSchemaVersion !== 2 || tree.installation.id !== attempt.installation_id
    || revision !== attempt.base_tree_revision || digest !== attempt.base_remote_tree_sha256) {
    throw new Error('The server changed or could not prove rejection of the original metadata request. It remains pending.');
  }
  return { kind: 'unchanged_preimage', tree_revision: attempt.base_tree_revision, tree_sha256: digest };
}

/** Retained evidence is inert history, not a dispatch/completion blocker. */
export function rejectedMetadataAttemptsForInstallation(store: AppDataStore, id: string): RejectedMetadataBackupAttempt[] {
  const installation = store.installations.find((item) => item.id === id);
  const owner = installation?.local_owner_user_id ?? installation?.assigned_work_actor_user_id;
  return Object.values(store.cloudSync.rejected_metadata_attempts ?? {})
    .filter((attempt) => attempt.installation_id === id && attempt.actor_user_id === owner)
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function metadataAttemptLocalMediaReferences(attempts: readonly PendingMetadataBackupAttempt[]): string[] {
  const result = new Set<string>();
  const visit = (value: unknown): void => {
    // Only managed/local URI schemes count; free text and HTTPS are never files.
    if (typeof value === 'string' && /^(file|content|ph|assets-library):\/\//i.test(value)) result.add(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  attempts.forEach((attempt) => {
    visit(attempt.sent_tree);
    const rejected = attempt as Partial<RejectedMetadataBackupAttempt>;
    visit(rejected.preserved_upload_queue); visit(rejected.preserved_thumbnail_queue);
  });
  return [...result].sort();
}

export function rejectedMetadataLocalMediaReferences(store: AppDataStore): string[] {
  return metadataAttemptLocalMediaReferences([
    ...Object.values(store.cloudSync.rejected_metadata_attempts ?? {}),
    ...(store.assignedWorkRecoveryCheckouts ?? []).flatMap((copy) => copy.cloudSync.rejected_metadata_attempts ?? []),
  ]);
}


export function resolvedMetadataConflictsForInstallation(store: AppDataStore, id: string): ResolvedMetadataBackupConflict[] {
  const installation = store.installations.find((item) => item.id === id);
  const owner = installation?.local_owner_user_id ?? installation?.assigned_work_actor_user_id;
  return Object.values(store.cloudSync.resolved_metadata_conflicts ?? {})
    .filter((entry) => entry.original.installation_id === id && entry.original.actor_user_id === owner)
    .sort((left, right) => left.original.id.localeCompare(right.original.id));
}

export function resolvedMetadataConflictMediaReferences(entries: readonly ResolvedMetadataBackupConflict[]): string[] {
  return metadataAttemptLocalMediaReferences(entries.map((entry) => ({ ...entry.original,
    preserved_upload_queue: entry.preserved_upload_queue, preserved_thumbnail_queue: entry.preserved_thumbnail_queue })));
}

export function metadataHistoryLocalMediaReferences(store: AppDataStore): string[] {
  return [...new Set([...rejectedMetadataLocalMediaReferences(store), ...resolvedMetadataConflictMediaReferences([
    ...Object.values(store.cloudSync.resolved_metadata_conflicts ?? {}),
    ...(store.assignedWorkRecoveryCheckouts ?? []).flatMap((entry) => entry.cloudSync.resolved_metadata_conflicts ?? []),
  ])])].sort();
}
