import type {
  AppDataStore,
  ThumbnailDownloadQueueItem,
} from '../types';
import { assignedWorkInstallationIsVisibleToActor } from './assignedWorkPolicy';

function actorMayUseThumbnailInstallation(
  store: AppDataStore,
  installationId: string,
  actorUserId: string,
): boolean {
  const installation = store.installations.find(
    (item) => item.id === installationId,
  );
  return Boolean(
    installation
    && assignedWorkInstallationIsVisibleToActor(installation, actorUserId),
  );
}

export function thumbnailDownloadsForActor(
  store: AppDataStore,
  actorUserId: string,
): ThumbnailDownloadQueueItem[] {
  const ownedInstallationIds = new Set(
    store.installations
      .filter((installation) => (
        assignedWorkInstallationIsVisibleToActor(installation, actorUserId)
      ))
      .map((installation) => installation.id),
  );
  return store.cloudSync.thumbnail_queue.filter(
    (job) => ownedInstallationIds.has(job.installation_id),
  );
}

export function nextThumbnailDownloadForActor(
  store: AppDataStore,
  actorUserId: string,
): ThumbnailDownloadQueueItem | null {
  return thumbnailDownloadsForActor(store, actorUserId).find(
    (job) => job.status === 'pending'
      || (job.status === 'failed' && job.attempts < 5),
  ) ?? null;
}

export function updateThumbnailDownloadForActor(
  store: AppDataStore,
  id: string,
  actorUserId: string,
  patch: Partial<ThumbnailDownloadQueueItem>,
  updatedAt: string,
): boolean {
  const index = store.cloudSync.thumbnail_queue.findIndex((job) => job.id === id);
  if (index < 0) return false;
  const existing = store.cloudSync.thumbnail_queue[index];
  if (!actorMayUseThumbnailInstallation(store, existing.installation_id, actorUserId)) {
    return false;
  }

  const updated: ThumbnailDownloadQueueItem = {
    ...existing,
    ...patch,
    id,
    // Queue ownership cannot be moved by a status update.
    installation_id: existing.installation_id,
    remote_uri: existing.remote_uri,
    updated_at: updatedAt,
  };
  store.cloudSync.thumbnail_queue[index] = updated;

  const installation = store.installations.find(
    (item) => item.id === existing.installation_id
      && assignedWorkInstallationIsVisibleToActor(item, actorUserId),
  );
  if (!installation) return false;
  const jobs = store.cloudSync.thumbnail_queue.filter(
    (job) => job.installation_id === installation.id,
  );
  installation.thumbnail_total = jobs.length;
  installation.thumbnail_ready = jobs.filter((job) => job.status === 'ready').length;
  installation.thumbnail_status =
    installation.thumbnail_ready === installation.thumbnail_total ? 'ready' : 'pending';
  return true;
}
