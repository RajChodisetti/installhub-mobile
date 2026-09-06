import { FormScrollView } from '../components/ui';
import { loadInstallationAccessView } from '../domain/supportCloudReads';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  Alert,
  Pressable,
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
import { useAuth, useTheme } from '../context/AppProviders';
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
type AccessView = {
  key: string;
  principal: unknown;
  installationId: string;
  active: boolean;
  reading: number;
  saving: boolean;
};
type AccessSnapshot = {
  view: AccessView;
  access: InstallationAccess;
  users: ManagedCloudUser[];
  lease: AuthenticatedCloudActionLease;
};

function userLabel(user: Pick<ManagedCloudUser, 'email' | 'fullName'>): string {
  return user.fullName?.trim() || sourceUserDisplayEmail(user.email);
}

export function InstallationAccessScreen({ route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.role === 'admin';
  const key = JSON.stringify([installationId, currentUser?.id ?? null, currentUser?.role ?? null]);
  const currentKey = useRef(key);
  currentKey.current = key;
  const principal = useRef(currentUser);
  principal.current = currentUser;
  const viewRef = useRef<AccessView | null>(null);
  const [snapshot, setSnapshot] = useState<AccessSnapshot>();
  const [selection, setSelection] = useState<{ view: AccessView; userId: string | null }>();
  const [activity, setActivity] = useState<{ view: AccessView; loading: boolean; saving: boolean; error?: string }>();

  const isCurrent = (view: AccessView | null): view is AccessView => Boolean(view && view.active
    && viewRef.current === view && currentKey.current === view.key && principal.current === view.principal);
  const bind = (view: AccessView, lease: AuthenticatedCloudActionLease): AuthenticatedCloudActionLease => ({
    ...lease,
    assertCurrent() {
      if (!isCurrent(view)) throw new Error('The access screen changed. Return to the current installation and retry.');
      lease.assertCurrent();
      if (lease.actorUserId !== currentUser?.id) throw new Error('The signed-in account changed. Retry from the current account.');
    },
  });
  const validateAccess = (value: InstallationAccess, expectedId: string) => {
    if (!value || value.installationId !== expectedId) throw new Error('Access was returned for a different installation. Retry this installation.');
    if (value.assignedInspector && value.assignedInspector.id !== value.assignedInspectorUserId) {
      throw new Error('The returned assignment does not match its user. Retry this installation.');
    }
  };
  const loadFor = useCallback(async (view: AccessView) => {
    if (!isCurrent(view) || view.saving) return;
    const ticket = ++view.reading;
    setActivity({ view, loading: true, saving: false });
    try {
      const lease = bind(view, await captureAuthenticatedCloudActionLease());
      const result = await runLeasedCloudActionStep(lease, () => loadInstallationAccessView(view.installationId, currentUser?.role, {
        getInstallationAccess: (id) => runLeasedCloudActionStep(lease, () => apiClient.getInstallationAccess(id, lease.cloudAuthority)),
        listUsers: () => runLeasedCloudActionStep(lease, () => apiClient.listUsers(lease.cloudAuthority)),
      }));
      validateAccess(result.access, view.installationId);
      if (!isCurrent(view) || ticket !== view.reading) return;
      setSnapshot({ view, ...result, lease });
      setSelection({ view, userId: result.access.assignedInspectorUserId });
    } catch (error) {
      if (isCurrent(view) && ticket === view.reading) {
        setActivity({ view, loading: false, saving: false, error: cloudConnectionErrorMessage(error) });
      }
    } finally {
      if (isCurrent(view) && ticket === view.reading) setActivity((value) => value?.view === view ? { ...value, loading: false } : value);
    }
  }, [key, currentUser]);

  useFocusEffect(useCallback(() => {
    const view: AccessView = { key, principal: currentUser, installationId, active: true, reading: 0, saving: false };
    viewRef.current = view;
    if (currentUser) void loadFor(view);
    else setActivity({ view, loading: false, saving: false, error: 'Sign in to view installation access.' });
    return () => { view.active = false; view.reading += 1; };
  }, [key, currentUser, installationId, loadFor]));

  // Render and callbacks remain bound to this focus/record/account, including
  // a same-account credential replacement that leaves the route mounted.
  const view = viewRef.current;
  let visibleSnapshot: AccessSnapshot | undefined;
  if (snapshot && isCurrent(snapshot.view)) {
    try { snapshot.lease.assertCurrent(); visibleSnapshot = snapshot; } catch { /* Old authority cannot display or assign access. */ }
  }
  const currentActivity = isCurrent(view) && activity?.view === view ? activity : undefined;
  const loading = currentActivity?.loading ?? true;
  const saving = currentActivity?.saving ?? false;
  const loadError = currentActivity?.error ?? (!loading && !visibleSnapshot ? 'Installation access is unavailable. Retry with the current session.' : undefined);
  const access = visibleSnapshot?.access;
  const users = visibleSnapshot?.users ?? [];
  const selectedUserId = selection?.view === view ? selection.userId : access?.assignedInspectorUserId ?? null;
  const load = () => isCurrent(view) ? loadFor(view) : Promise.resolve();

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

  if (loading) return <LoadingState />;

  const currentAssignment = access?.assignedInspector;
  const currentAssignmentUser = users.find(
    (user) => user.id === currentAssignment?.id,
  ) ?? currentAssignment;
  const unchanged = selectedUserId === (access?.assignedInspectorUserId ?? null);

  const save = async () => {
    if (!isAdmin || !isCurrent(view) || view.saving || loading || loadError || !visibleSnapshot || unchanged) return;
    try { visibleSnapshot.lease.assertCurrent(); } catch { return; }
    const requestedInstallationId = view.installationId;
    const requestedAssignedInspectorUserId = selectedUserId;
    let actionLease: AuthenticatedCloudActionLease | null = null;
    view.saving = true;
    view.reading += 1;
    setActivity({ view, loading: false, saving: true });
    try {
      actionLease = bind(view, await captureAuthenticatedCloudActionLease());
      const updated = await runLeasedCloudActionStep(
        actionLease,
        () => apiClient.setInstallationAccess(
          requestedInstallationId,
          requestedAssignedInspectorUserId,
          actionLease!.cloudAuthority,
        ),
      );
      validateAccess(updated, requestedInstallationId);
      if (updated.assignedInspectorUserId !== requestedAssignedInspectorUserId) throw new Error('The returned assignment differs from the requested user. Reload access before retrying.');
      applyLeasedCloudActionState(actionLease, () => {
        setSnapshot({ ...visibleSnapshot, access: updated, lease: actionLease! });
        setSelection({ view, userId: updated.assignedInspectorUserId });
        Alert.alert(
          'Access updated',
          updated.assignedInspector
            ? `${userLabel(updated.assignedInspector)} can now see and import this cloud backup.`
            : 'This cloud backup is no longer assigned to another user.',
        );
      });
    } catch (error) {
      let canReport = isCurrent(view);
      if (actionLease) {
        try {
          actionLease.assertCurrent();
        } catch {
          canReport = false;
        }
      }
      if (canReport) {
        setActivity({ view, loading: false, saving: true, error: cloudConnectionErrorMessage(error) });
        Alert.alert('Could not update access', cloudConnectionErrorMessage(error));
      }
    } finally {
      view.saving = false;
      if (isCurrent(view)) setActivity((value) => value?.view === view ? { ...value, saving: false } : value);
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
        onPress={() => {
          if (isCurrent(view) && !view.saving && visibleSnapshot) {
            try { visibleSnapshot.lease.assertCurrent(); setSelection({ view, userId: id }); } catch { /* Stale option is inert. */ }
          }
        }}
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
    <FormScrollView
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

          {isAdmin ? <>
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
          </> : <Text style={{ color: colors.mutedForeground, marginTop: spacing.md }}>Only administrators can change the assigned inspector.</Text>}
        </>
      )}
    </FormScrollView>
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
