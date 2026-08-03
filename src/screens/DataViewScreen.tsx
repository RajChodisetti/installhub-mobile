import React, { useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInstallation } from '../hooks';
import {
  canonicalInstallationRepo,
  electricalAssetsRepo,
  siteAssetsRepo,
} from '../repositories';
import {
  createMeasurementAssignment,
  cycleSafeBoardCandidates,
  type AllAssetMeteringRow,
  type ElectricalTreeRow,
} from '../domain/installationV2';
import type {
  ElectricalAsset,
  MeasurementAssignment,
  MeasurementDirection,
  MeterDevice,
  ReadinessIssue,
  SiteAsset,
} from '../types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingState,
  SearchBar,
} from '../components/ui';
import { FormModal, SelectChips } from '../components/forms';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { searchEligibleMeters } from '../domain/meterSearch';
import {
  readinessIssueKey,
  reconciliationProgress,
} from '../domain/reconciliationWorkflow';

type Props = NativeStackScreenProps<RootStackParamList, 'DataView'>;
type ViewMode = 'RECONCILIATION' | 'COVERAGE' | 'ELECTRICAL' | 'PHYSICAL';
const METER_RESULT_LIMIT = 100;
type DataViewResumeState = {
  mode: ViewMode;
  search: string;
  zoneId: string;
  issueCode: string;
  baselineIssueKeys: string[];
};
const dataViewResumeByInstallation = new Map<string, DataViewResumeState>();

