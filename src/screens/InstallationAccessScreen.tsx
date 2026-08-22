import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  apiClient,
  cloudConnectionErrorMessage,
  type InstallationAccess,
  type ManagedCloudUser,
} from '../api/apiClient';
import { Button, Card, LoadingState, SectionHeader } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import type { RootStackParamList } from '../navigation/types';
import {
  captureAuthenticatedCloudActionLease,
  type AuthenticatedCloudActionLease,
} from '../services/authenticatedCloudAction';
import {
  applyLeasedCloudActionState,
  runLeasedCloudActionStep,
} from '../services/cloudActionLease';
import { radii, spacing, typography } from '../theme';
import {
  isOrphanedSourceUser,
  isSourceManagedUser,
  sourceAppDisplayName,
  sourceUserDisplayEmail,
} from '../utils/sourceManagedUsers';

type Props = NativeStackScreenProps<RootStackParamList, 'InstallationAccess'>;

function userLabel(user: Pick<ManagedCloudUser, 'email' | 'fullName'>): string {
  return user.fullName?.trim() || sourceUserDisplayEmail(user.email);
}

export function InstallationAccessScreen({ route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const [access, setAccess] = useState<InstallationAccess | null>(null);
  const [users, setUsers] = useState<ManagedCloudUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(undefined);
    try {
      const [nextAccess, usersResponse] = await Promise.all([
        apiClient.getInstallationAccess(installationId),
        apiClient.listUsers(),
      ]);
      setAccess(nextAccess);
      setSelectedUserId(nextAccess.assignedInspectorUserId);
      setUsers(usersResponse.data);
    } catch (error) {
      const message = cloudConnectionErrorMessage(error);
      setLoadError(message);
      Alert.alert('Could not load access', message);
    } finally {
      setLoading(false);
    }
  }, [installationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeUsers = useMemo(
    () =>
      users
        .filter((user) => user.isActive)
        .sort((left, right) =>
          userLabel(left).localeCompare(userLabel(right), undefined, {
            sensitivity: 'base',
          }),
        ),
    [users],
  );

  if (loading && !access) return <LoadingState />;

  const currentAssignment = access?.assignedInspector;
  const currentAssignmentUser = users.find(
    (user) => user.id === currentAssignment?.id,
  ) ?? currentAssignment;
  const unchanged = selectedUserId === (access?.assignedInspectorUserId ?? null);

  const save = async () => {
    const actionLeasePromise = captureAuthenticatedCloudActionLease();
    const requestedAssignedInspectorUserId = selectedUserId;
    let actionLease: AuthenticatedCloudActionLease | null = null;
    setSaving(true);
    try {
      actionLease = await actionLeasePromise;
      const updated = await runLeasedCloudActionStep(
        actionLease,
        () => apiClient.setInstallationAccess(
          installationId,
          requestedAssignedInspectorUserId,
          actionLease!.cloudAuthority,
        ),
      );
      applyLeasedCloudActionState(actionLease, () => {
        setAccess(updated);
        setSelectedUserId(updated.assignedInspectorUserId);
        Alert.alert(
          'Access updated',
          updated.assignedInspector
            ? `${userLabel(updated.assignedInspector)} can now see and import this cloud backup.`
            : 'This cloud backup is no longer assigned to another user.',
        );
      });
    } catch (error) {
      let canReport = true;
      if (actionLease) {
        try {
          actionLease.assertCurrent();
        } catch {
          canReport = false;
        }
      }
      if (canReport) {
        Alert.alert('Could not update access', cloudConnectionErrorMessage(error));
      }
    } finally {
      setSaving(false);
    }
  };

  const option = (
    id: string | null,
    title: string,
    subtitle: string,
  ) => {
    const selected = selectedUserId === id;
    return (
      <Pressable
        key={id ?? 'unassigned'}
        accessibilityRole="radio"
        accessibilityLabel={`${title}. ${subtitle}`}
        accessibilityState={{ checked: selected, disabled: saving }}
        disabled={saving}
        onPress={() => setSelectedUserId(id)}
        style={({ pressed }) => [
          styles.option,
          {
            borderColor: selected ? colors.primary : colors.border,
            backgroundColor: selected ? colors.muted : colors.card,
            opacity: pressed ? 0.84 : saving ? 0.6 : 1,
          },
        ]}
      >
        <View
          style={[
            styles.radio,
            { borderColor: selected ? colors.primary : colors.mutedForeground },
          ]}
        >
          {selected ? (
            <View style={[styles.radioDot, { backgroundColor: colors.primary }]} />
          ) : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[typography.subheading, { color: colors.foreground }]}>
            {title}
          </Text>
          <Text
            style={[
              typography.caption,
              { color: colors.mutedForeground, marginTop: spacing.xs },
            ]}
          >
            {subtitle}
          </Text>
        </View>
      </Pressable>
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
    >
      <Text style={[typography.title, { color: colors.foreground }]}>
        Installation access
      </Text>
      <Card style={{ marginTop: spacing.lg }}>
        <Text style={[typography.body, { color: colors.foreground, lineHeight: 22 }]}>
          Assigning this installation lets that user see the cloud backup and import
          an editable copy. Importing never overwrites their existing local data.
        </Text>
      </Card>

      {loadError ? (
        <Card style={{ marginTop: spacing.md }}>
          <Text style={{ color: colors.destructive, marginBottom: spacing.md }}>
            {loadError}
          </Text>
          <Button title="Try again" variant="secondary" onPress={() => void load()} />
        </Card>
      ) : (
        <>
          <SectionHeader title="Current assignment" />
          <Card>
            <Text style={[typography.subheading, { color: colors.foreground }]}>
              {currentAssignment ? userLabel(currentAssignment) : 'Unassigned'}
            </Text>
            <Text
              style={[
                typography.caption,
                { color: colors.mutedForeground, marginTop: spacing.xs },
              ]}
            >
              {currentAssignment
                ? `${sourceUserDisplayEmail(currentAssignment.email)} · ${currentAssignment.role}${
                    currentAssignment.isActive ? '' : ' · inactive'
                  }${
                    isOrphanedSourceUser(currentAssignmentUser)
                      ? ' · source unavailable'
                      : isSourceManagedUser(currentAssignmentUser)
                        ? ` · ${sourceAppDisplayName(currentAssignmentUser?.sourceApp)} managed`
                      : ''
                  }`
                : 'Only the owner and administrators currently have access.'}
            </Text>
          </Card>

          <SectionHeader title="Assign to" />
          <View accessibilityRole="radiogroup" accessibilityLabel="Assigned inspector">
            {option(
              null,
              'Unassigned',
              'Remove the assigned-user access while keeping owner and administrator access.',
            )}
            {activeUsers.map((user) =>
              option(
                user.id,
                userLabel(user),
                `${sourceUserDisplayEmail(user.email)} · ${user.role}${
                  isOrphanedSourceUser(user)
                    ? ' · source unavailable'
                    : isSourceManagedUser(user)
                      ? ` · ${sourceAppDisplayName(user.sourceApp)} managed`
                    : ''
                }`,
              ),
            )}
          </View>

          <Button
            title={saving ? 'Saving…' : 'Save access'}
            disabled={saving || unchanged}
            style={{ marginTop: spacing.md }}
            onPress={() => void save()}
          />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  option: {
    minHeight: 68,
    borderWidth: 1,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
});
