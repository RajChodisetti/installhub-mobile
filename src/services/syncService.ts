import { File } from 'expo-file-system';
import { sha256 } from 'js-sha256';
import { apiClient, ApiError, AuthError, NetworkError } from '../api/apiClient';
import {
  getInstallationBackupTree,
  getInstallationSyncMetadata,
  getNextUpload,
  listPendingCompleteBackupAttempts,
  listInstallationsNeedingBackup,
  listUploadQueue,
  finishCompleteBackupAttempt,
  discardCompleteBackupAttempt,
  getPendingCompleteBackupAttempt,
  markInstallationBackupConflict,
  prepareCompleteBackupAttempt,
  recordAcceptedCompleteBackupAttempt,
  recordInstallationServerTreeRevision,
  reconcileBackupMediaQueue,
  resetInterruptedUploads,
  updateUploadQueueItem,
} from '../repositories/cloudSyncRepository';
import { installationsRepo } from '../repositories';
import type { CloudUploadQueueItem } from '../types';
import type { RemoteInstallationTree } from '../api/apiClient';
import { buildBackupPayload, discoverBackupMedia } from './backupMedia';
import {
  CompleteBackupConflictError,
  confirmCompleteBackupAttempt,
  type CompleteBackupConfirmationDependencies,
} from './completeBackupConfirmation';
import { reconcileResolvedDisplayCodes } from './displayCodeReconciliation';
import {
  recordBackupPendingAge,
  recordSyncDiagnostic,
} from './operationalDiagnostics';
import { confirmedUploadTreeRevision } from './uploadConfirmationRevision';
import {
  isDefinitivelyUnconfirmedUploadConfirmationError,
  recoverUploadConfirmation,
} from './uploadConfirmationRecovery';
import { createSingleFlightProgressRunner } from './singleFlightProgress';

export type SyncProgress = {
  phase: 'idle' | 'preparing' | 'pushing' | 'uploading' | 'done' | 'error' | 'offline';
  installationId?: string;
  uploaded: number;
  total: number;
  failedCount: number;
  lastError?: string;
};

function bytesFromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function markUploadComplete(
  row: CloudUploadQueueItem,
  checksum: string,
  remoteUrl: string,
): Promise<void> {
  await updateUploadQueueItem(row.id, {
    status: 'cleared',
    checksum,
    remote_url: remoteUrl,
    session_id: undefined,
    last_error: undefined,
  });
}

async function applyDuplicateUploadRevision(
  installationId: string,
  treeRevision: unknown,
): Promise<void> {
  await recordInstallationServerTreeRevision(
    installationId,
    confirmedUploadTreeRevision(treeRevision),
  );
}

