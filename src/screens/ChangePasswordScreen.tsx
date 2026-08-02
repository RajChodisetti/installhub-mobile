import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text } from 'react-native';
import { apiClient, cloudConnectionErrorMessage } from '../api/apiClient';
import { Button, Card, TextField } from '../components/ui';
import { useAuth, useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import {
  passwordChangeSessionNotice,
  sourceAppDisplayName,
} from '../utils/sourceManagedUsers';

export function ChangePasswordScreen() {
  const { user, logout } = useAuth();
  const { colors } = useTheme();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const sourceManaged = user?.source_managed === true;
  const sourceUnavailable = user?.source_state === 'orphaned';
  const sourceAppName = sourceAppDisplayName(user?.source_app);
  const sessionNotice = passwordChangeSessionNotice(
    user?.source_app,
    sourceManaged,
  );

  const submit = async () => {
    if (!user) {
      Alert.alert('Session required', 'Sign in before changing your password.');
      return;
    }
    if (sourceUnavailable) {
      Alert.alert(
        'Source account unavailable',
        'A password cannot be changed for this retained read-only Field App Complete record.',
      );
      return;
    }
    if (!currentPassword) {
      Alert.alert('Current password required', 'Enter your current password.');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Password too short', 'Use at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Re-enter your new password.');
      return;
    }

    setSaving(true);
    try {
      await apiClient.changeUserPassword(user.id, {
        currentPassword,
        newPassword,
      });
      await logout();
      Alert.alert(
        'Password changed',
        sourceManaged
          ? `Your shared ${sourceAppName} credential was updated. ${sessionNotice} Sign in again with the new password.`
          : `${sessionNotice} Sign in again with the new password.`,
      );
    } catch (error) {
      Alert.alert('Could not change password', cloudConnectionErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Card>
        <Text style={[typography.heading, { color: colors.foreground }]}>
          Change your password
        </Text>
        {sourceUnavailable ? (
          <Text style={[styles.explanation, { color: colors.mutedForeground }]}>
            The source account is unavailable. This retained Field App Complete
            record is read-only, so its password cannot be changed.
          </Text>
        ) : (
          <>
            <Text style={[styles.explanation, { color: colors.mutedForeground }]}>
              {sourceManaged
                ? `This password is shared with your ${sourceAppName} account. ${sessionNotice}`
                : `Confirm your current password. ${sessionNotice}`}
            </Text>
            <TextField
              label="Current password"
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              autoCapitalize="none"
              textContentType="password"
            />
            <TextField
              label="New password"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
              textContentType="newPassword"
            />
            <TextField
              label="Confirm new password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              textContentType="newPassword"
            />
            <Button
              title={saving ? 'Changing password…' : 'Change password'}
              disabled={saving}
              accessibilityState={{ busy: saving }}
              onPress={() => void submit()}
              style={{ marginTop: spacing.sm }}
            />
          </>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: 40 },
  explanation: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
});
