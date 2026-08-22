import { File } from 'expo-file-system';
import { sha256 } from 'js-sha256';
import {
  apiClient,
  ApiError,
  AuthError,
  NetworkError,
  assertCurrentCloudSessionAuthority,
  type CloudSessionAuthority,
} from '../api/apiClient';
import {
  getInstallationBackupTree,
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
  assertInstallationAllowsBackupRecovery,
  assertInstallationAllowsNewBackupDispatch,
  InstallationBackupDispatchBlockedError,
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
import { uploadThenConfirmForAuthority } from './backupAuthorityFence';
import {
  assertCurrentAssignedWorkAuthority,
  type AssignedWorkMutationAuthority,
} from './assignedWorkMutationGuard';
import {
  captureServerResultInstallationSnapshot,
  type ServerResultCommitFence,
} from './serverResultCommitFence';

export type SyncProgress = {
  phase: 'idle' | 'preparing' | 'pushing' | 'uploading' | 'done' | 'error' | 'offline';
  installationId?: string;
  uploaded: number;
  total: number;
  failedCount: number;
  lastError?: string;
};

export interface CloudBackupRunAuthority {
  /** Only the exact same caller authority object may join this flight. */
  readonly identity: object;
  readonly actorUserId: string;
  readonly cloudAuthority: CloudSessionAuthority;
  readonly assignedWorkAuthority: AssignedWorkMutationAuthority;
  readonly assertAdditionalAuthority?: () => void;
}

export class CloudBackupAuthorityChangedError extends Error {
  readonly code = 'CLOUD_BACKUP_AUTHORITY_CHANGED';

  constructor(cause: unknown) {
    super(cause instanceof Error
      ? cause.message
      : 'The authenticated Cloud Backup authority changed.');
    this.name = 'CloudBackupAuthorityChangedError';
  }
}

function assertCloudBackupRunAuthorityCurrent(
  authority: CloudBackupRunAuthority,
): void {
  try {
    assertCurrentCloudSessionAuthority(
      authority.cloudAuthority,
      authority.actorUserId,
    );
    assertCurrentAssignedWorkAuthority(
      authority.assignedWorkAuthority,
      authority.actorUserId,
    );
    authority.assertAdditionalAuthority?.();
  } catch (error) {
    if (error instanceof CloudBackupAuthorityChangedError) throw error;
    throw new CloudBackupAuthorityChangedError(error);
  }
}

function serverResultCommitFence(
  authority: CloudBackupRunAuthority,
  expectedLocalTreeRevision: number,
  expectedTreeWatermark: string,
): ServerResultCommitFence {
  return {
    actorUserId: authority.actorUserId,
    expectedLocalTreeRevision,
    expectedTreeWatermark,
    assertCurrent: () => assertCloudBackupRunAuthorityCurrent(authority),
  };
}

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
  assertCurrent: () => void,
): Promise<void> {
  await updateUploadQueueItem(row.id, {
    status: 'cleared',
    checksum,
    remote_url: remoteUrl,
    session_id: undefined,
    last_error: undefined,
  }, assertCurrent);
}

async function applyDuplicateUploadRevision(
  installationId: string,
  treeRevision: unknown,
  commitFence: ServerResultCommitFence,
): Promise<void> {
  await recordInstallationServerTreeRevision(
    installationId,
    confirmedUploadTreeRevision(treeRevision),
    commitFence,
  );
}

