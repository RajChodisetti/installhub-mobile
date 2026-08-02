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
  ].join(':');
}
