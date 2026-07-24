import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProviders, useTheme } from './src/context/AppProviders';
import { RootNavigator } from './src/navigation/RootNavigator';
import { SyncStatusProvider } from './src/services/SyncStatusContext';
import { SyncStatusBanner } from './src/components/SyncStatusBanner';

function AppShell() {
  const { resolvedMode } = useTheme();
  return (
    <>
      <StatusBar style={resolvedMode === 'dark' ? 'light' : 'dark'} />
      <SyncStatusProvider>
        <RootNavigator />
        <SyncStatusBanner />
      </SyncStatusProvider>
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProviders>
        <AppShell />
      </AppProviders>
    </SafeAreaProvider>
  );
}
