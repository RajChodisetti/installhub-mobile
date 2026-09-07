import type { InstallationStatus } from '../types';

export type ElectricalMapFileFormat = 'png' | 'svg';

export function electricalMapRecordVersionForDownload(
  status: InstallationStatus,
  recordVersionNumber?: number | null,
): number | undefined {
  if (status === 'Draft') return undefined;
  if (!Number.isSafeInteger(recordVersionNumber) || (recordVersionNumber ?? 0) < 1) {
    throw new Error('A completed electrical map requires a positive immutable record version.');
  }
  return recordVersionNumber ?? undefined;
}

export function electricalMapDownloadPath(
  installationId: string,
  format: ElectricalMapFileFormat,
  recordVersionNumber?: number,
): string {
  if (recordVersionNumber !== undefined && (!Number.isSafeInteger(recordVersionNumber) || recordVersionNumber < 1)) {
    throw new Error('The pinned electrical-map version is invalid.');
  }
  const version = recordVersionNumber !== undefined
    ? `&recordVersionNumber=${encodeURIComponent(String(recordVersionNumber))}`
    : '';
  return `/v1/installhub/installations/${encodeURIComponent(installationId)}/electrical-map?format=${format}${version}`;
}
