import { sha256 } from 'js-sha256';
import type { ThumbnailDownloadQueueItem } from '../types';

export type InterruptedThumbnailRecovery =
  { status: 'pending'; local_uri: undefined };

export function thumbnailAttemptFilename(
  remoteUri: string,
  jobId: string,
  attemptNumber: number,
): string {
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error('Thumbnail attempt number must be a positive integer.');
  }
  return `${sha256(remoteUri)}-${sha256(jobId).slice(0, 16)}-${attemptNumber}.jpg`;
}

export function hasRecognizedImageSignature(bytes: Uint8Array): boolean {
  const matches = (expected: readonly number[], offset = 0) =>
    bytes.length >= offset + expected.length &&
    expected.every((value, index) => bytes[offset + index] === value);
  const ascii = (value: string, offset = 0) => matches(
    [...value].map((character) => character.charCodeAt(0)),
    offset,
  );
  return matches([0xff, 0xd8, 0xff]) ||
    matches([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ||
    ascii('GIF87a') ||
    ascii('GIF89a') ||
    (ascii('RIFF') && ascii('WEBP', 8)) ||
    (ascii('ftyp', 4) && ['avif', 'avis', 'heic', 'heix', 'hevc', 'mif1']
      .some((brand) => ascii(brand, 8)));
}

export function interruptedThumbnailRecovery(
  job: Pick<ThumbnailDownloadQueueItem, 'status' | 'local_uri'>,
): InterruptedThumbnailRecovery | null {
  if (job.status !== 'downloading') return null;
  return { status: 'pending', local_uri: undefined };
}
