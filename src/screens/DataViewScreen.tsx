import { FormScrollView } from '../components/ui';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePreventRemove } from '@react-navigation/native';
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
import { buildElectricalDiagramModel } from '../domain/electricalDiagram';
import { ElectricalSingleLineDiagram, type ElectricalMapDraft } from '../components/domain/ElectricalSingleLineDiagram';
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
import { loadElectricalMapLayout, prepareElectricalMapLayoutAttempt, executeElectricalMapLayoutAttempt, type ElectricalMapLayoutAttempt, type ElectricalMapLayoutSession } from '../repositories/electricalMapLayoutRepository';
import { pinnedMappingCanonicalJson } from '../services/pinnedInstallationMapping';
import type { ElectricalMapLayoutDocument } from '../domain/electricalMapLayout';
import { sharePinnedInstallationMapping } from '../services/installationMappingFiles';
import { shareInstallationElectricalMap, type ElectricalMapFileFormat } from '../services/electricalMapFiles';
import { RecordLoadState } from '../components/RecordLoadState';
import { useAuth, useTheme } from '../context/AppProviders';
import { assignedWorkActionIsLocked } from '../services/assignedWorkMutationGuard';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { searchEligibleMeters } from '../domain/meterSearch';
import {
  partitionReadinessIssues,
  readinessIssueKey,
  reconciliationIssueWhy,
  reconciliationProgress,
} from '../domain/reconciliationWorkflow';
import {
  energyFlowLabel,
  meterChannelPurposeLabel,
  phaseGroupingLabel,
} from '../domain/meterCommissioning';
import {
  assetMeteringChannelDescription,
  assetMeteringChannelGroupComplete,
  assetMeteringDeviceChoices,
  assetMeteringSelectionAfterToggle,
  requiredAssetMeteringChannelCount,
} from '../domain/assetMeteringWorkflow';

