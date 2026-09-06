import { sha256 } from 'js-sha256';
import type { AppDataStore, PendingMetadataBackupAttempt, ConflictedMetadataBackupAttempt } from '../types';
import type { RemoteInstallationTree } from '../api/apiClient';
import { getStore, initStore, updateStore } from '../data/seed';
import { nowIso } from '../utils';
import { buildInstallationBackupTree, installationAllowsNewBackupDispatch, serverBaseTreeRevision, type InstallationBackupTree } from './cloudSyncRepository';
import { assertInstallationNotRecovering } from '../services/installationRecoveryFence';
import { applyServerResultCommitFence, type ServerResultCommitFence } from '../services/serverResultCommitFence';
import { applyMetadataBackupRecovery, type MetadataBackupRecoveryCommitFence } from '../services/metadataBackupRecovery';

import { assertMetadataRejectionObservation, metadataPrecommitRejectionCode, type MetadataRejectionObservation } from '../services/metadataBackupRejection';

import { consumeForegroundRejectedMetadataRetry, type ForegroundRejectedMetadataRetry } from '../services/foregroundRejectedMetadataRetry';

import { assignedWorkTreeReplacementHasNoRetainedScreen } from '../services/assignedWorkNavigationFence';

const exact = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = (value: unknown): string => sha256(JSON.stringify(value));
const attemptId = (actor: string, payloadHash: string, treeHash: string, preimageHash = '') =>
  `metadata-backup:${sha256(`${actor}\n${payloadHash}\n${treeHash}\n${preimageHash}`)}`;

export function assertPendingMetadataAttempt(id: string, attempt: PendingMetadataBackupAttempt): PendingMetadataBackupAttempt {
  const payload = attempt?.payload;
  const root = payload?.installation as Record<string, unknown> | undefined;
  const sent = attempt?.sent_tree;
  const preimage = attempt?.base_remote_tree;
  const preimageRevision = preimage?.treeRevision ?? preimage?.installation.treeRevision ?? preimage?.installation.tree_revision;
  const preimageOwner = preimage?.installation.createdByUserId ?? preimage?.installation.created_by_user_id;
  const preimageAssignee = preimage?.installation.assignedInspectorUserId ?? preimage?.installation.assigned_inspector_user_id;
  if (!attempt || attempt.version !== 1 || attempt.installation_id !== id
    || !attempt.actor_user_id?.trim() || !attempt.prepared_at
    || !Number.isSafeInteger(attempt.local_tree_revision) || attempt.local_tree_revision < 0
    || !['Draft', 'Completed'].includes(attempt.installation_status)
    || !attempt.tree_watermark || !payload || payload.syncStage !== 'metadata' || payload.treeSchemaVersion !== 2
    || root?.id !== id || !sent || sent.treeSchemaVersion !== 2 || sent.installation?.id !== id
    || sent.installation.local_owner_user_id !== attempt.actor_user_id
    || sent.installation.status !== attempt.installation_status
    || (sent.installation.tree_revision ?? 0) !== attempt.local_tree_revision || sent.watermark !== attempt.tree_watermark
    || attempt.payload_sha256 !== hash(payload) || attempt.sent_tree_sha256 !== hash(sent)
    || attempt.id !== attemptId(attempt.actor_user_id, attempt.payload_sha256, attempt.sent_tree_sha256, attempt.base_remote_tree_sha256)
    || payload.baseTreeRevision !== attempt.base_tree_revision
    || serverBaseTreeRevision(sent.installation) !== attempt.base_tree_revision
    || (attempt.base_tree_revision === undefined
      ? preimage !== undefined || attempt.base_remote_tree_sha256 !== undefined
      : !preimage || preimage.treeSchemaVersion !== 2 || preimage.installation.id !== id
        || preimageRevision !== attempt.base_tree_revision || attempt.base_remote_tree_sha256 !== hash(preimage)
        || preimage.installation.status !== attempt.installation_status
        || (preimageOwner !== attempt.actor_user_id && preimageAssignee !== attempt.actor_user_id))
    || (attempt.base_tree_revision !== undefined && (!Number.isSafeInteger(attempt.base_tree_revision) || attempt.base_tree_revision < 0))
    || (attempt.accepted_tree_revision !== undefined && (!Number.isSafeInteger(attempt.accepted_tree_revision)
      || attempt.accepted_tree_revision < (attempt.base_tree_revision ?? 0)))
    || (attempt.accepted_record_version_number != null && (!Number.isSafeInteger(attempt.accepted_record_version_number)
      || attempt.accepted_record_version_number < 0))) {
    throw new Error('Pending metadata backup identity or integrity check failed. Its original request was preserved.');
  }
  return attempt;
}

