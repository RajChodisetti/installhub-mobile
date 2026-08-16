import React, { useMemo, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInstallations } from '../hooks';
import { InstallationCard } from '../components/domain';
import { Button, EmptyState, LoadingState, SearchBar } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { searchMatch } from '../utils';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { getLocalDeletionPreview, installationsRepo } from '../repositories';
import type { Installation } from '../types';
import {
  resumeAuditWorkForInstallation,
  suspendAuditWorkForInstallation,
} from '../services/auditWorkTrackingBridge';
import { useSyncStatus } from '../services/SyncStatusContext';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };

export function DashboardScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { items, loading, refresh } = useInstallations();
  const { triggerSync } = useSyncStatus();
  const [query, setQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const filtered = useMemo(
    () =>
      items.filter((i) =>
        i.thumbnail_status !== 'pending' &&
        searchMatch(`${i.site_name} ${i.client_name} ${i.site_address} ${i.inspector_name}`, query),
      ),
    [items, query],
  );

  const deleteInstallation = async (installation: Installation) => {
    if (deletingId) return;
    setDeletingId(installation.id);
    try {
      const preview = await getLocalDeletionPreview({ kind: 'installation', id: installation.id });
      if (!preview) throw new Error('Installation not found.');
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          `Delete ${installation.site_name}?`,
          [
            'This removes the installation from this device.',
            `${preview.deletes.zones} zone(s), ${preview.deletes.boards} board(s), ${preview.deletes.siteAssets} site asset(s), ${preview.deletes.meters} meter(s), and ${preview.deletes.forms} field form(s) will be deleted locally.`,
            'Any existing Cloud Backup is retained and is not deleted.',
          ].join('\n\n'),
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Delete from device', style: 'destructive', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      if (!confirmed) return;
      await suspendAuditWorkForInstallation(installation.id).catch(() => {});
      try {
        await installationsRepo.remove(installation.id);
      } finally {
        await resumeAuditWorkForInstallation(installation.id).catch(() => {});
      }
      await refresh();
    } catch (error) {
      Alert.alert(
        'Installation not deleted',
        error instanceof Error ? error.message : 'The local installation could not be deleted.',
      );
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.hero}>
        <Text style={[typography.title, { color: colors.foreground }]}>
          Field App Complete
        </Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
          Site installations & Wattwatcher metering
        </Text>
      </View>
      <SearchBar value={query} onChangeText={setQuery} placeholder="Search sites or clients" />
      <Button
        title="Start New Site Installation"
        onPress={() => navigation.navigate('InstallationForm')}
        style={{ marginBottom: spacing.md }}
      />
      <Button
        title="Browse Cloud Backups"
        variant="ghost"
        onPress={() => navigation.navigate('RemoteInstallations')}
        style={{ marginBottom: spacing.md }}
      />
      {loading && !items.length ? (
        <LoadingState />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          refreshControl={(
            <RefreshControl
              refreshing={loading}
              onRefresh={() => { void triggerSync().finally(refresh); }}
              tintColor={colors.primary}
            />
          )}
          ListEmptyComponent={
            <EmptyState title="No installations" subtitle="Create a site installation to get started." />
          }
          renderItem={({ item }) => (
            <InstallationCard
              item={item}
              onPress={() => navigation.navigate('InstallationDetail', { installationId: item.id })}
              onDelete={() => { void deleteInstallation(item); }}
              deleteDisabled={Boolean(deletingId)}
            />
          )}
          ListFooterComponent={<View style={{ height: 24 }} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg },
  hero: { marginBottom: spacing.lg, marginTop: spacing.sm },
});
