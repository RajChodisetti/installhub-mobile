import { sha256 } from 'js-sha256';
import type { InstallationReportDetailMode } from '../types';

export function formReportJobKey(
  localFormId: string,
  targetInstallationId?: string,
  targetFormId?: string,
  revision?: string,
  recordVersionNumber?: number,
): string {
  if (!targetInstallationId || !targetFormId || !revision) {
    return `form:${localFormId}`;
  }
  return [
    'form',
    localFormId,
    'target',
    targetInstallationId,
    targetFormId,
    recordVersionNumber === undefined ? 'live' : `record-version-${recordVersionNumber}`,
    'revision',
    revision,
  ].join(':');
}

export function installationReportJobKey(
  localInstallationId: string,
  targetInstallationId?: string,
  revision?: string,
  recordVersionNumber?: number,
  detailMode?: InstallationReportDetailMode,
  selectedFormIds: string[] = [],
): string {
  if (!targetInstallationId || !revision) {
    return `installation:${localInstallationId}`;
  }
  return [
    'installation',
    localInstallationId,
    'target',
    targetInstallationId,
    recordVersionNumber === undefined ? 'live' : `record-version-${recordVersionNumber}`,
    'revision',
    revision,
    ...(detailMode
      ? [
          'detail',
          detailMode,
          'forms',
          installationReportSelectionDigest(selectedFormIds),
        ]
      : []),
  ].join(':');
}

export function installationReportSelectionDigest(formIds: string[]): string {
  return sha256(
    JSON.stringify([...new Set(formIds.filter(Boolean))].sort()),
  ).slice(0, 24);
}
