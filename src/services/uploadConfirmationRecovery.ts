import type { CloudUploadQueueItem } from '../types';

export interface UploadConfirmationRecoveryDependencies {
  confirm: (sessionId: string, checksum: string) => Promise<{
    remoteUrl: string;
    treeRevision: number;
  }>;
  recordRevision: (installationId: string, treeRevision: number) => Promise<void>;
  markComplete: (
    row: CloudUploadQueueItem,
    checksum: string,
    remoteUrl: string,
  ) => Promise<void>;
  resetUnconfirmed: (row: CloudUploadQueueItem) => Promise<void>;
  isProvenUnconfirmed: (error: unknown) => boolean;
  assertCurrent?: () => void;
}

const RESETTABLE_CONFIRMATION_CONFLICTS = new Set([
  'snapshot_conflict',
  'installation_completed_reopen_required',
  'upload_parent_changed',
]);

/**
 * A confirmation session may be discarded only when the API proves that its
 * photo was not committed. In particular, revision-unavailable is excluded:
 * it can describe a legacy confirmation that committed without an immutable
 * revision receipt and therefore must remain recoverable for review.
 */
export function isDefinitivelyUnconfirmedUploadConfirmationError(
  error: unknown,
): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; message?: unknown };
  if (candidate.status === 400 || candidate.status === 404) return true;
  if (candidate.status !== 409 || typeof candidate.message !== 'string') return false;
  return RESETTABLE_CONFIRMATION_CONFLICTS.has(candidate.message.trim());
}

/** Replays only a durable upload session before any later metadata write. */
export async function recoverUploadConfirmation(
  row: CloudUploadQueueItem,
  dependencies: UploadConfirmationRecoveryDependencies,
): Promise<boolean> {
  if (!row.session_id || !row.checksum || !['pending', 'failed'].includes(row.status)) {
    return false;
  }
  try {
    dependencies.assertCurrent?.();
    const confirmed = await dependencies.confirm(row.session_id, row.checksum);
    dependencies.assertCurrent?.();
    await dependencies.recordRevision(row.installation_id, confirmed.treeRevision);
    dependencies.assertCurrent?.();
    await dependencies.markComplete(row, row.checksum, confirmed.remoteUrl);
    dependencies.assertCurrent?.();
    return true;
  } catch (error) {
    if (dependencies.isProvenUnconfirmed(error)) {
      dependencies.assertCurrent?.();
      await dependencies.resetUnconfirmed(row);
      dependencies.assertCurrent?.();
      return false;
    }
    throw error;
  }
}
