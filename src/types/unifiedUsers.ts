export type UnifiedPortalApp = 'ecoaudit' | 'solarsense' | 'installhub';
export type UnifiedPortalSourceApp = Exclude<UnifiedPortalApp, 'installhub'>;
export type UnifiedPortalSyncStatus =
  | 'synced'
  | 'drifted'
  | 'missing_projection'
  | 'orphaned_projection'
  | 'field_only'
  | 'unlinked';

export type UnifiedPortalMembership = {
  app: UnifiedPortalApp;
  userId: string;
  identityId: string | null;
  email: string;
  fullName: string | null;
  role: 'admin' | 'inspector';
  isActive: boolean;
  isSourceProjection: boolean;
  sourceApp: UnifiedPortalSourceApp | null;
  sourceUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UnifiedPortalUser = {
  key: string;
  identityIds: string[];
  displayEmail: string;
  fullName: string | null;
  candidateKey: string | null;
  possibleDuplicateCount: number;
  memberships: UnifiedPortalMembership[];
  syncStatus: UnifiedPortalSyncStatus;
};

export type UnifiedPortalUsersResponse = {
  data: UnifiedPortalUser[];
  summary: {
    total: number;
    active: number;
    admins: number;
    needsAttention: number;
    byApp: Record<
      UnifiedPortalApp,
      {
        total: number;
        active: number;
        admins: number;
      }
    >;
    bySyncStatus: Record<UnifiedPortalSyncStatus, number>;
  };
};