async function processUpload(
  row: CloudUploadQueueItem,
  authority: CloudBackupRunAuthority,
): Promise<void> {
  const assertCurrent = () => assertCloudBackupRunAuthorityCurrent(authority);
  assertCurrent();
  assertInstallationAllowsNewBackupDispatch(
    row.installation_id,
    authority.actorUserId,
  );
  const file = new File(row.local_uri);
  if (!file.exists) {
    await updateUploadQueueItem(row.id, {
      status: 'failed',
      attempts: row.attempts + 1,
      last_error: 'Local evidence file is missing.',
    }, assertCurrent);
    throw new Error('Local evidence file is missing.');
  }

  const bytes = bytesFromBase64(await file.base64());
  assertCurrent();
  const checksum = sha256(bytes);
  const localTreeAtDispatch = await getInstallationBackupTree(row.installation_id);
  assertCurrent();
  if (!localTreeAtDispatch) throw new Error('Installation not found.');
  const baseTreeRevision = localTreeAtDispatch.baseTreeRevision;
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
  const commitFence = serverResultCommitFence(
    authority,
    localTreeAtDispatch.installation.tree_revision ?? 0,
    localTreeAtDispatch.watermark,
  );

  await updateUploadQueueItem(row.id, {
    status: 'uploading',
    attempts: row.attempts + 1,
    checksum,
    last_error: undefined,
  }, assertCurrent);

  try {
    assertCurrent();
    assertInstallationAllowsNewBackupDispatch(
      row.installation_id,
      authority.actorUserId,
    );
    const duplicate = await apiClient.checkPhoto(
      { ...identity, checksum },
      authority.cloudAuthority,
    );
    assertCurrent();
    if (duplicate.exists && duplicate.remoteUrl) {
      await applyDuplicateUploadRevision(
        row.installation_id,
        duplicate.treeRevision,
        commitFence,
      );
      assertCurrent();
      await markUploadComplete(row, checksum, duplicate.remoteUrl, assertCurrent);
      assertCurrent();
      return;
    }

    assertCurrent();
    assertInstallationAllowsNewBackupDispatch(
      row.installation_id,
      authority.actorUserId,
    );
    const session = await apiClient.createUploadSession({
      ...identity,
      checksum,
      filename: row.local_uri.split('/').pop() || 'evidence.jpg',
      fileSizeBytes: file.size ?? bytes.byteLength,
    }, authority.cloudAuthority);
    assertCurrent();
    if (session.alreadyExists && session.remoteUrl) {
      await applyDuplicateUploadRevision(
        row.installation_id,
        session.treeRevision,
        commitFence,
      );
      assertCurrent();
      await markUploadComplete(row, checksum, session.remoteUrl, assertCurrent);
      assertCurrent();
      return;
    }
    if (!session.uploadUrl) throw new Error('Upload session did not provide an upload URL.');

    await updateUploadQueueItem(row.id, {
      status: 'uploading',
      checksum,
      session_id: session.sessionId,
    }, assertCurrent);
    assertCurrent();
    assertInstallationAllowsNewBackupDispatch(
      row.installation_id,
      authority.actorUserId,
    );
    const confirmed = await uploadThenConfirmForAuthority(
      assertCurrent,
      () => apiClient.uploadPhoto(
        session.uploadUrl!,
        bytes.buffer as ArrayBuffer,
        row.mime_type,
      ),
      () => apiClient.confirmUpload(
        session.sessionId,
        checksum,
        authority.cloudAuthority,
      ),
    );
    assertCurrent();
    // Confirmation mutates the server tree. Persist its authoritative CAS
    // revision before clearing the queue row so a retry can safely replay the
    // idempotent confirmation and the final push never uses metadata's stale
    // base revision.
    await recordInstallationServerTreeRevision(
      row.installation_id,
      confirmed.treeRevision,
      commitFence,
    );
    assertCurrent();
    await markUploadComplete(row, checksum, confirmed.remoteUrl, assertCurrent);
    assertCurrent();
  } catch (error) {
    if (
      error instanceof InstallationBackupDispatchBlockedError
      || error instanceof CloudBackupAuthorityChangedError
      || error instanceof AuthError
    ) {
      await updateUploadQueueItem(row.id, {
        status: 'pending',
        last_error: undefined,
      }, assertCurrent);
      throw error;
    }
    await updateUploadQueueItem(row.id, {
      status: 'failed',
      checksum,
      last_error: error instanceof Error ? error.message : String(error),
    }, assertCurrent);
    throw error;
  }
}

