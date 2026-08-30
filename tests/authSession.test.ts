import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSyncApiUrl } from '../src/constants/syncConfig';
import {
  buildCloudLoginPayload,
  cloudLoginIdentifier,
  createSessionMutationCoordinator,
  isCloudAuthResponse,
  localUserFromCloud,
  loginAndCacheCloudUser,
  persistCloudSessionWithRollback,
  persistSessionIfCurrent,
  restoreCloudSessionWithDependencies,
  runWithSessionAccessLease,
  supportsCloudLoginSource,
} from '../src/services/authSession';
import type { CloudUser } from '../src/api/apiClient';
import type { User } from '../src/types';

const verifiedCloudUser: CloudUser = {
  id: 'unified-field:ecoaudit:user-1',
  email: 'raj@ecoaudit.users.local',
  fullName: 'Raj',
  role: 'admin',
  app: 'installhub',
  sourceManaged: true,
  sourceApp: 'ecoaudit',
};

test('device builds accept only a credential-free HTTPS API origin', () => {
  assert.equal(
    resolveSyncApiUrl(),
    'https://api.sustainabilitywise.com.au',
  );
  assert.equal(
    resolveSyncApiUrl(' https://example.test/ '),
    'https://example.test',
  );
  assert.throws(
    () => resolveSyncApiUrl('https://EXAMPLE.test:443/api/path?ignored=yes'),
    /must contain only.*HTTPS origin/,
  );
  assert.throws(
    () => resolveSyncApiUrl('https://example.test/#fragment'),
    /must contain only.*HTTPS origin/,
  );
  assert.throws(
    () => resolveSyncApiUrl('http://localhost:3000/'),
    /credential-free HTTPS origin/,
  );
  assert.throws(
    () => resolveSyncApiUrl('https://user:secret@example.test/'),
    /credential-free HTTPS origin/,
  );
});

test('login identity preserves automatic usernames and applies an explicit source', () => {
  assert.equal(cloudLoginIdentifier(' Raj '), 'raj');
  assert.equal(
    cloudLoginIdentifier(' Raj ', 'ecoaudit'),
    'raj@ecoaudit.users.local',
  );
  assert.equal(
    cloudLoginIdentifier('raj@installhub.users.local', 'solarsense'),
    'raj@solarsense.users.local',
  );
  assert.equal(
    cloudLoginIdentifier('person@example.com', 'ecoaudit'),
    'person@example.com',
  );
  assert.equal(supportsCloudLoginSource('raj'), true);
  assert.equal(
    supportsCloudLoginSource('raj@installhub.users.local'),
    true,
  );
  assert.equal(
    cloudLoginIdentifier('raj@wattwatchers.users.local', 'ecoaudit'),
    'raj@ecoaudit.users.local',
  );
  assert.equal(supportsCloudLoginSource('person@example.com'), false);
});

test('login payload normalizes only identity and preserves password bytes', () => {
  const password = ' Case-Sensitive Password ';
  assert.deepEqual(
    buildCloudLoginPayload({ identifier: ' Raj ', password }),
    {
      app: 'installhub',
      email: 'raj',
      password,
    },
  );
  assert.deepEqual(
    buildCloudLoginPayload({
      identifier: ' Raj ',
      password,
      sourceApp: 'ecoaudit',
    }),
    {
      app: 'installhub',
      email: 'raj@ecoaudit.users.local',
      password,
    },
  );
});

test('session validation rejects malformed tokens, roles, apps, and identities', () => {
  assert.equal(isCloudAuthResponse({
    accessToken: 'access',
    refreshToken: 'refresh',
    user: verifiedCloudUser,
  }), true);
  assert.equal(isCloudAuthResponse({
    accessToken: '',
    refreshToken: 'refresh',
    user: verifiedCloudUser,
  }), false);
  assert.equal(isCloudAuthResponse({
    accessToken: 'access',
    refreshToken: 'refresh',
    user: { ...verifiedCloudUser, role: 'viewer' },
  }), false);
  assert.equal(isCloudAuthResponse({
    accessToken: 'access',
    refreshToken: 'refresh',
    user: { ...verifiedCloudUser, app: 'ecoaudit' },
  }), false);
  assert.equal(isCloudAuthResponse({
    accessToken: 'access',
    refreshToken: 'refresh',
    user: { ...verifiedCloudUser, id: '' },
  }), false);
});