async function processUpload(row: CloudUploadQueueItem): Promise<void> {
  const file = new File(row.local_uri);
  if (!file.exists) {
    await updateUploadQueueItem(row.id, {
      status: 'failed',
      attempts: row.attempts + 1,
      last_error: 'Local evidence file is missing.',
    });
    throw new Error('Local evidence file is missing.');
  }

  const bytes = bytesFromBase64(await file.base64());
  const checksum = sha256(bytes);
  const syncMetadata = await getInstallationSyncMetadata(row.installation_id);
  const baseTreeRevision = syncMetadata.serverTreeRevision;
  if (
    !Number.isSafeInteger(baseTreeRevision)
    || baseTreeRevision === undefined
    || baseTreeRevision < 0
  ) {
    throw new Error('Canonical server revision is required before evidence upload.');
  }
  const identity = {
    installationId: row.installation_id,
    baseTreeRevision,
    entityType: row.entity_type,
    entityId: row.entity_id,
    fieldName: row.field_name,
  };

  await updateUploadQueueItem(row.id, {
    status: 'uploading',
    attempts: row.attempts + 1,
    checksum,
    last_error: undefined,
  });

  try {
    const duplicate = await apiClient.checkPhoto({ ...identity, checksum });
    if (duplicate.exists && duplicate.remoteUrl) {
      await applyDuplicateUploadRevision(row.installation_id, duplicate.treeRevision);
      await markUploadComplete(row, checksum, duplicate.remoteUrl);
      return;
    }

    const session = await apiClient.createUploadSession({
      ...identity,
      checksum,
      filename: row.local_uri.split('/').pop() || 'evidence.jpg',
      fileSizeBytes: file.size ?? bytes.byteLength,
    });
    if (session.alreadyExists && session.remoteUrl) {
      await applyDuplicateUploadRevision(row.installation_id, session.treeRevision);
      await markUploadComplete(row, checksum, session.remoteUrl);
      return;
    }
    if (!session.uploadUrl) throw new Error('Upload session did not provide an upload URL.');

    await updateUploadQueueItem(row.id, {
      status: 'uploading',
      checksum,
      session_id: session.sessionId,
    });
    await apiClient.uploadPhoto(
      session.uploadUrl,
      bytes.buffer as ArrayBuffer,
      row.mime_type,
    );
    const confirmed = await apiClient.confirmUpload(session.sessionId, checksum);
    // Confirmation mutates the server tree. Persist its authoritative CAS
    // revision before clearing the queue row so a retry can safely replay the
    // idempotent confirmation and the final push never uses metadata's stale
    // base revision.
    await recordInstallationServerTreeRevision(row.installation_id, confirmed.treeRevision);
    await markUploadComplete(row, checksum, confirmed.remoteUrl);
  } catch (error) {
    await updateUploadQueueItem(row.id, {
      status: 'failed',
      checksum,
      last_error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function fetchAndMergeCanonicalTree(
  installationId: string,
  expectedTreeRevision: number,
  replaceRecordedChanges: boolean,
): Promise<RemoteInstallationTree> {
  const response = await apiClient.pull('1970-01-01T00:00:00.000Z', installationId);
  const tree = response.installations.find(
    (item) => String(item.installation.id ?? '') === installationId,
  );
  if (!tree) throw new Error('Canonical server tree was unavailable after backup.');
  await reconcileResolvedDisplayCodes(
    installationId,
    tree,
    expectedTreeRevision,
    replaceRecordedChanges,
  );
  return tree;
}

const completeBackupConfirmationDependencies: CompleteBackupConfirmationDependencies = {
  getInstallationBackupTree,
  push: (payload) => apiClient.push(payload),
  recordAccepted: recordAcceptedCompleteBackupAttempt,
  fetchAndMerge: fetchAndMergeCanonicalTree,
  applyServerState: (installationId, patch) =>
    installationsRepo.applyServerState(installationId, patch),
  finish: finishCompleteBackupAttempt,
};

async function executeCloudBackup(
  onProgress: (progress: SyncProgress) => void = () => {},
): Promise<SyncProgress> {
  const syncStartedAt = Date.now();
  let uploaded = 0;
  let total = 0;
  let activeInstallationId: string | undefined;

  try {
    await resetInterruptedUploads();
    // Recovery is independent of the current backup opt-in and dirty flags:
    // once a final request may have committed, it must be reconciled first.
    for (const attempt of await listPendingCompleteBackupAttempts()) {
      activeInstallationId = attempt.installation_id;
      onProgress({
        phase: 'pushing',
        installationId: activeInstallationId,
        uploaded,
        total,
        failedCount: 0,
      });
      await confirmCompleteBackupAttempt(attempt, completeBackupConfirmationDependencies);
    }

    const trees = await listInstallationsNeedingBackup();
    if (!trees.length) {
      const done: SyncProgress = {
        phase: 'done',
        uploaded,
        total,
        failedCount: 0,
      };
      await recordSyncDiagnostic({
        outcome: 'SUCCESS', conflict: false, schemaVersion: 2,
        latencyMs: Date.now() - syncStartedAt,
      });
      onProgress(done);
      return done;
    }

    for (let originalTree of trees) {
      const installationId = originalTree.installation.id;
      activeInstallationId = installationId;
      const pendingSince = Date.parse(originalTree.watermark);
      if (Number.isFinite(pendingSince)) {
        void recordBackupPendingAge(Date.now() - pendingSince);
      }
      onProgress({
        phase: 'preparing',
        installationId,
        uploaded,
        total,
        failedCount: 0,
      });

      await reconcileBackupMediaQueue(
        installationId,
        discoverBackupMedia(originalTree),
      );
      let queue = await listUploadQueue(installationId);
      total += queue.filter((item) => item.status !== 'cleared').length;

      // A prior confirm may have committed even if its response was lost or
      // the app was killed. Replay the bound session before metadata so its
      // exact CAS revision is recovered instead of immediately conflicting.
      for (const row of queue) {
        if (await recoverUploadConfirmation(row, {
          confirm: (sessionId, checksum) => apiClient.confirmUpload(sessionId, checksum),
          recordRevision: recordInstallationServerTreeRevision,
          markComplete: markUploadComplete,
          resetUnconfirmed: (item) => updateUploadQueueItem(item.id, {
            status: 'pending',
            session_id: undefined,
            last_error: undefined,
          }),
          isProvenUnconfirmed: isDefinitivelyUnconfirmedUploadConfirmationError,
        })) uploaded += 1;
      }
      queue = await listUploadQueue(installationId);
      const refreshedAfterConfirmation = await getInstallationBackupTree(installationId);
      if (!refreshedAfterConfirmation) {
        throw new Error('Installation disappeared during upload confirmation recovery.');
      }
      originalTree = refreshedAfterConfirmation;

      onProgress({
        phase: 'pushing',
        installationId,
        uploaded,
        total,
        failedCount: queue.filter((item) => item.status === 'failed').length,
      });
      const metadataResult = await apiClient.push(
        buildBackupPayload(originalTree, queue, 'metadata'),
      );
      // The confirmation pull commits server identity, generated codes, and
      // the accepted CAS revision atomically. A revision-only write here can
      // strand an imported copy if the pull is interrupted.
      await fetchAndMergeCanonicalTree(installationId, metadataResult.treeRevision, true);
      await installationsRepo.applyServerState(installationId, {
        status: originalTree.installation.status,
        // A reopened Draft may still carry its last immutable version for
        // historical reporting. A null metadata result must not erase it.
        record_version_number: metadataResult.recordVersionNumber ??
          originalTree.installation.record_version_number,
        backup_conflict: { kind: 'NONE' },
      });

      let next = await getNextUpload(installationId);
      while (next) {
        onProgress({
          phase: 'uploading',
          installationId,
          uploaded,
          total,
          failedCount: queue.filter((item) => item.status === 'failed').length,
        });
        await processUpload(next);
        uploaded += 1;
        queue = await listUploadQueue(installationId);
        next = await getNextUpload(installationId);
      }

      const failed = queue.filter((item) => item.status === 'failed');
      if (failed.length) throw new Error(failed[0]?.last_error || 'Evidence upload failed.');

      const latestTree = await getInstallationBackupTree(installationId);
      if (!latestTree) continue;
      queue = await listUploadQueue(installationId);
      onProgress({
        phase: 'pushing',
        installationId,
        uploaded,
        total,
        failedCount: 0,
      });
      const completeAttempt = await prepareCompleteBackupAttempt(
        installationId,
        buildBackupPayload(latestTree, queue, 'complete'),
        latestTree.watermark,
        latestTree.installation.status,
        latestTree.installation.tree_revision ?? 0,
      );
      await confirmCompleteBackupAttempt(
        completeAttempt,
        completeBackupConfirmationDependencies,
      );
    }

    const done: SyncProgress = {
      phase: 'done',
      uploaded,
      total,
      failedCount: 0,
    };
    await recordSyncDiagnostic({
      outcome: 'SUCCESS', conflict: false, schemaVersion: 2,
      latencyMs: Date.now() - syncStartedAt,
    });
    onProgress(done);
    return done;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '';
    const conflict = Boolean(
      activeInstallationId &&
      ((error instanceof ApiError && error.status === 409) ||
        error instanceof CompleteBackupConflictError ||
        /display-code conflict|duplicate or empty display codes/i.test(errorMessage))
    );
    if (conflict && activeInstallationId) {
      const remoteRevision = Number(errorMessage.match(/(?:treeRevision|revision)[^0-9]*(\d+)/i)?.[1]);
      await markInstallationBackupConflict(
        activeInstallationId,
        Number.isFinite(remoteRevision) ? remoteRevision : undefined,
      );
      // A definitive conflict proves this exact final attempt can no longer
      // become the current server snapshot. Retire only that compare-matched
      // marker while preserving the conflict and dirty local tree for review.
      const pendingAttempt = await getPendingCompleteBackupAttempt(activeInstallationId);
      if (pendingAttempt) {
        await discardCompleteBackupAttempt(activeInstallationId, pendingAttempt.id);
      }
    }
    const failedCount = (await listUploadQueue())
      .filter((item) => item.status === 'failed').length;
    const progress: SyncProgress = {
      phase: error instanceof NetworkError ? 'offline' : 'error',
      uploaded,
      total,
      failedCount,
      lastError:
        error instanceof AuthError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error),
    };
    await recordSyncDiagnostic({
      outcome: conflict ? 'CONFLICT' : error instanceof NetworkError ? 'OFFLINE' : 'FAILURE',
      conflict,
      schemaVersion: 2,
      latencyMs: Date.now() - syncStartedAt,
    });
    onProgress(progress);
    return progress;
  }
}

// Foreground, app-resume, interval, store-debounce, and OS background callers
// all share this one process-wide operation and receive the same progress.
export const runCloudBackup = createSingleFlightProgressRunner<SyncProgress, SyncProgress>(
  executeCloudBackup,
);
