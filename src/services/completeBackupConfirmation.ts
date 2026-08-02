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
  recordAccepted: (
    installationId: string,
    attemptId: string,
    treeRevision: number,
    recordVersionNumber: number | null,
  ) => Promise<void>;
  fetchAndMerge: (
    installationId: string,
    expectedTreeRevision: number,
    replaceRecordedChanges: boolean,
  ) => Promise<{ installation: Record<string, unknown> }>;
  applyServerState: (
    installationId: string,
    patch: {
      status: 'Draft' | 'Completed';
      record_version_number?: number;
      backup_conflict: { kind: 'NONE' };
    },
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
  if (!currentBeforeReplay || currentBeforeReplay.watermark !== attempt.tree_watermark) {
    throw new CompleteBackupConflictError(
      'Local installation changed while final backup confirmation was pending.',
    );
  }

  const result = completePushResponse(
    attempt,
    await dependencies.push(attempt.payload),
  );
  await dependencies.recordAccepted(
    attempt.installation_id,
    attempt.id,
    result.treeRevision,
    result.recordVersionNumber,
  );
  const canonicalTree = await dependencies.fetchAndMerge(
    attempt.installation_id,
    result.treeRevision,
    false,
  );
  if (canonicalTree.installation.status !== attempt.installation_status) {
    throw new CompleteBackupConflictError(
      'Server lifecycle changed while final backup confirmation was pending.',
    );
  }
  const currentAfterMerge = await dependencies.getInstallationBackupTree(attempt.installation_id);
  if (!currentAfterMerge || currentAfterMerge.watermark !== attempt.tree_watermark) {
    throw new CompleteBackupConflictError(
      'Local installation changed while final backup confirmation was being merged.',
    );
  }
  await dependencies.applyServerState(attempt.installation_id, {
    status: currentAfterMerge.installation.status,
    record_version_number: result.recordVersionNumber
      ?? currentAfterMerge.installation.record_version_number,
    backup_conflict: { kind: 'NONE' },
  });
  await dependencies.finish(attempt.installation_id, attempt.id);
}