async function fetchAndMergeCanonicalTree(
  installationId: string,
  expectedTreeRevision: number,
  expectedLocalTreeRevision: number,
  expectedTreeWatermark: string,
  replaceRecordedChanges: boolean,
  authority: CloudBackupRunAuthority,
): Promise<RemoteInstallationTree> {
  assertCloudBackupRunAuthorityCurrent(authority);
  const response = await apiClient.pull(
    '1970-01-01T00:00:00.000Z',
    installationId,
    authority.cloudAuthority,
  );
  assertCloudBackupRunAuthorityCurrent(authority);
  const tree = response.installations.find(
    (item) => String(item.installation.id ?? '') === installationId,
  );
  if (!tree) throw new Error('Canonical server tree was unavailable after backup.');
  assertCloudBackupRunAuthorityCurrent(authority);
  await reconcileResolvedDisplayCodes(
    installationId,
    tree,
    expectedTreeRevision,
    serverResultCommitFence(
      authority,
      expectedLocalTreeRevision,
      expectedTreeWatermark,
    ),
    replaceRecordedChanges,
  );
  assertCloudBackupRunAuthorityCurrent(authority);
  return tree;
}

function completeBackupDependencies(
  authority: CloudBackupRunAuthority,
): CompleteBackupConfirmationDependencies {
  return {
    getInstallationBackupTree,
    push: (payload) => apiClient.push(payload, authority.cloudAuthority),
    recordAccepted: (...args) => recordAcceptedCompleteBackupAttempt(
      ...args,
      () => assertCloudBackupRunAuthorityCurrent(authority),
    ),
    fetchAndMerge: (
      installationId,
      expectedTreeRevision,
      expectedLocalTreeRevision,
      expectedTreeWatermark,
      replaceRecordedChanges,
    ) => fetchAndMergeCanonicalTree(
      installationId,
      expectedTreeRevision,
      expectedLocalTreeRevision,
      expectedTreeWatermark,
      replaceRecordedChanges,
      authority,
    ),
    applyServerState: (
      installationId,
      patch,
      expectedLocalTreeRevision,
      expectedTreeWatermark,
    ) => installationsRepo.applyServerState(
      installationId,
      patch,
      serverResultCommitFence(
        authority,
        expectedLocalTreeRevision,
        expectedTreeWatermark,
      ),
    ),
    finish: (installationId, attemptId) => finishCompleteBackupAttempt(
      installationId,
      attemptId,
      () => assertCloudBackupRunAuthorityCurrent(authority),
    ),
  };
}

function backupDispatchStillAllowed(
  installationId: string,
  actorUserId: string,
): boolean {
  try {
    assertInstallationAllowsNewBackupDispatch(installationId, actorUserId);
    return true;
  } catch (error) {
    if (error instanceof InstallationBackupDispatchBlockedError) return false;
    throw error;
  }
}

function backupRecoveryStillAllowed(
  installationId: string,
  actorUserId: string,
): boolean {
  try {
    assertInstallationAllowsBackupRecovery(installationId, actorUserId);
    return true;
  } catch (error) {
    if (error instanceof InstallationBackupDispatchBlockedError) return false;
    throw error;
  }
}

