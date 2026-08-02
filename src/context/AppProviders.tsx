import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';
import { ColorTokens, ThemeMode, colors } from '../theme';
import { User } from '../types';
import {
  initStore,
  recoverStoreFromEncryptedCopy,
  retryStoreStartup,
} from '../data/seed';
import { StoreStartupError } from '../data/storePersistence';
import { userRepo } from '../repositories';
import {
  loginToCloud,
  logoutFromCloud,
  restoreCloudSession,
} from '../api/apiClient';
import {
  localUserFromCloud,
  loginAndCacheCloudUser,
  type CloudLoginSource,
} from '../services/authSession';
import { clearSiteAssetEditorDraftsForUser } from '../services/siteAssetEditorDraft';

const THEME_KEY = 'installhub.theme';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  storageIssue: StoreStartupError | null;
  retryStorage: () => Promise<void>;
  restoreStorage: () => Promise<void>;
  login: (
    identifier: string,
    password: string,
    sourceApp?: CloudLoginSource,
  ) => Promise<void>;
  logout: () => Promise<void>;
}

interface ThemeState {
  mode: ThemeMode;
  resolvedMode: 'light' | 'dark';
  colors: ColorTokens;
  toggleTheme: () => void;
  setMode: (mode: ThemeMode) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const ThemeContext = createContext<ThemeState | null>(null);

export function AppProviders({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('light');
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [storageIssue, setStorageIssue] = useState<StoreStartupError | null>(null);

  const loadPreferencesAndSession = useCallback(async () => {
    const savedTheme = await AsyncStorage.getItem(THEME_KEY).catch(() => null);
    if (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'system') {
      setModeState(savedTheme);
    }
    // Cloud session availability is independent of local-store integrity. A
    // remote/offline restore failure never replaces or relabels a store error.
    const cloudUser = await restoreCloudSession().catch(() => null);
    if (cloudUser) {
      const next = localUserFromCloud(cloudUser);
      await userRepo.setCurrent(next);
      setUser(next);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await initStore();
      } catch (error) {
        setStorageIssue(error instanceof StoreStartupError
          ? error
          : new StoreStartupError(
              'PERSISTENCE_FAILED',
              error instanceof Error ? error.message : String(error),
              false,
            ));
        setIsLoading(false);
        return;
      }
      try {
        await loadPreferencesAndSession();
      } catch {
        // Local capture remains available if a remote session cannot restore.
      } finally {
        setIsLoading(false);
      }
    })();
  }, [loadPreferencesAndSession]);

  const finishStorageAction = useCallback(async (action: () => Promise<unknown>) => {
    setIsLoading(true);
    try {
      await action();
      setStorageIssue(null);
      await loadPreferencesAndSession();
    } catch (error) {
      setStorageIssue(error instanceof StoreStartupError
        ? error
        : new StoreStartupError(
            'MIGRATION_FAILED',
            error instanceof Error ? error.message : String(error),
            Boolean(storageIssue?.canRestore),
          ));
    } finally {
      setIsLoading(false);
    }
  }, [loadPreferencesAndSession, storageIssue?.canRestore]);

  const retryStorage = useCallback(
    () => finishStorageAction(retryStoreStartup),
    [finishStorageAction],
  );
  const restoreStorage = useCallback(
    () => finishStorageAction(recoverStoreFromEncryptedCopy),
    [finishStorageAction],
  );

  const setMode = useCallback(async (next: ThemeMode) => {
    setModeState(next);
    await AsyncStorage.setItem(THEME_KEY, next);
  }, []);

  const toggleTheme = useCallback(() => {
    void setMode(mode === 'light' ? 'dark' : 'light');
  }, [mode, setMode]);

  const login = useCallback(async (
    identifier: string,
    password: string,
    sourceApp?: CloudLoginSource,
  ) => {
    const next = await loginAndCacheCloudUser(
      { identifier, password, sourceApp },
      {
        authenticate: loginToCloud,
        persistLocalUser: userRepo.setCurrent,
        discardCloudSession: logoutFromCloud,
      },
    );
    setUser(next);
  }, []);

  const logout = useCallback(async () => {
    if (user) await clearSiteAssetEditorDraftsForUser(user.id);
    setUser(null);
    await logoutFromCloud();
  }, [user]);

  const authValue = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      isLoading,
      storageIssue,
      retryStorage,
      restoreStorage,
      login,
      logout,
    }),
    [user, isLoading, storageIssue, retryStorage, restoreStorage, login, logout],
  );

  const themeValue = useMemo(
    () => {
      const resolvedMode =
        mode === 'system'
          ? systemColorScheme === 'dark' ? 'dark' : 'light'
          : mode;
      return {
        mode,
        resolvedMode,
        colors: colors[resolvedMode],
        toggleTheme,
        setMode,
      };
    },
    [mode, systemColorScheme, toggleTheme, setMode],
  );

  return (
    <ThemeContext.Provider value={themeValue}>
      <AuthContext.Provider value={authValue}>{children}</AuthContext.Provider>
    </ThemeContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth requires AppProviders');
  return ctx;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme requires AppProviders');
  return ctx;
}
