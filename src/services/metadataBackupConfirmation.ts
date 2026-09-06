import type { PendingMetadataBackupAttempt } from '../types';
import type { RemoteInstallationTree } from '../api/apiClient';

export interface MetadataBackupConfirmationDependencies {
  assertCurrent: (installationId: string) => void;
  push: (payload: Record<string, unknown>) => Promise<{ installationId: string; treeRevision: number; recordVersionNumber: number | null }>;
  recordAccepted: (attempt: PendingMetadataBackupAttempt, result: { installationId: string; treeRevision: number; recordVersionNumber: number | null }) => Promise<void>;
  fetchCanonical: (installationId: string) => Promise<RemoteInstallationTree>;
  finish: (attempt: PendingMetadataBackupAttempt, remote: RemoteInstallationTree, revision: number) => Promise<void>;
}

/** Replay only an unacknowledged durable request. Once its acceptance is saved,
 * confirm that exact revision with a read; generated server values may make a
 * second POST conflict even when the first one succeeded. Metadata acceptance
 * never advances the full-backup watermark or supplies a completed-tree count. */
export async function confirmMetadataBackupAttempt(attempt: PendingMetadataBackupAttempt, dependencies: MetadataBackupConfirmationDependencies): Promise<void> {
  dependencies.assertCurrent(attempt.installation_id);
  const hasReceipt = attempt.accepted_tree_revision !== undefined;
  if (hasReceipt !== Object.prototype.hasOwnProperty.call(attempt, 'accepted_record_version_number')) {
    throw new Error('Metadata backup acknowledgement is incomplete. The original request remains pending.');
  }
  const result = hasReceipt
    ? { installationId: attempt.installation_id, treeRevision: attempt.accepted_tree_revision!, recordVersionNumber: attempt.accepted_record_version_number! }
    : await dependencies.push(attempt.payload);
  dependencies.assertCurrent(attempt.installation_id);
  if (result.installationId !== attempt.installation_id || !Number.isSafeInteger(result.treeRevision)
    || result.treeRevision < (attempt.base_tree_revision ?? 0)
    || (result.recordVersionNumber !== null && (!Number.isSafeInteger(result.recordVersionNumber) || result.recordVersionNumber < 0))) {
    throw new Error('Server returned an invalid metadata backup acknowledgement. The original request remains pending.');
  }
  if (!hasReceipt) await dependencies.recordAccepted(attempt, result);
  dependencies.assertCurrent(attempt.installation_id);
  const remote = await dependencies.fetchCanonical(attempt.installation_id);
  dependencies.assertCurrent(attempt.installation_id);
  const revision = remote.treeRevision ?? remote.installation.treeRevision ?? remote.installation.tree_revision;
  if (remote.installation.id !== attempt.installation_id || remote.treeSchemaVersion !== 2 || revision !== result.treeRevision) {
    throw new Error('Canonical metadata revision or identity changed. The original request remains pending for review.');
  }
  await dependencies.finish(attempt, remote, result.treeRevision);
  dependencies.assertCurrent(attempt.installation_id);
}