function assertActor(store: AppDataStore, id: string, actor: string, assertCurrent: () => void) {
  assertCurrent(); assertInstallationNotRecovering(id);
  const installation = store.installations.find((item) => item.id === id);
  if (!installation || installation.local_owner_user_id !== actor
    || (installation.assigned_work_state !== 'none' && installation.assigned_work_actor_user_id !== actor)) {
    throw new Error('Metadata backup belongs to another installation account.');
  }
  return installation;
}

export function applyPreparedMetadataBackupAttempt(
  store: AppDataStore, tree: InstallationBackupTree, payload: Record<string, unknown>, fence: ServerResultCommitFence,
  baseRemoteTree?: RemoteInstallationTree,
  foregroundRetry?: { descriptor: ForegroundRejectedMetadataRetry; firstCreateAbsenceProved: boolean },
): PendingMetadataBackupAttempt {
  const id = tree.installation.id;
  return applyServerResultCommitFence(store, id, fence, () => {
    const installation = assertActor(store, id, fence.actorUserId, fence.assertCurrent);
    if (!installationAllowsNewBackupDispatch(installation, fence.actorUserId)
      || installation.pending_completion || store.cloudSync.pending_complete_attempts?.[id]
      || store.cloudSync.conflicted_complete_attempts?.[id]
      || store.cloudSync.conflicted_metadata_attempts?.[id]) {
      throw new Error('Resolve the installation backup or completion state before preparing metadata.');
    }
    if (hash(buildInstallationBackupTree(store, installation)) !== hash(tree)) {
      throw new Error('Installation changed before its metadata request was persisted.');
    }
    const frozenPayload = exact(payload); const sent = exact(tree);
    const payloadHash = hash(frozenPayload); const treeHash = hash(sent);
    const attempt: PendingMetadataBackupAttempt = {
      version: 1, id: attemptId(fence.actorUserId, payloadHash, treeHash, baseRemoteTree ? hash(baseRemoteTree) : ''), installation_id: id,
      actor_user_id: fence.actorUserId, payload: frozenPayload, payload_sha256: payloadHash,
      sent_tree: sent, sent_tree_sha256: treeHash, base_tree_revision: sent.baseTreeRevision,
      local_tree_revision: sent.installation.tree_revision ?? 0, tree_watermark: sent.watermark,
      installation_status: sent.installation.status, prepared_at: nowIso(),
      ...(baseRemoteTree ? { base_remote_tree: exact(baseRemoteTree), base_remote_tree_sha256: hash(baseRemoteTree) } : {}),
    };
    assertPendingMetadataAttempt(id, attempt);
    for (const entry of foregroundRetry?.descriptor.attempts ?? []) {
      if (entry.installationId !== id) continue;
      const captured = store.cloudSync.rejected_metadata_attempts?.[entry.attemptId];
      if (captured?.payload_sha256 === payloadHash && captured.sent_tree_sha256 === treeHash
        && captured.base_remote_tree_sha256 !== attempt.base_remote_tree_sha256) {
        throw new Error('The server preimage changed since this metadata request was rejected. Local work was preserved.');
      }
    }
    const pending = store.cloudSync.pending_metadata_attempts ?? {};
    if (pending[id]) {
      if (foregroundRetry) throw new Error('A metadata request became pending before manual retry. Recover its original request first.');
      const previous = assertPendingMetadataAttempt(id, pending[id]);
      if (previous.id !== attempt.id) throw new Error('A different metadata backup request is still pending. Retry its original request first.');
      return exact(previous);
    }
    const rejected = store.cloudSync.rejected_metadata_attempts?.[attempt.id];
    if (rejected) {
      if (!foregroundRetry) {
        throw new Error('This metadata request was rejected without changing the server. Correct the reported capture issue, or use the manual Cloud Backup button to retry it. The original request is preserved.');
      }
      assertPendingMetadataAttempt(id, rejected);
      if (rejected.payload_sha256 !== payloadHash || rejected.sent_tree_sha256 !== treeHash
        || rejected.base_remote_tree_sha256 !== attempt.base_remote_tree_sha256
        || metadataPrecommitRejectionCode(400, rejected.rejection_message) !== rejected.rejection_code) {
        throw new Error('The rejected request no longer matches this exact metadata retry. Its original evidence was preserved.');
      }
      if (!baseRemoteTree && !foregroundRetry.firstCreateAbsenceProved) {
        throw new Error('The server did not prove this first-create installation is still absent. The rejected request was preserved.');
      }
      const proof = assertMetadataRejectionObservation(rejected, baseRemoteTree
        ? { kind: 'unchanged_preimage', tree: baseRemoteTree }
        : { kind: 'absent_first_dispatch', installationId: id, freshFirstDispatch: true });
      if (hash(proof) !== hash(rejected.rejection_proof)) {
        throw new Error('The rejected metadata proof changed before retry. Its original evidence was preserved.');
      }
      // Do not consume the button invocation until every durable/current check
      // passes. A failed persistence cannot dispatch; another press can retry.
      assertActor(store, id, fence.actorUserId, fence.assertCurrent);
      consumeForegroundRejectedMetadataRetry(foregroundRetry.descriptor, fence.actorUserId, rejected);
    }
    store.cloudSync.pending_metadata_attempts = pending;
    pending[id] = attempt;
    return exact(attempt);
  });
}

