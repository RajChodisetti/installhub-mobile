import type { Installation } from '../types';
import { sha256 } from 'js-sha256';

export const COMPLETION_NOTES_MAX_LENGTH = 2_000;

export interface CompletionTreeSnapshot {
  baseTreeRevision: number | undefined;
  localTreeRevision: number | undefined;
  treeWatermark: string;
  pendingCompletion: Installation['pending_completion'];
}

/** Captures primitives before readiness awaits can expose live store objects. */
export function captureCompletionTreeSnapshot(tree: {
  installation: Installation;
  watermark: string;
}): CompletionTreeSnapshot {
  return {
    baseTreeRevision: tree.installation.server_tree_revision,
    localTreeRevision: tree.installation.tree_revision,
    treeWatermark: tree.watermark,
    pendingCompletion: tree.installation.pending_completion
      ? { ...tree.installation.pending_completion }
      : undefined,
  };
}
export function completionFailureIsDefinitiveRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const response = error as { status?: unknown; code?: unknown };
  // This exact typed readiness response is emitted only after the authorized
  // server transaction has reloaded the installation as Draft and evaluated
  // its current tree. Status alone is never enough: 403/404/409 and an
  // unstructured 422 remain ambiguous and require lifecycle reconciliation.
  return Number(response.status) === 422
    && response.code === 'installation_not_ready';
}

export function completionFailureAllowsTrackingResume(
  dispatchStarted: boolean,
  error: unknown,
): boolean {
  return !dispatchStarted || completionFailureIsDefinitiveRejection(error);
}

export function normalizeCompletionNotes(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? '';
  if (!normalized) return null;
  if (normalized.length > COMPLETION_NOTES_MAX_LENGTH) {
    throw new Error('Completion notes must be 2,000 characters or fewer.');
  }
  return normalized;
}

export function pendingCompletionNotesRequestField(
  pending: NonNullable<Installation['pending_completion']>,
): { completionNotes?: string | null } {
  return Object.prototype.hasOwnProperty.call(pending, 'completionNotes')
    ? { completionNotes: pending.completionNotes ?? null }
    : {};
}

export function completionIdempotencyKey(
  installationId: string,
  baseTreeRevision: number,
  completionNotes: string | null,
): string {
  const fingerprint = JSON.stringify({
    installationId,
    baseTreeRevision,
    completionNotes,
  });
  return `complete-${sha256(fingerprint).slice(0, 32)}`;
}

export function pendingCompletionAttemptsMatch(
  left: NonNullable<Installation['pending_completion']>,
  right: NonNullable<Installation['pending_completion']>,
): boolean {
  const leftHasNotes = Object.prototype.hasOwnProperty.call(left, 'completionNotes');
  const rightHasNotes = Object.prototype.hasOwnProperty.call(right, 'completionNotes');
  return left.baseTreeRevision === right.baseTreeRevision
    && left.localTreeRevision === right.localTreeRevision
    && left.treeWatermark === right.treeWatermark
    && left.idempotencyKey === right.idempotencyKey
    && left.createdAt === right.createdAt
    && leftHasNotes === rightHasNotes
    && (!leftHasNotes || left.completionNotes === right.completionNotes);
}

export function assertCompletionAttemptInstallationState(
  installation: Installation,
  pendingCompletion: NonNullable<Installation['pending_completion']>,
  requirePersistedPending: boolean,
  currentTreeWatermark: string,
): void {
  if (installation.status !== 'Draft') {
    throw new Error('Only a Draft installation can be completed.');
  }
  if (!installation.cloud_backup_enabled) {
    throw new Error('Cloud Backup must remain enabled until completion finishes.');
  }
  if (installation.server_tree_revision !== pendingCompletion.baseTreeRevision) {
    throw new Error('The installation changed after completion validation. Sync and retry.');
  }
  if (
    pendingCompletion.localTreeRevision === undefined
    || installation.tree_revision !== pendingCompletion.localTreeRevision
    || !pendingCompletion.treeWatermark
    || pendingCompletion.treeWatermark !== currentTreeWatermark
  ) {
    throw new Error('Local installation work changed after completion validation. Sync and retry.');
  }
  const persisted = installation.pending_completion;
  if (requirePersistedPending) {
    if (!persisted || !pendingCompletionAttemptsMatch(persisted, pendingCompletion)) {
      throw new Error('The pending completion attempt changed before it could be sent.');
    }
  } else if (
    persisted
    && persisted.baseTreeRevision === installation.server_tree_revision
    && !pendingCompletionAttemptsMatch(persisted, pendingCompletion)
  ) {
    throw new Error('Resolve the existing pending completion attempt before starting another.');
  }
}
