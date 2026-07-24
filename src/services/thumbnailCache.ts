import { Directory, File, Paths } from 'expo-file-system';
import { sha256 } from 'js-sha256';
import { getStoredCloudJwt } from '../api/apiClient';
import {
  getNextThumbnailDownload,
  listThumbnailDownloads,
  updateThumbnailDownload,
} from '../repositories/cloudSyncRepository';

let activeWorker: Promise<void> | null = null;

export function thumbnailUrlFor(originalUrl: string): string {
  return originalUrl.replace('/v1/files/', '/v1/thumbnails/');
}

async function downloadOne(): Promise<boolean> {
  const job = await getNextThumbnailDownload();
  if (!job) return false;
  const token = await getStoredCloudJwt();
  if (!token) return false;

  await updateThumbnailDownload(job.id, {
    status: 'downloading',
    attempts: job.attempts + 1,
    last_error: undefined,
  });
  try {
    const directory = new Directory(Paths.cache, 'installhub-imported-thumbnails');
    directory.create({ idempotent: true, intermediates: true });
    const destination = new File(directory, `${sha256(job.remote_uri)}.jpg`);
    const file = await File.downloadFileAsync(
      thumbnailUrlFor(job.remote_uri),
      destination,
      {
        headers: { Authorization: `Bearer ${token}` },
        idempotent: true,
      },
    );
    await updateThumbnailDownload(job.id, {
      status: 'ready',
      local_uri: file.uri,
      last_error: undefined,
    });
  } catch (error) {
    await updateThumbnailDownload(job.id, {
      status: 'failed',
      last_error: error instanceof Error ? error.message : String(error),
    });
  }
  return true;
}

async function repairInterruptedOrEvictedPreviews(): Promise<void> {
  const jobs = await listThumbnailDownloads();
  for (const job of jobs) {
    const missingReadyFile =
      job.status === 'ready' && (!job.local_uri || !new File(job.local_uri).exists);
    if (job.status === 'downloading' || missingReadyFile) {
      await updateThumbnailDownload(job.id, {
        status: 'pending',
        local_uri: missingReadyFile ? undefined : job.local_uri,
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
