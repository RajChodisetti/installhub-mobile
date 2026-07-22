import React from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useAuth, useTheme } from '../context/AppProviders';
import { Button, Card, SectionHeader } from '../components/ui';
import { resetDemoData } from '../repositories';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'MainTabs'> | any;

export function SettingsScreen({}: Props) {
  const { user, logout } = useAuth();
  const { colors, mode, toggleTheme } = useTheme();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.title, { color: colors.foreground }]}>Settings</Text>
      <Card style={{ marginTop: spacing.lg }}>
        <SectionHeader title="Profile" />
        <Text style={{ color: colors.foreground, fontWeight: '600' }}>{user?.full_name}</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>{user?.email}</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>Role: {user?.role}</Text>
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <SectionHeader title="Appearance" />
        <Text style={{ color: colors.mutedForeground, marginBottom: 12 }}>Current: {mode}</Text>
        <Button title={mode === 'light' ? 'Switch to dark' : 'Switch to light'} variant="secondary" onPress={toggleTheme} />
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <SectionHeader title="Demo data" />
        <Button
          title="Reset fixture data"
          variant="secondary"
          onPress={() => {
            Alert.alert('Reset data?', 'This restores seeded installations.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Reset',
                style: 'destructive',
                onPress: () => {
                  void resetDemoData().then(() => {
                    Alert.alert('Done', 'Demo fixtures restored.');
                  });
                },
              },
            ]);
          }}
        />
      </Card>

      <View style={{ marginTop: spacing.xl }}>
        <Button title="Log out" variant="danger" onPress={() => void logout()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 40 },
});
