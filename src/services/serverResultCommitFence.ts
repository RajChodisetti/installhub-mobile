import type { AppDataStore, Installation } from '../types';
import {
  buildInstallationBackupTree,
  type InstallationBackupTree,
} from '../repositories/cloudSyncRepository';

export interface ServerResultInstallationSnapshot {
  localTreeRevision: number;
  treeWatermark: string;
  status: Installation['status'];
  recordVersionNumber: number | undefined;
}

/** Copies scalars from backup trees whose installation objects are live refs. */
export function captureServerResultInstallationSnapshot(
  tree: InstallationBackupTree,
): ServerResultInstallationSnapshot {
  return {
    localTreeRevision: tree.installation.tree_revision ?? 0,
    treeWatermark: tree.watermark,
    status: tree.installation.status,
    recordVersionNumber: tree.installation.record_version_number,
  };
}

export interface ServerResultCommitFence {
  actorUserId: string;
  expectedLocalTreeRevision: number;
  expectedTreeWatermark: string;
  /** Optional exact server CAS base for lifecycle responses such as reopen. */
  expectedServerTreeRevision?: number;
  /** Revalidates the initiating process generation and cloud session. */
  assertCurrent(): void;
}

export class ServerResultCommitFenceError extends Error {
  readonly code = 'SERVER_RESULT_COMMIT_FENCE_FAILED';
}

/**
 * Runs a server-result mutation only against the exact actor-owned local tree
 * snapshot that initiated the request. The assertion executes inside the
 * serialized store transaction, closing the assert-before-queue race.
 */
export function applyServerResultCommitFence<T>(
  store: AppDataStore,
  installationId: string,
  fence: ServerResultCommitFence,
  commit: (installation: Installation) => T,
): T {
  fence.assertCurrent();
  const installation = store.installations.find(
    (item) => item.id === installationId,
  );
  if (
    !installation
    || installation.local_owner_user_id !== fence.actorUserId
    || (
      installation.assigned_work_state !== 'none'
      && installation.assigned_work_actor_user_id !== fence.actorUserId
    )
  ) {
    throw new ServerResultCommitFenceError(
      'The server response belongs to a different local checkout owner.',
    );
  }
  const currentTree = buildInstallationBackupTree(store, installation);
  if (
    (installation.tree_revision ?? 0) !== fence.expectedLocalTreeRevision
    || currentTree.watermark !== fence.expectedTreeWatermark
    || (
      fence.expectedServerTreeRevision !== undefined
      && installation.server_tree_revision !== fence.expectedServerTreeRevision
    )
  ) {
    throw new ServerResultCommitFenceError(
      'The local installation changed before the server response could be applied.',
    );
  }
  fence.assertCurrent();
  return commit(installation);
}
