import { Directory, File, Paths } from 'expo-file-system';
import type { FormSubmission } from '../types';
import { formPdfFilename } from './reportFilenames';
import { evidenceDirectoryIsReferenced } from './formStorageOwnership';

export interface FormStorageCleanupResult {
  removedEvidenceDirectory: boolean;
  preservedEvidenceDirectory: boolean;
  removedGeneratedReport: boolean;
  warnings: string[];
}

/**
 * Removes files owned by one local form only. Remote evidence URLs and files
 * stored under another form (including inherited amendment evidence) are never
 * touched.
 */
export function deleteFormLocalFiles(
  form: FormSubmission,
  protectedAttachmentUris: readonly string[] = [],
): FormStorageCleanupResult {
  const result: FormStorageCleanupResult = {
    removedEvidenceDirectory: false,
    preservedEvidenceDirectory: false,
    removedGeneratedReport: false,
    warnings: [],
  };
  try {
    const evidence = new Directory(Paths.document, 'form-media', form.id);
    if (evidence.exists) {
      const isReferencedBySurvivingForm = evidenceDirectoryIsReferenced(
        evidence.uri,
        protectedAttachmentUris,
      );
      if (isReferencedBySurvivingForm) {
        result.preservedEvidenceDirectory = true;
      } else {
        evidence.delete();
        result.removedEvidenceDirectory = true;
      }
    }
  } catch (error) {
    result.warnings.push(
      `Could not remove evidence for ${form.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  try {
    const report = new File(
      Paths.cache,
      'form-reports',
      formPdfFilename(form),
    );
    if (report.exists) {
      report.delete();
      result.removedGeneratedReport = true;
    }
  } catch (error) {
    result.warnings.push(
      `Could not remove generated report for ${form.id}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return result;
}

export function deleteFormsLocalFiles(
  forms: FormSubmission[],
  protectedAttachmentUris: readonly string[] = [],
): FormStorageCleanupResult[] {
  return forms.map((form) =>
    deleteFormLocalFiles(form, protectedAttachmentUris));
}
