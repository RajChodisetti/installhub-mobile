import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProviders, useTheme } from './src/context/AppProviders';
import { RootNavigator } from './src/navigation/RootNavigator';
import { SyncStatusProvider } from './src/services/SyncStatusContext';
import { SyncStatusBanner } from './src/components/SyncStatusBanner';
import { AuditWorkTrackingProvider } from './src/services/AuditWorkTrackingContext';
import { PushNotificationProvider } from './src/services/PushNotificationProvider';

function AppShell() {
  const { resolvedMode } = useTheme();
  return (
    <>
      <StatusBar style={resolvedMode === 'dark' ? 'light' : 'dark'} />
      <PushNotificationProvider>
        <AuditWorkTrackingProvider>
          <SyncStatusProvider>
            <RootNavigator />
            <SyncStatusBanner />
          </SyncStatusProvider>
        </AuditWorkTrackingProvider>
      </PushNotificationProvider>
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
