import type {
  User,
  UserSourceApp,
  UserSourceState,
} from '../types';
import { sourceUserDisplayEmail } from '../utils/sourceManagedUsers';

export type CloudLoginSource = UserSourceApp | null;

export interface CloudUser {
  id: string;
  email: string;
  fullName: string | null;
  role: 'admin' | 'inspector';
  app: 'installhub';
  sourceManaged?: boolean;
  sourceApp?: UserSourceApp | null;
  sourceState?: UserSourceState;
}

export interface CloudAuthResponse {
  accessToken: string;
  refreshToken: string;
  user: CloudUser;
}

const APP_LOCAL_EMAIL =
  /^([^@]+)@(ecoaudit|solarsense|installhub|wattwatchers)\.users\.local$/;

export function supportsCloudLoginSource(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return !normalized.includes('@') || APP_LOCAL_EMAIL.test(normalized);
}

export function cloudLoginIdentifier(
  value: string,
  sourceApp: CloudLoginSource = null,
): string {
  const normalized = value.trim().toLowerCase();
  if (!sourceApp) return normalized;
  const localMatch = APP_LOCAL_EMAIL.exec(normalized);
  const username = localMatch?.[1] ?? (
    normalized.includes('@')
      ? null
      : normalized.replace(/[^a-z0-9._-]/g, '-').replace(/-+/g, '-')
  );
  return username ? `${username}@${sourceApp}.users.local` : normalized;
}

export interface CloudLoginCredentials {
  identifier: string;
  password: string;
  sourceApp?: CloudLoginSource;
}

export function buildCloudLoginPayload(credentials: CloudLoginCredentials): {
  app: 'installhub';
  email: string;
  password: string;
} {
  return {
    app: 'installhub',
    email: cloudLoginIdentifier(
      credentials.identifier,
      credentials.sourceApp,
    ),
    password: credentials.password,
  };
}

export function isCloudUser(value: unknown): value is CloudUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Partial<CloudUser>;
  return (
    typeof user.id === 'string' &&
    user.id.length > 0 &&
    typeof user.email === 'string' &&
    user.email.length > 0 &&
    (user.fullName === null || typeof user.fullName === 'string') &&
    (user.role === 'admin' || user.role === 'inspector') &&
    user.app === 'installhub'
  );
}

export function isCloudAuthResponse(
  value: unknown,
): value is CloudAuthResponse {
  if (!value || typeof value !== 'object') return false;
  const response = value as Partial<CloudAuthResponse>;
  return (
    typeof response.accessToken === 'string' &&
    response.accessToken.length > 0 &&
    typeof response.refreshToken === 'string' &&
    response.refreshToken.length > 0 &&
    isCloudUser(response.user)
  );
}

export function localUserFromCloud(user: CloudUser): User {
  return {
    id: user.id,
    email: user.email,
    full_name: user.fullName || sourceUserDisplayEmail(user.email),
    role: user.role === 'admin' ? 'admin' : 'user',
    source_managed: user.sourceManaged === true,
    source_app: user.sourceManaged === true ? user.sourceApp ?? null : null,
    source_state: user.sourceState,
  };
}

export async function loginAndCacheCloudUser(
  credentials: CloudLoginCredentials,
  dependencies: {
    authenticate: (input: CloudLoginCredentials) => Promise<CloudUser>;
    persistLocalUser: (user: User) => Promise<unknown>;
    discardCloudSession: () => Promise<unknown>;
  },
): Promise<User> {
  const cloudUser = await dependencies.authenticate(credentials);
  const localUser = localUserFromCloud(cloudUser);
  try {
    await dependencies.persistLocalUser(localUser);
  } catch (error) {
    await dependencies.discardCloudSession().catch(() => {});
    throw error;
  }
  return localUser;
}

export type RefreshSessionResult =
  | { status: 'refreshed'; accessToken: string }
  | { status: 'offline' }
  | { status: 'rejected' };

