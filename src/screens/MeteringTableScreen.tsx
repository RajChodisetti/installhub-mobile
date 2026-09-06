import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInstallation } from '../hooks';
import { canonicalInstallationRepo } from '../repositories';
import type { AllAssetMeteringRow, MeteringInventorySummary } from '../domain/installationV2';
import type { ReadinessIssue } from '../types';
import { RecordLoadState } from '../components/RecordLoadState';
import { meterRegistryIssues, meterRegistryMatches, meteringCoverageMatches, meteringTargetDetail, type MeteringCoverageFilter } from '../domain/meteringTable';
import { Badge, Button, Card, EmptyState, LoadingState, SearchBar } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'MeteringTable'>;

type TableSnapshot = { installationId: string; rows: AllAssetMeteringRow[]; inventory: MeteringInventorySummary; diagnostics: ReadinessIssue[] };
type CoverageFilter = MeteringCoverageFilter;

export function MeteringTableScreen({ navigation, route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const {
    item,
    boards,
    gridSupplies,
    siteAssets,
    meterDevices,
    measurementAssignments,
    readiness,
    loading,
    error,
    refresh,
  } = useInstallation(installationId);
  const [snapshot, setSnapshot] = useState<TableSnapshot | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  const [tableLoading, setTableLoading] = useState(false);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [search, setSearch] = useState('');
  const [meterSearch, setMeterSearch] = useState('');
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>('ALL');
  const currentSnapshot = snapshot?.installationId === installationId ? snapshot : null;
  const rows = currentSnapshot?.rows ?? [];
  const inventory = currentSnapshot?.inventory;

  useEffect(() => {
    if (!item || item.id !== installationId) return;
    let active = true;
    setTableLoading(true);
    setTableError(null);
    void Promise.all([
      canonicalInstallationRepo.allAssetMetering(installationId),
      canonicalInstallationRepo.meteringInventory(installationId),
      canonicalInstallationRepo.validationIssues(installationId),
    ]).then(([nextRows, nextInventory, diagnostics]) => {
      if (active) setSnapshot({ installationId, rows: nextRows, inventory: nextInventory, diagnostics });
    }).catch((caught) => {
      if (active) setTableError(caught instanceof Error ? caught.message : 'The metering table could not be loaded.');
    }).finally(() => {
      if (active) setTableLoading(false);
    });
    return () => { active = false; };
  }, [installationId, item?.id, item?.tree_revision, retryGeneration]);

  const query = search.trim().toLocaleLowerCase();
  const visible = useMemo(() => rows
    .filter((row) => meteringCoverageMatches(row, coverageFilter))
    .filter((row) => !query || `${row.displayCode} ${row.name} ${row.typeLabel} ${row.supplyLabel} ${row.state} ${row.channelLabels.join(' ')}`
      .toLocaleLowerCase().includes(query)), [coverageFilter, query, rows]);
  const coverageCount = (state: AllAssetMeteringRow['state']) => rows.filter((row) => row.state === state).length;

  const visibleMeters = meterDevices.filter((meter) => meterRegistryMatches(meter, meterSearch));
  const retry = () => {
    setRetryGeneration((current) => current + 1);
    void refresh().catch(() => undefined);
  };
  if (loading && (!item || item.id !== installationId)) return <LoadingState />;
  if (!item || item.id !== installationId) return <RecordLoadState title="Installation unavailable"
    message={error ?? 'This installation is no longer available.'} onRetry={retry} onBack={() => navigation.goBack()} />;
  if (!currentSnapshot) {
    if (tableError || error) return <RecordLoadState title="Metering table unavailable" message={tableError ?? error!}
      onRetry={retry} onBack={() => navigation.goBack()} />;
    return <LoadingState />;
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.pad}
      data={visible}
      keyExtractor={(row) => row.id}
      ListHeaderComponent={(
        <View>
          {error || tableError ? <RecordLoadState inline title="Could not refresh metering table"
            message={error ?? tableError!} onRetry={retry} onBack={() => navigation.goBack()} /> : null}
          <Button title={tableLoading ? 'Refreshing…' : 'Refresh table'} variant="secondary" disabled={tableLoading}
            onPress={retry} style={{ marginBottom: spacing.md }} />
          <Text style={[typography.title, { color: colors.foreground }]}>All-asset metering</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
            {item.site_name} · {rows.length} assets · {meterDevices.length} physical meters
          </Text>
          <Card
            accessibilityRole="summary"
            style={{ marginTop: spacing.md, marginBottom: spacing.sm }}
          >
            <Text style={{ color: colors.foreground, fontWeight: '700' }}>Confirmed unmetered is valid</Text>
            <Text style={{ color: colors.mutedForeground, marginTop: 6, lineHeight: 20 }}>
              {inventory?.assets.confirmedUnmetered ?? 0} asset{inventory?.assets.confirmedUnmetered === 1 ? '' : 's'} have no direct device/channel connection. They remain in the full register. Only explicit TBC relationships block completion; invalid mappings and unassigned active channels are optional follow-up and stay outside confirmed topology.
            </Text>
          </Card>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search asset coverage, supply, or channel…" />
          <View style={styles.filters} accessibilityRole="radiogroup" accessibilityLabel="Filter asset metering status">
            {([
              ['ALL', `All ${rows.length}`],
              ['CONFIRMED_UNMETERED', `Confirmed unmetered ${coverageCount('UNMETERED') + coverageCount('VIRTUAL')}`],
              ['DIRECT', `Direct ${coverageCount('DIRECT')}`],
              ['VIRTUAL', `Virtual ${coverageCount('VIRTUAL')}`],
              ['UNMETERED', `Unmetered ${coverageCount('UNMETERED')}`],
              ['TBC', `TBC ${coverageCount('TBC')}`],
              ['MAPPING_ISSUE', `Issues ${coverageCount('MAPPING_ISSUE')}`],
            ] as Array<[CoverageFilter, string]>).map(([value, label]) => (
              <Button
                key={value}
                title={label}
                variant={coverageFilter === value ? 'primary' : 'secondary'}
                accessibilityRole="radio"
                accessibilityState={{ selected: coverageFilter === value }}
                onPress={() => setCoverageFilter(value)}
              />
            ))}
          </View>
          <Text style={[typography.subheading, { color: colors.foreground, marginBottom: spacing.sm }]}>Meter registry</Text>
          <SearchBar value={meterSearch} onChangeText={setMeterSearch} placeholder="Search device, serial, or model…" />
          {visibleMeters.map((meter) => {
            const board = boards.find((candidate) => candidate.id === meter.installedOnBoardId);
            const assignments = measurementAssignments.filter((assignment) => assignment.meterId === meter.id);
            const assignedChannelIds = new Set(assignments.flatMap((assignment) => assignment.channelIds));
            const activeChannels = meter.channels.filter((channel) => channel.purpose !== 'SPARE');
            const unassignedActive = activeChannels.filter((channel) => !assignedChannelIds.has(channel.id)).length;
            const spareChannels = meter.channels.filter((channel) => channel.purpose === 'SPARE').length;
            const allSpare = meter.channels.length > 0 && spareChannels === meter.channels.length;
            const blockers = meterRegistryIssues(meter, assignments, readiness?.issues ?? []);
            const diagnostics = meterRegistryIssues(meter, assignments, currentSnapshot.diagnostics)
              .filter((issue) => issue.code !== 'CHANNEL_UNASSIGNED' && !blockers.some((blocker) =>
                blocker.code === issue.code && blocker.entityId === issue.entityId && blocker.field === issue.field));
            const needsAttention = blockers.length > 0 || diagnostics.length > 0 || meter.channels.length === 0;
            return (
              <Card key={meter.id} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                  <Text style={[typography.subheading, { color: colors.foreground, flex: 1 }]}>{meter.displayName.value}</Text>
                  <Badge
                    label={needsAttention
                      ? `${Math.max(blockers.length + diagnostics.length, 1)} issue${Math.max(blockers.length + diagnostics.length, 1) === 1 ? '' : 's'}`
                      : unassignedActive
                      ? `${unassignedActive} unassigned`
                      : allSpare
                        ? 'All spare'
                        : 'Mapped'}
                    tone={blockers.length ? 'danger' : needsAttention ? 'tbc' : unassignedActive ? 'tbc' : allSpare ? 'default' : 'success'}
                  />
                </View>
                <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
                  {meter.deviceModel} · {meter.serialNumber || 'no serial'} · installed on {board?.display_code ?? 'missing board'}
                </Text>
                <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
                  {assignments.length} assignment{assignments.length === 1 ? '' : 's'} · {activeChannels.length} active · {spareChannels} spare
                </Text>
                {needsAttention ? (
                  <Text style={{ color: colors.destructive, fontWeight: '700', marginTop: 6 }}>
                    {blockers.length ? 'Explicit TBC targets must be confirmed before completion.' : 'Configuration needs review. These diagnostics alone do not block completion.'}
                  </Text>
                ) : unassignedActive ? (
                  <Text style={{ color: colors.destructive, fontWeight: '700', marginTop: 6 }}>
                    Unassigned active channels are optional follow-up and stay outside confirmed topology.
                  </Text>
                ) : allSpare ? (
                  <Text style={{ color: colors.mutedForeground, marginTop: 6 }}>
                    No active measurements. Every channel is explicitly marked Spare / unused.
                  </Text>
                ) : null}
                {[...blockers, ...diagnostics].map((issue, index) => <Text key={`${issue.code}:${issue.entityId}:${index}`}
                  style={{ color: colors.mutedForeground, marginTop: 4 }}>{issue.message}</Text>)}
                {board ? <View style={styles.filters}>
                  <Button title="Open device" variant="secondary" onPress={() => navigation.navigate('MeterForm', { installationId, boardId: board.id, meterId: meter.id })} />
                  <Button title="Channels and assignments" variant="ghost" onPress={() => navigation.navigate('MeterForm', { installationId, boardId: board.id, meterId: meter.id })} />
                </View> : <Text style={{ color: colors.mutedForeground }}>The installed board is missing.</Text>}
                {meter.channels.map((channel) => {
                  const channelAssignments = assignments.filter((assignment) => assignment.channelIds.includes(channel.id));
                  return <View key={channel.id} style={{ borderTopWidth: 1, borderColor: colors.border, paddingVertical: spacing.sm }}>
                    <Text style={{ color: colors.foreground, fontWeight: '700' }}>Channel {channel.ordinal} {channel.phaseLabel ?? ''}</Text>
                    <Text selectable style={{ color: colors.mutedForeground }}>{channel.id}</Text>
                    {channel.description ? <Text style={{ color: colors.foreground }}>{channel.description}</Text> : null}
                    <Text style={{ color: colors.mutedForeground }}>{channel.purpose.replaceAll('_', ' ')} · {channel.customLoadTypeName || channel.loadTypeCode || 'No load recorded'} · {channel.sensorRating || 'No sensor recorded'}</Text>
                    {channelAssignments.map((assignment) => {
                      const target = meteringTargetDetail(assignment.target, installationId, boards, siteAssets, gridSupplies);
                      return <View key={assignment.id} style={{ marginTop: spacing.sm }}>
                        <Text style={{ color: colors.foreground, fontWeight: '700' }}>{target.label}</Text>
                        <Text style={{ color: colors.mutedForeground }}>{assignment.phaseMode.replaceAll('_', ' ')} · {assignment.direction} · {assignment.status}</Text>
                        <Text selectable style={{ color: colors.mutedForeground }}>{assignment.target.kind}{target.id ? ` · ${target.id}` : ''}</Text>
                        {target.destination ? <Button title="Open assignment target" variant="ghost" onPress={() => {
                          const destination = target.destination;
                          if (destination?.kind === 'BOARD') navigation.navigate('BoardDetail', { installationId, boardId: destination.id, zoneId: destination.zoneId });
                          else if (destination?.kind === 'SITE_ASSET') navigation.navigate('SiteAssetDetail', { installationId, assetId: destination.id, zoneId: destination.zoneId });
                          else if (destination?.kind === 'GRID_BOUNDARY') navigation.navigate('InstallationDetail', { installationId });
                        }} /> : null}
                      </View>;
                    })}
                    {!channelAssignments.length ? <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm }}>{channel.purpose === 'SPARE' ? 'Spare / unused — no target required' : 'Unassigned active channel — optional follow-up'}</Text> : null}
                  </View>;
                })}
              </Card>
            );
          })}
          {meterDevices.length > 0 && !visibleMeters.length ? <EmptyState title="No matching meter devices" subtitle="Try another device name, serial, or model." /> : null}
          {!meterDevices.length ? <EmptyState title="No meter devices" subtitle="Confirmed unmetered assets can still be recorded; that metering state alone does not block completion." /> : null}
          <Text style={[typography.subheading, { color: colors.foreground, marginTop: spacing.md, marginBottom: spacing.sm }]}>Asset coverage</Text>
        </View>
      )}
      renderItem={({ item: row }) => (
        <Card style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.subheading, { color: colors.foreground }]}>{row.displayCode} · {row.name}</Text>
              <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>{row.typeLabel} · Fed from {row.supplyLabel}</Text>
            </View>
            <Badge
              label={row.state === 'UNMETERED'
                ? 'CONFIRMED UNMETERED'
                : row.state === 'MAPPING_ISSUE'
                  ? 'MAPPING ISSUE'
                  : row.virtualPreview
                    ? `${row.state} · preview`
                    : row.state}
              tone={row.state === 'DIRECT' ? 'success' : row.state === 'MAPPING_ISSUE' ? 'danger' : row.state === 'TBC' ? 'tbc' : 'default'}
            />
          </View>
          <Text style={{ color: colors.mutedForeground, marginTop: 6 }}>
            {row.channelLabels.length
              ? row.channelLabels.join(', ')
              : row.state === 'UNMETERED'
                ? 'No direct device/channel connection — this metering state alone is non-blocking.'
                : row.state === 'VIRTUAL'
                  ? 'No direct connection — confirmed unmetered with shared residual boundary coverage.'
                  : row.state === 'TBC'
                    ? 'Metering is not confirmed — blocks completion.'
                    : 'Declared metering and exact assignments disagree — optional follow-up, excluded from confirmed topology.'}
          </Text>
          {siteAssets.find((asset) => asset.id === row.id) ? (
            <Button
              title="Open asset"
              variant="ghost"
              style={{ marginTop: spacing.sm }}
              onPress={() => {
                const asset = siteAssets.find((candidate) => candidate.id === row.id);
                if (asset) navigation.navigate('SiteAssetDetail', {
                  assetId: asset.id,
                  installationId,
                  zoneId: asset.zone_id,
                });
              }}
            />
          ) : null}
        </Card>
      )}
      ListEmptyComponent={<EmptyState title="No matching assets" />}
    />
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
});
