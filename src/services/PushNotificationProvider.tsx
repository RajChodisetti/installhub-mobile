import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../context/AppProviders';
import {
  beginAuthenticatedPushNotificationSession,
  listenForPushTokenRotation,
} from './pushNotifications';

export function PushNotificationProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, user } = useAuth();

  useEffect(() => {
    if (isLoading || !isAuthenticated || !user) return undefined;

    const session = beginAuthenticatedPushNotificationSession();
    let pendingDevicePushToken: Parameters<typeof session.refresh>[0];
    const refreshWhileActive = () => {
      if (AppState.currentState === 'active') {
        const devicePushToken = pendingDevicePushToken;
        pendingDevicePushToken = undefined;
        void session.refresh(devicePushToken).catch(() => {});
      }
    };
    refreshWhileActive();

    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshWhileActive();
    });
    const stopListening = listenForPushTokenRotation((devicePushToken) => {
      pendingDevicePushToken = devicePushToken;
      refreshWhileActive();
    });

    return () => {
      session.dispose();
      appStateSubscription.remove();
      stopListening();
    };
  }, [isAuthenticated, isLoading, user?.id]);

  return <>{children}</>;
}
