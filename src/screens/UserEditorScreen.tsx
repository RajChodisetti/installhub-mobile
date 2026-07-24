import React, { useEffect, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  apiClient,
  cloudConnectionErrorMessage,
  type ManagedCloudUser,
} from '../api/apiClient';
import { Badge, Button, Card, LoadingState, TextField } from '../components/ui';
import { useAuth, useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';

type Props = {
  navigation: {
    goBack: () => void;
    navigate: (name: string, params?: Record<string, unknown>) => void;
    setOptions: (options: { title: string }) => void;
  };
  route: { params?: { userId?: string } };
};

export function UserEditorScreen({ navigation, route }: Props) {
  const userId = route.params?.userId;
  const isEditing = Boolean(userId);
  const { user: currentUser } = useAuth();
  const { colors } = useTheme();
  const [loadedUser, setLoadedUser] = useState<ManagedCloudUser>();
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<ManagedCloudUser['role']>('inspector');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [confirmResetPassword, setConfirmResetPassword] = useState('');
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [changingAccess, setChangingAccess] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);

  useEffect(() => {
    navigation.setOptions({ title: isEditing ? 'Edit user' : 'Add user' });
  }, [isEditing, navigation]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true);
    void apiClient.getUser(userId)
      .then((result) => {
        if (!active) return;
        setLoadedUser(result);
        setEmail(result.email);
        setFullName(result.fullName ?? '');
        setRole(result.role);
      })
      .catch((error) => {
        if (!active) return;
        Alert.alert('Could not load user', cloudConnectionErrorMessage(error), [
          { text: 'Close', onPress: navigation.goBack },
        ]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [navigation, userId]);

  const validateProfile = (): string | null => {
    if (!email.trim() || !email.includes('@')) return 'Enter a valid email address.';
    if (!isEditing && password.length < 6) {
      return 'The temporary password must be at least 6 characters.';
    }
    if (!isEditing && password !== confirmPassword) {
      return 'The temporary passwords do not match.';
    }
    return null;
  };

  const save = async () => {
    const validationError = validateProfile();
    if (validationError) {
      Alert.alert('Check user details', validationError);
      return;
    }
    setSaving(true);
    try {
      if (userId) {
        const updated = await apiClient.updateUser(userId, {
          email: email.trim().toLowerCase(),
          fullName: fullName.trim() || null,
          role,
        });
        setLoadedUser(updated);
        Alert.alert('User updated', 'The account details have been saved.');
      } else {
        await apiClient.createUser({
          email: email.trim().toLowerCase(),
          fullName: fullName.trim(),
          role,
          password,
        });
        Alert.alert('User created', 'The new account can now sign in.', [
          { text: 'Done', onPress: navigation.goBack },
        ]);
      }
    } catch (error) {
      Alert.alert('Could not save user', cloudConnectionErrorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const setAccountActive = async (isActive: boolean) => {
    if (!userId || !loadedUser) return;
    setChangingAccess(true);
    try {
      if (isActive) {
        setLoadedUser(await apiClient.updateUser(userId, { isActive: true }));
      } else {
        await apiClient.deactivateUser(userId);
        setLoadedUser({ ...loadedUser, isActive: false });
      }
      Alert.alert(
        isActive ? 'Access restored' : 'Access removed',
        isActive
          ? 'The user can sign in again.'
          : 'The user has been signed out and can no longer access InstallHub.',
      );
    } catch (error) {
      Alert.alert('Could not change access', cloudConnectionErrorMessage(error));
    } finally {
      setChangingAccess(false);
    }
  };

  const confirmAccessChange = () => {
    if (!loadedUser) return;
    const nextActive = !loadedUser.isActive;
    if (nextActive) {
      void setAccountActive(true);
      return;
    }
    Alert.alert(
      'Deactivate this user?',
      'Their InstallHub refresh sessions will be revoked. Existing backed-up data is retained.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Deactivate',
          style: 'destructive',
          onPress: () => void setAccountActive(false),
        },
      ],
    );
  };

  const resetAnotherUserPassword = async () => {
    if (!userId) return;
    if (resetPassword.length < 6) {
      Alert.alert('Password too short', 'Use at least 6 characters.');
      return;
    }
    if (resetPassword !== confirmResetPassword) {
      Alert.alert('Passwords do not match', 'Re-enter the new temporary password.');
      return;
    }
    setResettingPassword(true);
    try {
      await apiClient.changeUserPassword(userId, { newPassword: resetPassword });
      setResetPassword('');
      setConfirmResetPassword('');
      Alert.alert(
        'Password reset',
        'Existing refresh sessions were revoked. Give the temporary password to the user securely.',
      );
    } catch (error) {
      Alert.alert('Could not reset password', cloudConnectionErrorMessage(error));
    } finally {
      setResettingPassword(false);
    }
  };

  if (loading) return <LoadingState />;

  const isCurrentUser = Boolean(userId && userId === currentUser?.id);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      {loadedUser ? (
        <View style={styles.statusRow}>
          <Text style={[typography.body, { color: colors.mutedForeground }]}>
            Account status
          </Text>
          <Badge
            label={loadedUser.isActive ? 'Active' : 'Inactive'}
            tone={loadedUser.isActive ? 'success' : 'danger'}
          />
        </View>
      ) : null}

      <Card>
        <Text style={[typography.heading, { color: colors.foreground }]}>
          Account details
        </Text>
        <TextField
          label="Full name"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
          textContentType="name"
          style={{ marginTop: spacing.md }}
        />
        <TextField
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
        />
        <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
          ROLE
        </Text>
        <View style={styles.roleButtons}>
          <Button
            title="Inspector"
            variant={role === 'inspector' ? 'primary' : 'secondary'}
            onPress={() => setRole('inspector')}
            style={{ flex: 1 }}
          />
          <Button
            title="Administrator"
            variant={role === 'admin' ? 'primary' : 'secondary'}
            onPress={() => setRole('admin')}
            style={{ flex: 1 }}
          />
        </View>

        {!isEditing ? (
          <View style={{ marginTop: spacing.lg }}>
            <TextField
              label="Temporary password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              textContentType="newPassword"
            />
            <TextField
              label="Confirm temporary password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
              textContentType="newPassword"
            />
          </View>
        ) : null}

        <Button
          title={saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create user'}
          disabled={saving || changingAccess || resettingPassword}
          onPress={() => void save()}
          style={{ marginTop: spacing.lg }}
        />
      </Card>

      {userId && loadedUser ? (
        <Card style={{ marginTop: spacing.md }}>
          <Text style={[typography.heading, { color: colors.foreground }]}>
            Password
          </Text>
          {isCurrentUser ? (
            <>
              <Text style={[styles.explanation, { color: colors.mutedForeground }]}>
                Changing your own password requires your current password.
              </Text>
              <Button
                title="Change my password"
                variant="secondary"
                onPress={() => navigation.navigate('ChangePassword')}
              />
            </>
          ) : (
            <>
              <Text style={[styles.explanation, { color: colors.mutedForeground }]}>
                Resetting another user signs out their refresh sessions.
              </Text>
              <TextField
                label="New temporary password"
                value={resetPassword}
                onChangeText={setResetPassword}
                secureTextEntry
                autoCapitalize="none"
                textContentType="newPassword"
              />
              <TextField
                label="Confirm temporary password"
                value={confirmResetPassword}
                onChangeText={setConfirmResetPassword}
                secureTextEntry
                autoCapitalize="none"
                textContentType="newPassword"
              />
              <Button
                title={resettingPassword ? 'Resetting…' : 'Reset password'}
                variant="secondary"
                disabled={saving || changingAccess || resettingPassword}
                onPress={() => void resetAnotherUserPassword()}
              />
            </>
          )}
        </Card>
      ) : null}

      {userId && loadedUser && !isCurrentUser ? (
        <Card style={{ marginTop: spacing.md }}>
          <Text style={[typography.heading, { color: colors.foreground }]}>
            Access
          </Text>
          <Text style={[styles.explanation, { color: colors.mutedForeground }]}>
            {loadedUser.isActive
              ? 'Deactivation blocks sign-in without deleting backed-up installations.'
              : 'Reactivation lets this account sign in again.'}
          </Text>
          <Button
            title={
              changingAccess
                ? 'Updating…'
                : loadedUser.isActive
                  ? 'Deactivate user'
                  : 'Reactivate user'
            }
            variant={loadedUser.isActive ? 'danger' : 'secondary'}
            disabled={saving || changingAccess || resettingPassword}
            onPress={confirmAccessChange}
          />
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: 40 },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  fieldLabel: {
    ...typography.label,
    marginBottom: spacing.sm,
  },
  roleButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  explanation: {
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
});
