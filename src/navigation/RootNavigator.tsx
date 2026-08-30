import React, { useCallback, useEffect, useRef } from 'react';
import {
  NavigationContainer,
  DarkTheme,
  DefaultTheme,
  StackActions,
  useNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Alert, Text, useWindowDimensions, View } from 'react-native';
import { useAuth, useTheme } from '../context/AppProviders';
import { Button, Card, LoadingState } from '../components/ui';
import { CollapsibleTabBar } from '../components/navigation/CollapsibleTabBar';
import { usesSidebarNavigation } from '../domain/mainNavigation';
import type { MainTabParamList, RootStackParamList } from './types';
import { LoginScreen } from '../screens/LoginScreen';
import { DashboardScreen } from '../screens/DashboardScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { InstallationFormScreen } from '../screens/InstallationFormScreen';
import { InstallationDetailScreen } from '../screens/InstallationDetailScreen';
import { ZoneWorkspaceScreen } from '../screens/ZoneWorkspaceScreen';
import { BoardDetailScreen } from '../screens/BoardDetailScreen';
import { SiteAssetDetailScreen } from '../screens/SiteAssetDetailScreen';
import { MeterFormScreen } from '../screens/MeterFormScreen';
import { DataViewScreen } from '../screens/DataViewScreen';
import { MeteringTableScreen } from '../screens/MeteringTableScreen';
import { InstallationReportScreen } from '../screens/InstallationReportScreen';
import { ClientReportScreen } from '../screens/ClientReportScreen';
import { PhotoPreviewScreen } from '../screens/PhotoPreviewScreen';
import { FormsListScreen } from '../screens/FormsListScreen';
import { FormTypePickerScreen } from '../screens/FormTypePickerScreen';
import { FormEditorScreen } from '../screens/FormEditorScreen';
import { RemoteInstallationsScreen } from '../screens/RemoteInstallationsScreen';
import { UserManagementScreen } from '../screens/UserManagementScreen';
import { UserEditorScreen } from '../screens/UserEditorScreen';
import { ChangePasswordScreen } from '../screens/ChangePasswordScreen';
import { DiagnosticsScreen } from '../screens/DiagnosticsScreen';
import { InstallationAccessScreen } from '../screens/InstallationAccessScreen';
import { CloudStorageScreen } from '../screens/CloudStorageScreen';
import { DeviceSearchScreen } from '../screens/DeviceSearchScreen';
import { InventoryScreen } from '../screens/InventoryScreen';
import { DailyRouteScreen } from '../screens/DailyRouteScreen';
import { useAuditWorkTracking } from '../services/AuditWorkTrackingContext';
import { getStore, subscribeStore } from '../data/seed';
import { focusedAuditInstallationId } from '../services/auditWorkTrackingPolicy';
import { assignedWorkRouteMustReturnToDetail } from '../services/assignedWorkMutationGuard';
import type { Installation } from '../types';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

