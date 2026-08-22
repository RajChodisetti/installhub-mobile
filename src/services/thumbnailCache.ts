import { Directory, File, FileMode, Paths } from 'expo-file-system';
import {
  cloudSessionAuthoritiesMatch,
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
import type { AuthenticatedCloudActionLease } from './authenticatedCloudAction';
import { fetchAndCommitThumbnailForAuthority } from './thumbnailWorkerFence';

type ActiveThumbnailWorker = {
  lease: AuthenticatedCloudActionLease;
  promise: Promise<void>;
};

let activeWorker: ActiveThumbnailWorker | null = null;

function thumbnailWorkerLeasesMatch(
  left: AuthenticatedCloudActionLease,
  right: AuthenticatedCloudActionLease,
): boolean {
  return left.actorUserId === right.actorUserId
    && left.processAuthority.generation === right.processAuthority.generation
    && cloudSessionAuthoritiesMatch(left.cloudAuthority, right.cloudAuthority);
}

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

async function downloadOne(
  lease: AuthenticatedCloudActionLease,
): Promise<boolean> {
  lease.assertCurrent();
  const job = await getNextThumbnailDownload(
    lease.actorUserId,
    lease.processAuthority,
  );
  lease.assertCurrent();
  if (!job) return false;

  const attemptNumber = job.attempts + 1;
  lease.assertCurrent();
  const directory = new Directory(Paths.cache, 'installhub-imported-thumbnails');
  directory.create({ idempotent: true, intermediates: true });
  const destination = new File(
    directory,
    thumbnailAttemptFilename(job.remote_uri, job.id, attemptNumber),
  );
  const claimed = await updateThumbnailDownload(
    job.id,
    {
      status: 'downloading',
      attempts: attemptNumber,
      // Persist the immutable attempt identity before network I/O so startup can
      // delete a possibly partial direct-write and retry at a fresh destination.
      local_uri: destination.uri,
      last_error: undefined,
    },
    lease.actorUserId,
    lease.processAuthority,
  );
  lease.assertCurrent();
  if (!claimed) return true;
  try {
    lease.assertCurrent();
    const request = trustedDownloadRequest(thumbnailUrlFor(job.remote_uri), SYNC_API_URL);
    const storeDownloadedFile = async (token?: string) => {
      await fetchAndCommitThumbnailForAuthority(
        lease.assertCurrent,
        () => token
          ? authenticatedFileDownload({
              url: request.url,
              destination,
              token,
              expectedContentType: 'image/',
            })
          : File.downloadFileAsync(
              request.url,
              destination,
              {
                idempotent: true,
              },
            ),
        async (file) => {
          if (!await isValidCommittedThumbnail(file.uri)) {
            throw new Error('Thumbnail download did not contain a recognized image.');
          }
        },
        async (file) => {
          const committed = await updateThumbnailDownload(
            job.id,
            {
              status: 'ready',
              local_uri: file.uri,
              last_error: undefined,
            },
            lease.actorUserId,
            lease.processAuthority,
          );
          if (!committed) {
            throw new Error('Thumbnail ownership changed before the cache could be committed.');
          }
        },
        () => deleteInvalidThumbnail(destination.uri),
      );
    };
    if (request.authorization === 'api-bearer') {
      await runWithCloudAccessToken(storeDownloadedFile, lease.cloudAuthority);
    } else {
      await storeDownloadedFile();
    }
    lease.assertCurrent();
  } catch (error) {
    deleteInvalidThumbnail(destination.uri);
    // A replaced session must not write a failure into A's row as B. The
    // destination is attempt-specific, so stale cleanup cannot touch B's file.
    lease.assertCurrent();
    await updateThumbnailDownload(
      job.id,
      {
        status: 'failed',
        local_uri: undefined,
        last_error: error instanceof Error ? error.message : String(error),
      },
      lease.actorUserId,
      lease.processAuthority,
    );
    lease.assertCurrent();
  }
  return true;
}

async function repairInterruptedOrEvictedPreviews(
  lease: AuthenticatedCloudActionLease,
): Promise<void> {
  lease.assertCurrent();
  const jobs = await listThumbnailDownloads(
    lease.actorUserId,
    lease.processAuthority,
  );
  lease.assertCurrent();
  for (const job of jobs) {
    lease.assertCurrent();
    const interrupted = interruptedThumbnailRecovery(job);
    if (interrupted) {
      // File.downloadFileAsync may have been killed after writing only a valid
      // header, so no in-process signature check can safely adopt this file.
      const reset = await updateThumbnailDownload(
        job.id,
        {
          ...interrupted,
          last_error: undefined,
        },
        lease.actorUserId,
        lease.processAuthority,
      );
      lease.assertCurrent();
      if (reset) deleteInvalidThumbnail(job.local_uri);
      continue;
    }
    const missingReadyFile =
      job.status === 'ready' && (!job.local_uri || !new File(job.local_uri).exists);
    if (missingReadyFile) {
      await updateThumbnailDownload(
        job.id,
        {
          status: 'pending',
          local_uri: undefined,
          last_error: undefined,
        },
        lease.actorUserId,
        lease.processAuthority,
      );
      lease.assertCurrent();
    }
  }
}

export function runThumbnailDownloadWorker(
  lease: AuthenticatedCloudActionLease,
): Promise<void> {
  lease.assertCurrent();
  const existing = activeWorker;
  if (existing && thumbnailWorkerLeasesMatch(existing.lease, lease)) {
    return existing.promise;
  }

  const operation = (async () => {
    if (existing) await existing.promise.catch(() => undefined);
    lease.assertCurrent();
    await repairInterruptedOrEvictedPreviews(lease);
    lease.assertCurrent();
    while (await downloadOne(lease)) {
      // Process sequentially to keep memory and network use bounded.
      lease.assertCurrent();
    }
  })();
  const worker: ActiveThumbnailWorker = { lease, promise: operation };
  activeWorker = worker;
  void operation.then(
    () => {
      if (activeWorker === worker) activeWorker = null;
    },
    () => {
      if (activeWorker === worker) activeWorker = null;
    },
  );
  return operation;
}
