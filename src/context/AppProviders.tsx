import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ColorTokens, ThemeMode, colors } from '../theme';
import { User } from '../types';
import { initStore } from '../data/seed';
import { userRepo } from '../repositories';

const THEME_KEY = 'installhub.theme';
const AUTH_KEY = 'installhub.auth';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

interface ThemeState {
  mode: ThemeMode;
  colors: ColorTokens;
  toggleTheme: () => void;
  setMode: (mode: ThemeMode) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);
const ThemeContext = createContext<ThemeState | null>(null);

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>('light');
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      await initStore();
      const [savedTheme, savedAuth] = await Promise.all([
        AsyncStorage.getItem(THEME_KEY),
        AsyncStorage.getItem(AUTH_KEY),
      ]);
      if (savedTheme === 'dark' || savedTheme === 'light') setModeState(savedTheme);
      if (savedAuth === '1') {
        setUser(await userRepo.getCurrent());
      }
      setIsLoading(false);
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
    // Demo auth: any email, password must be "password123"
    if (!email.trim() || password !== 'password123') {
      throw new Error('Invalid credentials. Use any email and password123');
    }
    const current = await userRepo.getCurrent();
    const next = await userRepo.updateProfile({ email: email.trim() });
    setUser({ ...current, ...next, email: email.trim() });
    await AsyncStorage.setItem(AUTH_KEY, '1');
  }, []);

  const logout = useCallback(async () => {
    setUser(null);
    await AsyncStorage.removeItem(AUTH_KEY);
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
    () => ({
      mode,
      colors: colors[mode],
      toggleTheme,
      setMode,
    }),
    [mode, toggleTheme, setMode],
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
