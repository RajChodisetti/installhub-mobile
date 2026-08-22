import type { InstallationBackupTree } from '../repositories/cloudSyncRepository';
import type { PendingCompleteBackupAttempt } from '../types';

export class CompleteBackupConflictError extends Error {
  readonly status = 409;
}

export interface CompleteBackupConfirmationDependencies {
  getInstallationBackupTree: (installationId: string) => Promise<InstallationBackupTree | null>;
  push: (payload: unknown) => Promise<{
    installationId: string;
    treeRevision: number;
    recordVersionNumber: number | null;
  }>;
  assertNewDispatchAllowed?: (installationId: string) => void;
  recordAccepted: (
    installationId: string,
    attemptId: string,
    treeRevision: number,
    recordVersionNumber: number | null,
  ) => Promise<void>;
  fetchAndMerge: (
    installationId: string,
    expectedTreeRevision: number,
    expectedLocalTreeRevision: number,
    expectedTreeWatermark: string,
    replaceRecordedChanges: boolean,
  ) => Promise<{ installation: Record<string, unknown> }>;
  applyServerState: (
    installationId: string,
    patch: {
      status: 'Draft' | 'Completed';
      record_version_number?: number;
      backup_conflict: { kind: 'NONE' };
    },
    expectedLocalTreeRevision: number,
    expectedTreeWatermark: string,
  ) => Promise<unknown>;
  finish: (installationId: string, attemptId: string) => Promise<void>;
}

function completePushResponse(
  attempt: PendingCompleteBackupAttempt,
  result: {
    installationId: string;
    treeRevision: number;
    recordVersionNumber: number | null;
  },
) {
  if (
    result.installationId !== attempt.installation_id
    || !Number.isSafeInteger(result.treeRevision)
    || result.treeRevision < 0
    || (result.recordVersionNumber !== null
      && (!Number.isSafeInteger(result.recordVersionNumber)
        || result.recordVersionNumber < 0))
  ) {
    throw new Error('Server returned an invalid complete backup acknowledgement.');
  }
  return result;
}

/**
 * Replays the exact durable final request, then advances identity, codes, CAS
 * revision, and the backed-up watermark only after pulling that exact server
 * revision. Every failure intentionally leaves the attempt durable.
 */
export async function confirmCompleteBackupAttempt(
  attempt: PendingCompleteBackupAttempt,
  dependencies: CompleteBackupConfirmationDependencies,
): Promise<void> {
  const currentBeforeReplay = await dependencies.getInstallationBackupTree(attempt.installation_id);
  dependencies.assertNewDispatchAllowed?.(attempt.installation_id);
  if (
    !currentBeforeReplay
    || currentBeforeReplay.watermark !== attempt.tree_watermark
    || (currentBeforeReplay.installation.tree_revision ?? 0)
      !== attempt.local_tree_revision
  ) {
    throw new CompleteBackupConflictError(
      'Local installation changed while final backup confirmation was pending.',
    );
  }

  dependencies.assertNewDispatchAllowed?.(attempt.installation_id);
  const result = completePushResponse(
    attempt,
    await dependencies.push(attempt.payload),
  );
  dependencies.assertNewDispatchAllowed?.(attempt.installation_id);
  await dependencies.recordAccepted(
    attempt.installation_id,
    attempt.id,
    result.treeRevision,
    result.recordVersionNumber,
  );
  // Acceptance is durable before any canonical pull. If logout/login or an
  // assignment transition wins during that local write, leave the accepted
  // attempt intact for its owning authority instead of pulling with the
  // replacement account.
  dependencies.assertNewDispatchAllowed?.(attempt.installation_id);
  const canonicalTree = await dependencies.fetchAndMerge(
    attempt.installation_id,
    result.treeRevision,
    attempt.local_tree_revision,
    attempt.tree_watermark,
    false,
  );
  dependencies.assertNewDispatchAllowed?.(attempt.installation_id);
  if (canonicalTree.installation.status !== attempt.installation_status) {
    throw new CompleteBackupConflictError(
      'Server lifecycle changed while final backup confirmation was pending.',
    );
  }
  const currentAfterMerge = await dependencies.getInstallationBackupTree(attempt.installation_id);
  dependencies.assertNewDispatchAllowed?.(attempt.installation_id);
  if (
    !currentAfterMerge
    || currentAfterMerge.watermark !== attempt.tree_watermark
    || (currentAfterMerge.installation.tree_revision ?? 0)
      !== attempt.local_tree_revision
  ) {
    throw new CompleteBackupConflictError(
      'Local installation changed while final backup confirmation was being merged.',
    );
  }
  await dependencies.applyServerState(attempt.installation_id, {
    status: currentAfterMerge.installation.status,
    record_version_number: result.recordVersionNumber
      ?? currentAfterMerge.installation.record_version_number,
    backup_conflict: { kind: 'NONE' },
  }, attempt.local_tree_revision, attempt.tree_watermark);
  dependencies.assertNewDispatchAllowed?.(attempt.installation_id);
  await dependencies.finish(attempt.installation_id, attempt.id);
}
