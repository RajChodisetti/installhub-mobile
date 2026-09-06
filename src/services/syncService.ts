import { resolveOwnedMediaUri } from './ownedMediaPaths';
import { anyInstallationRecoveryIsActive } from './installationRecoveryFence';
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
  getInstallationBackupSelection,
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
import type { CloudUploadQueueItem, PendingMetadataBackupAttempt, ConflictedMetadataBackupAttempt } from '../types';
import { metadataPrecommitRejectionCode, type MetadataRejectionObservation } from './metadataBackupRejection';
import { listPendingMetadataBackupAttempts, prepareMetadataBackupAttempt, recordAcceptedMetadataBackupAttempt,
  finishMetadataBackupAttempt, archiveConflictedMetadataBackupAttempt, archiveRejectedMetadataBackupAttempt,
  listAcceptedMetadataConflicts, assertCurrentAcceptedMetadataConflict, resolveAcceptedMetadataConflict } from '../repositories/metadataBackupRepository';
import { confirmMetadataBackupAttempt } from './metadataBackupConfirmation';
import { validateCanonicalRemoteTreeIds } from './remoteInstallationValidation';
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
import type { ForegroundRejectedMetadataRetry } from './foregroundRejectedMetadataRetry';
import { createSingleFlightProgressRunner } from './singleFlightProgress';
import type { BackupInstallationOutcome } from './backupOutcome';
import { uploadThenConfirmForAuthority } from './backupAuthorityFence';
import {
  assertCurrentAssignedWorkAuthority,
  type AssignedWorkMutationAuthority,
} from './assignedWorkMutationGuard';
import {
  type ServerResultCommitFence,
} from './serverResultCommitFence';

export type SyncProgress = {
  phase: 'idle' | 'preparing' | 'pushing' | 'uploading' | 'done' | 'error' | 'offline';
  installationId?: string;
  uploaded: number;
  total: number;
  failedCount: number;
  lastError?: string;
  installationOutcome?: BackupInstallationOutcome;
};

