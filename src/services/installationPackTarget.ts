import { sha256 } from 'js-sha256';
import type { InstallationBackupTree } from '../repositories/cloudSyncRepository';

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
};

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

function completedLocalFormIds(tree: InstallationBackupTree): string[] {
  return tree.formSubmissions
    .filter((form) => form.status === 'Completed')
    .map((form) => form.id);
}

export function hasIntactImportedSourceProvenance(
  tree: InstallationBackupTree,
  syncMetadata: InstallationSyncMetadata,
): boolean {
  if (
    tree.installation.is_imported_copy !== true ||
    tree.installation.cloud_backup_enabled ||
    !tree.installation.import_source_server_id ||
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
): InstallationPackServerTarget {
  const localTarget = (
    reason: Exclude<
      InstallationPackServerTarget['reason'],
      'original-import-provenance'
    >,
  ): InstallationPackServerTarget => ({
    installationId: tree.installation.id,
    formSubmissionIds: completedLocalFormIds(tree),
    usesOriginalImportedRecord: false,
    reason,
  });

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

  return {
    installationId: tree.installation.import_source_server_id,
    formSubmissionIds: tree.formSubmissions
      .filter((form) => form.status === 'Completed')
      .map((form) => form.import_source_server_id!),
    usesOriginalImportedRecord: true,
    reason: 'original-import-provenance',
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