test('a successful API login persists the exact verified server identity', async () => {
  const savedUsers: User[] = [];
  let discarded = false;
  const credentials = {
    identifier: 'raj',
    password: 'development-password',
    sourceApp: 'ecoaudit' as const,
  };

  const result = await loginAndCacheCloudUser(credentials, {
    authenticate: async (input) => {
      assert.deepEqual(input, credentials);
      return verifiedCloudUser;
    },
    persistLocalUser: async (user) => {
      savedUsers.push(user);
    },
    discardCloudSession: async () => {
      discarded = true;
    },
  });

  assert.equal(result.id, verifiedCloudUser.id);
  assert.equal(savedUsers.length, 1);
  assert.equal(savedUsers[0]?.id, verifiedCloudUser.id);
  assert.equal(savedUsers[0]?.email, verifiedCloudUser.email);
  assert.equal(savedUsers[0]?.source_app, 'ecoaudit');
  assert.equal(savedUsers[0]?.source_managed, true);
  assert.equal('password' in result, false);
  assert.equal(discarded, false);
});

test('a rejected API login performs no local user write', async () => {
  let writes = 0;
  let discarded = false;

  await assert.rejects(
    loginAndCacheCloudUser(
      { identifier: 'rejected', password: 'wrong' },
      {
        authenticate: async () => {
          throw new Error('Unauthorized');
        },
        persistLocalUser: async () => {
          writes += 1;
        },
        discardCloudSession: async () => {
          discarded = true;
        },
      },
    ),
    /Unauthorized/,
  );

  assert.equal(writes, 0);
  assert.equal(discarded, false);
});

test('a local persistence failure discards the newly created cloud session', async () => {
  let discarded = false;

  await assert.rejects(
    loginAndCacheCloudUser(
      { identifier: 'raj', password: 'development-password' },
      {
        authenticate: async () => verifiedCloudUser,
        persistLocalUser: async () => {
          throw new Error('local write failed');
        },
        discardCloudSession: async () => {
          discarded = true;
        },
      },
    ),
    /local write failed/,
  );

  assert.equal(discarded, true);
});

test('cloud users map to local profiles without changing their API ID', () => {
  assert.deepEqual(localUserFromCloud(verifiedCloudUser), {
    id: verifiedCloudUser.id,
    email: verifiedCloudUser.email,
    full_name: 'Raj',
    role: 'admin',
    source_managed: true,
    source_app: 'ecoaudit',
    source_state: undefined,
  });
});

test('partial secure-session writes revoke and clear the new session', async () => {
  const calls: string[] = [];

  await assert.rejects(
    persistCloudSessionWithRollback({
      persistTokens: async () => {
        calls.push('tokens');
      },
      persistUser: async () => {
        calls.push('user');
        throw new Error('SecureStore failed');
      },
      revokeSession: async () => {
        calls.push('revoke');
      },
      clearSession: async () => {
        calls.push('clear');
      },
    }),
    /SecureStore failed/,
  );

  assert.deepEqual(calls, ['tokens', 'user', 'clear', 'revoke']);
});

test('a refresh response arriving after logout cannot restore the old session', async () => {
  const coordinator = createSessionMutationCoordinator();
  const refreshGeneration = coordinator.captureGeneration();
  let releaseRefresh: (() => void) | undefined;
  const refreshResponse = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  let storedAccessToken: string | null = 'old-access';

  const refresh = (async () => {
    await refreshResponse;
    return persistSessionIfCurrent(
      coordinator,
      refreshGeneration,
      async () => {
        storedAccessToken = 'rotated-access';
      },
    );
  })();

  coordinator.invalidate();
  await coordinator.runExclusive(async () => {
    storedAccessToken = null;
  });
  releaseRefresh?.();

  assert.equal(await refresh, false);
  assert.equal(storedAccessToken, null);
});

test('a delayed request cannot refresh or retry after another account signs in', async () => {
  const coordinator = createSessionMutationCoordinator();
  const accountAGeneration = coordinator.captureGeneration();
  let releaseResponse: (() => void) | undefined;
  const accountAResponse = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  let storedAccount = 'A';
  let refreshes = 0;
  let retries = 0;

  const delayedAccountARequest = (async () => {
    await accountAResponse;
    if (!coordinator.isCurrent(accountAGeneration)) return 'stale';
    refreshes += 1;
    retries += 1;
    return 'retried';
  })();

  coordinator.invalidate();
  await coordinator.runExclusive(async () => {
    storedAccount = '';
  });

  const accountBLoginGeneration = coordinator.captureGeneration();
  await coordinator.runExclusive(async () => {
    assert.equal(coordinator.isCurrent(accountBLoginGeneration), true);
    coordinator.invalidate();
    storedAccount = 'B';
  });

  releaseResponse?.();

  assert.equal(await delayedAccountARequest, 'stale');
  assert.equal(refreshes, 0);
  assert.equal(retries, 0);
  assert.equal(storedAccount, 'B');
});