export interface SessionMutationCoordinator {
  captureGeneration: () => number;
  invalidate: () => number;
  isCurrent: (generation: number) => boolean;
  runExclusive: <T>(mutation: () => Promise<T>) => Promise<T>;
}

export function createSessionMutationCoordinator(): SessionMutationCoordinator {
  let generation = 0;
  let pendingMutation = Promise.resolve();

  return {
    captureGeneration: () => generation,
    invalidate: () => {
      generation += 1;
      return generation;
    },
    isCurrent: (candidate) => candidate === generation,
    runExclusive: <T>(mutation: () => Promise<T>): Promise<T> => {
      const result = pendingMutation.then(mutation, mutation);
      pendingMutation = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

export async function persistSessionIfCurrent(
  coordinator: SessionMutationCoordinator,
  generation: number,
  persist: () => Promise<void>,
): Promise<boolean> {
  return coordinator.runExclusive(async () => {
    if (!coordinator.isCurrent(generation)) return false;
    await persist();
    return coordinator.isCurrent(generation);
  });
}

export async function runWithSessionAccessLease<T>(
  lease: {
    generation: number;
    accessToken: string;
  },
  dependencies: {
    isCurrent: (generation: number) => boolean;
    perform: (accessToken: string) => Promise<T>;
    refresh: () => Promise<string | null>;
    staleSessionError: () => Error;
  },
): Promise<T> {
  const assertCurrent = () => {
    if (!dependencies.isCurrent(lease.generation)) {
      throw dependencies.staleSessionError();
    }
  };

  assertCurrent();
  try {
    const result = await dependencies.perform(lease.accessToken);
    assertCurrent();
    return result;
  } catch (firstError) {
    assertCurrent();
    const refreshedAccessToken = await dependencies.refresh();
    assertCurrent();
    if (!refreshedAccessToken) throw firstError;
    const result = await dependencies.perform(refreshedAccessToken);
    assertCurrent();
    return result;
  }
}

export async function persistCloudSessionWithRollback(
  dependencies: {
    persistTokens: () => Promise<unknown>;
    persistUser: () => Promise<unknown>;
    revokeSession: () => Promise<unknown>;
    clearSession: () => Promise<unknown>;
  },
): Promise<void> {
  try {
    await dependencies.persistTokens();
    await dependencies.persistUser();
  } catch (error) {
    const clear = dependencies.clearSession().catch(() => {});
    void dependencies.revokeSession().catch(() => {});
    await clear;
    throw error;
  }
}

export async function restoreCloudSessionWithDependencies(
  dependencies: {
    getCachedUser: () => Promise<CloudUser | null>;
    getAccessToken: () => Promise<string | null>;
    getRefreshToken: () => Promise<string | null>;
    refreshSession: () => Promise<RefreshSessionResult>;
    fetchCurrentUser: () => Promise<unknown>;
    persistCurrentUser: (user: CloudUser) => Promise<unknown>;
    clearSession: () => Promise<unknown>;
    isOfflineError: (error: unknown) => boolean;
    isDefinitiveAuthError: (error: unknown) => boolean;
  },
): Promise<CloudUser | null> {
  const cachedUser = await dependencies.getCachedUser();
  if (!await dependencies.getAccessToken()) {
    if (!await dependencies.getRefreshToken()) {
      await dependencies.clearSession().catch(() => {});
      return null;
    }
    const refresh = await dependencies.refreshSession();
    if (refresh.status === 'rejected') {
      await dependencies.clearSession().catch(() => {});
      return null;
    }
    if (refresh.status === 'offline') return cachedUser;
  }

  try {
    const currentUser = await dependencies.fetchCurrentUser();
    if (!isCloudUser(currentUser)) {
      await dependencies.clearSession().catch(() => {});
      return null;
    }
    await dependencies.persistCurrentUser(currentUser);
    return currentUser;
  } catch (error) {
    if (dependencies.isOfflineError(error)) return cachedUser;
    if (dependencies.isDefinitiveAuthError(error)) {
      await dependencies.clearSession().catch(() => {});
      return null;
    }
    throw error;
  }
}
