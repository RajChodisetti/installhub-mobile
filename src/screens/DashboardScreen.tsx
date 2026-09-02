import React, { useMemo, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInstallations } from '../hooks';
import { InstallationCard } from '../components/domain';
import { Button, Card, EmptyState, LoadingState, SearchBar, SectionHeader } from '../components/ui';
import { useAuth, useTheme } from '../context/AppProviders';
import { searchMatch } from '../utils';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { getLocalDeletionPreview, installationsRepo } from '../repositories';
import type { Installation } from '../types';
import {
  resumeAuditWorkForInstallation,
  suspendAuditWorkForInstallation,
} from '../services/auditWorkTrackingBridge';
import { captureAuditWorkResumeAuthority } from '../services/assignedWorkMutationGuard';
import { useSyncStatus } from '../services/SyncStatusContext';
import {
  dashboardJobGroupLabel,
  dashboardJobTiming,
  sortDashboardJobs,
} from '../domain/jobDashboard';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };

export function DashboardScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { items, loading, refresh } = useInstallations();
  const { triggerSync } = useSyncStatus();
  const [query, setQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const filtered = useMemo(
    () => sortDashboardJobs(
      items.filter((i) =>
        i.thumbnail_status !== 'pending' &&
        searchMatch(`${i.site_name} ${i.client_name} ${i.site_address} ${i.inspector_name}`, query),
      ),
    ),
    [items, query],
  );
  const jobCounts = useMemo(() => filtered.reduce(
    (counts, installation) => {
      counts[dashboardJobTiming(installation).group] += 1;
      return counts;
    },
    { scheduled: 0, unscheduled: 0, completed: 0 },
  ), [filtered]);

  const deleteInstallation = async (installation: Installation) => {
    if (deletingId) return;
    const actorUserId = user?.id;
    if (!actorUserId) {
      Alert.alert('Installation not deleted', 'Sign in again before deleting local work.');
      return;
    }
    let resumeAuthority: ReturnType<typeof captureAuditWorkResumeAuthority>;
    try {
      resumeAuthority = captureAuditWorkResumeAuthority(actorUserId);
    } catch (error) {
      Alert.alert(
        'Installation not deleted',
        error instanceof Error ? error.message : 'Your authenticated session changed.',
      );
      return;
    }
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
      const suspension = await suspendAuditWorkForInstallation(
        installation.id,
        resumeAuthority,
      );
      if (!suspension) {
        throw new Error('Your authenticated session changed before deletion started.');
      }
      try {
        await installationsRepo.remove(installation.id);
      } finally {
        await resumeAuditWorkForInstallation(suspension, resumeAuthority).catch(() => false);
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
      <Card style={{ marginBottom: spacing.md }} accessibilityRole="summary">
        <Text style={{ color: colors.foreground, fontWeight: '800' }}>My jobs</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 4, lineHeight: 20 }}>
          {jobCounts.scheduled} scheduled · {jobCounts.unscheduled} unscheduled · {jobCounts.completed} completed
        </Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 4, fontSize: 12, lineHeight: 18 }}>
          Scheduled work is ordered by the nearest scheduled start or deadline. Unscheduled work stays below it.
        </Text>
      </Card>
      <SearchBar value={query} onChangeText={setQuery} placeholder="Search sites or clients" />
      <Button
        title="Start New Site Installation"
        onPress={() => navigation.navigate('InstallationForm')}
        style={{ marginBottom: spacing.md }}
      />
      <Button
        title="Plan My Route"
        variant="secondary"
        onPress={() => navigation.navigate('DailyRoute')}
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
          renderItem={({ item, index }) => {
            const group = dashboardJobTiming(item).group;
            const previousGroup = index > 0
              ? dashboardJobTiming(filtered[index - 1]).group
              : undefined;
            return (
              <View>
                {group !== previousGroup ? (
                  <SectionHeader title={dashboardJobGroupLabel(group)} />
                ) : null}
                <InstallationCard
                  item={item}
                  onPress={() => navigation.navigate('InstallationDetail', { installationId: item.id })}
                  onDelete={() => { void deleteInstallation(item); }}
                  deleteDisabled={Boolean(deletingId)}
                />
              </View>
            );
          }}
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
