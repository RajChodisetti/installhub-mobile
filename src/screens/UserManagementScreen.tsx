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
          subtitle="Only InstallHub administrators can manage cloud user accounts."
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
              to InstallHub Cloud Backup.
            </Text>
            <Button
              title="Add user"
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
              subtitle="Add the first InstallHub account."
            />
          ) : null
        }
        renderItem={({ item }) => {
          const isCurrentUser = item.id === currentUser.id;
          return (
            <Card style={styles.userCard}>
              <View style={styles.userHeading}>
                <View style={{ flex: 1 }}>
                  <Text style={[typography.subheading, { color: colors.foreground }]}>
                    {item.fullName || item.email}
                  </Text>
                  <Text style={[typography.caption, { color: colors.mutedForeground }]}>
                    {item.email}
                  </Text>
                </View>
                <Badge
                  label={item.isActive ? 'Active' : 'Inactive'}
                  tone={item.isActive ? 'success' : 'danger'}
                />
              </View>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                Role: {item.role === 'admin' ? 'Administrator' : 'Inspector'}
                {isCurrentUser ? ' · You' : ''}
              </Text>
              <Button
                title="Edit user"
                variant="secondary"
                onPress={() => navigation.navigate('UserEditor', { userId: item.id })}
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
  meta: { marginTop: spacing.sm },
});
