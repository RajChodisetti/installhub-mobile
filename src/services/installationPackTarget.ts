import { sha256 } from 'js-sha256';
import type { InstallationBackupTree } from '../repositories/cloudSyncRepository';
import {
  selectReportVersion,
  validRecordVersionNumber,
  type ReportVersionSelection,
} from './reportVersioning';

export interface InstallationSyncMetadata {
  forceDirty: boolean;
  syncedWatermark?: string;
}

export type InstallationPackServerTarget = {
  installationId: string;
  formSubmissionIds: string[];
  usesOriginalImportedRecord: boolean;
  reason:
    | 'original-import-provenance'
    | 'local-installation'
    | 'local-backup-enabled'
    | 'missing-import-provenance'
    | 'remote-source-divergence'
    | 'local-divergence';
} & ReportVersionSelection;

function timestampProvenanceIsIntact(tree: InstallationBackupTree): boolean {
  const importedAt = tree.installation.created_at;
  if (!importedAt || tree.watermark !== importedAt) return false;

  const records = [
    tree.installation,
    ...tree.zones,
    ...tree.electricalAssets,
    ...tree.siteAssets,
    ...tree.formSubmissions,
  ];
  return records.every(
    (record) =>
      record.created_at === importedAt &&
      record.updated_at === importedAt,
  );
}

function selectedCompletedForms(
  tree: InstallationBackupTree,
  selectedLocalFormIds?: string[],
) {
  const completed = tree.formSubmissions.filter(
    (form) => form.status === 'Completed',
  );
  if (selectedLocalFormIds === undefined) return completed;
  const selectedIds = [...new Set(selectedLocalFormIds.filter(Boolean))];
  if (completed.length && !selectedIds.length) {
    throw new Error('Select at least one completed form for the installation pack.');
  }
  const byId = new Map(completed.map((form) => [form.id, form]));
  const selected = selectedIds.map((id) => byId.get(id));
  if (selected.some((form) => !form)) {
    throw new Error('The report selection contains a form that is missing or not Completed.');
  }
  return selected.filter((form): form is NonNullable<typeof form> => Boolean(form));
}

export function hasIntactImportedSourceProvenance(
  tree: InstallationBackupTree,
  syncMetadata: InstallationSyncMetadata,
): boolean {
  const sourceWasExplicitlyDraft =
    tree.installation.legacy_completed_unpinned === false;
  if (
    tree.installation.is_imported_copy !== true ||
    tree.installation.cloud_backup_enabled ||
    !tree.installation.import_source_server_id ||
    (!sourceWasExplicitlyDraft &&
      validRecordVersionNumber(
        tree.installation.import_source_record_version_number,
      ) === undefined) ||
    tree.installation.import_provenance_watermark !==
      tree.installation.created_at
  ) {
    return false;
  }

  const sourceFormIds = tree.formSubmissions.map(
    (form) => form.import_source_server_id,
  );
  const hasCompleteUniqueFormProvenance =
    sourceFormIds.every((id): id is string => Boolean(id)) &&
    new Set(sourceFormIds).size === sourceFormIds.length;

  return (
    !syncMetadata.forceDirty &&
    !syncMetadata.syncedWatermark &&
    timestampProvenanceIsIntact(tree) &&
    hasCompleteUniqueFormProvenance
  );
}

/**
 * Resolves the server identities for an installation pack.
 *
 * Imported children deliberately receive the same created/updated timestamp at
 * import time. Updates/new records move away from that anchor, form edits and
 * amendments clear their source ID, and deletions set forceDirty. Requiring all
 * three signals lets the original cloud tree be used only while that imported
 * provenance is still intact. Any uncertainty conservatively targets the local
 * cpN copy, which must be backed up before the PDF job starts.
 */
export function resolveInstallationPackServerTarget(
  tree: InstallationBackupTree,
  syncMetadata: InstallationSyncMetadata,
  remoteSourceRevisionMatches = false,
  selectedLocalFormIds?: string[],
): InstallationPackServerTarget {
  const selectedForms = selectedCompletedForms(tree, selectedLocalFormIds);
  const localTarget = (
    reason: Exclude<
      InstallationPackServerTarget['reason'],
      'original-import-provenance'
    >,
  ): InstallationPackServerTarget => {
    const version = tree.installation.status === 'Completed'
      ? selectReportVersion(tree.installation.record_version_number, true)
      : { liveMode: true as const };
    return {
      installationId: tree.installation.id,
      formSubmissionIds: selectedForms.map((form) => form.id),
      usesOriginalImportedRecord: false,
      reason,
      ...version,
    };
  };

  if (!tree.installation.is_imported_copy) {
    return localTarget('local-installation');
  }
  if (tree.installation.cloud_backup_enabled) {
    return localTarget('local-backup-enabled');
  }
  if (!tree.installation.import_source_server_id) {
    return localTarget('missing-import-provenance');
  }

  if (!hasIntactImportedSourceProvenance(tree, syncMetadata)) {
    return localTarget('local-divergence');
  }
  if (!remoteSourceRevisionMatches) {
    return localTarget('remote-source-divergence');
  }

  const originalSource = {
    installationId: tree.installation.import_source_server_id,
    formSubmissionIds: selectedForms.map((form) => form.import_source_server_id!),
    usesOriginalImportedRecord: true,
    reason: 'original-import-provenance' as const,
  };
  // Imported copies are always locally Draft. The import-time discriminator
  // tells us whether the source itself was Draft: use its current diagnostic
  // tree even if a reopened source still carries an older immutable pin.
  if (tree.installation.legacy_completed_unpinned === false) {
    return { ...originalSource, liveMode: true };
  }
  return {
    ...originalSource,
    recordVersionNumber: validRecordVersionNumber(
      tree.installation.import_source_record_version_number,
    )!,
  };
}

/**
 * A successful sync is current only when both durable sync signals agree with
 * the tree that will be sent to the PDF API.
 */
export function isInstallationTreeBackedUpCurrent(
  tree: InstallationBackupTree,
  syncMetadata: InstallationSyncMetadata,
): boolean {
  return (
    !syncMetadata.forceDirty &&
    syncMetadata.syncedWatermark === tree.watermark
  );
}

/**
 * Separates remembered jobs by the exact local tree revision. This prevents an
 * interrupted source-pack job from being resumed after the cpN copy changes.
 * Thumbnail cache progress is excluded because it does not affect the report.
 */
export function installationPackRevision(
  tree: InstallationBackupTree,
  syncMetadata: InstallationSyncMetadata,
): string {
  const {
    thumbnail_status: _thumbnailStatus,
    thumbnail_total: _thumbnailTotal,
    thumbnail_ready: _thumbnailReady,
    ...installation
  } = tree.installation;
  const byId = <T extends { id: string }>(records: T[]) =>
    [...records].sort((left, right) => left.id.localeCompare(right.id));

  return sha256(JSON.stringify({
    installation,
    zones: byId(tree.zones),
    electricalAssets: byId(tree.electricalAssets),
    siteAssets: byId(tree.siteAssets),
    formSubmissions: byId(tree.formSubmissions),
    watermark: tree.watermark,
    forceDirty: syncMetadata.forceDirty,
    syncedWatermark: syncMetadata.syncedWatermark ?? null,
  }));
}
