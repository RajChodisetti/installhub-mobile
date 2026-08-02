import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  runWithCloudAccessToken,
  type CloudStoredFile,
} from '../api/apiClient';
import { SYNC_API_URL } from '../constants/syncConfig';
import { trustedDownloadRequest } from './downloadSecurity';
import { authenticatedFileDownload } from './authenticatedFileDownload';

function safeFilename(value: string, contentType: string): string {
  let filename = value
    .split(/[\\/]/)
    .pop()
    ?.replace(/[^a-z0-9 ._()-]+/gi, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150) || 'field-app-complete-file';
  if (!filename.includes('.')) {
    if (contentType === 'application/pdf') filename += '.pdf';
    else if (contentType === 'image/png') filename += '.png';
    else if (contentType.startsWith('image/')) filename += '.jpg';
  }
  return filename;
}

async function download(
  url: string,
  destination: File,
): Promise<File> {
  return File.downloadFileAsync(
    url,
    destination,
    {
      idempotent: true,
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
  const request = trustedDownloadRequest(file.downloadUrl, SYNC_API_URL);
  const downloaded = request.authorization === 'api-bearer'
    ? await runWithCloudAccessToken((token) => authenticatedFileDownload({
        url: request.url,
        destination,
        token,
        expectedContentType: file.contentType,
      }))
    : await download(request.url, destination);
  return downloaded.uri;
}

export async function shareCloudFile(file: CloudStoredFile): Promise<void> {
  if (!await Sharing.isAvailableAsync()) {
    throw new Error('Sharing is not available on this device.');
  }
  const uri = await downloadCloudFile(file);
  await Sharing.shareAsync(uri, {
    mimeType: file.contentType,
    ...(file.contentType === 'application/pdf' ? { UTI: 'com.adobe.pdf' } : {}),
    dialogTitle: `Share ${
      file.originalFilename || file.fieldName || 'Field App Complete file'
    }`,
  });
}
