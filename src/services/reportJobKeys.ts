export function formReportJobKey(
  localFormId: string,
  targetInstallationId?: string,
  targetFormId?: string,
  revision?: string,
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
    'revision',
    revision,
  ].join(':');
}

export function installationReportJobKey(
  localInstallationId: string,
  targetInstallationId?: string,
  revision?: string,
): string {
  if (!targetInstallationId || !revision) {
    return `installation:${localInstallationId}`;
  }
  return [
    'installation',
    localInstallationId,
    'target',
    targetInstallationId,
    'revision',
    revision,
  ].join(':');
}