export function DataViewScreen({ navigation, route }: Props) {
  const { installationId } = route.params;
  const resumeState = dataViewResumeByInstallation.get(installationId);
  const { colors } = useTheme();
  const {
    item,
    zones,
    boards,
    siteAssets,
    gridSupplies,
    meterDevices,
    measurementAssignments,
    readiness,
    loading,
    refresh,
  } = useInstallation(installationId);
  const [mode, setMode] = useState<ViewMode>(resumeState?.mode ?? 'RECONCILIATION');
  const [search, setSearch] = useState(resumeState?.search ?? '');
  const [treeRows, setTreeRows] = useState<ElectricalTreeRow[]>([]);
  const [meteringRows, setMeteringRows] = useState<AllAssetMeteringRow[]>([]);
  const [sourceIssue, setSourceIssue] = useState<ReadinessIssue | null>(null);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [mappingAsset, setMappingAsset] = useState<SiteAsset | null>(null);
  const [eligibleMeters, setEligibleMeters] = useState<MeterDevice[]>([]);
  const [meterSearch, setMeterSearch] = useState('');
  const [selectedMeterId, setSelectedMeterId] = useState('');
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [phaseMode, setPhaseMode] = useState<MeasurementAssignment['phaseMode']>('SINGLE_PHASE');
  const [direction, setDirection] = useState<MeasurementDirection | ''>('');
  const [reconcileZoneId, setReconcileZoneId] = useState(resumeState?.zoneId ?? 'ALL');
  const [reconcileIssueCode, setReconcileIssueCode] = useState(resumeState?.issueCode ?? 'ALL');
  const [baselineIssueKeys, setBaselineIssueKeys] = useState<string[] | null>(
    resumeState?.baselineIssueKeys ?? null,
  );
  const [collapsedElectricalIds, setCollapsedElectricalIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!item) return;
    void Promise.all([
      canonicalInstallationRepo.electricalTree(installationId),
      canonicalInstallationRepo.allAssetMetering(installationId),
    ]).then(([tree, rows]) => {
      setTreeRows(tree);
      setMeteringRows(rows);
    });
  }, [installationId, item?.tree_revision]);

  const currentIssueKeys = useMemo(
    () => (readiness?.issues ?? []).map(readinessIssueKey),
    [readiness?.issues],
  );
  const issueCodes = useMemo(
    () => [...new Set((readiness?.issues ?? []).map((issue) => issue.code))].sort(),
    [readiness?.issues],
  );
  useEffect(() => {
    if (readiness && baselineIssueKeys === null) setBaselineIssueKeys(currentIssueKeys);
  }, [baselineIssueKeys, currentIssueKeys, readiness]);
  useEffect(() => {
    if (baselineIssueKeys === null) return;
    dataViewResumeByInstallation.set(installationId, {
      mode,
      search,
      zoneId: reconcileZoneId,
      issueCode: reconcileIssueCode,
      baselineIssueKeys,
    });
  }, [baselineIssueKeys, installationId, mode, reconcileIssueCode, reconcileZoneId, search]);
  const reconcileProgress = reconciliationProgress(
    baselineIssueKeys ?? currentIssueKeys,
    currentIssueKeys,
  );

  const issueContext = (issue: ReadinessIssue) => {
    const board = issue.entityType === 'board'
      ? boards.find((candidate) => candidate.id === issue.entityId)
      : undefined;
    const asset = issue.entityType === 'site_asset'
      ? siteAssets.find((candidate) => candidate.id === issue.entityId)
      : undefined;
    const directMeter = issue.entityType === 'meter'
      ? meterDevices.find((candidate) => candidate.id === issue.entityId)
      : undefined;
    const channelMeter = issue.entityType === 'channel'
      ? meterDevices.find((candidate) => candidate.channels.some((channel) => channel.id === issue.entityId))
      : undefined;
    const assignment = issue.entityType === 'measurement_assignment'
      ? measurementAssignments.find((candidate) => candidate.id === issue.entityId)
      : undefined;
    const assignmentMeter = assignment
      ? meterDevices.find((candidate) => candidate.id === assignment.meterId)
      : undefined;
    const meter = directMeter ?? channelMeter ?? assignmentMeter;
    const meterBoard = meter ? boards.find((candidate) => candidate.id === meter.installedOnBoardId) : undefined;
    const grid = issue.entityType === 'grid_supply'
      ? gridSupplies.find((candidate) => candidate.id === issue.entityId)
      : undefined;
    const zoneId = board?.zone_id ?? asset?.zone_id ?? meterBoard?.zone_id;
    const zone = zones.find((candidate) => candidate.id === zoneId);
    const title = board
      ? `${board.display_code} · ${board.asset_name}`
      : asset
        ? `${asset.display_code ?? asset.id} · ${asset.asset_name}`
        : meter
          ? `${meter.displayName.value} · ${meter.deviceModel}`
          : grid
            ? grid.name
            : issue.entityType === 'installation'
              ? item?.site_name ?? issue.entityId
              : issue.entityType === 'form'
                ? 'Field form'
                : issue.entityId;
    const detail = [
      issue.entityType.replace('_', ' '),
      zone?.zone_name,
      meterBoard ? `installed on ${meterBoard.display_code}` : undefined,
      issue.field ? `field: ${issue.field}` : undefined,
    ].filter(Boolean).join(' · ');
    return { board, asset, meter, meterBoard, assignment, zoneId, zone, title, detail };
  };

  const query = search.trim().toLocaleLowerCase();
  const visibleIssues = useMemo(
    () => (readiness?.issues ?? []).filter((issue) => {
      const context = issueContext(issue);
      const zoneMatches = reconcileZoneId === 'ALL' || context.zoneId === reconcileZoneId;
      const issueTypeMatches = reconcileIssueCode === 'ALL' || issue.code === reconcileIssueCode;
      const searchMatches = !query || `${issue.code} ${issue.message} ${issue.entityId} ${context.title} ${context.detail}`
        .toLocaleLowerCase().includes(query);
      return zoneMatches && issueTypeMatches && searchMatches;
    }),
    [
      boards,
      gridSupplies,
      item?.site_name,
      measurementAssignments,
      meterDevices,
      query,
      readiness?.issues,
      reconcileIssueCode,
      reconcileZoneId,
      siteAssets,
      zones,
    ],
  );
  const visibleMetering = useMemo(
    () => meteringRows.filter((row) =>
      !query || `${row.displayCode} ${row.name} ${row.typeLabel} ${row.state}`.toLocaleLowerCase().includes(query)),
    [meteringRows, query],
  );
  const visibleTree = useMemo(
    () => treeRows.filter((row) => {
      if (query && !row.label.toLocaleLowerCase().includes(query)) return false;
      const seen = new Set<string>();
      let sourceId = row.sourceId;
      while (sourceId && !seen.has(sourceId)) {
        if (collapsedElectricalIds.has(sourceId)) return false;
        seen.add(sourceId);
        sourceId = treeRows.find((candidate) => candidate.id === sourceId)?.sourceId;
      }
      return true;
    }),
    [collapsedElectricalIds, query, treeRows],
  );
  const visibleZones = useMemo(
    () => zones.filter((zone) =>
      !query || [
        zone.zone_name,
        zone.zone_description,
        ...boards.filter((board) => board.zone_id === zone.id).flatMap((board) => [board.display_code, board.asset_name, board.asset_type]),
        ...siteAssets.filter((asset) => asset.zone_id === zone.id).flatMap((asset) => [asset.display_code, asset.asset_name, asset.asset_type]),
      ].join(' ').toLocaleLowerCase().includes(query)),
    [boards, query, siteAssets, zones],
  );

  const sourceCandidates = useMemo(() => {
    if (!sourceIssue) return [];
    const validBoards = sourceIssue.entityType === 'board'
      ? cycleSafeBoardCandidates(boards, sourceIssue.entityId)
      : boards;
    const candidates = [
      ...gridSupplies.map((grid) => ({
        id: grid.id,
        kind: 'GRID' as const,
        label: `${grid.name}${grid.isDefault ? ' · default' : ''}${grid.nmi ? ` · ${grid.nmi}` : ''}`,
      })),
      ...validBoards.map((board) => ({
        id: board.id,
        kind: 'BOARD' as const,
        label: `${board.display_code} · ${board.asset_name} · ${board.asset_type} · ${zones.find((zone) => zone.id === board.zone_id)?.zone_name ?? 'Unknown zone'}`,
      })),
    ];
    const candidateQuery = candidateSearch.trim().toLocaleLowerCase();
    return candidates.filter((candidate) =>
      !candidateQuery || candidate.label.toLocaleLowerCase().includes(candidateQuery));
  }, [boards, candidateSearch, gridSupplies, sourceIssue, zones]);

  const selectedMeter = eligibleMeters.find((meter) => meter.id === selectedMeterId);
  const eligibleMeterSearch = useMemo(
    () => searchEligibleMeters(eligibleMeters, meterSearch, METER_RESULT_LIMIT),
    [eligibleMeters, meterSearch],
  );
  const visibleEligibleMeters = eligibleMeterSearch.visible;
  const assignedElsewhere = useMemo(() => {
    const currentIds = new Set(
      mappingAsset?.metering_state?.kind === 'METERED'
        ? mappingAsset.metering_state.measurementAssignmentIds
        : [],
    );
    return new Set(
      measurementAssignments
        .filter((assignment) => !currentIds.has(assignment.id) && assignment.target.kind !== 'TBC')
        .flatMap((assignment) => assignment.channelIds),
    );
  }, [mappingAsset, measurementAssignments]);

  if (loading || !item || !readiness) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  const header = (
    <View>
      <Text style={[typography.title, { color: colors.foreground }]}>Installation data</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
        {item.site_name} · revision {readiness.treeRevision}
      </Text>
      <View style={styles.modeRow} accessibilityRole="tablist">
        {(['RECONCILIATION', 'COVERAGE', 'ELECTRICAL', 'PHYSICAL'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === value }}
            onPress={() => setMode(value)}
            style={[
              styles.modeButton,
              { backgroundColor: mode === value ? colors.primary : colors.muted },
            ]}
          >
            <Text style={{ color: mode === value ? colors.primaryForeground : colors.foreground, fontWeight: '700', fontSize: 12 }}>
              {value === 'RECONCILIATION'
                ? 'Reconcile'
                : value === 'COVERAGE'
                  ? 'Coverage'
                  : value === 'ELECTRICAL'
                    ? 'Electrical'
                    : 'Physical'}
            </Text>
          </Pressable>
        ))}
      </View>
      <SearchBar value={search} onChangeText={setSearch} placeholder={`Search ${mode.toLocaleLowerCase()}…`} />
      {mode === 'RECONCILIATION' ? (
        <>
          <SelectChips
            label="Filter reconciliation by physical zone"
            value={reconcileZoneId}
            options={['ALL', ...zones.map((zone) => zone.id)]}
            getLabel={(value) => value === 'ALL'
              ? 'All zones'
              : zones.find((zone) => zone.id === value)?.zone_name ?? value}
            onChange={setReconcileZoneId}
          />
          <SelectChips
            label="Filter by issue type"
            value={reconcileIssueCode}
            options={['ALL', ...issueCodes]}
            getLabel={(value) => value === 'ALL' ? 'All issue types' : value.replaceAll('_', ' ')}
            onChange={setReconcileIssueCode}
          />
          <Card style={{ marginBottom: spacing.md }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={[typography.subheading, { color: colors.foreground }]}>Readiness workflow</Text>
                <Text
                  accessibilityRole={readiness.readyToComplete ? 'summary' : 'alert'}
                  accessibilityLiveRegion={readiness.readyToComplete ? 'polite' : 'assertive'}
                  style={{ color: colors.mutedForeground, marginTop: 4, lineHeight: 20 }}
                >
                  {readiness.readyToComplete
                    ? 'Locally ready. Cloud validation is still required to complete.'
                    : `${readiness.issues.filter((issue) => issue.severity === 'ERROR').length} blocking · ${readiness.issues.filter((issue) => issue.severity === 'WARNING').length} warning · showing ${visibleIssues.length}`}
                </Text>
                <Text
                  accessibilityRole="progressbar"
                  accessibilityValue={{
                    min: 0,
                    max: reconcileProgress.total,
                    now: reconcileProgress.resolved,
                    text: `${reconcileProgress.resolved} resolved, ${reconcileProgress.remaining} remaining`,
                  }}
                  style={{ color: colors.mutedForeground, marginTop: 6, lineHeight: 20 }}
                >
                  Reconciliation progress · {reconcileProgress.resolved} resolved of {reconcileProgress.total} · {reconcileProgress.remaining} remaining
                </Text>
                {resumeState ? (
                  <Text style={{ color: colors.mutedForeground, marginTop: 4, fontSize: 12 }}>
                    Your previous reconciliation filters and progress are restored for this session.
                  </Text>
                ) : null}
              </View>
              <Badge label={readiness.readyToComplete ? 'READY' : 'RECONCILE'} tone={readiness.readyToComplete ? 'success' : 'tbc'} />
            </View>
            <Button
              title="Reset progress baseline"
              variant="ghost"
              style={{ marginTop: spacing.sm }}
              onPress={() => setBaselineIssueKeys(currentIssueKeys)}
            />
          </Card>
        </>
      ) : mode === 'PHYSICAL' ? (
        <Card style={{ marginBottom: spacing.md }}>
          <Text accessibilityRole="summary" style={[typography.subheading, { color: colors.foreground }]}>Physical inventory</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4, lineHeight: 20 }}>
            1 installation · {zones.length} zones · {boards.length} switchboards · {siteAssets.length} site assets
          </Text>
        </Card>
      ) : null}
    </View>
  );

  const resolveSource = async (candidate: { id: string; kind: 'GRID' | 'BOARD' }) => {
    if (!sourceIssue) return;
    const source = candidate.kind === 'GRID'
      ? { kind: 'GRID' as const, gridSupplyId: candidate.id }
      : { kind: 'BOARD' as const, boardId: candidate.id };
    if (sourceIssue.entityType === 'board') {
      await electricalAssetsRepo.update(sourceIssue.entityId, { electrical_source: source });
    } else if (sourceIssue.entityType === 'site_asset') {
      await siteAssetsRepo.update(sourceIssue.entityId, { electrical_source: source });
    }
    setSourceIssue(null);
    setCandidateSearch('');
    await refresh();
  };

  const openMapping = async (assetId: string) => {
    const asset = siteAssets.find((candidate) => candidate.id === assetId);
    if (!asset) return;
    const candidates = await canonicalInstallationRepo.eligibleMetersForAsset(assetId);
    setMappingAsset(asset);
    setEligibleMeters(candidates);
    setMeterSearch('');
    setSelectedMeterId('');
    setSelectedChannelIds([]);
    setPhaseMode('SINGLE_PHASE');
    setDirection('');
  };

  const confirmMeteringTransition = (
    assetId: string,
    state: 'UNMETERED' | 'TBC',
  ) => {
    const linked = measurementAssignments.filter((assignment) =>
      assignment.target.kind === 'SITE_ASSET' && assignment.target.siteAssetId === assetId);
    const exactIds = linked.map((assignment) => assignment.id).sort();
    Alert.alert(
      state === 'UNMETERED' ? 'Confirm unmetered asset' : 'Move metering to TBC',
      linked.length
        ? `This removes ${linked.length} exact assignment(s):\n${exactIds.join('\n')}\n\nCommissioning forms and evidence are retained.`
        : 'No exact assignments will be removed. Commissioning forms and evidence are retained.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: state === 'UNMETERED' ? 'Confirm unmetered' : 'Set TBC',
          style: state === 'UNMETERED' ? 'destructive' : 'default',
          onPress: () => { void (async () => {
            await siteAssetsRepo.setMetering(assetId, { kind: state });
            await refresh();
          })(); },
        },
      ],
    );
  };

  const issueRow = ({ item: issue }: { item: ReadinessIssue }) => {
    const context = issueContext(issue);
    const openRecord = () => {
      if (context.board) {
        navigation.navigate('BoardDetail', {
          boardId: context.board.id,
          installationId,
          zoneId: context.board.zone_id,
        });
      } else if (context.asset) {
        navigation.navigate('SiteAssetDetail', {
          assetId: context.asset.id,
          installationId,
          zoneId: context.asset.zone_id,
        });
      } else if (context.meter && context.meterBoard) {
        navigation.navigate('MeterForm', {
          boardId: context.meterBoard.id,
          meterId: context.meter.id,
        });
      } else if (issue.entityType === 'installation') {
        navigation.navigate('InstallationForm', { installationId });
      } else if (issue.entityType === 'form') {
        navigation.navigate('FormsList', { installationId });
      }
    };
    const canOpen = Boolean(
      context.board || context.asset || (context.meter && context.meterBoard) ||
      issue.entityType === 'installation' || issue.entityType === 'form',
    );
    return (
    <Card style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontWeight: '800' }}>{context.title}</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4, lineHeight: 20 }}>{issue.message}</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 5, fontSize: 12 }}>
            {issue.code} · {context.detail || issue.entityId}
          </Text>
        </View>
        <Badge label={issue.severity} tone={issue.severity === 'ERROR' ? 'danger' : 'default'} />
      </View>
      {canOpen ? (
        <Button
          title="Open affected record"
          variant="ghost"
          style={{ marginTop: 10 }}
          onPress={openRecord}
        />
      ) : null}
      {(issue.code === 'SUPPLY_TBC' || issue.code === 'SUPPLY_SOURCE_INVALID') &&
      (issue.entityType === 'board' || issue.entityType === 'site_asset') ? (
        <Button
          title="Choose exact source"
          variant="secondary"
          style={{ marginTop: 10 }}
          onPress={() => setSourceIssue(issue)}
        />
      ) : null}
      {(issue.code === 'METERING_STATE_INVALID' || issue.code === 'METER_PRESENT_MISMATCH') && issue.entityType === 'site_asset' ? (
        <Button
          title="Choose exact meter and channels"
          variant="secondary"
          style={{ marginTop: 10 }}
          onPress={() => { void openMapping(issue.entityId); }}
        />
      ) : null}
      {issue.code === 'FORM_INCOMPLETE' ? (
        <Button
          title="Open Field Forms"
          variant="secondary"
          style={{ marginTop: 10 }}
          onPress={() => navigation.navigate('FormsList', { installationId })}
        />
      ) : null}
    </Card>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {mode === 'RECONCILIATION' ? (
        <FlatList
          data={visibleIssues}
          keyExtractor={(issue, index) => `${issue.code}:${issue.entityId}:${issue.field ?? ''}:${index}`}
          renderItem={issueRow}
          ListHeaderComponent={header}
          ListEmptyComponent={<EmptyState title="No readiness issues" subtitle="The local graph is ready for Cloud validation." />}
          contentContainerStyle={styles.pad}
          keyboardShouldPersistTaps="handled"
        />
      ) : mode === 'COVERAGE' ? (
        <FlatList
          data={visibleMetering}
          keyExtractor={(row) => row.id}
          ListHeaderComponent={header}
          renderItem={({ item: row }) => (
            <Card style={{ marginBottom: 8 }}>
              <Text style={[typography.subheading, { color: colors.foreground }]}>{row.displayCode} · {row.name}</Text>
              <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>{row.typeLabel} · Fed from {row.supplyLabel}</Text>
              <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
                {row.state === 'UNMETERED' ? 'CONFIRMED UNMETERED' : row.state.replace('_', ' ')}{row.virtualPreview ? ' · advisory preview until sync' : ''}
                {row.state === 'VIRTUAL' && row.virtualMeterId
                  ? ` · shared/unallocated residual · boundary ${row.virtualMeterId}`
                  : ''}
                {row.channelLabels.length ? ` · ${row.channelLabels.join(', ')}` : ''}
              </Text>
              {row.state === 'UNMETERED' ? (
                <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>No direct device/channel connection; this metering state alone is non-blocking.</Text>
              ) : row.state === 'MAPPING_ISSUE' ? (
                <Text style={{ color: colors.destructive, fontWeight: '700', marginTop: 4 }}>Declared metering and exact assignments disagree. Resolve before completion.</Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <Button title="Map meter/channels" variant="secondary" onPress={() => { void openMapping(row.id); }} />
                <Button title="Set unmetered" variant="ghost" onPress={() => confirmMeteringTransition(row.id, 'UNMETERED')} />
                <Button title="Set TBC" variant="ghost" onPress={() => confirmMeteringTransition(row.id, 'TBC')} />
              </View>
            </Card>
          )}
          ListEmptyComponent={<EmptyState title="No site assets" />}
          contentContainerStyle={styles.pad}
        />
      ) : mode === 'ELECTRICAL' ? (
        <FlatList
          data={visibleTree}
          keyExtractor={(row) => row.id}
          ListHeaderComponent={header}
          renderItem={({ item: row }) => {
            const hasChildren = treeRows.some((candidate) => candidate.sourceId === row.id);
            const expanded = !collapsedElectricalIds.has(row.id);
            const boardRow = row.kind === 'BOARD' ? boards.find((board) => board.id === row.id) : undefined;
            const assetRow = row.kind === 'SITE_ASSET' ? siteAssets.find((asset) => asset.id === row.id) : undefined;
            return (
            <Card style={{ marginBottom: 8, marginLeft: Math.min(row.depth, 6) * 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <Pressable
                  accessibilityRole={hasChildren ? 'button' : 'text'}
                  accessibilityLabel={`${row.label}, ${row.kind}${hasChildren ? `, ${expanded ? 'expanded' : 'collapsed'}` : ''}`}
                  accessibilityState={hasChildren ? { expanded } : undefined}
                  accessibilityHint={hasChildren ? 'Double tap to expand or collapse electrical children.' : undefined}
                  disabled={!hasChildren}
                  onPress={() => setCollapsedElectricalIds((current) => {
                    const next = new Set(current);
                    if (next.has(row.id)) next.delete(row.id); else next.add(row.id);
                    return next;
                  })}
                  style={{ minHeight: 44, flex: 1, justifyContent: 'center' }}
                >
                  <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                    {hasChildren ? `${expanded ? '▾' : '▸'} ` : ''}{row.label}
                  </Text>
                </Pressable>
                <Badge label={row.unresolved ? 'TBC' : row.kind} tone={row.unresolved ? 'tbc' : 'default'} />
              </View>
              <Text style={{ color: colors.mutedForeground, marginTop: 4, fontSize: 12 }}>
                {row.kind === 'GRID'
                  ? 'Electrical origin'
                  : row.kind === 'UNRESOLVED'
                    ? 'Records below have unresolved FED_FROM links'
                    : `FED_FROM ${treeRows.find((candidate) => candidate.id === row.sourceId)?.label ?? 'TBC'}`}
              </Text>
              {row.depth > 6 ? <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>Electrical depth {row.depth}</Text> : null}
              {boardRow ? (
                <Button
                  title="Open switchboard"
                  variant="ghost"
                  style={{ marginTop: spacing.sm }}
                  onPress={() => navigation.navigate('BoardDetail', {
                    boardId: boardRow.id,
                    installationId,
                    zoneId: boardRow.zone_id,
                  })}
                />
              ) : assetRow ? (
                <Button
                  title="Open site asset"
                  variant="ghost"
                  style={{ marginTop: spacing.sm }}
                  onPress={() => navigation.navigate('SiteAssetDetail', {
                    assetId: assetRow.id,
                    installationId,
                    zoneId: assetRow.zone_id,
                  })}
                />
              ) : null}
              {row.unresolved ? (
                <Button
                  title="Resolve topology"
                  variant="secondary"
                  style={{ marginTop: spacing.sm }}
                  onPress={() => {
                    setMode('RECONCILIATION');
                    setReconcileIssueCode('ALL');
                    setSearch(row.id.startsWith('unresolved:') ? '' : row.id);
                  }}
                />
              ) : null}
            </Card>
            );
          }}
          ListFooterComponent={(
            <View style={{ marginTop: spacing.lg }}>
              <Text style={[typography.heading, { color: colors.foreground, marginBottom: spacing.sm }]}>MEASURES overlay</Text>
              <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md, lineHeight: 20 }}>
                FED_FROM describes power flow. These records separately describe what each meter channel measures.
              </Text>
              {measurementAssignments
                .filter((assignment) => {
                  if (!query) return true;
                  const meter = meterDevices.find((item) => item.id === assignment.meterId);
                  return `${assignment.id} ${meter?.displayName.value ?? ''} ${assignment.target.kind}`
                    .toLocaleLowerCase().includes(query);
                })
                .map((assignment) => {
                  const meter = meterDevices.find((item) => item.id === assignment.meterId);
                  const channelLabels = assignment.channelIds.map((id) =>
                    `Ch ${meter?.channels.find((channel) => channel.id === id)?.ordinal ?? id}`);
                  let target = 'TBC';
                  if (assignment.target.kind === 'BOARD') {
                    const targetId = assignment.target.boardId;
                    target = boards.find((board) => board.id === targetId)?.display_code ?? targetId;
                  } else if (assignment.target.kind === 'SITE_ASSET') {
                    const targetId = assignment.target.siteAssetId;
                    target = siteAssets.find((asset) => asset.id === targetId)?.display_code ?? targetId;
                  } else if (assignment.target.kind === 'GRID_BOUNDARY') {
                    const targetId = assignment.target.gridSupplyId;
                    target = gridSupplies.find((grid) => grid.id === targetId)?.name ?? targetId;
                  }
                  return (
                    <Card key={assignment.id} style={{ marginBottom: spacing.sm }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
                        <Text style={{ color: colors.foreground, fontWeight: '700', flex: 1 }}>
                          {meter?.displayName.value ?? assignment.meterId} · {channelLabels.join(', ')}
                        </Text>
                        <Badge label={assignment.status} tone={assignment.status === 'TBC' ? 'tbc' : 'success'} />
                      </View>
                      <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
                        MEASURES {target} · {assignment.phaseMode.replace('_', ' ')} · {assignment.direction.toLocaleLowerCase()}
                      </Text>
                    </Card>
                  );
                })}
              {!measurementAssignments.length ? (
                <EmptyState title="No measurement assignments" subtitle="Commission a meter and map its active channels." />
              ) : null}
            </View>
          )}
          ListEmptyComponent={<EmptyState title="No electrical nodes" />}
          contentContainerStyle={styles.pad}
        />
      ) : (
        <FlatList
          data={visibleZones}
          keyExtractor={(zone) => zone.id}
          ListHeaderComponent={header}
          renderItem={({ item: zone }) => {
            const zoneBoards = boards.filter((board) => board.zone_id === zone.id);
            const zoneAssets = siteAssets.filter((asset) => asset.zone_id === zone.id);
            const sourceLabel = (source: ElectricalAsset['electrical_source'] | SiteAsset['electrical_source']) => {
              if (!source || source.kind === 'TBC') return 'Supply TBC';
              if (source.kind === 'GRID') {
                return `Grid: ${gridSupplies.find((grid) => grid.id === source.gridSupplyId)?.name ?? source.gridSupplyId}`;
              }
              const parent = boards.find((board) => board.id === source.boardId);
              return `Fed from ${parent?.display_code ?? source.boardId}`;
            };
            const zoneIds = new Set([...zoneBoards.map((board) => board.id), ...zoneAssets.map((asset) => asset.id)]);
            const issueCount = readiness.issues.filter((issue) => zoneIds.has(issue.entityId)).length;
            return (
              <Card style={{ marginBottom: spacing.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.subheading, { color: colors.foreground }]}>{zone.zone_name}</Text>
                    <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
                      Physical home for {zoneBoards.length} board{zoneBoards.length === 1 ? '' : 's'} and {zoneAssets.length} asset{zoneAssets.length === 1 ? '' : 's'} · {issueCount} direct issue{issueCount === 1 ? '' : 's'}
                    </Text>
                  </View>
                  <Button
                    title="Open zone"
                    variant="ghost"
                    onPress={() => navigation.navigate('ZoneWorkspace', { zoneId: zone.id, installationId })}
                  />
                </View>
                <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>Switchboards</Text>
                {zoneBoards.length ? zoneBoards.map((board) => (
                  <Pressable
                    key={board.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open switchboard ${board.display_code}, ${board.asset_name}`}
                    onPress={() => navigation.navigate('BoardDetail', {
                      boardId: board.id,
                      installationId,
                      zoneId: zone.id,
                    })}
                    style={[styles.physicalRow, { borderColor: colors.border }]}
                  >
                    <Text style={{ color: colors.foreground, fontWeight: '700' }}>{board.display_code} · {board.asset_name}</Text>
                    <Text style={{ color: colors.mutedForeground, marginTop: 3 }}>
                      {board.asset_type} · {sourceLabel(board.electrical_source)} · {board.meters.length} device{board.meters.length === 1 ? '' : 's'}
                    </Text>
                  </Pressable>
                )) : <Text style={{ color: colors.mutedForeground }}>No switchboards in this zone.</Text>}
                <Text style={[styles.groupLabel, { color: colors.mutedForeground }]}>Site assets</Text>
                {zoneAssets.length ? zoneAssets.map((asset) => (
                  <Pressable
                    key={asset.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open site asset ${asset.display_code ?? asset.asset_name}`}
                    onPress={() => navigation.navigate('SiteAssetDetail', {
                      assetId: asset.id,
                      installationId,
                      zoneId: zone.id,
                    })}
                    style={[styles.physicalRow, { borderColor: colors.border }]}
                  >
                    <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                      {asset.display_code ?? asset.id} · {asset.asset_name}
                    </Text>
                    <Text style={{ color: colors.mutedForeground, marginTop: 3 }}>
                      {asset.asset_type} · {sourceLabel(asset.electrical_source)} · Metering {asset.metering_state?.kind ?? 'TBC'}
                    </Text>
                  </Pressable>
                )) : <Text style={{ color: colors.mutedForeground }}>No site assets in this zone.</Text>}
              </Card>
            );
          }}
          ListEmptyComponent={<EmptyState title="No physical zones" />}
          contentContainerStyle={styles.pad}
        />
      )}

      <FormModal visible={Boolean(sourceIssue)} title="Choose electrical source" onClose={() => setSourceIssue(null)}>
        <SearchBar value={candidateSearch} onChangeText={setCandidateSearch} placeholder="Search Grid supplies and boards…" />
        {sourceCandidates.slice(0, 100).map((candidate) => (
          <Button
            key={`${candidate.kind}:${candidate.id}`}
            title={candidate.label}
            variant="secondary"
            style={{ marginBottom: 8 }}
            onPress={() => { void resolveSource(candidate); }}
          />
        ))}
        {sourceCandidates.length > 100 ? (
          <Text style={{ color: colors.mutedForeground }}>Showing 100 matches. Refine the search to choose another source.</Text>
        ) : null}
      </FormModal>

      <FormModal
        visible={Boolean(mappingAsset)}
        title="Map exact measurement"
        onClose={() => setMappingAsset(null)}
        scroll={false}
      >
        <FlatList
          data={visibleEligibleMeters}
          keyExtractor={(meter) => meter.id}
          keyboardShouldPersistTaps="handled"
          accessibilityRole="radiogroup"
          accessibilityLabel="Eligible upstream meters"
          contentContainerStyle={styles.mappingList}
          ListHeaderComponent={(
            <View>
              <Text style={{ color: colors.foreground, fontWeight: '700', marginBottom: 8 }}>
                {mappingAsset?.display_code} · {mappingAsset?.asset_name}
              </Text>
              <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>
                Only meters installed on a validated upstream electrical path are shown.
              </Text>
              <SearchBar
                value={meterSearch}
                onChangeText={setMeterSearch}
                placeholder="Search meter code, model, or serial…"
              />
              <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm }}>
                {eligibleMeterSearch.total > METER_RESULT_LIMIT
                  ? `Showing ${METER_RESULT_LIMIT} of ${eligibleMeterSearch.total} matches. Refine the search to choose another meter.`
                  : `${eligibleMeterSearch.total} eligible meter${eligibleMeterSearch.total === 1 ? '' : 's'}.`}
              </Text>
            </View>
          )}
          renderItem={({ item: meter, index }) => {
            const selected = selectedMeterId === meter.id;
            return (
              <Button
                title={`${meter.displayName.value} · ${meter.deviceModel} · ${meter.serialNumber || 'no serial'}`}
                variant={selected ? 'primary' : 'secondary'}
                style={{ marginBottom: 8 }}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityHint={`${index + 1} of ${visibleEligibleMeters.length}${selected ? ', selected' : ''}`}
                onPress={() => {
                  setSelectedMeterId(meter.id);
                  setSelectedChannelIds([]);
                }}
              />
            );
          }}
          ListEmptyComponent={(
            <Text style={{ color: colors.mutedForeground }}>
              {eligibleMeters.length
                ? 'No meters match this search. Refine or clear the search.'
                : 'No eligible upstream meter is available. Resolve the supply path or install a meter first.'}
            </Text>
          )}
          ListFooterComponent={selectedMeter ? (
            <View style={{ marginTop: spacing.md }}>
              <Text style={[typography.subheading, { color: colors.foreground, marginBottom: 8 }]}>Channels</Text>
              <Text
                accessibilityLiveRegion="polite"
                accessibilityRole="summary"
                style={{ color: colors.mutedForeground, marginBottom: spacing.sm }}
              >
                {phaseMode === 'SINGLE_PHASE'
                  ? `Single phase requires exactly 1 channel. ${selectedChannelIds.length} selected.`
                  : phaseMode === 'THREE_PHASE'
                    ? `Three phase requires exactly 3 channels. ${selectedChannelIds.length} selected.`
                    : `Other channel group requires at least 1 channel. ${selectedChannelIds.length} selected.`}
              </Text>
              {selectedMeter.channels.map((channel, index) => {
                const selected = selectedChannelIds.includes(channel.id);
                const unavailable = assignedElsewhere.has(channel.id) || channel.purpose === 'SPARE';
                return (
                  <Button
                    key={channel.id}
                    title={`Ch ${channel.ordinal} · ${channel.purpose}${channel.description ? ` · ${channel.description}` : ''}${unavailable ? ' · unavailable' : ''}`}
                    variant={selected ? 'primary' : 'secondary'}
                    disabled={unavailable}
                    style={{ marginBottom: 8 }}
                    accessibilityLabel={`Channel ${channel.ordinal}, ${channel.purpose}${unavailable ? ', unavailable' : selected ? ', selected' : ', not selected'}`}
                    accessibilityHint={`${index + 1} of ${selectedMeter.channels.length}`}
                    accessibilityState={{ selected, disabled: unavailable }}
                    onPress={() => setSelectedChannelIds((current) =>
                      selected ? current.filter((id) => id !== channel.id) : [...current, channel.id])}
                  />
                );
              })}
              <SelectChips
                label="Phase mode"
                value={phaseMode}
                options={['SINGLE_PHASE', 'THREE_PHASE', 'OTHER']}
                getLabel={(value) => value === 'SINGLE_PHASE'
                  ? 'Single phase'
                  : value === 'THREE_PHASE'
                    ? 'Three phase'
                    : 'Other channel group'}
                onChange={setPhaseMode}
              />
              <SelectChips
                label="Measurement direction"
                value={direction}
                options={['', 'CONSUMPTION', 'GENERATION', 'BIDIRECTIONAL']}
                getLabel={(value) => value === '' ? 'Choose direction' : value.charAt(0) + value.slice(1).toLocaleLowerCase()}
                onChange={setDirection}
              />
              <Button
                title="Save exact mapping"
                disabled={!selectedChannelIds.length}
                style={{ marginTop: spacing.md }}
                onPress={async () => {
                  if (!mappingAsset) return;
                  try {
                    if (!direction) throw new Error('Choose the measurement direction explicitly.');
                    const assignment = createMeasurementAssignment({
                      installationId,
                      assetId: mappingAsset.id,
                      meter: selectedMeter,
                      channelIds: selectedChannelIds,
                      phaseMode,
                      direction,
                    });
                    await siteAssetsRepo.setMetering(
                      mappingAsset.id,
                      { kind: 'METERED', measurementAssignmentIds: [assignment.id] },
                      [assignment],
                    );
                    setMappingAsset(null);
                    await refresh();
                  } catch (error) {
                    Alert.alert('Mapping not saved', error instanceof Error ? error.message : String(error));
                  }
                }}
              />
            </View>
          ) : null}
        />
      </FormModal>
    </View>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
  modeRow: { flexDirection: 'row', gap: 8, marginTop: spacing.lg, marginBottom: spacing.md },
  modeButton: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  mappingList: { padding: spacing.lg, paddingBottom: 40 },
  groupLabel: { fontSize: 12, fontWeight: '800', textTransform: 'uppercase', marginTop: spacing.lg, marginBottom: spacing.sm },
  physicalRow: { minHeight: 54, justifyContent: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.sm },
});
