import type { UserSourceApp, UserSourceState } from '../types';

export interface SourceManagedUserMetadata {
  sourceManaged?: boolean;
  sourceApp?: UserSourceApp | null;
  sourceState?: UserSourceState;
}

export function isSourceManagedUser(
  user: SourceManagedUserMetadata | null | undefined,
): boolean {
  return (
    user?.sourceManaged === true ||
    user?.sourceState === 'linked' ||
    user?.sourceState === 'orphaned'
  );
}

export function isOrphanedSourceUser(
  user: SourceManagedUserMetadata | null | undefined,
): boolean {
  return user?.sourceState === 'orphaned';
}

export function sourceAppDisplayName(
  sourceApp: UserSourceApp | null | undefined,
): string {
  if (sourceApp === 'ecoaudit') return 'Eco Audit';
  if (sourceApp === 'solarsense') return 'Solar Sense';
  return 'source app';
}

export function sourceManagedBadgeLabel(
  user: SourceManagedUserMetadata,
): string | null {
  if (!isSourceManagedUser(user)) return null;
  if (isOrphanedSourceUser(user)) return 'Source unavailable · read only';
  return `${sourceAppDisplayName(user.sourceApp)} · read only`;
}

export function sourceUserDisplayEmail(
  email: string | null | undefined,
): string {
  const value = email?.trim() ?? '';
  if (
    !value ||
    /^bridge-[^@]+@installhub\.users\.local$/i.test(value)
  ) {
    return 'Source account unavailable';
  }
  return value;
}

export function passwordChangeSessionNotice(
  sourceApp?: UserSourceApp | null,
  sourceManaged = Boolean(sourceApp),
): string {
  if (sourceManaged) {
    const appName = sourceAppDisplayName(sourceApp);
    return `This device's local session is cleared immediately. Refresh sessions for ${appName} and Field App Complete are revoked. Already-issued access tokens may remain valid for up to 15 minutes.`;
  }
  return `This device's local Field App Complete session is cleared immediately. Field App Complete refresh sessions are revoked. Already-issued access tokens may remain valid for up to 15 minutes.`;
}