export async function prepareMetadataBackupAttempt(
  tree: InstallationBackupTree, payload: Record<string, unknown>, fence: ServerResultCommitFence, baseRemoteTree?: RemoteInstallationTree,
  foregroundRetry?: { descriptor: ForegroundRejectedMetadataRetry; firstCreateAbsenceProved: boolean },
) {
  let result!: PendingMetadataBackupAttempt;
  await updateStore((store) => { result = applyPreparedMetadataBackupAttempt(store, tree, payload, fence, baseRemoteTree, foregroundRetry); });
  return result;
}

export async function listPendingMetadataBackupAttempts(actor: string): Promise<PendingMetadataBackupAttempt[]> {
  await initStore();
  return Object.entries(getStore().cloudSync.pending_metadata_attempts ?? {})
    .filter(([, attempt]) => attempt.actor_user_id === actor)
    .map(([id, attempt]) => exact(assertPendingMetadataAttempt(id, attempt)));
}

export function applyAcceptedMetadataBackupAttempt(
  store: AppDataStore, original: PendingMetadataBackupAttempt, result: { installationId: string; treeRevision: number; recordVersionNumber: number | null },
  assertCurrent: () => void,
) {
  assertActor(store, original.installation_id, original.actor_user_id, assertCurrent);
  const attempt = store.cloudSync.pending_metadata_attempts?.[original.installation_id];
  if (!attempt || assertPendingMetadataAttempt(original.installation_id, attempt).id !== original.id
    || result.installationId !== original.installation_id || !Number.isSafeInteger(result.treeRevision)
    || result.treeRevision < (attempt.base_tree_revision ?? 0)
    || (result.recordVersionNumber !== null && (!Number.isSafeInteger(result.recordVersionNumber) || result.recordVersionNumber < 0))
    || (attempt.accepted_tree_revision !== undefined && attempt.accepted_tree_revision !== result.treeRevision)
    || (Object.prototype.hasOwnProperty.call(attempt, 'accepted_record_version_number')
      && attempt.accepted_record_version_number !== result.recordVersionNumber)) {
    throw new Error('Server returned a different metadata backup acknowledgement. The exact original request remains pending.');
  }
  attempt.accepted_tree_revision = result.treeRevision;
  attempt.accepted_record_version_number = result.recordVersionNumber;
}

export async function recordAcceptedMetadataBackupAttempt(
  attempt: PendingMetadataBackupAttempt, result: { installationId: string; treeRevision: number; recordVersionNumber: number | null }, assertCurrent: () => void,
) {
  await updateStore((store) => applyAcceptedMetadataBackupAttempt(store, attempt, result, assertCurrent));
}

