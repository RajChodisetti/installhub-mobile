import { File } from 'expo-file-system';
import { sha256 } from 'js-sha256';
import { apiClient, AuthError, NetworkError } from '../api/apiClient';
import {
  getInstallationBackupTree,
  getNextUpload,
  listInstallationsNeedingBackup,
  listUploadQueue,
  markInstallationBackedUp,
  reconcileBackupMediaQueue,
  resetInterruptedUploads,
  updateUploadQueueItem,
} from '../repositories/cloudSyncRepository';
import type { CloudUploadQueueItem } from '../types';
import { buildBackupPayload, discoverBackupMedia } from './backupMedia';

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
  const identity = {
    installationId: row.installation_id,
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

export async function runCloudBackup(
  onProgress: (progress: SyncProgress) => void = () => {},
): Promise<SyncProgress> {
  await resetInterruptedUploads();
  const trees = await listInstallationsNeedingBackup();
  let uploaded = 0;
  let total = 0;

  if (!trees.length) {
    const done: SyncProgress = {
      phase: 'done',
      uploaded: 0,
      total: 0,
      failedCount: 0,
    };
    onProgress(done);
    return done;
  }

  try {
    for (const originalTree of trees) {
      const installationId = originalTree.installation.id;
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

      onProgress({
        phase: 'pushing',
        installationId,
        uploaded,
        total,
        failedCount: queue.filter((item) => item.status === 'failed').length,
      });
      await apiClient.push(buildBackupPayload(originalTree, queue, 'metadata'));

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
      await apiClient.push(buildBackupPayload(latestTree, queue, 'complete'));
      await markInstallationBackedUp(installationId, originalTree.watermark);
    }

    const done: SyncProgress = {
      phase: 'done',
      uploaded,
      total,
      failedCount: 0,
    };
    onProgress(done);
    return done;
  } catch (error) {
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
    onProgress(progress);
    return progress;
  }
}
