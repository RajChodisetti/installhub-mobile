import { prepareAssignedWorkConflictRecovery, confirmAssignedWorkConflictRecovery, type ConflictRecoveryReview } from '../services/assignedWorkConflictRecovery';
import React, { useMemo, useState } from 'react';
import { Alert, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useInstallations } from '../hooks';
import { InstallationCard } from '../components/domain';
import { Button, Card, EmptyState, LoadingState, SearchBar, SectionHeader } from '../components/ui';
import { useAuth, useTheme } from '../context/AppProviders';
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
  filterDashboardJobs,
  recentAssignedJobs,
  type DashboardStatusFilter,
} from '../domain/jobDashboard';

type Props = { navigation: NativeStackNavigationProp<RootStackParamList> };

export function DashboardScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const { items, countsByInstallation, loading, refresh } = useInstallations();
  const { triggerSync } = useSyncStatus();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<DashboardStatusFilter>('All');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [recoveringId, setRecoveringId] = useState<string | null>(null);
  const filtered = useMemo(
    () => filterDashboardJobs(items, query, status),
    [items, query, status],
  );
  const recent = useMemo(() => recentAssignedJobs(filtered), [filtered]);
  const recentIds = useMemo(() => new Set(recent.map((item) => item.id)), [recent]);
  const otherJobs = useMemo(
    () => filtered.filter((item) => !recentIds.has(item.id)),
    [filtered, recentIds],
  );
  const jobCounts = useMemo(() => filtered.reduce(
    (counts, installation) => {
      counts[dashboardJobTiming(installation).group] += 1;
      return counts;
    },
    { scheduled: 0, unscheduled: 0, completed: 0 },
  ), [filtered]);

  const recoverInstallation = async (installationId: string) => {
    if (recoveringId || deletingId) return;
    setRecoveringId(installationId);
    let review: ConflictRecoveryReview | undefined;
    try {
      review = await prepareAssignedWorkConflictRecovery(installationId);
      const confirmed = await new Promise<boolean>((resolve) => Alert.alert(
        'Preserve device copy and use server version?',
        `Device: ${review!.localLabel}\n${review!.localCounts}\n\nServer: ${review!.serverLabel} · revision ${review!.serverTreeRevision}\n${review!.serverCounts}\n\nYour full device capture and original evidence will remain in a separate local-only recovery copy in Settings. The working job will use the reviewed server version. This does not upload recovered work or overwrite the server.`,
        [{ text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Preserve and use server', onPress: () => resolve(true) }],
        { cancelable: true, onDismiss: () => resolve(false) },
      ));
      if (!confirmed) return;
      await confirmAssignedWorkConflictRecovery(review);
      await refresh();
      review.lease.assertCurrent();
      Alert.alert('Device copy preserved', 'The job now uses the reviewed server version. Inspect the separate recovery copy in Settings before transferring any unsent changes manually.');
    } catch (error) {
      if (review) { try { review.lease.assertCurrent(); } catch { return; } }
      Alert.alert('Recovery not completed', error instanceof Error ? error.message : 'The checkout was not replaced. Try again.');
    } finally { setRecoveringId(null); }
  };

  const deleteInstallation = async (installation: Installation) => {
    if (deletingId || recoveringId) return;
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

  const installationRow = (item: Installation, groupTitle?: string) => (
    <View key={item.id}>
      {groupTitle ? <SectionHeader title={groupTitle} /> : null}
      <InstallationCard
        item={item}
        counts={countsByInstallation[item.id]}
        onPress={() => { if (!recoveringId) navigation.navigate('InstallationDetail', { installationId: item.id }); }}
        onDelete={() => { void deleteInstallation(item); }}
        deleteDisabled={Boolean(deletingId || recoveringId)}
      />
      {item.assigned_work_refresh_conflict || item.backup_conflict?.kind === 'CONFLICT' ? (
        <Button title={recoveringId === item.id ? 'Reviewing recovery…' : 'Review sync conflict'}
          variant="secondary" disabled={Boolean(recoveringId || deletingId)}
          onPress={() => { void recoverInstallation(item.id); }} style={{ marginBottom: spacing.md }} />
      ) : null}
    </View>
  );

  const listHeader = (
    <View>
      <View style={styles.hero}>
        <Text style={[typography.title, { color: colors.foreground }]}>Field App Complete</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 2 }}>
          Site installations & Wattwatcher metering
        </Text>
      </View>
      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Search any part of a job name, reference, client, or address"
      />
      <View style={styles.statusFilters} accessibilityRole="radiogroup" accessibilityLabel="Filter installations by status">
        {(['All', 'Draft', 'Completed'] as const).map((value) => (
          <Button
            key={value}
            title={value}
            variant={status === value ? 'primary' : 'secondary'}
            accessibilityRole="radio"
            accessibilityState={{ selected: status === value }}
            style={{ flex: 1 }}
            onPress={() => setStatus(value)}
          />
        ))}
      </View>
      <Card style={styles.summaryCard} accessibilityRole="summary">
        <Text style={{ color: colors.foreground, fontWeight: '800' }}>Matching jobs</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 3, lineHeight: 19 }}>
          {filtered.length} jobs · {jobCounts.scheduled} scheduled · {jobCounts.unscheduled} unscheduled · {jobCounts.completed} completed
        </Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 3, fontSize: 12, lineHeight: 17 }}>
          {filtered.reduce((total, item) => total + (countsByInstallation[item.id]?.forms ?? 0), 0)} field forms · scheduled work appears first
        </Text>
      </Card>
      <View style={styles.primaryActions}>
        <Button
          title="New Installation"
          onPress={() => navigation.navigate('InstallationForm')}
          style={{ flex: 1 }}
        />
        <Button
          title="Plan Route"
          variant="secondary"
          onPress={() => navigation.navigate('DailyRoute')}
          style={{ flex: 1 }}
        />
      </View>
      <Button
        title="Download Existing Job / Site Copy"
        variant="ghost"
        onPress={() => navigation.navigate('RemoteInstallations')}
        style={{ marginBottom: spacing.sm }}
      />
      {recent.length ? (
        <View>
          <SectionHeader title="Recent jobs" />
          <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>Four most recently assigned jobs</Text>
          {recent.map((item) => installationRow(item))}
        </View>
      ) : null}
      {otherJobs.length ? <SectionHeader title="Other jobs" /> : null}
    </View>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        data={otherJobs}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={listHeader}
        refreshControl={(
          <RefreshControl
            refreshing={loading}
            onRefresh={() => { void triggerSync().finally(refresh); }}
            tintColor={colors.primary}
          />
        )}
        ListEmptyComponent={filtered.length
          ? null
          : loading && !items.length
          ? <LoadingState />
          : (
            <EmptyState
              title={items.length ? 'No installations match' : 'No installations'}
              subtitle={items.length ? 'Try partial words from the job title, reference, client, or address.' : 'Create a site installation to get started.'}
            />
          )}
        renderItem={({ item, index }) => {
          const group = dashboardJobTiming(item).group;
          const previousGroup = index > 0
            ? dashboardJobTiming(otherJobs[index - 1]).group
            : undefined;
          return installationRow(
            item,
            group !== previousGroup ? dashboardJobGroupLabel(group) : undefined,
          );
        }}
        ListFooterComponent={<View style={{ height: 24 }} />}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: 40 },
  hero: { marginBottom: spacing.md, marginTop: spacing.xs },
  statusFilters: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  summaryCard: { marginBottom: spacing.md, paddingVertical: spacing.md },
  primaryActions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  sectionHint: { fontSize: 12, marginBottom: spacing.sm, marginTop: -spacing.xs },
});