test('a failed binary download cannot retry after another account signs in', async () => {
  const coordinator = createSessionMutationCoordinator();
  const accountAGeneration = coordinator.captureGeneration();
  let releaseFailure: (() => void) | undefined;
  const firstDownloadFailure = new Promise<void>((resolve) => {
    releaseFailure = resolve;
  });
  const attemptedTokens: string[] = [];
  let refreshes = 0;
  let storedAccount = 'A';

  const download = runWithSessionAccessLease(
    {
      generation: accountAGeneration,
      accessToken: 'account-a-access',
    },
    {
      isCurrent: coordinator.isCurrent,
      perform: async (accessToken) => {
        attemptedTokens.push(accessToken);
        await firstDownloadFailure;
        throw new Error('download unauthorized');
      },
      refresh: async () => {
        refreshes += 1;
        return 'account-b-access';
      },
      staleSessionError: () => new Error('session changed'),
    },
  );

  coordinator.invalidate();
  await coordinator.runExclusive(async () => {
    storedAccount = '';
  });
  await coordinator.runExclusive(async () => {
    coordinator.invalidate();
    storedAccount = 'B';
  });
  releaseFailure?.();

  await assert.rejects(download, /session changed/);
  assert.deepEqual(attemptedTokens, ['account-a-access']);
  assert.equal(refreshes, 0);
  assert.equal(storedAccount, 'B');
});

type RestoreDependencies =
  Parameters<typeof restoreCloudSessionWithDependencies>[0];

const offlineError = new Error('offline');
const definitiveAuthError = new Error('inactive');

function restoreDependencies(
  overrides: Partial<RestoreDependencies> = {},
): RestoreDependencies {
  return {
    getCachedUser: async () => verifiedCloudUser,
    getAccessToken: async () => 'access',
    getRefreshToken: async () => 'refresh',
    refreshSession: async () => ({
      status: 'refreshed',
      accessToken: 'next-access',
    }),
    fetchCurrentUser: async () => verifiedCloudUser,
    persistCurrentUser: async () => {},
    clearSession: async () => {},
    isOfflineError: (error) => error === offlineError,
    isDefinitiveAuthError: (error) => error === definitiveAuthError,
    ...overrides,
  };
}

test('a cached identity cannot restore when both durable tokens are missing', async () => {
  let clears = 0;
  let fetches = 0;
  const result = await restoreCloudSessionWithDependencies(
    restoreDependencies({
      getAccessToken: async () => null,
      getRefreshToken: async () => null,
      fetchCurrentUser: async () => {
        fetches += 1;
        return verifiedCloudUser;
      },
      clearSession: async () => {
        clears += 1;
      },
    }),
  );

  assert.equal(result, null);
  assert.equal(fetches, 0);
  assert.equal(clears, 1);
});

test('offline refresh restores the cached identity without clearing it', async () => {
  let clears = 0;
  const result = await restoreCloudSessionWithDependencies(
    restoreDependencies({
      getAccessToken: async () => null,
      refreshSession: async () => ({ status: 'offline' }),
      clearSession: async () => {
        clears += 1;
      },
    }),
  );

  assert.equal(result?.id, verifiedCloudUser.id);
  assert.equal(clears, 0);
});

test('rejected refresh clears the cached identity', async () => {
  let clears = 0;
  const result = await restoreCloudSessionWithDependencies(
    restoreDependencies({
      getAccessToken: async () => null,
      refreshSession: async () => ({ status: 'rejected' }),
      clearSession: async () => {
        clears += 1;
      },
    }),
  );

  assert.equal(result, null);
  assert.equal(clears, 1);
});

test('definitive current-user rejection clears tokens while network failure stays offline', async () => {
  let clears = 0;
  const rejected = await restoreCloudSessionWithDependencies(
    restoreDependencies({
      fetchCurrentUser: async () => {
        throw definitiveAuthError;
      },
      clearSession: async () => {
        clears += 1;
      },
    }),
  );
  assert.equal(rejected, null);
  assert.equal(clears, 1);

  const offline = await restoreCloudSessionWithDependencies(
    restoreDependencies({
      fetchCurrentUser: async () => {
        throw offlineError;
      },
    }),
  );
  assert.equal(offline?.id, verifiedCloudUser.id);
});

test('a malformed current-user response clears the local session', async () => {
  let clears = 0;
  const result = await restoreCloudSessionWithDependencies(
    restoreDependencies({
      fetchCurrentUser: async () => ({
        app: 'installhub',
        id: '',
      }),
      clearSession: async () => {
        clears += 1;
      },
    }),
  );

  assert.equal(result, null);
  assert.equal(clears, 1);
});
