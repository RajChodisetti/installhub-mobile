import { sha256 } from 'js-sha256';

const LAST_SYNCED_AT_KEY_PREFIX = 'ih_last_synced_at.';

export function lastSyncedAtSecureStoreKey(actorUserId: string): string {
  if (!actorUserId.trim()) throw new Error('Actor user ID is required.');
  return `${LAST_SYNCED_AT_KEY_PREFIX}${sha256(actorUserId).slice(0, 32)}`;
}