function MainTabs() {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isSidebar = usesSidebarNavigation(width);
  return (
    <Tabs.Navigator
      tabBar={(props) => <CollapsibleTabBar {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.foreground,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarPosition: isSidebar ? 'left' : 'bottom',
        tabBarVariant: isSidebar ? 'material' : 'uikit',
      }}
    >
      <Tabs.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: 'Home',
          tabBarAccessibilityLabel: 'Home tab',
        }}
      />
      <Tabs.Screen
        name="Inventory"
        component={InventoryScreen}
        options={{
          title: 'Inventory',
          tabBarAccessibilityLabel: 'Inventory tab',
        }}
      />
      <Tabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          title: 'Settings',
          tabBarAccessibilityLabel: 'Settings tab',
        }}
      />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const {
    isAuthenticated,
    isLoading,
    storageIssue,
    retryStorage,
    restoreStorage,
    user,
  } = useAuth();
  const { colors, resolvedMode } = useTheme();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();
  const { setFocusedRoute } = useAuditWorkTracking();
  const redirectingRouteKey = useRef<string | null>(null);

  const enforceAssignedWorkRoute = useCallback(() => {
    if (!isAuthenticated || !navigationRef.isReady()) {
      redirectingRouteKey.current = null;
      return;
    }
    const route = navigationRef.getCurrentRoute();
    const installationId = focusedAuditInstallationId(route);
    if (!route || !installationId) {
      redirectingRouteKey.current = null;
      return;
    }
    let installation: Installation | undefined;
    try {
      installation = getStore().installations.find(
        (item) => item.id === installationId,
      );
    } catch {
      return;
    }
    if (
      !installation
      || !assignedWorkRouteMustReturnToDetail(
        installation,
        user?.id,
        route.name,
        installationId,
      )
    ) {
      redirectingRouteKey.current = null;
      return;
    }
    const redirectKey = `${route.key}:${installationId}`;
    if (redirectingRouteKey.current === redirectKey) return;
    redirectingRouteKey.current = redirectKey;
    navigationRef.dispatch(StackActions.popTo('InstallationDetail', {
      installationId,
    }));
  }, [isAuthenticated, navigationRef, user?.id]);

  const handleFocusedRouteChange = useCallback(() => {
    setFocusedRoute(navigationRef.getCurrentRoute());
    enforceAssignedWorkRoute();
  }, [enforceAssignedWorkRoute, navigationRef, setFocusedRoute]);

  useEffect(() => {
    enforceAssignedWorkRoute();
    return subscribeStore(enforceAssignedWorkRoute);
  }, [enforceAssignedWorkRoute]);

  if (isLoading) {
    return <LoadingState />;
  }

  if (storageIssue) {
    return (
      <View
        accessibilityRole="alert"
        style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.background }}
      >
        <Card>
          <Text style={{ color: colors.foreground, fontSize: 22, fontWeight: '800' }}>
            Local data needs attention
          </Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 10, lineHeight: 21 }}>
            {storageIssue.message}
          </Text>
          <Text style={{ color: colors.foreground, marginTop: 12, fontWeight: '700' }}>
            Your saved installation data was preserved. It was not replaced with demo data.
          </Text>
          {storageIssue.canRestore ? (
            <Button
              title="Restore encrypted recovery copy"
              accessibilityHint="Validates and restores the encrypted pre-migration copy stored on this device"
              style={{ marginTop: 18 }}
              onPress={() => { void restoreStorage(); }}
            />
          ) : null}
          <Button
            title="Retry local storage"
            variant="secondary"
            accessibilityHint="Retries loading the existing local data without replacing it"
            style={{ marginTop: 10 }}
            onPress={() => { void retryStorage(); }}
          />
          <Button
            title="Preserve local data"
            variant="ghost"
            accessibilityHint="Makes no changes and explains how to keep the existing data for support"
            style={{ marginTop: 10 }}
            onPress={() => Alert.alert(
              'Local data preserved',
              'No local records or recovery data were changed. You can close the app and contact support before retrying.',
            )}
          />
          <Text style={{ color: colors.mutedForeground, marginTop: 12, fontSize: 12 }}>
            Reference: {storageIssue.code}
          </Text>
        </Card>
      </View>
    );
  }

  const navTheme = {
    ...(resolvedMode === 'dark' ? DarkTheme : DefaultTheme),
    colors: {
      ...(resolvedMode === 'dark' ? DarkTheme.colors : DefaultTheme.colors),
      primary: colors.primary,
      background: colors.background,
      card: colors.card,
      text: colors.foreground,
      border: colors.border,
      notification: colors.accent,
    },
  };

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navTheme}
      onReady={handleFocusedRouteChange}
      onStateChange={handleFocusedRouteChange}
    >
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTintColor: colors.foreground,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        {!isAuthenticated ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
            <Stack.Screen name="InstallationForm" component={InstallationFormScreen} options={{ title: 'Installation' }} />
            <Stack.Screen name="InstallationDetail" component={InstallationDetailScreen} options={{ title: 'Site' }} />
            <Stack.Screen name="DeviceSearch" component={DeviceSearchScreen} options={{ title: 'Device Search' }} />
            <Stack.Screen name="ZoneWorkspace" component={ZoneWorkspaceScreen} options={{ title: 'Zone' }} />
            <Stack.Screen name="BoardDetail" component={BoardDetailScreen} options={{ title: 'Board' }} />
            <Stack.Screen name="SiteAssetDetail" component={SiteAssetDetailScreen} options={{ title: 'Asset' }} />
            <Stack.Screen name="MeterForm" component={MeterFormScreen} options={{ title: 'Meter' }} />
            <Stack.Screen name="DataView" component={DataViewScreen} options={{ title: 'Data View' }} />
            <Stack.Screen name="MeteringTable" component={MeteringTableScreen} options={{ title: 'Metering' }} />
            <Stack.Screen name="InstallationReport" component={InstallationReportScreen} options={{ title: 'Report' }} />
            <Stack.Screen name="ClientReport" component={ClientReportScreen} options={{ title: 'Client Report' }} />
            <Stack.Screen name="PhotoPreview" component={PhotoPreviewScreen} options={{ title: 'Photos' }} />
            <Stack.Screen name="FormsList" component={FormsListScreen} options={{ title: 'Field Forms' }} />
            <Stack.Screen name="FormTypePicker" component={FormTypePickerScreen} options={{ title: 'New Form' }} />
            <Stack.Screen name="FormEditor" component={FormEditorScreen} options={{ title: 'Field Form' }} />
            <Stack.Screen name="RemoteInstallations" component={RemoteInstallationsScreen} options={{ title: 'Cloud Backups' }} />
            <Stack.Screen name="UserManagement" component={UserManagementScreen} options={{ title: 'User Management' }} />
            <Stack.Screen name="UserEditor" component={UserEditorScreen} options={{ title: 'User' }} />
            <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ title: 'Change Password' }} />
            <Stack.Screen name="Diagnostics" component={DiagnosticsScreen} options={{ title: 'Diagnostics' }} />
            <Stack.Screen name="DailyRoute" component={DailyRouteScreen} options={{ title: 'Daily Route' }} />
            <Stack.Screen name="InstallationAccess" component={InstallationAccessScreen} options={{ title: 'Cloud Access' }} />
            <Stack.Screen name="CloudStorage" component={CloudStorageScreen} options={{ title: 'Cloud Files & History' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
