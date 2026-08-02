import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import {
  authenticatedDownloadToFile,
  type AtomicDownloadFile,
} from './authenticatedDownloadCore';

export async function authenticatedFileDownload(input: {
  url: string;
  destination: File;
  token: string;
  expectedContentType: string;
}): Promise<File> {
  const partialName = `.${input.destination.name}.${Date.now().toString(36)}-${
    Math.random().toString(36).slice(2, 10)
  }.partial`;
  await authenticatedDownloadToFile({
    ...input,
    destination: input.destination as AtomicDownloadFile,
    createPartialFile: () => new File(
      input.destination.parentDirectory,
      partialName,
    ) as AtomicDownloadFile,
    fetcher: expoFetch,
  });
  return input.destination;
}