type Props = NativeStackScreenProps<RootStackParamList, 'DataView'>;
type ViewMode = 'RECONCILIATION' | 'VALIDATION' | 'COVERAGE' | 'ELECTRICAL' | 'PHYSICAL';
type ElectricalViewMode = 'DIAGRAM' | 'RELATIONSHIPS';
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
  const { installationId, initialMode } = route.params;
  const resumeState = dataViewResumeByInstallation.get(installationId);
  const { colors } = useTheme();
  const { user } = useAuth();
  const {
    item,
    zones,
    boards,
    siteAssets,
    gridSupplies,
    meterDevices,
    measurementAssignments,
    virtualMeters,
    readiness,
    loading,
    error,
    refresh,
  } = useInstallation(installationId);
  const [layoutSession, setLayoutSession] = useState<ElectricalMapLayoutSession | null>(null);
  const [layoutLoadError, setLayoutLoadError] = useState('');
  const [layoutLoading, setLayoutLoading] = useState(false);
  const [retainedLayoutDraft, setRetainedLayoutDraft] = useState<ElectricalMapDraft | null>(null);
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [layoutEditsLocked, setLayoutEditsLocked] = useState(false);
  const [layoutReload, setLayoutReload] = useState(0);
  const layoutAttempt = useRef<ElectricalMapLayoutAttempt | null>(null);
  const layoutNamespace = useRef(0);
  const layoutRequest = useRef(0);
  useEffect(() => () => { layoutNamespace.current += 1; }, [installationId]);
  let layoutActorCurrent = false;
  if (item?.id === installationId && user?.id && item.local_owner_user_id === user.id
    && layoutSession?.lease.actorUserId === user.id && !assignedWorkActionIsLocked(item, user.id)) {
    try { layoutSession.lease.assertCurrent(); layoutActorCurrent = true; } catch { /* Expired authority must not block logout or access withdrawal. */ }
  }
  usePreventRemove(layoutDirty && layoutActorCurrent && Boolean(readiness), () => Alert.alert('Unsaved electrical arrangement', 'Save or discard the arrangement before leaving this screen.'));
  const blockWhileArranging = () => {
    if (!layoutDirty) return false;
    Alert.alert('Unsaved electrical arrangement', 'Save or discard the arrangement before changing the view or search.');
    return true;
  };
  const [mappingExportBusy, setMappingExportBusy] = useState(false);
  const [mapFileBusy, setMapFileBusy] = useState<ElectricalMapFileFormat | null>(null);
  const exportGeneration = useRef(0);
  useEffect(() => {
    setMappingExportBusy(false);
    setMapFileBusy(null);
    return () => { exportGeneration.current += 1; };
  }, [installationId]);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const [rowsRetry, setRowsRetry] = useState(0);
  const [mode, setMode] = useState<ViewMode>(
    initialMode ?? resumeState?.mode ?? 'RECONCILIATION',
  );
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
  const [electricalViewMode, setElectricalViewMode] = useState<ElectricalViewMode>('DIAGRAM');

  const electricalDiagram = useMemo(
    () => item
      ? buildElectricalDiagramModel({
          installation: item,
          zones,
          boards,
          siteAssets,
          gridSupplies,
          meterDevices,
          measurementAssignments,
          virtualMeterDefinitions: virtualMeters,
        })
      : null,
    [
      boards,
      gridSupplies,
      item,
      measurementAssignments,
      meterDevices,
      siteAssets,
      virtualMeters,
      zones,
    ],
  );

  const mapNodeKey = electricalDiagram?.nodes.map((node) => node.id).sort().join('|') ?? '';
  useEffect(() => {
    if (!item || item.id !== installationId || !electricalDiagram || layoutDirty || mode !== 'ELECTRICAL') return;
    let active = true;
    const namespace = layoutNamespace.current;
    const request = ++layoutRequest.current;
    setLayoutLoading(true); setLayoutLoadError(''); setLayoutSession(null);
    void loadElectricalMapLayout(installationId, electricalDiagram.nodes.map((node) => node.id), () => {
      if (layoutNamespace.current !== namespace || layoutRequest.current !== request) throw new Error('The electrical map screen changed.');
    }).then((session) => { if (active) setLayoutSession(session); })
      .catch((caught) => { if (active) setLayoutLoadError(caught instanceof Error ? caught.message : 'The saved arrangement could not be loaded.'); })
      .finally(() => { if (active) setLayoutLoading(false); });
    return () => { active = false; };
  }, [installationId, item?.id, item?.tree_revision, item?.server_tree_revision, item?.record_version_number, mapNodeKey, layoutDirty, layoutReload, mode]);

  const layoutDirtyChanged = (dirty: boolean) => {
    setLayoutDirty(dirty);
    if (!dirty) { layoutAttempt.current = null; setLayoutEditsLocked(false); setRetainedLayoutDraft(null); }
  };
  const saveMapLayout = async (layout: ElectricalMapLayoutDocument) => {
    if (!layoutSession) throw new Error('Reload the saved arrangement before saving.');
    if (!layoutAttempt.current) {
      layoutAttempt.current = await prepareElectricalMapLayoutAttempt(layoutSession, layout);
      setLayoutEditsLocked(true);
    } else if (pinnedMappingCanonicalJson(layoutAttempt.current.layout) !== pinnedMappingCanonicalJson(layout)) {
      throw new Error('Retry must keep the original arrangement. Discard it before making different changes.');
    }
    await executeElectricalMapLayoutAttempt(layoutAttempt.current);
    // The receipt is persisted already. A presentation refresh failure must not
    // turn a confirmed save into a second mutation on retry.
    layoutAttempt.current = null;
    setLayoutEditsLocked(false);
    await refresh().catch(() => undefined);
    setLayoutReload((current) => current + 1);
  };

  useEffect(() => {
    if (!item) return;
    let active = true;
    setRowsError(null);
    void Promise.all([
      canonicalInstallationRepo.electricalTree(installationId),
      canonicalInstallationRepo.allAssetMetering(installationId),
    ]).then(([tree, rows]) => {
      if (!active) return;
      setTreeRows(tree);
      setMeteringRows(rows);
    }).catch((caught) => {
      if (active) setRowsError(caught instanceof Error ? caught.message : 'The electrical and metering tables could not be loaded.');
    });
    return () => { active = false; };
  }, [installationId, item?.tree_revision, rowsRetry]);

  const issuePartition = useMemo(
    () => partitionReadinessIssues(readiness?.issues ?? [], {
      siteAssets,
      measurementAssignments,
    }),
    [measurementAssignments, readiness?.issues, siteAssets],
  );
  const currentIssueKeys = useMemo(
    () => issuePartition.reconciliation.map(readinessIssueKey),
    [issuePartition.reconciliation],
  );
  const issueCodes = useMemo(
    () => [...new Set(issuePartition.reconciliation.map((issue) => issue.code))].sort(),
    [issuePartition.reconciliation],
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
    () => issuePartition.reconciliation.filter((issue) => {
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
      issuePartition.reconciliation,
      reconcileIssueCode,
      reconcileZoneId,
      siteAssets,
      zones,
    ],
  );
  const visibleValidationIssues = useMemo(
    () => issuePartition.validation.filter((issue) => {
      const context = issueContext(issue);
      return !query || `${issue.code} ${issue.message} ${issue.entityId} ${context.title} ${context.detail}`
        .toLocaleLowerCase().includes(query);
    }),
    [
      boards,
      gridSupplies,
      issuePartition.validation,
      item?.site_name,
      measurementAssignments,
      meterDevices,
      query,
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
  const mappingMeterChoices = useMemo(() => assetMeteringDeviceChoices({
    meters: meterDevices,
    assignments: measurementAssignments,
    supplyingBoardId: mappingAsset?.electrical_source?.kind === 'BOARD'
      ? mappingAsset.electrical_source.boardId
      : undefined,
    assetId: mappingAsset?.id,
  }), [mappingAsset?.electrical_source, mappingAsset?.id, measurementAssignments, meterDevices]);
  const selectedMeterChoice = mappingMeterChoices.find((choice) => choice.meter.id === selectedMeterId);
  const requiredChannelCount = requiredAssetMeteringChannelCount(phaseMode);
  const channelGroupComplete = assetMeteringChannelGroupComplete(phaseMode, selectedChannelIds);
  const eligibleMeterSearch = useMemo(
    () => searchEligibleMeters(eligibleMeters, meterSearch, METER_RESULT_LIMIT),
    [eligibleMeters, meterSearch],
  );
  const visibleEligibleMeters = eligibleMeterSearch.visible;
  useEffect(() => {
    if (!mappingAsset || !selectedMeterId) return;
    if (!selectedMeterChoice) {
      setSelectedMeterId('');
      setSelectedChannelIds([]);
      return;
    }
    const selectable = new Set(selectedMeterChoice.channels
      .filter((choice) => choice.selectable)
      .map((choice) => choice.channel.id));
    setSelectedChannelIds((current) => {
      const retained = current.filter((channelId) => selectable.has(channelId));
      return retained.length === current.length ? current : retained;
    });
  }, [mappingAsset, selectedMeterChoice, selectedMeterId]);

  const retry = () => {
    setRowsRetry((current) => current + 1);
    void refresh().catch(() => undefined);
  };
  const discardUnavailableDraft = () => Alert.alert('Discard pending arrangement?',
    'The installation is unavailable. Discard the retained symbol positions and go back?', [
      { text: 'Keep pending positions', style: 'cancel' },
      { text: 'Discard and go back', style: 'destructive', onPress: () => {
        layoutDirtyChanged(false);
        navigation.goBack();
      } },
    ]);
  if (loading && (!item || !readiness) && !layoutDirty) return <LoadingState />;
  if (!item || item.id !== installationId || !readiness) return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <RecordLoadState title="Installation data unavailable"
        message={error ?? 'The installation or its readiness data is no longer available.'}
        onRetry={retry} onBack={layoutDirty ? discardUnavailableDraft : () => navigation.goBack()} />
      {layoutDirty ? <Card style={{ margin: spacing.lg }}>
        <Text style={{ color: colors.foreground }}>Your pending arrangement is retained while you retry this installation.</Text>
        <Button title="Discard arrangement and go back" variant="secondary" onPress={discardUnavailableDraft} />
      </Card> : null}
    </View>
  );

  const downloadPinnedMapping = async () => {
    if (mappingExportBusy || mapFileBusy || !item.record_version_number) return;
    const generation = ++exportGeneration.current;
    setMappingExportBusy(true);
    try {
      await sharePinnedInstallationMapping(installationId, item.record_version_number, () => {
        if (exportGeneration.current !== generation) throw new Error('The mapping screen changed. Download cancelled.');
      });
    } catch (caught) {
      if (exportGeneration.current === generation) Alert.alert('Mapping download unavailable', caught instanceof Error ? caught.message : 'The pinned mapping could not be downloaded.');
    } finally {
      if (exportGeneration.current === generation) setMappingExportBusy(false);
    }
  };

  const downloadElectricalMap = async (format: ElectricalMapFileFormat) => {
    if (mappingExportBusy || mapFileBusy || item.is_imported_copy) return;
    const generation = ++exportGeneration.current;
    setMapFileBusy(format);
    try {
      await shareInstallationElectricalMap({
        installationId,
        siteCode: item.site_code,
        format,
        installationStatus: item.status,
        recordVersionNumber: item.record_version_number,
        assertScreenCurrent: () => {
          if (exportGeneration.current !== generation) throw new Error('The electrical map screen changed. Download cancelled.');
        },
      });
    } catch (caught) {
      if (exportGeneration.current === generation) Alert.alert('Map download unavailable', caught instanceof Error ? caught.message : 'The electrical map could not be downloaded.');
    } finally {
      if (exportGeneration.current === generation) setMapFileBusy(null);
    }
  };

  const completedMapVersionMissing = item.status === 'Completed'
    && (!Number.isSafeInteger(item.record_version_number) || (item.record_version_number ?? 0) < 1);

  const header = (
    <View>
      <Text testID={`electrical-map-installation:${installationId}`} style={[typography.title, { color: colors.foreground }]}>Installation data</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
        {item.site_name} · revision {readiness.treeRevision}
      </Text>
      <Button title={mappingExportBusy ? 'Downloading pinned mapping…' : 'Download pinned mapping'} variant="secondary"
        disabled={mappingExportBusy || !readiness.eligibility.mappingExport || !item.record_version_number || Boolean(item.is_imported_copy)}
        onPress={() => void downloadPinnedMapping()} style={{ marginTop: spacing.md }} />
      {!readiness.eligibility.mappingExport ? <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>A completed, eligible cloud version is required for the pinned mapping JSON.</Text> : null}
      <View style={styles.modeRow} accessibilityRole="tablist">
        {(['RECONCILIATION', 'VALIDATION', 'COVERAGE', 'ELECTRICAL', 'PHYSICAL'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === value }}
            onPress={() => { if (!blockWhileArranging()) setMode(value); }}
            style={[
              styles.modeButton,
              { backgroundColor: mode === value ? colors.primary : colors.muted },
            ]}
          >
            <Text style={{ color: mode === value ? colors.primaryForeground : colors.foreground, fontWeight: '700', fontSize: 12 }}>
              {value === 'RECONCILIATION'
                ? 'Reconcile'
                : value === 'VALIDATION'
                  ? 'Checks'
                : value === 'COVERAGE'
                  ? 'Coverage'
                  : value === 'ELECTRICAL'
                    ? 'Electrical'
                    : 'Physical'}
            </Text>
          </Pressable>
        ))}
      </View>
      <SearchBar value={search} onChangeText={(value) => { if (!blockWhileArranging()) setSearch(value); }} placeholder={`Search ${mode.toLocaleLowerCase()}…`} />
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
                <Text style={[typography.subheading, { color: colors.foreground }]}>Items left to confirm</Text>
                <Text
                  accessibilityRole={issuePartition.reconciliation.length ? 'alert' : 'summary'}
                  accessibilityLiveRegion={issuePartition.reconciliation.length ? 'assertive' : 'polite'}
                  style={{ color: colors.mutedForeground, marginTop: 4, lineHeight: 20 }}
                >
                  {issuePartition.reconciliation.length
                    ? `${issuePartition.reconciliation.length} explicit TBC choice${issuePartition.reconciliation.length === 1 ? '' : 's'} remain · showing ${visibleIssues.length}`
                    : 'Every explicitly deferred choice has been confirmed.'}
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
              <Badge
                label={issuePartition.reconciliation.length ? 'RECONCILE' : 'CONFIRMED'}
                tone={issuePartition.reconciliation.length ? 'tbc' : 'success'}
              />
            </View>
            <Button
              title="Reset progress baseline"
              variant="ghost"
              style={{ marginTop: spacing.sm }}
              onPress={() => setBaselineIssueKeys(currentIssueKeys)}
            />
          </Card>
        </>
      ) : mode === 'VALIDATION' ? (
        <Card style={{ marginBottom: spacing.md }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.subheading, { color: colors.foreground }]}>Completion checks</Text>
              <Text
                accessibilityRole={issuePartition.validation.length ? 'alert' : 'summary'}
                style={{ color: colors.mutedForeground, marginTop: 4, lineHeight: 20 }}
              >
                {issuePartition.validation.length
                  ? `${issuePartition.validation.filter((issue) => issue.severity === 'ERROR').length} blocking · ${issuePartition.validation.filter((issue) => issue.severity === 'WARNING').length} warning · showing ${visibleValidationIssues.length}. Only explicit TBC relationships block completion.`
                  : 'No additional local completion checks need attention.'}
              </Text>
            </View>
            <Badge
              label={issuePartition.validation.length ? 'CHECKS' : 'CLEAR'}
              tone={issuePartition.validation.some((issue) => issue.severity === 'ERROR') ? 'danger' : 'success'}
            />
          </View>
        </Card>
      ) : mode === 'PHYSICAL' ? (
        <Card style={{ marginBottom: spacing.md }}>
          <Text accessibilityRole="summary" style={[typography.subheading, { color: colors.foreground }]}>Physical inventory</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4, lineHeight: 20 }}>
            1 installation · {zones.length} zones · {boards.length} switchboards · {siteAssets.length} site assets
          </Text>
        </Card>
      ) : mode === 'ELECTRICAL' ? (
        <>
          <Card style={{ marginBottom: spacing.md }}>
            <Text accessibilityRole="summary" style={[typography.subheading, { color: colors.foreground }]}>Supply and measurement stay separate</Text>
            <Text style={{ color: colors.mutedForeground, marginTop: 4, lineHeight: 20 }}>Every known item stays visible. Only safe FED_FROM links build the supply forest; MEASURES shows confirmed channels and never changes a target's supply parent.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
              <Button title={mapFileBusy === 'png' ? 'Downloading PNG…' : 'Share PNG'} variant="secondary"
                disabled={Boolean(mappingExportBusy || mapFileBusy || item.is_imported_copy || completedMapVersionMissing)} style={{ flexGrow: 1 }}
                onPress={() => void downloadElectricalMap('png')} />
              <Button title={mapFileBusy === 'svg' ? 'Downloading SVG…' : 'Share SVG'} variant="secondary"
                disabled={Boolean(mappingExportBusy || mapFileBusy || item.is_imported_copy || completedMapVersionMissing)} style={{ flexGrow: 1 }}
                onPress={() => void downloadElectricalMap('svg')} />
            </View>
            <Text style={{ color: colors.mutedForeground, marginTop: 4, fontSize: 12 }}>
              {completedMapVersionMissing
                ? 'This Completed job has no authoritative record version, so its map cannot be downloaded as mutable live data.'
                : 'Downloads use the authenticated portal renderer and the same schematic symbol catalog.'}
            </Text>
          </Card>
          {layoutLoading ? <Text testID="electrical-map-layout-loading" style={{ color: colors.mutedForeground, marginBottom: spacing.sm }}>Loading saved electrical arrangement…</Text> : null}
          {layoutLoadError ? <Card style={{ marginBottom: spacing.sm }}>
            <Text testID="electrical-map-layout-load-error" accessibilityRole="alert" style={{ color: colors.destructive }}>Saved arrangement unavailable: {layoutLoadError}</Text>
            <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>The local automatic diagram remains available.</Text>
            <Button title="Reload saved arrangement" variant="secondary" onPress={() => setLayoutReload((current) => current + 1)} />
          </Card> : null}
          <SelectChips
            label="Electrical map view"
            value={electricalViewMode}
            options={['DIAGRAM', 'RELATIONSHIPS']}
            getLabel={(value) => value === 'DIAGRAM' ? 'Single-line diagram' : 'Relationship details'}
            onChange={(value) => { if (!blockWhileArranging()) setElectricalViewMode(value); }}
          />
        </>
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
          installationId,
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
          <Text style={{ color: colors.foreground, marginTop: 6, lineHeight: 20 }}>
            <Text style={{ fontWeight: '800' }}>Why: </Text>
            {reconciliationIssueWhy(issue)}
          </Text>
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
      {error || rowsError ? <RecordLoadState inline title="Could not refresh installation data"
        message={error ?? rowsError!} onRetry={retry} onBack={() => navigation.goBack()} /> : null}
      {mode === 'RECONCILIATION' ? (
        <FlatList
          data={visibleIssues}
          keyExtractor={(issue, index) => `${issue.code}:${issue.entityId}:${issue.field ?? ''}:${index}`}
          renderItem={issueRow}
          ListHeaderComponent={header}
          ListEmptyComponent={(
            <EmptyState
              title="Nothing left to confirm"
              subtitle={issuePartition.validation.length
                ? 'Explicit TBC choices are resolved. Optional capture does not block completion.'
                : 'All local choices are confirmed.'}
            />
          )}
          contentContainerStyle={styles.pad}
          keyboardShouldPersistTaps="handled"
        />
      ) : mode === 'VALIDATION' ? (
        <FlatList
          data={visibleValidationIssues}
          keyExtractor={(issue, index) => `${issue.code}:${issue.entityId}:${issue.field ?? ''}:${index}`}
          renderItem={issueRow}
          ListHeaderComponent={header}
          ListEmptyComponent={(
            <EmptyState
              title="No completion checks"
              subtitle="No other completion checks need attention."
            />
          )}
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
                <Text style={{ color: colors.destructive, fontWeight: '700', marginTop: 4 }}>Declared metering and exact assignments disagree. Optional follow-up; excluded from confirmed topology.</Text>
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
      ) : mode === 'ELECTRICAL' && electricalViewMode === 'DIAGRAM' ? (
        <FormScrollView contentContainerStyle={styles.pad} keyboardShouldPersistTaps="handled">
          {header}
          {electricalDiagram ? (
            <ElectricalSingleLineDiagram
              model={electricalDiagram}
              search={search}
              savedLayout={layoutSession?.savedLayout}
              retainedDraft={retainedLayoutDraft}
              onDraftChange={setRetainedLayoutDraft}
              canArrange={item.status === 'Draft' && Boolean(layoutSession) && !layoutLoading}
              layoutEditsLocked={layoutEditsLocked}
              onSaveLayout={saveMapLayout}
              onLayoutDirtyChange={layoutDirtyChanged}
              onOpenNode={(node) => {
                if (blockWhileArranging()) return;
                if (node.kind === 'BOARD') {
                  const board = boards.find((candidate) => candidate.id === node.id);
                  if (board) navigation.navigate('BoardDetail', {
                    boardId: board.id,
                    installationId,
                    zoneId: board.zone_id,
                  });
                } else if (node.kind === 'SITE_ASSET') {
                  const asset = siteAssets.find((candidate) => candidate.id === node.id);
                  if (asset) navigation.navigate('SiteAssetDetail', {
                    assetId: asset.id,
                    installationId,
                    zoneId: asset.zone_id,
                  });
                }
              }}
            />
          ) : (
            <EmptyState title="No electrical items" subtitle="Add or import an electrical item to build the diagram." />
          )}
        </FormScrollView>
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
        title="Choose meter channels for this asset"
        onClose={() => setMappingAsset(null)}
        scroll={false}
      >
        <FlatList
          data={visibleEligibleMeters}
          keyExtractor={(meter) => meter.id}
          keyboardShouldPersistTaps="handled"
          accessibilityRole="radiogroup"
          accessibilityLabel="Active meters on the supplying board"
          contentContainerStyle={styles.mappingList}
          ListHeaderComponent={(
            <View>
              <Text style={{ color: colors.foreground, fontWeight: '700', marginBottom: 8 }}>
                {mappingAsset?.display_code} · {mappingAsset?.asset_name}
              </Text>
              <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>
                Record which configured sub-circuit channels directly measure this asset. Active meters on the immediate supplying switchboard remain visible when occupied so you can inspect the reason; use the full asset editor for an explicit reassignment.
              </Text>
              <SearchBar
                value={meterSearch}
                onChangeText={setMeterSearch}
                placeholder="Search meter code, model, or serial…"
              />
              <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm }}>
                {eligibleMeterSearch.total > METER_RESULT_LIMIT
                  ? `Showing ${METER_RESULT_LIMIT} of ${eligibleMeterSearch.total} matches. Refine the search to choose another meter.`
                  : `${eligibleMeterSearch.total} active meter${eligibleMeterSearch.total === 1 ? '' : 's'} on this switchboard.`}
              </Text>
            </View>
          )}
          renderItem={({ item: meter, index }) => {
            const selected = selectedMeterId === meter.id;
            const availability = mappingMeterChoices.find((choice) => choice.meter.id === meter.id);
            const directlySelectable = availability?.channels.some((choice) => choice.selectable) ?? false;
            return (
              <Button
                title={`${meter.displayName.value} · ${meter.deviceModel} · ${meter.serialNumber || 'no serial'}${availability
                  ? ` · ${availability.availableCount} free${availability.currentCount ? ` · ${availability.currentCount} current` : ''}${availability.tbcCount ? ` · ${availability.tbcCount} TBC` : ''}${availability.occupiedCount ? ` · ${availability.occupiedCount} occupied` : ''}${availability.takeoverCount ? ` · ${availability.takeoverCount} require reassignment` : ''}${directlySelectable ? '' : ' · unavailable in quick mapping'}`
                  : ''}`}
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
                : 'No active meter is installed on the supplying board. Confirm the asset’s supplying board or install a meter on that board first.'}
            </Text>
          )}
          ListFooterComponent={selectedMeter ? (
            <View style={{ marginTop: spacing.md }}>
              <Text style={[typography.subheading, { color: colors.foreground, marginBottom: 8 }]}>Meter channels</Text>
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
                {channelGroupComplete ? ' Channel group complete.' : ' Select the required channel count before saving.'}
              </Text>
              {selectedMeterChoice?.channels.map((channelChoice, index) => {
                const { channel } = channelChoice;
                const selected = selectedChannelIds.includes(channel.id);
                const phaseLimitReached = !selected && requiredChannelCount !== null
                  && selectedChannelIds.length >= requiredChannelCount;
                const unavailable = !channelChoice.selectable || phaseLimitReached;
                const availabilityStatus = channelChoice.availability === 'AVAILABLE'
                  ? 'available'
                  : channelChoice.availability === 'CURRENT'
                    ? 'current asset mapping'
                    : channelChoice.availability === 'TBC_ASSIGNMENT'
                      ? 'claimable TBC mapping'
                      : channelChoice.availability === 'TAKEOVER_REQUIRED'
                        ? 'assigned to another asset; use the full asset editor to reassign'
                        : channelChoice.availability === 'PROTECTED_ASSIGNMENT'
                          ? 'reserved for a board or Grid boundary'
                          : channelChoice.availability === 'CAPABILITY_REQUIRED'
                            ? 'configure channel capabilities first'
                            : channelChoice.availability === 'NOT_ASSET_CHANNEL'
                              ? 'not configured as a sub-circuit channel'
                              : 'invalid device topology';
                const status = channelChoice.selectable && phaseLimitReached
                  ? `${requiredChannelCount} required channel${requiredChannelCount === 1 ? '' : 's'} already selected`
                  : availabilityStatus;
                const description = assetMeteringChannelDescription(selectedMeter, channel);
                return (
                  <Button
                    key={channel.id}
                    title={`Ch ${channel.ordinal} · ${meterChannelPurposeLabel(channel.purpose)}${description ? ` · ${description}` : ''} · ${status}`}
                    variant={selected ? 'primary' : 'secondary'}
                    disabled={unavailable}
                    style={{ marginBottom: 8 }}
                    accessibilityLabel={`Channel ${channel.ordinal}, ${meterChannelPurposeLabel(channel.purpose)}, ${status}${selected ? ', selected' : ''}`}
                    accessibilityHint={`${index + 1} of ${selectedMeter.channels.length}`}
                    accessibilityState={{ selected, disabled: unavailable }}
                    onPress={() => setSelectedChannelIds((current) => assetMeteringSelectionAfterToggle({
                      phaseMode,
                      selectedChannelIds: current,
                      channelId: channel.id,
                    }))}
                  />
                );
              })}
              <SelectChips
                label="Phase grouping"
                value={phaseMode}
                options={['SINGLE_PHASE', 'THREE_PHASE', 'OTHER']}
                getLabel={phaseGroupingLabel}
                onChange={(value) => {
                  if (value !== phaseMode) setSelectedChannelIds([]);
                  setPhaseMode(value);
                }}
              />
              <SelectChips
                label="Energy flow"
                value={direction}
                options={['', 'CONSUMPTION', 'GENERATION', 'BIDIRECTIONAL']}
                getLabel={energyFlowLabel}
                onChange={setDirection}
              />
              <Button
                title="Save channel measurement"
                disabled={!channelGroupComplete || !direction}
                style={{ marginTop: spacing.md }}
                onPress={async () => {
                  if (!mappingAsset) return;
                  try {
                    if (!direction) throw new Error('Choose the energy flow.');
                    if (!channelGroupComplete) {
                      throw new Error(requiredChannelCount === null
                        ? 'Choose at least one channel.'
                        : `Choose exactly ${requiredChannelCount} channel${requiredChannelCount === 1 ? '' : 's'} for this phase grouping.`);
                    }
                    const selectable = new Set(selectedMeterChoice?.channels
                      .filter((choice) => choice.selectable)
                      .map((choice) => choice.channel.id) ?? []);
                    if (!selectedChannelIds.every((channelId) => selectable.has(channelId))) {
                      throw new Error('A selected channel is no longer available. Review the current device mapping.');
                    }
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
