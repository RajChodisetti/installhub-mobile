export const INSTALLATION_SITE_CODE_MAX_LENGTH = 16;
export const INSTALLATION_SITE_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export function isValidInstallationSiteCode(value: string): boolean {
  return value.length >= 1
    && value.length <= INSTALLATION_SITE_CODE_MAX_LENGTH
    && INSTALLATION_SITE_CODE_PATTERN.test(value);
}

export function normalizedSiteCode(siteName: string): string {
  const words = siteName
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'SITE';
  return words.map((word) => word[0]).join('').toUpperCase().slice(0, 8) || 'SITE';
}