async function executeCloudBackup(
  onProgress: (progress: SyncProgress) => void = () => {},
  authority: CloudBackupRunAuthority,
): Promise<SyncProgress> {
  const assertCurrentSession = () => {
    assertCloudBackupRunAuthorityCurrent(authority);
  };
  const syncStartedAt = Date.now();
  let uploaded = 0;
  let total = 0;
  let activeInstallationId: string | undefined;
  const confirmationDependencies = completeBackupDependencies(authority);
  const recoveryConfirmationDependencies: CompleteBackupConfirmationDependencies = {
    ...confirmationDependencies,
    assertNewDispatchAllowed: (installationId) => {
      assertCurrentSession();
      assertInstallationAllowsBackupRecovery(
        installationId,
        authority.actorUserId,
      );
    },
  };
  const newConfirmationDependencies: CompleteBackupConfirmationDependencies = {
    ...confirmationDependencies,
    assertNewDispatchAllowed: (installationId) => {
      assertCurrentSession();
      assertInstallationAllowsNewBackupDispatch(
        installationId,
        authority.actorUserId,
      );
    },
  };

  try {
    assertCurrentSession();
    await resetInterruptedUploads(authority.actorUserId);
    assertCurrentSession();
    // Recovery is independent of the current backup opt-in and dirty flags:
    // once a final request may have committed, it must be reconciled first.
    for (const attempt of await listPendingCompleteBackupAttempts()) {
      assertCurrentSession();
      if (!backupRecoveryStillAllowed(
        attempt.installation_id,
        authority.actorUserId,
      )) continue;
      activeInstallationId = attempt.installation_id;
      onProgress({
        phase: 'pushing',
        installationId: activeInstallationId,
        uploaded,
        total,
        failedCount: 0,
      });
      await confirmCompleteBackupAttempt(attempt, recoveryConfirmationDependencies);
      assertCurrentSession();
    }

    assertCurrentSession();
    const trees = await listInstallationsNeedingBackup(authority.actorUserId);
    assertCurrentSession();
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
        serverResultCommitFence(
          authority,
          originalTree.installation.tree_revision ?? 0,
          originalTree.watermark,
        ),
      );
      let queue = await listUploadQueue(installationId);
      total += queue.filter((item) => item.status !== 'cleared').length;

      // A prior confirm may have committed even if its response was lost or
      // the app was killed. Replay the bound session before metadata so its
      // exact CAS revision is recovered instead of immediately conflicting.
      const uploadRecoveryCommitFence = serverResultCommitFence(
        authority,
        originalTree.installation.tree_revision ?? 0,
        originalTree.watermark,
      );
      for (const row of queue) {
        if (await recoverUploadConfirmation(row, {
          confirm: (sessionId, checksum) => {
            assertCurrentSession();
            return apiClient.confirmUpload(
              sessionId,
              checksum,
              authority.cloudAuthority,
            );
          },
          recordRevision: (id, revision) => recordInstallationServerTreeRevision(
            id,
            revision,
            uploadRecoveryCommitFence,
          ),
          markComplete: (item, checksum, remoteUrl) => markUploadComplete(
            item,
            checksum,
            remoteUrl,
            assertCurrentSession,
          ),
          resetUnconfirmed: (item) => updateUploadQueueItem(item.id, {
            status: 'pending',
            session_id: undefined,
            last_error: undefined,
          }, assertCurrentSession),
          isProvenUnconfirmed: isDefinitivelyUnconfirmedUploadConfirmationError,
          assertCurrent: assertCurrentSession,
        })) uploaded += 1;
        assertCurrentSession();
      }
      queue = await listUploadQueue(installationId);
      const refreshedAfterConfirmation = await getInstallationBackupTree(installationId);
      if (!refreshedAfterConfirmation) {
        throw new Error('Installation disappeared during upload confirmation recovery.');
      }
      originalTree = refreshedAfterConfirmation;

      // Confirmation recovery above is allowed to finish an ambiguous request.
      // Every new request below must recheck the latest assignment state.
      assertCurrentSession();
      if (!backupDispatchStillAllowed(installationId, authority.actorUserId)) continue;

      onProgress({
        phase: 'pushing',
        installationId,
        uploaded,
        total,
        failedCount: queue.filter((item) => item.status === 'failed').length,
      });
      const metadataSnapshot = captureServerResultInstallationSnapshot(originalTree);
      const metadataResult = await apiClient.push(
        buildBackupPayload(originalTree, queue, 'metadata'),
        authority.cloudAuthority,
      );
      assertCurrentSession();
      // The confirmation pull commits server identity, generated codes, and
      // the accepted CAS revision atomically. A revision-only write here can
      // strand an imported copy if the pull is interrupted.
      await fetchAndMergeCanonicalTree(
        installationId,
        metadataResult.treeRevision,
        metadataSnapshot.localTreeRevision,
        metadataSnapshot.treeWatermark,
        true,
        authority,
      );
      assertCurrentSession();
      await installationsRepo.applyServerState(installationId, {
        status: metadataSnapshot.status,
        // A reopened Draft may still carry its last immutable version for
        // historical reporting. A null metadata result must not erase it.
        record_version_number: metadataResult.recordVersionNumber ??
          metadataSnapshot.recordVersionNumber,
        backup_conflict: { kind: 'NONE' },
      }, serverResultCommitFence(
        authority,
        metadataSnapshot.localTreeRevision,
        metadataSnapshot.treeWatermark,
      ));
      assertCurrentSession();

      let next = await getNextUpload(installationId);
      while (next) {
        assertCurrentSession();
        if (!backupDispatchStillAllowed(installationId, authority.actorUserId)) break;
        onProgress({
          phase: 'uploading',
          installationId,
          uploaded,
          total,
          failedCount: queue.filter((item) => item.status === 'failed').length,
        });
        try {
          await processUpload(next, authority);
        } catch (error) {
          if (error instanceof InstallationBackupDispatchBlockedError) break;
          throw error;
        }
        uploaded += 1;
        queue = await listUploadQueue(installationId);
        next = await getNextUpload(installationId);
      }

      assertCurrentSession();
      if (!backupDispatchStillAllowed(installationId, authority.actorUserId)) continue;

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
      let completeAttempt: Awaited<ReturnType<typeof prepareCompleteBackupAttempt>> | undefined;
      try {
        assertCurrentSession();
        completeAttempt = await prepareCompleteBackupAttempt(
          installationId,
          authority.actorUserId,
          buildBackupPayload(latestTree, queue, 'complete'),
          latestTree.watermark,
          latestTree.installation.status,
          latestTree.installation.tree_revision ?? 0,
          serverResultCommitFence(
            authority,
            latestTree.installation.tree_revision ?? 0,
            latestTree.watermark,
          ),
        );
        await confirmCompleteBackupAttempt(
          completeAttempt,
          newConfirmationDependencies,
        );
      } catch (error) {
        if (!(error instanceof InstallationBackupDispatchBlockedError)) throw error;
        if (completeAttempt) {
          const durableAttempt = await getPendingCompleteBackupAttempt(installationId);
          if (
            durableAttempt?.id === completeAttempt.id
            && durableAttempt.accepted_tree_revision === undefined
          ) {
            await discardCompleteBackupAttempt(
              installationId,
              completeAttempt.id,
              assertCurrentSession,
            );
          }
        }
      }
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
        assertCurrentSession,
      );
      // A definitive conflict proves this exact final attempt can no longer
      // become the current server snapshot. Retire only that compare-matched
      // marker while preserving the conflict and dirty local tree for review.
      const pendingAttempt = await getPendingCompleteBackupAttempt(activeInstallationId);
      if (pendingAttempt) {
        await discardCompleteBackupAttempt(
          activeInstallationId,
          pendingAttempt.id,
          assertCurrentSession,
        );
      }
    }
    const failedCount = (await listUploadQueue(undefined, authority.actorUserId))
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

// The process still performs at most one backup at a time. Only callers that
// present the exact same authority identity may join; a different foreground,
// background, actor, or session flight waits and then re-runs under its own
// fences.
export const runCloudBackup = createSingleFlightProgressRunner<
  SyncProgress,
  SyncProgress,
  CloudBackupRunAuthority
>(
  executeCloudBackup,
  (active, incoming) => active.identity === incoming.identity,
);
