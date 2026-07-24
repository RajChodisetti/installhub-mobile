import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { FormAttachment } from '../types';
import { createId, nowIso } from '../utils';

async function acquirePhoto(source: 'camera' | 'library'): Promise<string | null> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ quality: 0.9, allowsEditing: false })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ['images'],
          quality: 0.9,
          allowsEditing: false,
        });
  return result.canceled ? null : (result.assets[0]?.uri ?? null);
}

export async function addFormPhoto(
  submissionId: string,
  slot: string,
  source: 'camera' | 'library',
): Promise<FormAttachment | null> {
  const sourceUri = await acquirePhoto(source);
  if (!sourceUri) return null;

  const processed = await manipulateAsync(
    sourceUri,
    [{ resize: { width: 1600 } }],
    { compress: 0.82, format: SaveFormat.JPEG },
  );
  const directory = new Directory(Paths.document, 'form-media', submissionId);
  directory.create({ idempotent: true, intermediates: true });
  const id = createId('photo');
  const destination = new File(directory, `${id}.jpg`);
  await new File(processed.uri).copy(destination);

  return {
    id,
    slot,
    uri: destination.uri,
    mime_type: 'image/jpeg',
    captured_at: nowIso(),
  };
}

export function deleteFormPhoto(attachment: FormAttachment): void {
  try {
    const file = new File(attachment.uri);
    if (file.exists) file.delete();
  } catch {
    // The form record can still drop an attachment whose local file is already gone.
  }
}
