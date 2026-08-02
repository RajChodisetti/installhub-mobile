import React, { useCallback, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  apiClient,
  cloudConnectionErrorMessage,
  type ManagedCloudUser,
} from '../api/apiClient';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingState,
} from '../components/ui';
import { useAuth, useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import {
  isOrphanedSourceUser,
  isSourceManagedUser,
  sourceAppDisplayName,
  sourceManagedBadgeLabel,
  sourceUserDisplayEmail,
} from '../utils/sourceManagedUsers';

type Props = {
  navigation: {
    navigate: (name: string, params?: Record<string, unknown>) => void;
  };
};

export function UserManagementScreen({ navigation }: Props) {
  const { user: currentUser } = useAuth();
  const { colors } = useTheme();
  const [users, setUsers] = useState<ManagedCloudUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string>();

  const load = useCallback(async () => {
    if (currentUser?.role !== 'admin') {
      setLoading(false);
      return;
    }
    setLoading(true);
    setErrorMessage(undefined);
    try {
      const response = await apiClient.listUsers();
      setUsers(response.data);
    } catch (error) {
      setErrorMessage(cloudConnectionErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [currentUser?.role]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  if (currentUser?.role !== 'admin') {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <EmptyState
          title="Administrator access required"
          subtitle="Only Field App Complete administrators can manage cloud user accounts."
        />
      </View>
    );
  }

  if (loading && users.length === 0) return <LoadingState />;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={users}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor={colors.primary}
          />
        }
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={[typography.body, { color: colors.mutedForeground }]}>
              Create accounts, assign roles, reset passwords, and control access
              to Field App Complete Cloud Backup. Accounts copied from Eco Audit
              or Solar Sense are read-only here. Active copied accounts remain
              available for installation assignment.
            </Text>
            <Button
              title="Add user"
              accessibilityHint="Opens the form to create a user managed in Field App Complete."
              onPress={() => navigation.navigate('UserEditor')}
              style={{ marginTop: spacing.md }}
            />
            {errorMessage ? (
              <Card style={{ marginTop: spacing.md }}>
                <Text style={{ color: colors.destructive }}>{errorMessage}</Text>
                <Button
                  title="Try again"
                  variant="secondary"
                  onPress={() => void load()}
                  style={{ marginTop: spacing.md }}
                />
              </Card>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          !errorMessage ? (
            <EmptyState
              title="No cloud users"
              subtitle="Add the first Field App Complete account."
            />
          ) : null
        }
        renderItem={({ item }) => {
          const isCurrentUser = item.id === currentUser.id;
          const sourceBadge = sourceManagedBadgeLabel(item);
          const displayEmail = sourceUserDisplayEmail(item.email);
          const displayName = item.fullName?.trim() || displayEmail;
          const sourceUnavailable = isOrphanedSourceUser(item);
          const sourceManaged = isSourceManagedUser(item);
          return (
            <Card style={styles.userCard}>
              <View style={styles.userHeading}>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.subheading, { color: colors.foreground }]}>
                    {displayName}
                  </Text>
                  <Text style={[typography.caption, { color: colors.mutedForeground }]}>
                    {displayEmail}
                  </Text>
                </View>
                <View style={styles.badges}>
                  <Badge
                    label={item.isActive ? 'Active' : 'Inactive'}
                    tone={item.isActive ? 'success' : 'danger'}
                  />
                  {sourceBadge ? <Badge label={sourceBadge} /> : null}
                </View>
              </View>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                Role: {item.role === 'admin' ? 'Administrator' : 'Inspector'}
                {isCurrentUser ? ' · You' : ''}
              </Text>
              {sourceManaged ? (
                <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                  {sourceUnavailable
                    ? `The ${sourceAppDisplayName(item.sourceApp)} source account is unavailable. This retained Field App Complete record is read-only.`
                    : `Profile, role, status, and administrator password resets are managed in ${sourceAppDisplayName(item.sourceApp)}.`}
                </Text>
              ) : null}
              <Button
                title={sourceManaged ? 'View user' : 'Edit user'}
                variant="secondary"
                accessibilityLabel={`${sourceManaged ? 'View' : 'Edit'} ${
                  displayName
                }`}
                onPress={() =>
                  navigation.navigate('UserEditor', {
                    userId: item.id,
                    sourceManaged,
                    sourceApp: item.sourceApp,
                    sourceState: item.sourceState,
                  })
                }
                style={{ marginTop: spacing.md }}
              />
            </Card>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1 },
  container: { flex: 1 },
  content: {
    padding: spacing.lg,
    paddingBottom: 40,
    flexGrow: 1,
  },
  header: { marginBottom: spacing.md },
  userCard: { marginBottom: spacing.sm },
  userHeading: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  badges: {
    maxWidth: '52%',
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  meta: { marginTop: spacing.sm },
});
