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
import {
  isOrphanedSourceUser,
  isSourceManagedUser,
  passwordChangeSessionNotice,
  sourceAppDisplayName,
  sourceUserDisplayEmail,
} from '../utils/sourceManagedUsers';

type Props = {
  navigation: {
    goBack: () => void;
    navigate: (name: string, params?: Record<string, unknown>) => void;
    setOptions: (options: { title: string }) => void;
  };
  route: {
    params?: {
      userId?: string;
      sourceManaged?: boolean;
      sourceApp?: ManagedCloudUser['sourceApp'];
      sourceState?: ManagedCloudUser['sourceState'];
    };
  };
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
    navigation.setOptions({
      title: !isEditing
        ? 'Add user'
        : isSourceManagedUser(loadedUser)
          ? 'User details'
          : 'Edit user',
    });
  }, [isEditing, loadedUser, navigation]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setLoading(true);
    void apiClient.getUser(userId)
      .then((result) => {
        if (!active) return;
        const sourceState =
          result.sourceState ?? route.params?.sourceState;
        const resultWithSource = {
          ...result,
          sourceManaged:
            result.sourceManaged === true ||
            route.params?.sourceManaged === true ||
            sourceState === 'linked' ||
            sourceState === 'orphaned',
          sourceApp: result.sourceApp ?? route.params?.sourceApp ?? null,
          sourceState,
        };
        setLoadedUser(resultWithSource);
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
  }, [
    navigation,
    route.params?.sourceApp,
    route.params?.sourceManaged,
    route.params?.sourceState,
    userId,
  ]);

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
    if (userId && isSourceManagedUser(loadedUser)) {
      Alert.alert(
        'Managed in the source app',
        `Update this account in ${sourceAppDisplayName(loadedUser?.sourceApp)}.`,
      );
      return;
    }
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
    if (!userId || !loadedUser || isSourceManagedUser(loadedUser)) return;
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
          : 'The user has been signed out and can no longer access Field App Complete.',
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
      'Their Field App Complete refresh sessions will be revoked. Existing backed-up data is retained.',
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
    if (!userId || isSourceManagedUser(loadedUser)) return;
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
        'Field App Complete refresh sessions were revoked. Already-issued access tokens may remain valid for up to 15 minutes. Give the temporary password to the user securely.',
      );
    } catch (error) {
      Alert.alert('Could not reset password', cloudConnectionErrorMessage(error));
    } finally {
      setResettingPassword(false);
    }
  };

  if (loading) return <LoadingState />;

  const isCurrentUser = Boolean(userId && userId === currentUser?.id);
  const sourceManaged = isSourceManagedUser(loadedUser);
  const sourceUnavailable = isOrphanedSourceUser(loadedUser);
  const sourceAppName = sourceAppDisplayName(loadedUser?.sourceApp);
  const displayEmail = sourceUserDisplayEmail(loadedUser?.email ?? email);
  const sessionNotice = passwordChangeSessionNotice(
    loadedUser?.sourceApp,
    sourceManaged,
  );

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

      {sourceManaged ? (
        <Card style={{ marginBottom: spacing.md }}>
          <View style={styles.badgeRow}>
            <Badge label={`Copied from ${sourceAppName}`} />
            {sourceUnavailable ? <Badge label="Source unavailable" /> : null}
            <Badge label="Read only here" />
          </View>
          <Text
            style={[
              styles.explanation,
              { color: colors.mutedForeground, marginBottom: 0 },
            ]}
          >
            {sourceUnavailable
              ? `The ${sourceAppName} source account is unavailable. This retained Field App Complete record stays read-only for audit history; no future source synchronization is expected.`
              : `Profile, role, account status, and administrator password resets are managed in ${sourceAppName}. Changes made there are copied to Field App Complete. When active, this user remains available for installation assignment.`}
          </Text>
        </Card>
      ) : null}

      <Card>
        <View style={styles.headingRow}>
          <Text style={[typography.heading, { color: colors.foreground }]}>
            Account details
          </Text>
          {sourceManaged ? <Badge label="Read only" /> : null}
        </View>

        {sourceManaged && loadedUser ? (
          <View style={{ marginTop: spacing.md }}>
            <View
              style={[
                styles.readOnlyRow,
                {
                  borderBottomColor: colors.border,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
              ]}
            >
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                FULL NAME
              </Text>
              <Text style={[typography.body, { color: colors.foreground }]}>
                {loadedUser.fullName || 'Not provided'}
              </Text>
            </View>
            <View
              style={[
                styles.readOnlyRow,
                {
                  borderBottomColor: colors.border,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
              ]}
            >
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                EMAIL
              </Text>
              <Text style={[typography.body, { color: colors.foreground }]}>
                {displayEmail}
              </Text>
            </View>
            <View style={styles.readOnlyRow}>
              <Text style={[styles.fieldLabel, { color: colors.mutedForeground }]}>
                ROLE
              </Text>
              <Text style={[typography.body, { color: colors.foreground }]}>
                {loadedUser.role === 'admin' ? 'Administrator' : 'Inspector'}
              </Text>
            </View>
          </View>
        ) : (
          <>
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
            <View accessibilityRole="radiogroup" accessibilityLabel="User role" style={styles.roleButtons}>
              <Button
                title="Inspector"
                variant={role === 'inspector' ? 'primary' : 'secondary'}
                accessibilityRole="radio"
                accessibilityState={{ checked: role === 'inspector' }}
                onPress={() => setRole('inspector')}
                style={{ flex: 1 }}
              />
              <Button
                title="Administrator"
                variant={role === 'admin' ? 'primary' : 'secondary'}
                accessibilityRole="radio"
                accessibilityState={{ checked: role === 'admin' }}
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
              accessibilityState={{ busy: saving }}
              onPress={() => void save()}
              style={{ marginTop: spacing.lg }}
            />
          </>
        )}
      </Card>

      {userId && loadedUser ? (
        <Card style={{ marginTop: spacing.md }}>
          <Text style={[typography.heading, { color: colors.foreground }]}>
            Password
          </Text>
          {isCurrentUser && sourceUnavailable ? (
            <Text style={[styles.explanation, { color: colors.mutedForeground }]}>
              The source account is unavailable, so no password change is
              available for this retained read-only record.
            </Text>
          ) : isCurrentUser ? (
            <>
              <Text style={[styles.explanation, { color: colors.mutedForeground }]}>
                {sourceManaged
                  ? `This password is shared with your ${sourceAppName} account. ${sessionNotice}`
                  : `Changing your own password requires your current password. ${sessionNotice}`}
              </Text>
              <Button
                title="Change my password"
                variant="secondary"
                accessibilityHint={
                  sourceManaged
                    ? `Updates the shared ${sourceAppName} credential.`
                    : 'Opens the current-password confirmation form.'
                }
                onPress={() => navigation.navigate('ChangePassword')}
              />
            </>
          ) : sourceManaged ? (
            <Text style={[styles.explanation, { color: colors.mutedForeground }]}>
              {sourceUnavailable
                ? 'The source account is unavailable, so administrator password reset is not offered for this retained read-only record.'
                : `Administrator password resets for this copied account are managed in ${sourceAppName}.`}
            </Text>
          ) : (
            <>
              <Text style={[styles.explanation, { color: colors.mutedForeground }]}>
                Resetting another user revokes their Field App Complete refresh
                sessions. Already-issued access tokens may remain valid for up
                to 15 minutes.
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
                accessibilityState={{ busy: resettingPassword }}
                onPress={() => void resetAnotherUserPassword()}
              />
            </>
          )}
        </Card>
      ) : null}

      {userId && loadedUser && !isCurrentUser && !sourceManaged ? (
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
            accessibilityState={{ busy: changingAccess }}
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
  headingRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  readOnlyRow: {
    minHeight: 56,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
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
