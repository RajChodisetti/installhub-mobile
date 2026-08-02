import type { FormSubmission, Installation } from '../types';
import {
  selectReportVersion,
  validRecordVersionNumber,
  type ReportVersionSelection,
} from './reportVersioning';

export type FormReportServerTarget = {
  installationId: string;
  formId: string;
  usesOriginalImportedRecord: boolean;
} & ReportVersionSelection;

/**
 * A caller-proven intact imported copy can render against its original cloud
 * record so the API can use full-resolution evidence not downloaded to the
 * device. The conservative default is the local identity; callers must verify
 * the whole installation tree with hasIntactImportedSourceProvenance.
 */
export function resolveFormReportServerTarget(
  installation: Installation,
  form: FormSubmission,
  hasIntactInstallationProvenance = false,
): FormReportServerTarget {
  const importedSourceRecordVersion = validRecordVersionNumber(
    installation.import_source_record_version_number,
  );
  const usesOriginalImportedRecord =
    hasIntactInstallationProvenance &&
    installation.is_imported_copy === true &&
    !installation.cloud_backup_enabled &&
    Boolean(installation.import_source_server_id && form.import_source_server_id) &&
    importedSourceRecordVersion !== undefined;

  if (usesOriginalImportedRecord) {
    return {
      installationId: installation.import_source_server_id!,
      formId: form.import_source_server_id!,
      usesOriginalImportedRecord: true,
      recordVersionNumber: importedSourceRecordVersion,
    };
  }

  return {
    installationId: form.installation_id,
    formId: form.id,
    usesOriginalImportedRecord: false,
    ...selectReportVersion(
      installation.record_version_number,
      installation.status === 'Completed',
    ),
  };
}
