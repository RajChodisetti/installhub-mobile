import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  getStoredCloudJwt,
  refreshStoredCloudJwt,
  type CloudStoredFile,
} from '../api/apiClient';
import { SYNC_API_URL } from '../constants/syncConfig';

function safeFilename(value: string, contentType: string): string {
  let filename = value
    .split(/[\\/]/)
    .pop()
    ?.replace(/[^a-z0-9 ._()-]+/gi, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150) || 'installhub-file';
  if (!filename.includes('.')) {
    if (contentType === 'application/pdf') filename += '.pdf';
    else if (contentType === 'image/png') filename += '.png';
    else if (contentType.startsWith('image/')) filename += '.jpg';
  }
  return filename;
}

function absoluteDownloadUrl(downloadUrl: string): string {
  if (/^https?:\/\//i.test(downloadUrl)) return downloadUrl;
  return `${SYNC_API_URL}${downloadUrl.startsWith('/') ? '' : '/'}${downloadUrl}`;
}

async function download(
  file: CloudStoredFile,
  destination: File,
  token: string | null,
): Promise<File> {
  return File.downloadFileAsync(
    absoluteDownloadUrl(file.downloadUrl),
    destination,
    {
      idempotent: true,
      ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
    },
  );
}

export async function downloadCloudFile(file: CloudStoredFile): Promise<string> {
  const directory = new Directory(Paths.cache, 'installhub-cloud-files');
  directory.create({ idempotent: true, intermediates: true });
  const filename = safeFilename(
    file.originalFilename || file.storageKey,
    file.contentType,
  );
  const destination = new File(directory, `${Date.now()}-${filename}`);
  const token = await getStoredCloudJwt();
  try {
    return (await download(file, destination, token)).uri;
  } catch (firstError) {
    const refreshed = await refreshStoredCloudJwt();
    if (!refreshed) throw firstError;
    return (await download(file, destination, refreshed)).uri;
  }
}

export async function shareCloudFile(file: CloudStoredFile): Promise<void> {
  if (!await Sharing.isAvailableAsync()) {
    throw new Error('Sharing is not available on this device.');
  }
  const uri = await downloadCloudFile(file);
  await Sharing.shareAsync(uri, {
    mimeType: file.contentType,
    ...(file.contentType === 'application/pdf' ? { UTI: 'com.adobe.pdf' } : {}),
    dialogTitle: `Share ${file.originalFilename || file.fieldName || 'InstallHub file'}`,
  });
}
