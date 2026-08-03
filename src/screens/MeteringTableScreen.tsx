import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInstallation } from '../hooks';
import { canonicalInstallationRepo } from '../repositories';
import type { AllAssetMeteringRow, MeteringInventorySummary } from '../domain/installationV2';
import { Badge, Button, Card, EmptyState, LoadingState, SearchBar } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'MeteringTable'>;

type CoverageFilter = 'ALL' | AllAssetMeteringRow['state'];

export function MeteringTableScreen({ navigation, route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const {
    item,
    boards,
    siteAssets,
    meterDevices,
    measurementAssignments,
    readiness,
    loading,
  } = useInstallation(installationId);
  const [rows, setRows] = useState<AllAssetMeteringRow[]>([]);
  const [inventory, setInventory] = useState<MeteringInventorySummary | null>(null);
  const [search, setSearch] = useState('');
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>('ALL');

  useEffect(() => {
    if (!item) return;
    void Promise.all([
      canonicalInstallationRepo.allAssetMetering(installationId),
      canonicalInstallationRepo.meteringInventory(installationId),
    ]).then(([nextRows, nextInventory]) => {
      setRows(nextRows);
      setInventory(nextInventory);
    });
  }, [installationId, item?.tree_revision]);

  const query = search.trim().toLocaleLowerCase();
  const visible = useMemo(() => rows
    .filter((row) => coverageFilter === 'ALL' || row.state === coverageFilter)
    .filter((row) => !query || `${row.displayCode} ${row.name} ${row.typeLabel} ${row.supplyLabel} ${row.state} ${row.channelLabels.join(' ')}`
      .toLocaleLowerCase().includes(query)), [coverageFilter, query, rows]);
  const coverageCount = (state: AllAssetMeteringRow['state']) => rows.filter((row) => row.state === state).length;

  if (loading || !item) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.pad}
      data={visible}
      keyExtractor={(row) => row.id}
      ListHeaderComponent={(
        <View>
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
              {inventory?.assets.confirmedUnmetered ?? 0} asset{inventory?.assets.confirmedUnmetered === 1 ? '' : 's'} have no direct device/channel connection. They remain in the full register, and that metering state alone does not block completion. TBC, mapping issues, and active unassigned channels stay separate.
            </Text>
          </Card>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search assets, supply, meter, or channel…" />
          <View style={styles.filters} accessibilityRole="radiogroup" accessibilityLabel="Filter asset metering status">
            {([
              ['ALL', `All ${rows.length}`],
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
          {meterDevices.map((meter) => {
            const board = boards.find((candidate) => candidate.id === meter.installedOnBoardId);
            const assignments = measurementAssignments.filter((assignment) => assignment.meterId === meter.id);
            const assignedChannelIds = new Set(assignments.flatMap((assignment) => assignment.channelIds));
            const activeChannels = meter.channels.filter((channel) => channel.purpose !== 'SPARE');
            const unassignedActive = activeChannels.filter((channel) => !assignedChannelIds.has(channel.id)).length;
            const spareChannels = meter.channels.filter((channel) => channel.purpose === 'SPARE').length;
            const allSpare = meter.channels.length > 0 && spareChannels === meter.channels.length;
            const assignmentIds = new Set(assignments.map((assignment) => assignment.id));
            const channelIds = new Set(meter.channels.map((channel) => channel.id));
            const blockingIssues = readiness?.issues.filter((issue) => issue.severity === 'ERROR' && (
              (issue.entityType === 'meter' && issue.entityId === meter.id)
              || (issue.entityType === 'channel' && channelIds.has(issue.entityId))
              || (issue.entityType === 'measurement_assignment' && assignmentIds.has(issue.entityId))
            )) ?? [];
            const nonUnassignedIssues = blockingIssues.filter((issue) => issue.code !== 'CHANNEL_UNASSIGNED');
            const needsAttention = nonUnassignedIssues.length > 0 || meter.channels.length === 0;
            return (
              <Card key={meter.id} style={{ marginBottom: 8 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                  <Text style={[typography.subheading, { color: colors.foreground, flex: 1 }]}>{meter.displayName.value}</Text>
                  <Badge
                    label={needsAttention
                      ? `${Math.max(nonUnassignedIssues.length, 1)} issue${Math.max(nonUnassignedIssues.length, 1) === 1 ? '' : 's'}`
                      : unassignedActive
                      ? `${unassignedActive} unassigned`
                      : allSpare
                        ? 'All spare'
                        : 'Mapped'}
                    tone={needsAttention ? 'danger' : unassignedActive ? 'tbc' : allSpare ? 'default' : 'success'}
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
                    Meter or assignment configuration needs attention before completion.
                  </Text>
                ) : unassignedActive ? (
                  <Text style={{ color: colors.destructive, fontWeight: '700', marginTop: 6 }}>
                    Active channels must be assigned to a target or explicitly marked Spare / unused before completion.
                  </Text>
                ) : allSpare ? (
                  <Text style={{ color: colors.mutedForeground, marginTop: 6 }}>
                    No active measurements. Every channel is explicitly marked Spare / unused.
                  </Text>
                ) : null}
              </Card>
            );
          })}
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
                    : 'Declared metering and exact assignments disagree — blocks completion.'}
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
