import React from 'react';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text } from 'react-native';
import { useAuth, useTheme } from '../context/AppProviders';
import { LoadingState } from '../components/ui';
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

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

function MainTabs() {
  const { colors } = useTheme();
  return (
    <Tabs.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.card },
        headerTintColor: colors.foreground,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
      }}
    >
      <Tabs.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 16 }}>⌂</Text>,
        }}
      />
      <Tabs.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 16 }}>⚙</Text>,
        }}
      />
    </Tabs.Navigator>
  );
}

export function RootNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const { colors, resolvedMode } = useTheme();

  if (isLoading) {
    return <LoadingState />;
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
    <NavigationContainer theme={navTheme}>
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
            <Stack.Screen name="ZoneWorkspace" component={ZoneWorkspaceScreen} options={{ title: 'Zone' }} />
            <Stack.Screen name="BoardDetail" component={BoardDetailScreen} options={{ title: 'Board' }} />
            <Stack.Screen name="SiteAssetDetail" component={SiteAssetDetailScreen} options={{ title: 'Asset' }} />
            <Stack.Screen name="MeterForm" component={MeterFormScreen} options={{ title: 'Wattwatcher' }} />
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
            <Stack.Screen name="InstallationAccess" component={InstallationAccessScreen} options={{ title: 'Cloud Access' }} />
            <Stack.Screen name="CloudStorage" component={CloudStorageScreen} options={{ title: 'Cloud Files & History' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
