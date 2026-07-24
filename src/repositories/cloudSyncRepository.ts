import type {
  AppDataStore,
  CloudUploadQueueItem,
  ElectricalAsset,
  FormSubmission,
  Installation,
  SiteAsset,
  ThumbnailDownloadQueueItem,
  Zone,
} from '../types';
import { getStore, initStore, updateStore } from '../data/seed';
import { createId, nowIso } from '../utils';

export interface InstallationBackupTree {
  installation: Installation;
  zones: Zone[];
  electricalAssets: ElectricalAsset[];
  siteAssets: SiteAsset[];
  formSubmissions: FormSubmission[];
  watermark: string;
}

export interface BackupMediaReference {
  installation_id: string;
  entity_type: CloudUploadQueueItem['entity_type'];
  entity_id: string;
  field_name: string;
  local_uri: string;
  mime_type: string;
}

function treeWatermark(store: AppDataStore, installationId: string): string {
  const timestamps = [
    store.installations.find((item) => item.id === installationId)?.updated_at,
    ...store.zones.filter((item) => item.audit_id === installationId).map((item) => item.updated_at),
    ...store.electricalAssets
      .filter((item) => item.audit_id === installationId)
      .map((item) => item.updated_at),
    ...store.siteAssets
      .filter((item) => item.audit_id === installationId)
      .map((item) => item.updated_at),
    ...store.formSubmissions
      .filter((item) => item.installation_id === installationId)
      .map((item) => item.updated_at),
  ].filter((value): value is string => Boolean(value));
  return timestamps.sort().at(-1) ?? new Date(0).toISOString();
}

function backupTree(store: AppDataStore, installation: Installation): InstallationBackupTree {
  return {
    installation,
    zones: store.zones.filter((item) => item.audit_id === installation.id),
    electricalAssets: store.electricalAssets.filter((item) => item.audit_id === installation.id),
    siteAssets: store.siteAssets.filter((item) => item.audit_id === installation.id),
    formSubmissions: store.formSubmissions.filter(
      (item) => item.installation_id === installation.id,
    ),
    watermark: treeWatermark(store, installation.id),
  };
}

export async function listInstallationsNeedingBackup(): Promise<InstallationBackupTree[]> {
  await initStore();
  const store = getStore();
  const forced = new Set(store.cloudSync.force_dirty_installation_ids);
  return store.installations
    .filter((installation) => installation.cloud_backup_enabled)
    .map((installation) => backupTree(store, installation))
    .filter((tree) => {
      const syncedAt = store.cloudSync.synced_at_by_installation[tree.installation.id];
      return forced.has(tree.installation.id) || !syncedAt || tree.watermark > syncedAt;
    });
}

export async function getInstallationBackupTree(
  installationId: string,
): Promise<InstallationBackupTree | null> {
  await initStore();
  const store = getStore();
  const installation = store.installations.find((item) => item.id === installationId);
  return installation ? backupTree(store, installation) : null;
}

export async function markInstallationDirty(installationId: string): Promise<void> {
  await updateStore((store) => {
    if (!store.cloudSync.force_dirty_installation_ids.includes(installationId)) {
      store.cloudSync.force_dirty_installation_ids.push(installationId);
    }
  });
}

export async function markInstallationBackedUp(
  installationId: string,
  watermark: string,
): Promise<void> {
  await updateStore((store) => {
    store.cloudSync.synced_at_by_installation[installationId] = watermark;
    store.cloudSync.force_dirty_installation_ids =
      store.cloudSync.force_dirty_installation_ids.filter((id) => id !== installationId);
  });
}

export async function getInstallationSyncMetadata(
  installationId: string,
): Promise<{ forceDirty: boolean; syncedWatermark?: string }> {
  await initStore();
  const sync = getStore().cloudSync;
  return {
    forceDirty: sync.force_dirty_installation_ids.includes(installationId),
    syncedWatermark: sync.synced_at_by_installation[installationId],
  };
}

