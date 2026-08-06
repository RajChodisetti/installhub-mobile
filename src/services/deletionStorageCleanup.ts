import { File } from 'expo-file-system';
import type { LocalDeletionEffects } from '../repositories/deletionIntegrity';
import {
  deleteFormsLocalFiles,
  type FormStorageCleanupResult,
} from './formStorageCleanup';
import { deleteLocalPhoto } from './localMedia';

export interface DeletionStorageCleanupResult {
  forms: FormStorageCleanupResult[];
  removedEntityMediaFiles: number;
  removedThumbnailFiles: number;
  warnings: string[];
}

/**
 * Runs only after the domain deletion has been persisted. Exact paths come
 * from records that were removed from the durable queues; no directory-wide
 * thumbnail or evidence purge is performed.
 */
export function cleanupDeletedTreeStorage(
  effects: LocalDeletionEffects,
): DeletionStorageCleanupResult {
  const forms = deleteFormsLocalFiles(
    effects.deletedForms,
    effects.protectedFormAttachmentUris,
  );
  const result: DeletionStorageCleanupResult = {
    forms,
    removedEntityMediaFiles: 0,
    removedThumbnailFiles: 0,
    warnings: forms.flatMap((item) => item.warnings),
  };
  const protectedEntityMedia = new Set(effects.protectedEntityMediaUris);
  for (const uri of effects.deletedEntityMediaUris) {
    if (protectedEntityMedia.has(uri)) continue;
    if (deleteLocalPhoto(uri)) result.removedEntityMediaFiles += 1;
  }
  for (const uri of effects.orphanedThumbnailCacheUris) {
    try {
      const file = new File(uri);
      if (file.exists) {
        file.delete();
        result.removedThumbnailFiles += 1;
      }
    } catch (error) {
      result.warnings.push(
        `Could not remove imported preview ${uri}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return result;
}