export function applyFinishedMetadataBackupAttempt(
  store: AppDataStore, attempt: PendingMetadataBackupAttempt, remote: RemoteInstallationTree, fence: MetadataBackupRecoveryCommitFence, revision: number,
) {
  assertActor(store, attempt.installation_id, attempt.actor_user_id, fence.assertCurrent);
  const durable = store.cloudSync.pending_metadata_attempts?.[attempt.installation_id];
  if (!durable || assertPendingMetadataAttempt(attempt.installation_id, durable).id !== attempt.id
    || durable.accepted_tree_revision !== revision) throw new Error('Metadata confirmation changed before recovery could finish.');
  applyMetadataBackupRecovery(store, durable, remote, fence, revision);
  delete store.cloudSync.pending_metadata_attempts![attempt.installation_id];
  // Metadata acceptance is not a complete backup or a clean content baseline.
  if (!store.cloudSync.force_dirty_installation_ids.includes(attempt.installation_id)) {
    store.cloudSync.force_dirty_installation_ids.push(attempt.installation_id);
  }
}

export async function finishMetadataBackupAttempt(
  attempt: PendingMetadataBackupAttempt, remote: RemoteInstallationTree, fence: MetadataBackupRecoveryCommitFence, revision: number,
) {
  await updateStore((store) => applyFinishedMetadataBackupAttempt(store, attempt, remote, fence, revision));
}

export function applyConflictedMetadataBackupAttempt(store: AppDataStore, attempt: PendingMetadataBackupAttempt, reason: string, assertCurrent: () => void) {
  const installation = assertActor(store, attempt.installation_id, attempt.actor_user_id, assertCurrent);
  const durable = store.cloudSync.pending_metadata_attempts?.[attempt.installation_id];
  if (!durable || assertPendingMetadataAttempt(attempt.installation_id, durable).id !== attempt.id) {
    throw new Error('Metadata intent changed before its conflict could be preserved.');
  }
  const conflicted = store.cloudSync.conflicted_metadata_attempts ??= {};
  if (conflicted[attempt.installation_id] && conflicted[attempt.installation_id].id !== durable.id) {
    throw new Error('An earlier metadata conflict still needs explicit recovery.');
  }
  conflicted[attempt.installation_id] = { ...exact(durable), conflicted_at: nowIso(), conflict_reason: reason };
  delete store.cloudSync.pending_metadata_attempts![attempt.installation_id];
  installation.backup_conflict = { kind: 'CONFLICT', localBaseTreeRevision: attempt.base_tree_revision ?? 0, detectedAt: nowIso() };
  if (!store.cloudSync.force_dirty_installation_ids.includes(attempt.installation_id)) store.cloudSync.force_dirty_installation_ids.push(attempt.installation_id);
}

export async function archiveConflictedMetadataBackupAttempt(attempt: PendingMetadataBackupAttempt, reason: string, assertCurrent: () => void) {
  await updateStore((store) => applyConflictedMetadataBackupAttempt(store, attempt, reason, assertCurrent));
}


/** Retire only a proven non-mutating validation rejection. Later local edits are
 * deliberately untouched; no server base, synced watermark or clean pair moves. */
export function applyRejectedMetadataBackupAttempt(
  store: AppDataStore, original: PendingMetadataBackupAttempt, code: string, message: string,
  observation: MetadataRejectionObservation, assertCurrent: () => void,
) {
  const installation = assertActor(store, original.installation_id, original.actor_user_id, assertCurrent);
  const durable = store.cloudSync.pending_metadata_attempts?.[original.installation_id];
  if (!durable || assertPendingMetadataAttempt(original.installation_id, durable).id !== original.id
    || hash(durable) !== hash(original)
    || metadataPrecommitRejectionCode(400, message) !== code
    || serverBaseTreeRevision(installation) !== durable.base_tree_revision
    || installation.status !== durable.installation_status
    || installation.pending_completion || store.cloudSync.pending_complete_attempts?.[original.installation_id]
    || store.cloudSync.conflicted_metadata_attempts?.[original.installation_id]) {
    throw new Error('Metadata rejection state changed. The original request remains pending.');
  }
  const proof = assertMetadataRejectionObservation(durable, observation);
  const rejected = store.cloudSync.rejected_metadata_attempts ?? {};
  if (rejected[durable.id] && (hash(rejected[durable.id].payload) !== durable.payload_sha256
    || hash(rejected[durable.id].sent_tree) !== durable.sent_tree_sha256)) {
    throw new Error('An existing rejected request has different evidence. Both requests were preserved.');
  }
  // Everything above is read-only; actor/session is checked at the final write.
  assertActor(store, original.installation_id, original.actor_user_id, assertCurrent);
  store.cloudSync.rejected_metadata_attempts = rejected;
  rejected[durable.id] ??= { ...exact(durable), rejected_at: nowIso(), rejection_code: code,
    rejection_message: message, rejection_proof: proof,
    preserved_upload_queue: exact(store.cloudSync.upload_queue.filter((row) => row.installation_id === original.installation_id)),
    preserved_thumbnail_queue: exact(store.cloudSync.thumbnail_queue.filter((row) => row.installation_id === original.installation_id)),
  };
  delete store.cloudSync.pending_metadata_attempts![original.installation_id];
  if (!store.cloudSync.force_dirty_installation_ids.includes(original.installation_id)) {
    store.cloudSync.force_dirty_installation_ids.push(original.installation_id);
  }
}