function queueIdentity(reference: BackupMediaReference): string {
  return [
    reference.installation_id,
    reference.entity_type,
    reference.entity_id,
    reference.field_name,
    reference.local_uri,
  ].join('|');
}

function queueStatusRank(status: CloudUploadQueueItem['status']): number {
  if (status === 'cleared') return 4;
  if (status === 'uploading') return 3;
  if (status === 'pending') return 2;
  return 1;
}

/**
 * Rebuilds one installation's queue from the media identities that are still
 * referenced by its current local tree. Exact matches keep their upload state;
 * removed/replaced files (including failed and cleared rows) are discarded.
 */
export function reconciledBackupMediaQueue(
  queue: CloudUploadQueueItem[],
  installationId: string,
  references: BackupMediaReference[],
  createQueueId: () => string = () => createId('upload'),
  updatedAt: string = nowIso(),
): CloudUploadQueueItem[] {
  if (references.some((reference) => reference.installation_id !== installationId)) {
    throw new Error('Backup media reference belongs to another installation.');
  }

  const desired = new Map<string, BackupMediaReference>();
  for (const reference of references) {
    desired.set(queueIdentity(reference), reference);
  }

  const bestCurrent = new Map<string, CloudUploadQueueItem>();
  for (const item of queue) {
    if (item.installation_id !== installationId) continue;
    const identity = queueIdentity(item);
    if (!desired.has(identity)) continue;
    const current = bestCurrent.get(identity);
    if (!current || queueStatusRank(item.status) > queueStatusRank(current.status)) {
      bestCurrent.set(identity, item);
    }
  }

  const reconciled = queue.filter((item) => item.installation_id !== installationId);
  for (const [identity, reference] of desired) {
    reconciled.push(
      bestCurrent.get(identity) ?? {
        ...reference,
        id: createQueueId(),
        status: 'pending',
        attempts: 0,
        updated_at: updatedAt,
      },
    );
  }
  return reconciled;
}

export async function reconcileBackupMediaQueue(
  installationId: string,
  references: BackupMediaReference[],
): Promise<void> {
  await initStore();
  await updateStore((store) => {
    store.cloudSync.upload_queue = reconciledBackupMediaQueue(
      store.cloudSync.upload_queue,
      installationId,
      references,
    );
  });
}

export async function enqueueBackupMedia(references: BackupMediaReference[]): Promise<void> {
  if (!references.length) return;
  await initStore();
  const queued = new Set(getStore().cloudSync.upload_queue.map((item) => queueIdentity(item)));
  if (references.every((reference) => queued.has(queueIdentity(reference)))) return;
  await updateStore((store) => {
    const existing = new Set(store.cloudSync.upload_queue.map((item) => queueIdentity(item)));
    for (const reference of references) {
      const identity = queueIdentity(reference);
      if (existing.has(identity)) continue;
      store.cloudSync.upload_queue.push({
        ...reference,
        id: createId('upload'),
        status: 'pending',
        attempts: 0,
        updated_at: nowIso(),
      });
      existing.add(identity);
    }
  });
}

export async function listUploadQueue(
  installationId?: string,
): Promise<CloudUploadQueueItem[]> {
  await initStore();
  return getStore().cloudSync.upload_queue.filter(
    (item) => !installationId || item.installation_id === installationId,
  );
}

export async function getNextUpload(
  installationId: string,
): Promise<CloudUploadQueueItem | null> {
  await initStore();
  return getStore().cloudSync.upload_queue.find(
    (item) =>
      item.installation_id === installationId &&
      (item.status === 'pending' || (item.status === 'failed' && item.attempts < 5)),
  ) ?? null;
}

export async function updateUploadQueueItem(
  id: string,
  patch: Partial<CloudUploadQueueItem>,
): Promise<void> {
  await updateStore((store) => {
    const index = store.cloudSync.upload_queue.findIndex((item) => item.id === id);
    if (index < 0) return;
    store.cloudSync.upload_queue[index] = {
      ...store.cloudSync.upload_queue[index],
      ...patch,
      id,
      updated_at: nowIso(),
    };
  });
}

