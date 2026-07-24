import { apiClient } from '../api/apiClient';
import type { Installation } from '../types';
import { remoteInstallationTreeRevision } from './remoteInstallationRevision';

/**
 * Re-pulls the source immediately before source-ID PDF generation. A missing,
 * inaccessible, or changed source is handled conservatively by backing up the
 * local cpN tree under its own identity.
 */
export async function importedSourceRevisionStillMatches(
  installation: Installation,
): Promise<boolean> {
  if (
    !installation.import_source_server_id ||
    !installation.import_source_tree_revision
  ) {
    return false;
  }
  try {
    const result = await apiClient.pull(
      '1970-01-01T00:00:00.000Z',
      installation.import_source_server_id,
    );
    const source = result.installations[0];
    return Boolean(
      source &&
      remoteInstallationTreeRevision(source) ===
        installation.import_source_tree_revision,
    );
  } catch {
    return false;
  }
}
