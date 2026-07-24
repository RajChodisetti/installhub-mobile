import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Badge, Button, Card, EmptyState, LoadingState, SearchBar } from '../components/ui';
import {
  importRemoteInstallationAsCopy,
  listRemoteInstallations,
  type RemoteInstallationSummary,
} from '../repositories';
import { apiClient, cloudConnectionErrorMessage } from '../api/apiClient';
import { useAuth, useTheme } from '../context/AppProviders';
import type { RootStackParamList } from '../navigation/types';
import { spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'RemoteInstallations'>;

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value || 'Unknown' : date.toLocaleString();
}

export function RemoteInstallationsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [items, setItems] = useState<RemoteInstallationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [importingId, setImportingId] = useState<string>();
  const [deletingId, setDeletingId] = useState<string>();
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listRemoteInstallations());
    } catch (error) {
      Alert.alert('Could not load Cloud Backup', cloudConnectionErrorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [
        item.siteName,
        item.clientName,
        item.siteAddress,
        item.status,
      ].some((value) => value.toLocaleLowerCase().includes(needle)),
    );
  }, [items, query]);

  const importCopy = async (item: RemoteInstallationSummary) => {
    setImportingId(item.id);
    try {
      await importRemoteInstallationAsCopy(item.id);
      Alert.alert(
        'Copy created',
        `An editable ${item.localCopyCount ? `cp${item.localCopyCount + 1}` : 'cp1'} copy was created. Original cloud data was not changed.`,
        [{ text: 'View Home', onPress: () => navigation.popToTop() }],
      );
    } catch (error) {
      Alert.alert('Import failed', cloudConnectionErrorMessage(error));
    } finally {
      setImportingId(undefined);
    }
  };

  const confirmImport = (item: RemoteInstallationSummary) => {
    Alert.alert(
      'Import an editable copy?',
      `${item.siteName} will be copied to this device as ${
        item.localCopyCount ? `cp${item.localCopyCount + 1}` : 'cp1'
      }. Existing local copies and the Cloud Backup will not be overwritten.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Import copy', onPress: () => void importCopy(item) },
      ],
    );
  };

  const deleteCloudBackup = async (item: RemoteInstallationSummary) => {
    setDeletingId(item.id);
    try {
      await apiClient.deleteInstallationCloud(item.id, true);
      setItems((current) => current.filter((candidate) => candidate.id !== item.id));
      Alert.alert('Cloud Backup deleted', `${item.siteName} was removed from the server.`);
    } catch (error) {
      Alert.alert('Delete failed', cloudConnectionErrorMessage(error));
    } finally {
      setDeletingId(undefined);
    }
  };

  const confirmDelete = (item: RemoteInstallationSummary) => {
    Alert.alert(
      'Permanently delete Cloud Backup?',
      `${item.siteName} and its server forms, unshared originals, generated reports, and version history will be deleted.\n\nExisting local cpN copies stay on their devices, but their server originals and API PDF source may no longer be available. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete From Cloud',
          style: 'destructive',
          onPress: () => void deleteCloudBackup(item),
        },
      ],
    );
  };

  if (loading && !items.length) return <LoadingState />;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.intro, { color: colors.mutedForeground }]}>
        Backups you own or that are assigned to you appear here. Import always
        creates the next local cpN copy; original images stay in Cloud Backup
        and only small previews are cached.
      </Text>
      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search site, client, address, or status"
      />
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: spacing.xxl }}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={load}
            tintColor={colors.primary}
          />
        }
        ListEmptyComponent={
          <EmptyState
            title={query ? 'No matching backups' : 'No accessible backups'}
            subtitle={
              query
                ? 'Try a different search.'
                : 'Backups you own or that are assigned to you will appear here.'
            }
          />
        }
        renderItem={({ item }) => {
          const canDelete =
            user?.role === 'admin' ||
            Boolean(user?.id && item.createdByUserId === user.id);
          const actionBusy = Boolean(importingId || deletingId);
          return (
          <Card style={styles.card}>
            <View style={styles.headingRow}>
              <Text style={[typography.subheading, { color: colors.foreground, flex: 1 }]}>
                {item.siteName}
              </Text>
              <Badge
                label={item.status}
                tone={item.status === 'Completed' ? 'success' : 'default'}
              />
            </View>
            <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs }}>
              {item.clientName}
            </Text>
            <Text style={{ color: colors.mutedForeground, marginTop: 2 }}>
              {item.siteAddress}
            </Text>
            <Text style={[styles.meta, { color: colors.mutedForeground }]}>
              Updated {formatUpdatedAt(item.updatedAt)} · Local copies{' '}
              {item.localCopyCount}
            </Text>
            {item.thumbnailTotal ? (
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                Cached previews {item.thumbnailReady}/{item.thumbnailTotal}
              </Text>
            ) : null}
            <Button
              title={importingId === item.id ? 'Preparing copy…' : 'Import next copy'}
              disabled={actionBusy}
              style={{ marginTop: spacing.md }}
              onPress={() => confirmImport(item)}
            />
            <Button
              title="Cloud files & history"
              variant="secondary"
              disabled={actionBusy}
              style={{ marginTop: spacing.sm }}
              onPress={() =>
                navigation.navigate('CloudStorage', {
                  installationId: item.id,
                  serverInstallationId: item.id,
                })
              }
            />
            {canDelete ? (
              <Button
                title={deletingId === item.id ? 'Deleting from Cloud…' : 'Delete From Cloud'}
                variant="danger"
                disabled={actionBusy}
                style={{ marginTop: spacing.sm }}
                onPress={() => confirmDelete(item)}
              />
            ) : null}
          </Card>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg },
  intro: { marginBottom: spacing.md, lineHeight: 20 },
  card: { marginBottom: spacing.sm },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  meta: { marginTop: spacing.sm, fontSize: 12 },
});