export async function archiveRejectedMetadataBackupAttempt(
  original: PendingMetadataBackupAttempt, code: string, message: string,
  observation: MetadataRejectionObservation, assertCurrent: () => void,
) {
  await updateStore((store) => applyRejectedMetadataBackupAttempt(store, original, code, message, observation, assertCurrent));
}


/** Read authority for a previously acknowledged conflict: no new POST permission. */
export function assertAcceptedMetadataConflictReadable(store: AppDataStore, original: ConflictedMetadataBackupAttempt, assertCurrent: () => void) {
  const installation = assertActor(store, original.installation_id, original.actor_user_id, assertCurrent);
  assertPendingMetadataAttempt(original.installation_id, original);
  const durable = store.cloudSync.conflicted_metadata_attempts?.[original.installation_id];
  const conflict = installation.backup_conflict;
  if (!durable || hash(durable) !== hash(original) || !original.conflicted_at || !original.conflict_reason
    || original.accepted_tree_revision === undefined
    || !Object.prototype.hasOwnProperty.call(original, 'accepted_record_version_number')
    || installation.assigned_work_state === 'inactive' || installation.is_imported_copy || installation.import_source_server_id
    || installation.status !== original.installation_status || installation.status !== 'Draft'
    || serverBaseTreeRevision(installation) !== original.base_tree_revision
    || store.cloudSync.pending_metadata_attempts?.[original.installation_id]
    || installation.pending_completion || store.cloudSync.pending_complete_attempts?.[original.installation_id]
    || store.cloudSync.conflicted_complete_attempts?.[original.installation_id]
    || (conflict && conflict.kind !== 'NONE' && (conflict.kind !== 'CONFLICT'
      || conflict.localBaseTreeRevision !== (original.base_tree_revision ?? 0)
      || (conflict.remoteTreeRevision !== undefined && conflict.remoteTreeRevision !== original.accepted_tree_revision)))) {
    throw new Error('The acknowledged metadata conflict no longer matches this checkout. Its original evidence was preserved.');
  }
  if (!assignedWorkTreeReplacementHasNoRetainedScreen(original.installation_id)
    || store.siteAssetEditorDrafts?.some((draft) => draft.installationId === original.installation_id)) {
    throw new Error('Return Home and close installation editors before checking this saved backup acknowledgement.');
  }
  return installation;
}

export async function listAcceptedMetadataConflicts(actor: string): Promise<ConflictedMetadataBackupAttempt[]> {
  await initStore();
  return Object.entries(getStore().cloudSync.conflicted_metadata_attempts ?? {})
    .filter(([, attempt]) => attempt.actor_user_id === actor && attempt.accepted_tree_revision !== undefined
      && Object.prototype.hasOwnProperty.call(attempt, 'accepted_record_version_number'))
    .map(([id, attempt]) => exact(assertPendingMetadataAttempt(id, attempt) as ConflictedMetadataBackupAttempt));
}

export function assertCurrentAcceptedMetadataConflict(original: ConflictedMetadataBackupAttempt, assertCurrent: () => void) {
  return assertAcceptedMetadataConflictReadable(getStore(), original, assertCurrent);
}

