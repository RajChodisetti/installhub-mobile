import type {
  UnifiedPortalApp,
  UnifiedPortalMembership,
  UnifiedPortalSyncStatus,
  UnifiedPortalUser,
} from '../types/unifiedUsers';

const APP_SEARCH_LABELS: Record<UnifiedPortalApp, readonly string[]> = {
  ecoaudit: ['eco audit', 'ecoaudit'],
  solarsense: ['solar sense', 'solarsense'],
  installhub: ['field app', 'installhub'],
};

const SYNC_SEARCH_LABELS: Record<UnifiedPortalSyncStatus, readonly string[]> = {
  synced: ['synced'],
  drifted: ['drifted', 'role drift', 'status drift', 'needs attention'],
  missing_projection: [
    'missing projection',
    'missing field access',
    'needs attention',
  ],
  orphaned_projection: [
    'orphaned projection',
    'orphaned field access',
    'needs attention',
  ],
  field_only: ['field only', 'field-only'],
  unlinked: ['unlinked', 'needs attention'],
};

export function membershipForApp(
  user: UnifiedPortalUser,
  app: UnifiedPortalApp,
): UnifiedPortalMembership | undefined {
  return user.memberships.find((membership) => membership.app === app);
}

export function editableFieldMembership(
  user: UnifiedPortalUser,
): UnifiedPortalMembership | undefined {
  if (user.syncStatus !== 'field_only' || user.memberships.length !== 1) {
    return undefined;
  }

  const membership = user.memberships[0];
  if (
    membership.app !== 'installhub' ||
    membership.isSourceProjection ||
    membership.sourceApp
  ) {
    return undefined;
  }
  return membership;
}

export function filterUnifiedPortalUsers(
  users: readonly UnifiedPortalUser[],
  search: string,
): UnifiedPortalUser[] {
  const needle = search.trim().toLocaleLowerCase();
  if (!needle) return [...users];

  return users.filter((user) => {
    const searchable = [
      user.key,
      ...user.identityIds,
      user.fullName ?? '',
      user.displayEmail,
      user.candidateKey ?? '',
      String(user.possibleDuplicateCount),
      user.syncStatus,
      ...SYNC_SEARCH_LABELS[user.syncStatus],
      ...user.memberships.flatMap((membership) => [
        membership.app,
        ...APP_SEARCH_LABELS[membership.app],
        membership.userId,
        membership.identityId ?? '',
        membership.email,
        membership.fullName ?? '',
        membership.role,
        membership.role === 'admin' ? 'administrator' : 'inspector',
        membership.isActive ? 'active' : 'inactive',
        membership.isSourceProjection ? 'source projection' : 'direct account',
        membership.sourceApp ?? '',
        membership.sourceUserId ?? '',
        membership.createdAt,
        membership.updatedAt,
        ...(membership.sourceApp
          ? APP_SEARCH_LABELS[membership.sourceApp]
          : []),
      ]),
    ];

    return searchable.some((value) =>
      value.toLocaleLowerCase().includes(needle),
    );
  });
}