export async function resetInterruptedUploads(): Promise<void> {
  await initStore();
  if (!getStore().cloudSync.upload_queue.some((item) => item.status === 'uploading')) return;
  await updateStore((store) => {
    for (const item of store.cloudSync.upload_queue) {
      if (item.status === 'uploading') {
        item.status = 'pending';
        item.session_id = undefined;
        item.updated_at = nowIso();
      }
    }
  });
}

export async function resetFailedUploadsForRetry(): Promise<void> {
  await initStore();
  if (!getStore().cloudSync.upload_queue.some((item) => item.status === 'failed')) return;
  await updateStore((store) => {
    for (const item of store.cloudSync.upload_queue) {
      if (item.status === 'failed') {
        item.status = 'pending';
        item.attempts = 0;
        item.session_id = undefined;
        item.last_error = undefined;
        item.updated_at = nowIso();
      }
    }
  });
}

export async function getCloudBackupStats(): Promise<{
  pending: number;
  uploading: number;
  failed: number;
  backedUp: number;
}> {
  await initStore();
  const items = getStore().cloudSync.upload_queue;
  return {
    pending: items.filter((item) => item.status === 'pending').length,
    uploading: items.filter((item) => item.status === 'uploading').length,
    failed: items.filter((item) => item.status === 'failed').length,
    backedUp: items.filter((item) => item.status === 'cleared').length,
  };
}

export async function enqueueThumbnailDownloads(
  installationId: string,
  remoteUris: string[],
): Promise<void> {
  const unique = [...new Set(remoteUris)];
  if (!unique.length) return;
  await updateStore((store) => {
    const existing = new Set(store.cloudSync.thumbnail_queue.map(
      (item) => `${item.installation_id}|${item.remote_uri}`,
    ));
    for (const remoteUri of unique) {
      if (existing.has(`${installationId}|${remoteUri}`)) continue;
      store.cloudSync.thumbnail_queue.push({
        id: createId('thumb'),
        installation_id: installationId,
        remote_uri: remoteUri,
        status: 'pending',
        attempts: 0,
        updated_at: nowIso(),
      });
    }
  });
}

export async function getNextThumbnailDownload(): Promise<ThumbnailDownloadQueueItem | null> {
  await initStore();
  return getStore().cloudSync.thumbnail_queue.find(
    (item) => item.status === 'pending' || (item.status === 'failed' && item.attempts < 5),
  ) ?? null;
}

export async function updateThumbnailDownload(
  id: string,
  patch: Partial<ThumbnailDownloadQueueItem>,
): Promise<void> {
  await updateStore((store) => {
    const index = store.cloudSync.thumbnail_queue.findIndex((item) => item.id === id);
    if (index < 0) return;
    store.cloudSync.thumbnail_queue[index] = {
      ...store.cloudSync.thumbnail_queue[index],
      ...patch,
      id,
      updated_at: nowIso(),
    };
    const job = store.cloudSync.thumbnail_queue[index];
    const installation = store.installations.find((item) => item.id === job.installation_id);
    if (!installation) return;
    const jobs = store.cloudSync.thumbnail_queue.filter(
      (item) => item.installation_id === installation.id,
    );
    installation.thumbnail_total = jobs.length;
    installation.thumbnail_ready = jobs.filter((item) => item.status === 'ready').length;
    installation.thumbnail_status =
      installation.thumbnail_ready === installation.thumbnail_total ? 'ready' : 'pending';
  });
}

export function cachedThumbnailUri(remoteUri: string): string | undefined {
  const item = getStore().cloudSync.thumbnail_queue.find(
    (job) => job.remote_uri === remoteUri && job.status === 'ready',
  );
  return item?.local_uri;
}

export async function listThumbnailDownloads(): Promise<ThumbnailDownloadQueueItem[]> {
  await initStore();
  return [...getStore().cloudSync.thumbnail_queue];
}
