import { sha256 } from 'js-sha256';
import type { AppDataStore, RejectedMetadataBackupAttempt } from '../types';
import { assignedWorkInstallationIsVisibleToActor } from './assignedWorkPolicy';

export interface ForegroundRejectedMetadataRetry {
  readonly actorUserId: string;
  readonly attempts: readonly {
    readonly installationId: string;
    readonly attemptId: string;
    readonly rejectedRecordSha256: string;
  }[];
}

// This permission exists only for one manual invocation, never in persisted data.
// Keeping consumption by descriptor identity also prevents reuse in another run.
const consumed = new WeakMap<ForegroundRejectedMetadataRetry, Set<string>>();

export function captureForegroundRejectedMetadataRetry(
  store: AppDataStore, actorUserId: string,
): ForegroundRejectedMetadataRetry {
  const eligible = new Set(store.installations.filter((installation) =>
    installation.local_owner_user_id === actorUserId && installation.cloud_backup_enabled
    && assignedWorkInstallationIsVisibleToActor(installation, actorUserId),
  ).map((installation) => installation.id));
  const attempts = Object.entries(store.cloudSync.rejected_metadata_attempts ?? {})
    .filter(([id, record]) => id === record.id && record.actor_user_id === actorUserId && eligible.has(record.installation_id))
    .map(([attemptId, record]) => Object.freeze({
      installationId: record.installation_id, attemptId, rejectedRecordSha256: sha256(JSON.stringify(record)),
    }))
    .sort((a, b) => a.attemptId.localeCompare(b.attemptId));
  const descriptor = Object.freeze({ actorUserId, attempts: Object.freeze(attempts) });
  consumed.set(descriptor, new Set());
  return descriptor;
}

/** Called at the final synchronous preparation boundary, after all store fences. */
export function consumeForegroundRejectedMetadataRetry(
  descriptor: ForegroundRejectedMetadataRetry | undefined,
  actorUserId: string, rejected: RejectedMetadataBackupAttempt,
): void {
  const used = descriptor && consumed.get(descriptor);
  const entry = descriptor?.attempts.find((item) => item.attemptId === rejected.id
    && item.installationId === rejected.installation_id);
  if (!descriptor || !used || descriptor.actorUserId !== actorUserId
    || rejected.actor_user_id !== actorUserId || !entry
    || entry.rejectedRecordSha256 !== sha256(JSON.stringify(rejected)) || used.has(entry.attemptId)) {
    throw new Error('This rejected metadata request needs a fresh manual Cloud Backup retry. Its original evidence was preserved.');
  }
  used.add(entry.attemptId);
}