export function applyResolvedMetadataConflict(
  store: AppDataStore, original: ConflictedMetadataBackupAttempt, remote: RemoteInstallationTree,
  fence: MetadataBackupRecoveryCommitFence,
) {
  const installation = assertAcceptedMetadataConflictReadable(store, original, fence.assertCurrent);
  const current = buildInstallationBackupTree(store, installation);
  if (hash(current) !== fence.expectedTreeSnapshotSha256
    || (current.installation.tree_revision ?? 0) !== fence.expectedLocalTreeRevision || current.watermark !== fence.expectedTreeWatermark) {
    throw new Error('Local work changed while the saved acknowledgement was checked. It was preserved.');
  }
  const canonicalRevision = remote.treeRevision ?? remote.installation.treeRevision ?? remote.installation.tree_revision;
  const canonicalVersion = remote.recordVersionNumber ?? remote.installation.recordVersionNumber;
  // /push represents no finalized version as null; canonical /pull represents it as 0.
  if (remote.treeSchemaVersion !== 2 || remote.installation.id !== original.installation_id
    || canonicalRevision !== original.accepted_tree_revision || remote.installation.status !== original.installation_status
    || canonicalVersion !== (original.accepted_record_version_number ?? 0)) {
    throw new Error('Canonical metadata no longer matches the saved acknowledgement. The conflict remains protected.');
  }
  const next = exact(store);
  delete next.cloudSync.conflicted_metadata_attempts![original.installation_id];
  (next.cloudSync.pending_metadata_attempts ??= {})[original.installation_id] = exact(original);
  const target = next.installations.find((item) => item.id === original.installation_id)!;
  // Only this exact local marker has been proved above. Any assigned-work
  // conflict stays in the clone for the existing fingerprint proof to validate.
  target.backup_conflict = exact(original.sent_tree.installation.backup_conflict ?? { kind: 'NONE' });
  const prepared = buildInstallationBackupTree(next, target);
  applyMetadataBackupRecovery(next, next.cloudSync.pending_metadata_attempts[original.installation_id]!, remote, {
    ...fence, expectedTreeSnapshotSha256: hash(prepared), expectedLocalTreeRevision: prepared.installation.tree_revision ?? 0,
    expectedTreeWatermark: prepared.watermark,
  }, original.accepted_tree_revision!);
  delete next.cloudSync.pending_metadata_attempts[original.installation_id];
  const resolved = next.cloudSync.resolved_metadata_conflicts ??= {};
  if (resolved[original.id] && resolved[original.id].original_sha256 !== hash(original)) {
    throw new Error('An earlier resolution contains different original evidence. Both copies were preserved.');
  }
  resolved[original.id] ??= { version: 1, original: exact(original), original_sha256: hash(original), resolved_at: nowIso(),
    canonical_tree_sha256: hash(remote), accepted_tree_revision: original.accepted_tree_revision!,
    accepted_record_version_number: original.accepted_record_version_number!,
    preserved_upload_queue: exact(store.cloudSync.upload_queue.filter((row) => row.installation_id === original.installation_id)),
    preserved_thumbnail_queue: exact(store.cloudSync.thumbnail_queue.filter((row) => row.installation_id === original.installation_id)),
  };
  if (!next.cloudSync.force_dirty_installation_ids.includes(original.installation_id)) next.cloudSync.force_dirty_installation_ids.push(original.installation_id);
  // All planning is detached. Recheck authority and the original document at
  // the synchronous commit boundary; no work/queue from the sent tree is copied.
  assertAcceptedMetadataConflictReadable(store, original, fence.assertCurrent);
  if (hash(buildInstallationBackupTree(store, installation)) !== fence.expectedTreeSnapshotSha256) {
    throw new Error('Local work changed before acknowledgement recovery could commit.');
  }
  store.installations = next.installations; store.electricalAssets = next.electricalAssets;
  store.siteAssets = next.siteAssets; store.meterDevices = next.meterDevices;
  store.cloudSync = next.cloudSync;
}

export async function resolveAcceptedMetadataConflict(
  original: ConflictedMetadataBackupAttempt, remote: RemoteInstallationTree, fence: MetadataBackupRecoveryCommitFence,
) {
  await updateStore((store) => applyResolvedMetadataConflict(store, original, remote, fence));
}
