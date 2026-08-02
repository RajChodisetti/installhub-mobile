import { Directory, File, FileMode, Paths } from 'expo-file-system';
import {
  hasStoredCloudSession,
  runWithCloudAccessToken,
} from '../api/apiClient';
import {
  getNextThumbnailDownload,
  listThumbnailDownloads,
  updateThumbnailDownload,
} from '../repositories/cloudSyncRepository';
import { SYNC_API_URL } from '../constants/syncConfig';
import { trustedDownloadRequest } from './downloadSecurity';
import { authenticatedFileDownload } from './authenticatedFileDownload';
import {
  hasRecognizedImageSignature,
  interruptedThumbnailRecovery,
  thumbnailAttemptFilename,
} from './thumbnailRecovery';

let activeWorker: Promise<void> | null = null;

export function thumbnailUrlFor(originalUrl: string): string {
  return originalUrl.replace('/v1/files/', '/v1/thumbnails/');
}

async function isValidCommittedThumbnail(uri: string): Promise<boolean> {
  try {
    const file = new File(uri);
    if (!file.exists || !Number.isSafeInteger(file.size) || file.size < 3) {
      return false;
    }
    const handle = file.open(FileMode.ReadOnly);
    try {
      return hasRecognizedImageSignature(
        await handle.readBytes(Math.min(file.size, 16)),
      );
    } finally {
      handle.close();
    }
  } catch {
    return false;
  }
}

function deleteInvalidThumbnail(uri?: string): void {
  if (!uri) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch { /* cache cleanup is best effort */ }
}

async function downloadOne(): Promise<boolean> {
  const job = await getNextThumbnailDownload();
  if (!job) return false;

  const attemptNumber = job.attempts + 1;
  const directory = new Directory(Paths.cache, 'installhub-imported-thumbnails');
  directory.create({ idempotent: true, intermediates: true });
  const destination = new File(
    directory,
    thumbnailAttemptFilename(job.remote_uri, job.id, attemptNumber),
  );
  await updateThumbnailDownload(job.id, {
    status: 'downloading',
    attempts: attemptNumber,
    // Persist the immutable attempt identity before network I/O so startup can
    // delete a possibly partial direct-write and retry at a fresh destination.
    local_uri: destination.uri,
    last_error: undefined,
  });
  try {
    const request = trustedDownloadRequest(thumbnailUrlFor(job.remote_uri), SYNC_API_URL);
    if (request.authorization === 'api-bearer' && !await hasStoredCloudSession()) {
      await updateThumbnailDownload(job.id, { status: 'pending', local_uri: undefined });
      return false;
    }
    const storeDownloadedFile = async (token?: string) => {
      const file = token
        ? await authenticatedFileDownload({
            url: request.url,
            destination,
            token,
            expectedContentType: 'image/',
          })
        : await File.downloadFileAsync(
          request.url,
          destination,
          {
            idempotent: true,
          },
        );
      if (!await isValidCommittedThumbnail(file.uri)) {
        deleteInvalidThumbnail(file.uri);
        throw new Error('Thumbnail download did not contain a recognized image.');
      }
      await updateThumbnailDownload(job.id, {
        status: 'ready',
        local_uri: file.uri,
        last_error: undefined,
      });
    };
    if (request.authorization === 'api-bearer') {
      await runWithCloudAccessToken(storeDownloadedFile);
    } else {
      await storeDownloadedFile();
    }
  } catch (error) {
    deleteInvalidThumbnail(destination.uri);
    await updateThumbnailDownload(job.id, {
      status: 'failed',
      local_uri: undefined,
      last_error: error instanceof Error ? error.message : String(error),
    });
  }
  return true;
}

async function repairInterruptedOrEvictedPreviews(): Promise<void> {
  const jobs = await listThumbnailDownloads();
  for (const job of jobs) {
    const interrupted = interruptedThumbnailRecovery(job);
    if (interrupted) {
      // File.downloadFileAsync may have been killed after writing only a valid
      // header, so no in-process signature check can safely adopt this file.
      deleteInvalidThumbnail(job.local_uri);
      await updateThumbnailDownload(job.id, {
        ...interrupted,
        last_error: undefined,
      });
      continue;
    }
    const missingReadyFile =
      job.status === 'ready' && (!job.local_uri || !new File(job.local_uri).exists);
    if (missingReadyFile) {
      await updateThumbnailDownload(job.id, {
        status: 'pending',
        local_uri: undefined,
        last_error: undefined,
      });
    }
  }
}

export function runThumbnailDownloadWorker(): Promise<void> {
  if (activeWorker) return activeWorker;
  activeWorker = (async () => {
    await repairInterruptedOrEvictedPreviews();
    while (await downloadOne()) {
      // Process sequentially to keep memory and network use bounded.
    }
  })();
  return activeWorker.finally(() => {
    activeWorker = null;
  });
}