export interface CloudBackupRunAuthority {
  /** Only the exact same caller authority object may join this flight. */
  readonly identity: object;
  readonly actorUserId: string;
  readonly cloudAuthority: CloudSessionAuthority;
  readonly assignedWorkAuthority: AssignedWorkMutationAuthority;
  readonly assertAdditionalAuthority?: () => void;
  /** Foreground assignment refresh runs only after durable requests are recovered. */
  readonly beforeNewBackups?: () => Promise<void>;
  readonly rejectedMetadataRetry?: ForegroundRejectedMetadataRetry;
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
  const file = new File(resolveOwnedMediaUri(row.local_uri));
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

async function recoverMetadataAttempt(attempt: PendingMetadataBackupAttempt, authority: CloudBackupRunAuthority, freshFirstDispatch = false) {
  const assertCurrent = () => {
    assertCloudBackupRunAuthorityCurrent(authority);
    if (attempt.actor_user_id !== authority.actorUserId) throw new Error('Metadata backup belongs to another account.');
    assertInstallationAllowsBackupRecovery(attempt.installation_id, authority.actorUserId);
  };
  await confirmMetadataBackupAttempt(attempt, {
    assertCurrent,
    push: async (payload) => {
      assertCurrent();
      try { return await apiClient.push(payload, authority.cloudAuthority); }
      catch (error) {
        // Only a definitive POST conflict retires ambiguity. Keep its complete
        // original intent for explicit preserved-copy recovery; never rebase it.
        if (error instanceof ApiError && error.status === 409) {
          await archiveConflictedMetadataBackupAttempt(attempt, error.message, assertCurrent);
        }
        const code = error instanceof ApiError ? metadataPrecommitRejectionCode(error.status, error.message) : null;
        if (code && attempt.accepted_tree_revision === undefined
          && !Object.prototype.hasOwnProperty.call(attempt, 'accepted_record_version_number')) {
          assertCurrent();
          let observation: MetadataRejectionObservation;
          try {
            const response = await apiClient.pull('1970-01-01T00:00:00.000Z', attempt.installation_id, authority.cloudAuthority);
            assertCurrent();
            if (response.installations.length !== 1
              || response.installations[0]?.installation.id !== attempt.installation_id) {
              throw new Error('The server could not prove the original request was rejected. It remains pending.');
            }
            const tree = response.installations[0]!;
            validateCanonicalRemoteTreeIds(tree);
            observation = { kind: 'unchanged_preimage', tree };
          } catch (proofError) {
            assertCurrent();
            // A fresh intent has never been dispatched before this engine run.
            // A restarted/replayed first-create must not infer no prior commit
            // from a 404, since the original record might have been purged.
            if (freshFirstDispatch && attempt.base_tree_revision === undefined
              && proofError instanceof ApiError && proofError.status === 404
              && proofError.message === 'Installation not found') {
              observation = { kind: 'absent_first_dispatch', installationId: attempt.installation_id, freshFirstDispatch: true };
            } else throw proofError;
          }
          assertCurrent();
          await archiveRejectedMetadataBackupAttempt(attempt, code, (error as ApiError).message, observation, assertCurrent);
          throw new Error(`${(error as ApiError).message} The rejected request was preserved. Correct this capture issue and back up again.`);
        }
        throw error;
      }
    },
    recordAccepted: (original, result) => recordAcceptedMetadataBackupAttempt(original, result, assertCurrent),
    fetchCanonical: async (id) => {
      assertCurrent();
      const response = await apiClient.pull('1970-01-01T00:00:00.000Z', id, authority.cloudAuthority);
      assertCurrent();
      const matches = response.installations.filter((tree) => tree.installation.id === id);
      if (response.installations.length !== 1 || matches.length !== 1) {
        throw new Error('Canonical metadata confirmation returned unexpected installation scope. Retry the original request.');
      }
      const remote = matches[0]!;
      validateCanonicalRemoteTreeIds(remote);
      return remote;
    },
    finish: async (original, remote, revision) => {
      assertCurrent();
      const current = await getInstallationBackupTree(original.installation_id);
      assertCurrent();
      if (!current) throw new Error('Installation disappeared before metadata confirmation.');
      await finishMetadataBackupAttempt(original, remote, {
        ...serverResultCommitFence(authority, current.installation.tree_revision ?? 0, current.watermark),
        expectedServerTreeRevision: current.installation.server_tree_revision,
        expectedTreeSnapshotSha256: sha256(JSON.stringify(current)),
      }, revision);
    },
  });
}

async function recoverAcceptedMetadataConflict(original: ConflictedMetadataBackupAttempt, authority: CloudBackupRunAuthority) {
  const assertCurrent = () => {
    assertCloudBackupRunAuthorityCurrent(authority);
    if (original.actor_user_id !== authority.actorUserId) throw new Error('The saved acknowledgement belongs to another account.');
    assertCurrentAcceptedMetadataConflict(original, () => assertCloudBackupRunAuthorityCurrent(authority));
  };
  assertCurrent();
  // Use the same pinned cloud read lease, never replay an acknowledged POST.
  const response = await apiClient.pull('1970-01-01T00:00:00.000Z', original.installation_id, authority.cloudAuthority);
  assertCurrent();
  if (response.installations.length !== 1 || response.installations[0]?.installation.id !== original.installation_id) {
    throw new Error('Canonical acknowledgement lookup returned unexpected installation scope. The conflict remains protected.');
  }
  const remote = response.installations[0]!;
  validateCanonicalRemoteTreeIds(remote);
  const current = await getInstallationBackupTree(original.installation_id);
  assertCurrent();
  if (!current) throw new Error('The acknowledged checkout is no longer available.');
  await resolveAcceptedMetadataConflict(original, remote, {
    ...serverResultCommitFence(authority, current.installation.tree_revision ?? 0, current.watermark),
    expectedServerTreeRevision: current.installation.server_tree_revision,
    expectedTreeSnapshotSha256: sha256(JSON.stringify(current)),
  });
  assertCloudBackupRunAuthorityCurrent(authority);
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
  const selectedInstallations = new Set<string>();
  const confirmedInstallations = new Set<string>();
  const skippedInstallations = new Set<string>();
  const finishRun = async (): Promise<SyncProgress> => {
    assertCurrentSession();
    // Re-read after confirmations: edits, opt-outs, recovery, or assignment changes
    // during the run must not be presented as a fully backed-up installation.
    const latest = await getInstallationBackupSelection(authority.actorUserId);
    assertCurrentSession();
    const visible = new Set(latest.visibleInstallationIds);
    const optedIn = new Set(latest.optedInInstallationIds);
    const deferred = new Set(latest.deferredInstallationIds);
    for (const id of skippedInstallations) if (optedIn.has(id)) deferred.add(id);
    const remaining = new Set([...deferred, ...latest.trees.map((tree) => tree.installation.id)]);
    const done: SyncProgress = {
      phase: 'done', uploaded, total, failedCount: 0,
      installationOutcome: {
        selected: [...selectedInstallations].filter((id) => visible.has(id)).length,
        confirmed: [...confirmedInstallations].filter((id) => visible.has(id)).length,
        alreadyCurrent: latest.alreadyCurrentInstallationIds.filter((id) => !confirmedInstallations.has(id)).length,
        deferred: deferred.size, remaining: remaining.size,
      },
    };
    await recordSyncDiagnostic({
      outcome: 'SUCCESS', conflict: false, schemaVersion: 2,
      latencyMs: Date.now() - syncStartedAt,
    });
    assertCurrentSession();
    onProgress(done);
    return done;
  };
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
    for (const original of await listAcceptedMetadataConflicts(authority.actorUserId)) {
      assertCurrentSession(); activeInstallationId = original.installation_id;
      selectedInstallations.add(activeInstallationId);
      onProgress({ phase: 'pushing', installationId: activeInstallationId, uploaded, total, failedCount: 0 });
      await recoverAcceptedMetadataConflict(original, authority);
      assertCurrentSession();
    }
    for (const attempt of await listPendingMetadataBackupAttempts(authority.actorUserId)) {
      assertCurrentSession();
      if (!backupRecoveryStillAllowed(attempt.installation_id, authority.actorUserId)) {
        skippedInstallations.add(attempt.installation_id); continue;
      }
      activeInstallationId = attempt.installation_id;
      selectedInstallations.add(activeInstallationId);
      onProgress({ phase: 'pushing', installationId: activeInstallationId, uploaded, total, failedCount: 0 });
      await recoverMetadataAttempt(attempt, authority);
      assertCurrentSession();
    }
    // Recovery is independent of the current backup opt-in and dirty flags:
    // once a final request may have committed, it must be reconciled first.
    for (const attempt of await listPendingCompleteBackupAttempts()) {
      assertCurrentSession();
      if (!backupRecoveryStillAllowed(
        attempt.installation_id,
        authority.actorUserId,
      )) { skippedInstallations.add(attempt.installation_id); continue; }
      activeInstallationId = attempt.installation_id;
      selectedInstallations.add(activeInstallationId);
      onProgress({
        phase: 'pushing',
        installationId: activeInstallationId,
        uploaded,
        total,
        failedCount: 0,
      });
      await confirmCompleteBackupAttempt(attempt, recoveryConfirmationDependencies);
      assertCurrentSession();
      confirmedInstallations.add(attempt.installation_id);
    }

    assertCurrentSession();
    await authority.beforeNewBackups?.();
    assertCurrentSession();

    assertCurrentSession();
    const { trees } = await getInstallationBackupSelection(authority.actorUserId);
    assertCurrentSession();
    if (!trees.length) return await finishRun();

    for (let originalTree of trees) {
      const installationId = originalTree.installation.id;
      selectedInstallations.add(installationId);
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
      const assertUploadRecoveryCurrent = () => {
        assertCurrentSession();
        assertInstallationAllowsBackupRecovery(installationId, authority.actorUserId);
      };
      const uploadRecoveryCommitFence = { ...serverResultCommitFence(
        authority,
        originalTree.installation.tree_revision ?? 0,
        originalTree.watermark,
      ), assertCurrent: assertUploadRecoveryCurrent };
      for (const row of queue) {
        if (await recoverUploadConfirmation(row, {
          confirm: (sessionId, checksum) => {
            assertUploadRecoveryCurrent();
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
            assertUploadRecoveryCurrent,
          ),
          resetUnconfirmed: (item) => updateUploadQueueItem(item.id, {
            status: 'pending',
            session_id: undefined,
            last_error: undefined,
          }, assertUploadRecoveryCurrent),
          isProvenUnconfirmed: isDefinitivelyUnconfirmedUploadConfirmationError,
          assertCurrent: assertUploadRecoveryCurrent,
        })) uploaded += 1;
        assertUploadRecoveryCurrent();
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
      if (!backupDispatchStillAllowed(installationId, authority.actorUserId)) {
        skippedInstallations.add(installationId); continue;
      }

      onProgress({
        phase: 'pushing',
        installationId,
        uploaded,
        total,
        failedCount: queue.filter((item) => item.status === 'failed').length,
      });
      // Bind the server's original state before dispatch: metadata may retain
      // immutable forms or an old Comms meter which differ from local capture.
      let priorResponse: { installations: RemoteInstallationTree[] };
      let firstCreateAbsenceProved = false;
      try {
        priorResponse = await apiClient.pull('1970-01-01T00:00:00.000Z', installationId, authority.cloudAuthority);
      } catch (error) {
        assertCurrentSession();
        // The scoped route checks existence before listing. Only its explicit
        // missing-installation response proves a first-create has no preimage.
        if (originalTree.baseTreeRevision === undefined && error instanceof ApiError
          && error.status === 404 && error.message === 'Installation not found') {
          priorResponse = { installations: [] };
          firstCreateAbsenceProved = true;
        } else throw error;
      }
      assertCurrentSession();
      const priorTrees = priorResponse.installations.filter((tree) => tree.installation.id === installationId);
      const priorTree = priorTrees[0];
      if (priorResponse.installations.length !== priorTrees.length
        || (originalTree.baseTreeRevision === undefined ? priorTrees.length !== 0 : priorTrees.length !== 1)) {
        throw new Error('The server installation no longer matches the known metadata base. Refresh and review before backup.');
      }
      if (priorTree) {
        validateCanonicalRemoteTreeIds(priorTree);
        if (priorTree.treeSchemaVersion !== 2
          || (priorTree.treeRevision ?? priorTree.installation.treeRevision ?? priorTree.installation.tree_revision) !== originalTree.baseTreeRevision) {
          throw new Error('The server revision changed before metadata could be prepared. Local work was preserved.');
        }
      }
      const metadataAttempt = await prepareMetadataBackupAttempt(
        originalTree, buildBackupPayload(originalTree, queue, 'metadata'),
        serverResultCommitFence(authority, originalTree.installation.tree_revision ?? 0, originalTree.watermark),
        priorTree,
        authority.rejectedMetadataRetry ? { descriptor: authority.rejectedMetadataRetry, firstCreateAbsenceProved } : undefined,
      );
      assertCurrentSession();
      await recoverMetadataAttempt(metadataAttempt, authority, true);
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
      if (!backupDispatchStillAllowed(installationId, authority.actorUserId)) {
        skippedInstallations.add(installationId); continue;
      }

      const failed = queue.filter((item) => item.status === 'failed');
      if (failed.length) throw new Error(failed[0]?.last_error || 'Evidence upload failed.');

      const latestTree = await getInstallationBackupTree(installationId);
      if (!latestTree) { skippedInstallations.add(installationId); continue; }
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
        assertCurrentSession();
        confirmedInstallations.add(installationId);
      } catch (error) {
        if (!(error instanceof InstallationBackupDispatchBlockedError)) throw error;
        skippedInstallations.add(installationId);
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

    return await finishRun();
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
let activeCloudBackupRuns = 0;
export function cloudBackupIsRunning(): boolean { return activeCloudBackupRuns > 0; }
export const runCloudBackup = createSingleFlightProgressRunner<
  SyncProgress,
  SyncProgress,
  CloudBackupRunAuthority
>(
  async (...args) => {
    // Mutual exclusion is established synchronously, before either operation
    // awaits: a new engine cannot replay durable upload receipts during recovery.
    if (anyInstallationRecoveryIsActive()) throw new Error('Wait for installation recovery to finish before Cloud Backup.');
    activeCloudBackupRuns += 1;
    try { return await executeCloudBackup(...args); }
    finally { activeCloudBackupRuns -= 1; }
  },
  (active, incoming) => active.identity === incoming.identity,
);
