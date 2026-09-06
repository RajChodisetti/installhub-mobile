import { sha256 } from 'js-sha256';

const LAST_SYNCED_AT_KEY_PREFIX = 'ih_last_synced_at.';

export function lastSyncedAtSecureStoreKey(actorUserId: string): string {
  if (!actorUserId.trim()) throw new Error('Actor user ID is required.');
  return `${LAST_SYNCED_AT_KEY_PREFIX}${sha256(actorUserId).slice(0, 32)}`;
}

/** Never reinterpret the legacy run timestamp as evidence of a confirmed tree. */
export function lastConfirmedBackupAtSecureStoreKey(actorUserId: string): string {
  if (!actorUserId.trim()) throw new Error('Actor user ID is required.');
  return `ih_last_confirmed_backup_at.${sha256(actorUserId).slice(0, 32)}`;
}
