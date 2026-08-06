import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { createId } from '../utils';

const LOCAL_MEDIA_DIRECTORY = 'installhub-media';

function mediaDirectory(): Directory {
  return new Directory(Paths.document, LOCAL_MEDIA_DIRECTORY);
}

async function persistPhoto(sourceUri: string): Promise<string> {
  const processed = await manipulateAsync(
    sourceUri,
    [{ resize: { width: 1600 } }],
    { compress: 0.82, format: SaveFormat.JPEG },
  );
  const directory = mediaDirectory();
  directory.create({ idempotent: true, intermediates: true });
  const destination = new File(directory, `${createId('photo')}.jpg`);
  const processedFile = new File(processed.uri);
  try {
    await processedFile.copy(destination);
  } finally {
    if (processed.uri !== sourceUri && processedFile.exists) processedFile.delete();
  }
  return destination.uri;
}

async function acquirePhoto(source: 'camera' | 'library'): Promise<string | null> {
  const permission = source === 'camera'
    ? await ImagePicker.requestCameraPermissionsAsync()
    : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: false })
    : await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.9,
        allowsEditing: false,
      });
  const sourceUri = result.canceled ? null : result.assets[0]?.uri;
  return sourceUri ? persistPhoto(sourceUri) : null;
}

/** Pick and copy a photo into app-owned document storage before returning it. */
export async function pickLocalPhoto(): Promise<string | null> {
  return acquirePhoto('library');
}

/** Capture and copy a photo into app-owned document storage before returning it. */
export async function takeLocalPhoto(): Promise<string | null> {
  return acquirePhoto('camera');
}

/**
 * Delete only media created by this service. Remote URLs, imported files, and
 * form evidence owned by other storage services are intentionally ignored.
 */
export function deleteLocalPhoto(uri: string | null | undefined): boolean {
  if (!uri) return false;
  try {
    const directoryUri = mediaDirectory().uri;
    const ownedPrefix = directoryUri.endsWith('/') ? directoryUri : `${directoryUri}/`;
    if (!uri.startsWith(ownedPrefix)) return false;
    const file = new File(uri);
    if (!file.exists) return false;
    file.delete();
    return true;
  } catch {
    return false;
  }
}

export function deleteRemovedLocalPhotos(
  previousUris: Array<string | null | undefined>,
  retainedUris: Array<string | null | undefined>,
): number {
  const retained = new Set(retainedUris.filter((uri): uri is string => Boolean(uri)));
  let removed = 0;
  for (const uri of new Set(previousUris.filter((value): value is string => Boolean(value)))) {
    if (!retained.has(uri) && deleteLocalPhoto(uri)) removed += 1;
  }
  return removed;
}
