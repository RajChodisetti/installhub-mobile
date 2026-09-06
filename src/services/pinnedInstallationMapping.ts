import { sha256 } from 'js-sha256';
import type { InstallationMappingResponse } from '../api/apiClient';
import type { InstallationBackupTree } from '../repositories/cloudSyncRepository';
import { isInstallationTreeBackedUpCurrent, type InstallationSyncMetadata } from './installationPackTarget';
import { validRecordVersionNumber } from './reportVersioning';

/** Matches the API canonical.ts stableStringify contract, including code-unit key sorting. */
export function pinnedMappingCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(pinnedMappingCanonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source).sort().map((key) => `${JSON.stringify(key)}:${pinnedMappingCanonicalJson(source[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function assertPinnedMappingLocalTarget(tree: InstallationBackupTree, metadata: InstallationSyncMetadata, expectedVersion: number): void {
  const installation = tree.installation;
  if (installation.status !== 'Completed' || validRecordVersionNumber(expectedVersion) === undefined
    || installation.record_version_number !== expectedVersion || installation.server_tree_revision === undefined
    || installation.is_imported_copy || installation.pending_completion
    || installation.backup_conflict?.kind === 'CONFLICT' || !isInstallationTreeBackedUpCurrent(tree, metadata)) {
    throw new Error('Download requires the current completed installation and its confirmed cloud version. Finish backup or resolve the conflict, then retry.');
  }
}

/** Never relabel a local preview or another saved version as the requested server mapping. */
export function assertPinnedInstallationMapping(mapping: InstallationMappingResponse, installationId: string, recordVersionNumber: number): void {
  if (!mapping || mapping.schema !== 'installation-mapping/v1' || mapping.authority === 'LOCAL_ADVISORY'
    || mapping.installation?.id !== installationId || mapping.installation.recordVersionNumber !== recordVersionNumber
    || mapping.readiness?.installationId !== installationId || mapping.readiness.eligibility?.mappingExport !== true
    || (mapping.readiness.recordVersionNumber !== undefined && mapping.readiness.recordVersionNumber !== recordVersionNumber)
    || typeof mapping.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(mapping.contentHash)) {
    throw new Error('The server did not return the requested eligible pinned mapping.');
  }
  const { contentHash, ...payload } = mapping;
  if (sha256(pinnedMappingCanonicalJson(payload)) !== contentHash) {
    throw new Error('The pinned mapping failed its content hash check. Retry the download.');
  }
}
