import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useColorScheme } from 'react-native';
import { ColorTokens, ThemeMode, colors } from '../theme';
import { User } from '../types';
import { initStore } from '../data/seed';
import { userRepo } from '../repositories';
import {
  loginToCloud,
  logoutFromCloud,
  restoreCloudSession,
  type CloudUser,
} from '../api/apiClient';

const THEME_KEY = 'installhub.theme';

function localUserFromCloud(user: CloudUser): User {
  return {
    id: user.id,
    email: user.email,
    full_name: user.fullName || user.email,
    role: user.role === 'admin' ? 'admin' : 'user',
  };
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
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

  useEffect(() => {
    (async () => {
      try {
        await initStore();
        const [savedTheme, cloudUser] = await Promise.all([
          AsyncStorage.getItem(THEME_KEY),
          restoreCloudSession(),
        ]);
        if (
          savedTheme === 'dark' ||
          savedTheme === 'light' ||
          savedTheme === 'system'
        ) setModeState(savedTheme);
        if (cloudUser) {
          const next = localUserFromCloud(cloudUser);
          await userRepo.updateProfile(next);
          setUser(next);
        }
      } catch {
        // A server error must not prevent the local app shell from starting.
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const setMode = useCallback(async (next: ThemeMode) => {
    setModeState(next);
    await AsyncStorage.setItem(THEME_KEY, next);
  }, []);

  const toggleTheme = useCallback(() => {
    void setMode(mode === 'light' ? 'dark' : 'light');
  }, [mode, setMode]);

  const login = useCallback(async (email: string, password: string) => {
    const current = await userRepo.getCurrent();
    const cloudUser = await loginToCloud({
      email,
      password,
      localUserId: current.id,
      fullName: current.full_name,
      role: current.role === 'admin' ? 'admin' : 'inspector',
    });
    const next = localUserFromCloud(cloudUser);
    await userRepo.updateProfile(next);
    setUser(next);
  }, []);

  const logout = useCallback(async () => {
    setUser(null);
    await logoutFromCloud();
  }, []);

  const authValue = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      isLoading,
      login,
      logout,
    }),
    [user, isLoading, login, logout],
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
