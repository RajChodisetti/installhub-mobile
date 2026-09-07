import { FormScrollView } from '../components/ui';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  canonicalInstallationRepo,
  electricalAssetsRepo,
  formsRepo,
  installationsRepo,
  siteAssetsRepo,
  zonesRepo,
} from '../repositories';
import type {
  ElectricalAsset,
  GridSupply,
  Installation,
  MeasurementAssignment,
  MeasurementDirection,
  MeasurementTarget,
  Meter,
  MeterChannelPurpose,
  SiteAsset,
  SiteAssetTypeCode,
  Zone,
} from '../types';
import { meterDeviceFromLegacy, SITE_ASSET_TYPE_LABELS } from '../domain/installationV2';
import { SITE_ASSET_TYPE_CODES } from '../types';
import { stagedMeterSiteAsset } from '../domain/meterEditorAdditions';
import { defaultMeterCustomName, provisionalDisplayCodeV2 } from '../domain/namingV2';
import {
  energyFlowLabel,
  measuredItemTypeLabel,
  meterChannelPurposeLabel,
  phaseGroupingLabel,
  structurallySavableMeterAssignments,
} from '../domain/meterCommissioning';
import { FormModal, SelectChips, WattwatcherForm, createEmptyMeter } from '../components/forms';
import { Button, Card, LoadingState, SearchBar, SectionHeader, TextField } from '../components/ui';
import { RecordLoadState } from '../components/RecordLoadState';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { createId } from '../utils';
import { boundedPickerResults } from '../domain/sourcePicker';
import { deleteRemovedLocalPhotos } from '../services';
import { apiClient, type InventoryMeter } from '../api/apiClient';
import { assignmentApprovalSignature, type AssignmentTakeoverApprovals } from '../domain/meterAssignmentTakeover';

type Props = NativeStackScreenProps<RootStackParamList, 'MeterForm'>;
type AssignmentDraft = Omit<MeasurementAssignment, 'phaseMode' | 'target' | 'direction'> & {
  phaseMode: MeasurementAssignment['phaseMode'] | '';
  target: MeasurementTarget | null;
  direction: MeasurementDirection | '';
};
type TargetCandidate = {
  key: string;
  label: string;
  subtitle: string;
  target: MeasurementTarget;
};
const TARGET_RESULT_LIMIT = 100;

function meterPhotoUris(meter: Pick<Meter, 'ww_photos'>): string[] {
  return [
    meter.ww_photos?.device_installed,
    meter.ww_photos?.switchboard_overview,
    meter.ww_photos?.labeling,
    ...(meter.ww_photos?.extra ?? []),
  ].filter((uri): uri is string => Boolean(uri));
}

function boardIsUpstreamOf(
  boards: ElectricalAsset[],
  upstreamBoardId: string,
  targetBoardId: string,
): boolean {
  const byId = new Map(boards.map((item) => [item.id, item]));
  const seen = new Set<string>();
  let currentId: string | undefined = targetBoardId;
  while (currentId && !seen.has(currentId)) {
    if (currentId === upstreamBoardId) return true;
    seen.add(currentId);
    const current = byId.get(currentId);
    currentId = current?.electrical_source?.kind === 'BOARD'
      ? current.electrical_source.boardId
      : undefined;
  }
  return false;
}

function meterBoardReachesGrid(
  boards: ElectricalAsset[],
  meterBoardId: string,
  gridSupplyId: string,
): boolean {
  const byId = new Map(boards.map((item) => [item.id, item]));
  const seen = new Set<string>();
  let current = byId.get(meterBoardId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.electrical_source?.kind === 'GRID') {
      return current.electrical_source.gridSupplyId === gridSupplyId;
    }
    current = current.electrical_source?.kind === 'BOARD'
      ? byId.get(current.electrical_source.boardId)
      : undefined;
  }
  return false;
}

export function MeterFormScreen({ navigation, route }: Props) {
  const {
    installationId,
    boardId,
    meterId,
    deviceType = 'A3RM',
    finishChannelMapping = false,
  } = route.params;
  const { colors } = useTheme();
  const [meter, setMeter] = useState<Meter | null>(null);
  const [persistedMeterPhotoUris, setPersistedMeterPhotoUris] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [lockedByCompletedForm, setLockedByCompletedForm] = useState(false);
  const [completedFormId, setCompletedFormId] = useState<string | null>(null);
  const [board, setBoard] = useState<ElectricalAsset | null>(null);
  const [boards, setBoards] = useState<ElectricalAsset[]>([]);
  const [gridSupplies, setGridSupplies] = useState<GridSupply[]>([]);
  const [assets, setAssets] = useState<SiteAsset[]>([]);
  const [installation, setInstallation] = useState<Installation | null>(null);
  const [stagedAssets, setStagedAssets] = useState<SiteAsset[]>([]);
  const [quickAssetGroupId, setQuickAssetGroupId] = useState<string | null>(null);
  const [quickAssetChannelId, setQuickAssetChannelId] = useState<string | null>(null);
  const [quickAssetZoneId, setQuickAssetZoneId] = useState('');
  const [quickAssetType, setQuickAssetType] = useState<SiteAssetTypeCode>('HVAC');
  const [quickAssetName, setQuickAssetName] = useState('');
  const [quickAssetCustomType, setQuickAssetCustomType] = useState('');
  const [invalidCapabilityChannels, setInvalidCapabilityChannels] = useState<Set<string>>(new Set());
  const [zones, setZones] = useState<Zone[]>([]);
  const [assignmentDrafts, setAssignmentDrafts] = useState<AssignmentDraft[]>([]);
  const [allAssignments, setAllAssignments] = useState<MeasurementAssignment[]>([]);
  const [baselineAssignments, setBaselineAssignments] = useState<MeasurementAssignment[]>([]);
  const [takeoverApprovals, setTakeoverApprovals] = useState<AssignmentTakeoverApprovals>({});
  const [targetSearch, setTargetSearch] = useState<Record<string, string>>({});
  const [deletionPreview, setDeletionPreview] = useState({
    assignmentIds: [] as string[],
    tbcAssetLabels: [] as string[],
    retainedCompletedFormIds: [] as string[],
    retainedEvidenceCount: 0,
  });
  const [myInventory, setMyInventory] = useState<InventoryMeter[]>([]);
  const [inventoryUnavailable, setInventoryUnavailable] = useState(false);

  useEffect(() => {
    if (meterId) return;
    let active = true;
    void apiClient.listInventoryMeters('mine')
      .then((response) => {
        if (active) setMyInventory(response.data);
      })
      .catch(() => {
        if (active) setInventoryUnavailable(true);
      });
    return () => { active = false; };
  }, [meterId]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    void (async () => {
      const board = await electricalAssetsRepo.getById(boardId);
      if (!active) return;
      if (!board || board.audit_id !== installationId) {
        setBoard(null);
        setMeter(null);
        return;
      }
      const [installation, forms, assignments, installationAssets, installationBoards, grids] = await Promise.all([
        installationsRepo.getById(board.audit_id),
        formsRepo.listByInstallation(board.audit_id),
        canonicalInstallationRepo.measurementAssignments(board.audit_id),
        siteAssetsRepo.listByInstallation(board.audit_id),
        electricalAssetsRepo.listByInstallation(board.audit_id),
        canonicalInstallationRepo.gridSupplies(board.audit_id),
      ]);
      const installationZones = await zonesRepo.listByInstallation(board.audit_id);
      if (!active) return;
      setInstallation(installation);
      if (!installation) {
        setBoard(null);
        setMeter(null);
        return;
      }
      setBoard(board);
      setBoards(installationBoards);
      setGridSupplies(grids);
      setAssets(installationAssets);
      setZones(installationZones.filter((item): item is Zone => Boolean(item)));
      setAssignmentDrafts(assignments.filter((assignment) => assignment.meterId === meterId));
      setAllAssignments(assignments);
      setBaselineAssignments(assignments.filter((assignment) => assignment.meterId === meterId));
      setReadOnly(installation?.status === 'Completed');
      const completedForm = meterId
        ? forms.find((form) => form.meter_id === meterId && form.status === 'Completed')
        : undefined;
      setLockedByCompletedForm(Boolean(completedForm));
      setCompletedFormId(completedForm?.id ?? null);
      const deletedAssignments = meterId
        ? assignments.filter((assignment) => assignment.meterId === meterId)
        : [];
      const deletedAssignmentIds = new Set(deletedAssignments.map((assignment) => assignment.id));
      const retainedForms = meterId ? forms.filter((form) => form.meter_id === meterId) : [];
      setDeletionPreview({
        assignmentIds: [...deletedAssignmentIds].sort(),
        tbcAssetLabels: installationAssets
          .filter((asset) => asset.metering_state?.kind === 'METERED' &&
            asset.metering_state.measurementAssignmentIds.some((id) => deletedAssignmentIds.has(id)) &&
            !asset.metering_state.measurementAssignmentIds.some((id) => !deletedAssignmentIds.has(id)))
          .map((asset) => `${asset.display_code ?? asset.id} (${asset.id})`)
          .sort(),
        retainedCompletedFormIds: retainedForms
          .filter((form) => form.status === 'Completed')
          .map((form) => form.id)
          .sort(),
        retainedEvidenceCount: retainedForms.reduce(
          (count, form) => count + form.attachments.length,
          0,
        ),
      });
      if (meterId) {
        const nextMeter = board.meters.find((m) => m.id === meterId) ?? null;
        setMeter(nextMeter);
        setPersistedMeterPhotoUris(nextMeter ? meterPhotoUris(nextMeter) : []);
      } else {
        const nextMeter = createEmptyMeter(deviceType);
        setMeter({
          ...nextMeter,
          ww_switchboard: {
            ...nextMeter.ww_switchboard,
            sb_name: board.asset_name,
            sb_location: board.location_description?.trim()
              || installationZones.find((item) => item.id === board.zone_id)?.zone_name
              || '',
          },
        });
        setPersistedMeterPhotoUris([]);
      }
    })().catch((caught) => {
      if (active) setLoadError(caught instanceof Error ? caught.message : 'This meter could not be loaded.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [boardId, meterId, deviceType, installationId, loadAttempt]);

  if (loading) return <LoadingState />;
  if (loadError || !installation || !meter || !board) return (
    <RecordLoadState title={meterId ? 'Meter unavailable' : 'Meter workspace unavailable'}
      message={loadError ?? (meterId
        ? 'This meter or its switchboard is no longer available in this installation.'
        : 'This switchboard is no longer available in this installation.')}
      onRetry={() => setLoadAttempt((current) => current + 1)} onBack={() => navigation.goBack()} />
  );

  const previewDevice = meterDeviceFromLegacy(board.audit_id, board, meter);
  const allAssets = [...assets, ...stagedAssets];
  const meterCustomName = meter.custom_name?.trim() || defaultMeterCustomName(
    meter.device_type,
    meter.custom_model_name,
    meter.custom_manufacturer_name,
  );
  const generatedMeterAssetId = provisionalDisplayCodeV2(
    structuredClone(installation),
    {
      zones,
      electricalAssets: boards,
      siteAssets: allAssets,
      meterDevices: boards.flatMap((item) => item.meters.map((device) => (
        meterDeviceFromLegacy(installationId, item, device)
      ))),
    },
    {
      zoneId: board.zone_id,
      customName: meterCustomName,
      fallbackType: defaultMeterCustomName(meter.device_type),
      entityKind: 'meter',
      entityTypeCode: meter.device_type === 'Other' ? 'OTHER' : meter.device_type,
      excludeId: meter.id,
      current: meterId ? previewDevice.displayName : undefined,
    },
  ).value;
  const historicalAssignmentUnchanged = (assignment: AssignmentDraft) => baselineAssignments.some((prior) => prior.id === assignment.id
    && assignmentApprovalSignature(prior) === assignmentApprovalSignature(assignment as MeasurementAssignment));
  const assetConflicts = (assetId: string) => allAssignments.filter((item) => item.meterId !== meter.id
    && item.target.kind === 'SITE_ASSET' && item.target.siteAssetId === assetId);
  // Preview allocation must stay pure: rerenders must not consume the durable
  // per-zone sequence before the staged asset is actually saved.
  const quickAssetPreview = installation && quickAssetZoneId ? provisionalDisplayCodeV2(structuredClone(installation), {
    zones, electricalAssets: boards, siteAssets: allAssets,
    meterDevices: boards.flatMap((item) => item.meters.map((device) => meterDeviceFromLegacy(installationId, item, device))),
  }, {
    zoneId: quickAssetZoneId,
    customName: quickAssetName || quickAssetCustomType || SITE_ASSET_TYPE_LABELS[quickAssetType],
    fallbackType: SITE_ASSET_TYPE_LABELS[quickAssetType],
    entityKind: 'site_asset',
    entityTypeCode: quickAssetType,
  }).value : '';
  const zoneName = (zoneId: string) => zones.find((item) => item.id === zoneId)?.zone_name ?? 'Unknown zone';
  const purposeFor = (assignment: AssignmentDraft): MeterChannelPurpose | null => {
    const purposes = new Set(
      assignment.channelIds
        .map((id) => previewDevice.channels.find((channel) => channel.id === id)?.purpose)
        .filter((purpose): purpose is MeterChannelPurpose => Boolean(purpose)),
    );
    return purposes.size === 1 ? [...purposes][0] : null;
  };
  const targetKindsFor = (assignment: AssignmentDraft): MeasurementTarget['kind'][] => {
    const purpose = purposeFor(assignment);
    if (purpose === 'MAIN_SUPPLY') return ['BOARD', 'GRID_BOUNDARY', 'TBC'];
    if (purpose === 'SUB_CIRCUIT') return ['BOARD', 'SITE_ASSET', 'TBC'];
    return ['BOARD', 'GRID_BOUNDARY', 'SITE_ASSET', 'TBC'];
  };
  const candidatesFor = (assignment: AssignmentDraft) => {
    if (!assignment.target) return { total: 0, visible: [] as TargetCandidate[], selectedPinned: false };
    const needle = (targetSearch[assignment.id] ?? '').trim().toLocaleLowerCase();
    const bound = (candidates: TargetCandidate[]) => {
      const matches = candidates.filter((candidate) => !needle ||
        `${candidate.label} ${candidate.subtitle}`.toLocaleLowerCase().includes(needle));
      const isSelected = (candidate: TargetCandidate) =>
        JSON.stringify(candidate.target) === JSON.stringify(assignment.target);
      const result = boundedPickerResults(matches, TARGET_RESULT_LIMIT, isSelected);
      const selected = candidates.find(isSelected);
      if (!selected || result.visible.some((candidate) => candidate.key === selected.key)) return result;
      return {
        ...result,
        visible: [selected, ...result.visible].slice(0, TARGET_RESULT_LIMIT),
        selectedPinned: true,
      };
    };
    if (assignment.target.kind === 'BOARD') {
      const purpose = purposeFor(assignment);
      return bound(boards
        .filter((item) => purpose === 'MAIN_SUPPLY'
          ? item.id === board.id
          : purpose === 'SUB_CIRCUIT'
            ? item.id !== board.id && boardIsUpstreamOf(boards, board.id, item.id)
            : boardIsUpstreamOf(boards, board.id, item.id))
        .map((item) => ({
          key: item.id,
          label: `${item.asset_name} · ${item.asset_type}`,
          subtitle: `${item.asset_type} · ${zoneName(item.zone_id)}`,
          target: { kind: 'BOARD' as const, boardId: item.id },
        })));
    }
    if (assignment.target.kind === 'GRID_BOUNDARY') {
      return bound(gridSupplies
        .filter((item) => meterBoardReachesGrid(boards, board.id, item.id))
        .map((item) => ({
          key: item.id,
          label: item.name,
          subtitle: item.nmi ? `NMI ${item.nmi}` : 'Grid boundary',
          target: { kind: 'GRID_BOUNDARY' as const, gridSupplyId: item.id },
        })));
    }
    if (assignment.target.kind === 'SITE_ASSET') {
      return bound(allAssets
        .filter((item) => (item.electrical_source?.kind === 'BOARD' && item.electrical_source.boardId === board.id)
          || (assignment.target?.kind === 'SITE_ASSET' && assignment.target.siteAssetId === item.id && historicalAssignmentUnchanged(assignment)))
        .map((item) => ({
          key: item.id,
          label: `${item.asset_name} · ${item.asset_type}`,
          subtitle: `${item.asset_type} · ${zoneName(item.zone_id)}${assetConflicts(item.id).length ? ' · Currently measured by another device; approval required' : ''}${item.electrical_source?.kind !== 'BOARD' || item.electrical_source.boardId !== board.id ? ' · Existing historical mapping' : ''}`,
          target: { kind: 'SITE_ASSET' as const, siteAssetId: item.id },
        })));
    }
    return { total: 0, visible: [] as TargetCandidate[], selectedPinned: false };
  };
  const updateAssignment = (
    assignmentId: string,
    transform: (current: AssignmentDraft) => AssignmentDraft,
  ) => setAssignmentDrafts((current) => current.map((item) =>
    item.id === assignmentId ? transform(item) : item));
  const chooseTarget = (assignment: AssignmentDraft, candidate: TargetCandidate) => {
    const select = () => updateAssignment(assignment.id, (current) => ({ ...current, target: candidate.target, status: 'CONFIRMED' }));
    const conflicts = candidate.target.kind === 'SITE_ASSET' ? assetConflicts(candidate.target.siteAssetId) : [];
    if (!conflicts.length || conflicts.every((conflict) => takeoverApprovals[conflict.id] === assignmentApprovalSignature(conflict))) { select(); return; }
    Alert.alert('Reassign this site asset?', `${candidate.label} is currently attached to:\n\n${conflicts.map((conflict) => {
      const owner = boards.flatMap((item) => item.meters).find((device) => device.id === conflict.meterId);
      return `${owner?.custom_name || owner?.device_id || conflict.meterId}\nDevice ID: ${conflict.meterId}\nAssignment: ${conflict.id}\nChannels: ${conflict.channelIds.join(', ')}\n${phaseGroupingLabel(conflict.phaseMode)} · ${energyFlowLabel(conflict.direction)}`;
    }).join('\n\n')}\n\nSaving moves this asset to the selected group. The previous device channels remain To be confirmed. A changed mapping requires fresh approval.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Approve reassignment', onPress: () => {
        setTakeoverApprovals((current) => ({ ...current, ...Object.fromEntries(conflicts.map((conflict) => [conflict.id, assignmentApprovalSignature(conflict)])) })); select();
      } },
    ]);
  };
  const setTargetKind = (
    assignment: AssignmentDraft,
    kind: MeasurementTarget['kind'],
  ) => {
    const target: MeasurementTarget = kind === 'BOARD'
      ? { kind, boardId: '' }
      : kind === 'GRID_BOUNDARY'
        ? { kind, gridSupplyId: '' }
        : kind === 'SITE_ASSET'
          ? { kind, siteAssetId: '' }
          : { kind: 'TBC' };
    updateAssignment(assignment.id, (current) => ({
      ...current,
      target,
      status: kind === 'TBC' ? 'TBC' : 'CONFIRMED',
    }));
  };
  const addAssignment = () => {
    const used = new Set(assignmentDrafts.flatMap((item) => item.channelIds));
    const channel = previewDevice.channels.find(
      (item) => item.purpose !== 'SPARE' && !used.has(item.id),
    );
    if (!channel) {
      Alert.alert('All channels included', 'Every non-spare channel is already included in a measured group.');
      return;
    }
    setAssignmentDrafts((current) => [...current, {
      id: createId('assignment'),
      installationId: board.audit_id,
      meterId: meter.id,
      channelIds: [channel.id],
      phaseMode: 'SINGLE_PHASE',
      target: { kind: 'TBC' },
      direction: 'CONSUMPTION',
      status: 'TBC',
    }]);
  };
  const openQuickAssetEditor = (assignmentId: string, channelId?: string) => {
    setQuickAssetGroupId(assignmentId);
    setQuickAssetChannelId(channelId ?? null);
    setQuickAssetZoneId(board.zone_id);
    setQuickAssetType('HVAC');
    setQuickAssetName('');
    setQuickAssetCustomType('');
  };
  const openQuickAssetForChannel = (channelId: string) => {
    const existing = assignmentDrafts.find((assignment) => assignment.channelIds.includes(channelId));
    const assignmentId = existing?.id ?? createId('assignment');
    openQuickAssetEditor(assignmentId, channelId);
  };
  const retainAssignmentsForChannels = (channelIds: Set<string>) => {
    setAssignmentDrafts((current) => current.map((assignment) => ({
      ...assignment,
      channelIds: assignment.channelIds.filter((channelId) => channelIds.has(channelId)),
    })));
  };

  const activeMeterChannelIds = new Set(previewDevice.channels
    .filter((channel) => channel.purpose !== 'SPARE')
    .map((channel) => channel.id));
  const activeMeterChannelCount = activeMeterChannelIds.size;
  const representedMeterChannelCount = new Set(
    assignmentDrafts.flatMap((assignment) => assignment.channelIds)
      .filter((channelId) => activeMeterChannelIds.has(channelId)),
  ).size;
  const unusedMeterChannelCount = Math.max(
    0,
    activeMeterChannelCount - representedMeterChannelCount,
  );
  const measurementGroupProblem = (assignment: AssignmentDraft): string | null => {
    if (!assignment.channelIds.length) return 'Select at least one non-spare channel.';
    if (assignment.channelIds.some((channelId) => !activeMeterChannelIds.has(channelId))) {
      return 'Remove channels that no longer exist or are now marked as spare.';
    }
    if (new Set(assignment.channelIds).size !== assignment.channelIds.length) {
      return 'Remove the duplicated channel from this group.';
    }
    if (assignment.channelIds.some((channelId) => assignmentDrafts.some(
      (candidate) => candidate.id !== assignment.id && candidate.channelIds.includes(channelId),
    ))) {
      return 'Each channel can belong to only one measurement group.';
    }
    if (!assignment.phaseMode) return 'Choose a phase grouping.';
    if (!assignment.direction) return 'Choose an energy flow.';
    if (!assignment.target) return 'Choose what the channels measure, or select To be confirmed.';
    if (assignment.phaseMode === 'SINGLE_PHASE' && assignment.channelIds.length !== 1) {
      return 'Single phase groups must contain exactly one channel.';
    }
    if (assignment.phaseMode === 'THREE_PHASE' && assignment.channelIds.length !== 3) {
      return 'Three phase groups must contain exactly three channels.';
    }
    return null;
  };
  const saveMeterAndMeasurementGroups = async () => {
    const invalidGroupIndex = assignmentDrafts.findIndex(
      (assignment) => Boolean(measurementGroupProblem(assignment)),
    );
    if (invalidGroupIndex >= 0) {
      Alert.alert(
        `Complete measurement group ${invalidGroupIndex + 1}`,
        measurementGroupProblem(assignmentDrafts[invalidGroupIndex])!,
      );
      return;
    }
    setBusy(true);
    try {
      const selectedAssetIds = new Set<string>();
      const finalizedAssignments = structurallySavableMeterAssignments(
        assignmentDrafts.map((assignment) => ({
          ...assignment,
          phaseMode: assignment.phaseMode || 'OTHER',
          direction: assignment.direction || 'CONSUMPTION',
          target: assignment.target ?? { kind: 'TBC' },
        })),
        previewDevice.channels,
      ).map((assignment): MeasurementAssignment => {
        const target = assignment.target;
        const purpose = purposeFor(assignment);
        let unresolved = !targetKindsFor(assignment).includes(target.kind);
        if (target.kind === 'BOARD') {
          unresolved ||= !boards.some((candidate) => candidate.id === target.boardId)
            || (purpose === 'MAIN_SUPPLY' ? target.boardId !== boardId
              : target.boardId === boardId || !boardIsUpstreamOf(boards, boardId, target.boardId));
        } else if (target.kind === 'GRID_BOUNDARY') {
          unresolved ||= !gridSupplies.some((grid) => grid.id === target.gridSupplyId)
            || !meterBoardReachesGrid(boards, boardId, target.gridSupplyId);
        } else if (target.kind === 'SITE_ASSET') {
          const asset = allAssets.find((item) => item.id === target.siteAssetId);
          const directlySupplied = asset?.electrical_source?.kind === 'BOARD' && asset.electrical_source.boardId === boardId;
          unresolved ||= !asset || (!directlySupplied && !historicalAssignmentUnchanged(assignment))
            || selectedAssetIds.has(target.siteAssetId);
          if (!unresolved && assetConflicts(target.siteAssetId).some((conflict) => takeoverApprovals[conflict.id] !== assignmentApprovalSignature(conflict))) {
            throw new Error('Approve the exact current device and channel group before reassigning this asset.');
          }
          if (!unresolved) selectedAssetIds.add(target.siteAssetId);
        }
        return unresolved ? { ...assignment, target: { kind: 'TBC' }, status: 'TBC' } : assignment;
      });
      await electricalAssetsRepo.saveMeterConfiguration(
        boardId,
        meter,
        finalizedAssignments,
        { stagedAssets, baselineAssignments, takeoverApprovals: Object.fromEntries(finalizedAssignments.flatMap((assignment) => assignment.target.kind === 'SITE_ASSET'
          ? assetConflicts(assignment.target.siteAssetId).filter((conflict) => takeoverApprovals[conflict.id]).map((conflict) => [conflict.id, takeoverApprovals[conflict.id]!]) : [])) },
      );
      deleteRemovedLocalPhotos(persistedMeterPhotoUris, meterPhotoUris(meter));
      setPersistedMeterPhotoUris(meterPhotoUris(meter));
      navigation.goBack();
    } catch (e) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  return <>
    <FormScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.heading, { color: colors.foreground, marginBottom: spacing.lg }]}>
        {meterId ? meterCustomName : 'Add meter'}
      </Text>
      {finishChannelMapping ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <Text accessibilityRole="alert" style={[typography.subheading, { color: colors.foreground }]}>Finish channel measurements</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 21 }}>
            The installation form is complete. Now record what every non-spare meter channel measures. For each channel or group, choose the phase grouping, energy flow, and exact switchboard, grid connection, or site asset it measures. Choose To be confirmed only when the measured item is genuinely unresolved.
          </Text>
        </Card>
      ) : null}
      {lockedByCompletedForm ? (
        <View style={{ marginBottom: spacing.md }}>
          <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm, lineHeight: 20 }}>
            Meter identity and channel definitions are fixed by a completed form. You can still update what each non-spare channel measures below. Create an amendment to change the commissioned device itself; deletion retains completed form history and evidence.
          </Text>
          <Button
            title="Create commissioning amendment"
            variant="secondary"
            disabled={readOnly || !completedFormId}
            onPress={async () => {
              if (!completedFormId) return;
              const amendment = await formsRepo.cloneAmendment(completedFormId);
              navigation.replace('FormEditor', {
                formId: amendment.id,
                installationId,
              });
            }}
          />
        </View>
      ) : null}
      {!meterId && !readOnly ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={[typography.subheading, { color: colors.foreground }]}>Choose from my inventory</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs, marginBottom: spacing.md, lineHeight: 20 }}>
            Selecting a registered meter fills its Device ID and model. It leaves your inventory when this installation is completed.
          </Text>
          {myInventory.length ? myInventory.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected: meter.device_id.trim().toUpperCase() === item.deviceId }}
              onPress={() => {
                const next = createEmptyMeter(item.deviceModel === 'OTHER' ? 'Other' : item.deviceModel);
                setMeter({
                  ...next,
                  id: meter.id,
                  ww_channels: next.ww_channels?.map((channel, index) => ({
                    ...channel,
                    id: `${meter.id}:${index + 1}`,
                  })),
                  device_id: item.deviceId,
                  custom_manufacturer_name: item.customManufacturerName ?? undefined,
                  custom_model_name: item.customModelName ?? undefined,
                  ww_switchboard: meter.ww_switchboard,
                });
                setAssignmentDrafts([]);
              }}
              style={{
                minHeight: 54,
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: meter.device_id.trim().toUpperCase() === item.deviceId ? colors.primary : colors.border,
                borderRadius: 12,
                paddingHorizontal: spacing.md,
                marginBottom: spacing.sm,
                backgroundColor: meter.device_id.trim().toUpperCase() === item.deviceId ? colors.muted : colors.card,
              }}
            >
              <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                {meter.device_id.trim().toUpperCase() === item.deviceId ? '✓ ' : ''}{item.deviceId}
              </Text>
              <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs }}>
                {item.deviceModel === 'OTHER'
                  ? `${item.customManufacturerName ?? 'Other'} ${item.customModelName ?? ''}`.trim()
                  : item.deviceModel}
              </Text>
            </Pressable>
          )) : (
            <Text style={{ color: colors.mutedForeground }}>
              {inventoryUnavailable
                ? 'Cloud inventory is unavailable. You can still enter the meter manually.'
                : 'No meters are in your inventory. Add one from the Inventory tab or enter it manually.'}
            </Text>
          )}
        </Card>
      ) : null}
      <View
        pointerEvents={readOnly || lockedByCompletedForm ? 'none' : 'auto'}
        style={{ opacity: readOnly || lockedByCompletedForm ? 0.68 : 1 }}
      >
        <WattwatcherForm
          deviceType={meter.device_type}
          data={meter}
          lockDeviceType={Boolean(meterId && meter.device_type === 'Other')}
          channelsLocked={readOnly || lockedByCompletedForm}
          generatedAssetId={generatedMeterAssetId}
          onChange={(next) => setMeter({ ...meter, ...next })}
          canAddSiteAssetForChannel={(channelId) => {
            const assignment = assignmentDrafts.find((candidate) => candidate.channelIds.includes(channelId));
            return !assignment || !assignment.target || assignment.target.kind === 'TBC';
          }}
          onAddSiteAssetForChannel={openQuickAssetForChannel}
          onChannelPurposeChange={(channelId, purpose) => {
            if (purpose !== 'SPARE') return;
            setAssignmentDrafts((current) => current.map((assignment) => ({
              ...assignment,
              channelIds: assignment.channelIds.filter((id) => id !== channelId),
            })));
          }}
          onChannelStructureChange={(channels) => retainAssignmentsForChannels(
            new Set(channels.flatMap((channel) => channel.id ? [channel.id] : [])),
          )}
          onCapabilitiesValidityChange={(id, valid) => setInvalidCapabilityChannels((current) => {
            if (current.has(id) === !valid) return current;
            const next = new Set(current); if (valid) next.delete(id); else next.add(id); return next;
          })}
        />
      </View>

      <View style={{ marginTop: spacing.xl }}>
        <SectionHeader title="What these channels measure" />
        <Text style={{ color: colors.mutedForeground, lineHeight: 20, marginBottom: spacing.md }}>
          Create a measured group for each captured load or supply. Group channels only when they measure the same thing. Unassigned channels remain available; explicit To be confirmed targets block completion.
        </Text>
        {!readOnly ? (
          <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
            <Button
              title={unusedMeterChannelCount === 0
                ? 'All non-spare channels are grouped'
                : assignmentDrafts.length
                  ? 'Add another measurement group'
                  : 'Add measurement group'}
              variant="secondary"
              disabled={busy || unusedMeterChannelCount === 0}
              onPress={addAssignment}
            />
            <Button
              title={busy ? 'Saving…' : 'Save meter and measurement groups'}
              disabled={busy || invalidCapabilityChannels.size > 0}
              onPress={() => { void saveMeterAndMeasurementGroups(); }}
            />
          </View>
        ) : null}
        {!assignmentDrafts.length ? (
          <Card style={{ marginBottom: spacing.md }}>
            <Text style={{ color: colors.mutedForeground }}>
              No channel measurements recorded yet. Add a group when its measurement is known.
            </Text>
          </Card>
        ) : null}
        {assignmentDrafts.map((assignment, index) => {
          const assignmentPurpose = purposeFor(assignment);
          const candidateResults = candidatesFor(assignment);
          const candidates = candidateResults.visible;
          const requiredInGroup = assignment.phaseMode === 'SINGLE_PHASE'
            ? 'exactly 1 channel'
            : assignment.phaseMode === 'THREE_PHASE'
              ? 'exactly 3 channels'
              : assignment.phaseMode === 'OTHER'
                ? 'at least 1 channel'
                : 'a phase grouping';
          return (
            <Card key={assignment.id} style={{ marginBottom: spacing.md }}>
              <View pointerEvents={readOnly ? 'none' : 'auto'} style={{ opacity: readOnly ? 0.68 : 1 }}>
                <SectionHeader title={`Measurement group ${index + 1}`} />
                <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>
                  {meterChannelPurposeLabel(assignmentPurpose)}
                </Text>
                <SelectChips
                  label="Phase grouping"
                  value={assignment.phaseMode}
                  options={['', 'SINGLE_PHASE', 'THREE_PHASE', 'OTHER']}
                  getLabel={phaseGroupingLabel}
                  onChange={(phaseMode) => updateAssignment(assignment.id, (current) => ({ ...current, phaseMode }))}
                />
                <SelectChips
                  label="Measured item"
                  value={assignment.target?.kind ?? ''}
                  options={['', ...targetKindsFor(assignment)]}
                  getLabel={measuredItemTypeLabel}
                  onChange={(kind) => kind
                    ? setTargetKind(assignment, kind)
                    : updateAssignment(assignment.id, (current) => ({ ...current, target: null, status: 'TBC' }))}
                />
                <SelectChips
                  label="Energy flow"
                  value={assignment.direction}
                  options={['', 'CONSUMPTION', 'GENERATION', 'BIDIRECTIONAL']}
                  getLabel={energyFlowLabel}
                  onChange={(direction) => updateAssignment(assignment.id, (current) => ({ ...current, direction }))}
                />
                {assignment.target && assignment.target.kind !== 'TBC' ? (
                  <View style={{ marginBottom: spacing.md }}>
                    <Text style={[styles.label, { color: colors.mutedForeground }]}>
                      {assignment.target.kind === 'BOARD'
                        ? 'Measured switchboard'
                        : assignment.target.kind === 'SITE_ASSET'
                          ? 'Measured site asset'
                          : 'Measured Grid boundary'}
                    </Text>
                    <SearchBar
                      value={targetSearch[assignment.id] ?? ''}
                      onChangeText={(value) => setTargetSearch((current) => ({ ...current, [assignment.id]: value }))}
                      placeholder="Search code, name, type, or zone"
                    />
                    <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm }}>
                      {candidateResults.total > TARGET_RESULT_LIMIT
                        ? `Showing ${TARGET_RESULT_LIMIT} of ${candidateResults.total} matches. Refine the search to choose another item.`
                        : `${candidateResults.total} matching item${candidateResults.total === 1 ? '' : 's'}.`}
                      {candidateResults.selectedPinned ? ' The selected item remains visible.' : ''}
                    </Text>
                    <View accessibilityRole="radiogroup" accessibilityLabel={`Measured group ${index + 1} measured item`}>
                      {candidates.map((candidate) => {
                        const selected = JSON.stringify(assignment.target) === JSON.stringify(candidate.target);
                        return (
                          <Pressable
                            key={candidate.key}
                            accessibilityRole="radio"
                            accessibilityState={{ checked: selected }}
                            onPress={() => chooseTarget(assignment, candidate)}
                            style={{
                              minHeight: 54,
                              justifyContent: 'center',
                              borderWidth: 1,
                              borderColor: selected ? colors.primary : colors.border,
                              borderRadius: 10,
                              paddingHorizontal: spacing.md,
                              marginBottom: spacing.sm,
                              backgroundColor: selected ? colors.muted : colors.card,
                            }}
                          >
                            <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                              {selected ? '✓ ' : ''}{candidate.label}
                            </Text>
                            <Text style={{ color: colors.mutedForeground, marginTop: 3 }}>{candidate.subtitle}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {!candidates.length ? (
                      <Text style={{ color: colors.mutedForeground }}>
                        No matching item found. Choose a different measured item type or To be confirmed.
                      </Text>
                    ) : null}
                  </View>
                ) : assignment.target?.kind === 'TBC' ? (
                  <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>
                    The measured item is left To be confirmed and must be resolved before the installation can be completed.
                  </Text>
                ) : null}
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Measured channels in this group</Text>
                <Text
                  accessibilityRole="summary"
                  accessibilityLiveRegion="polite"
                  style={{ color: colors.mutedForeground, marginBottom: spacing.sm, lineHeight: 20 }}
                >
                  This group needs {requiredInGroup}; {assignment.channelIds.length} selected here. {representedMeterChannelCount} of {activeMeterChannelCount} non-spare channels are included across all groups.
                </Text>
                <View accessibilityLabel={`Measured group ${index + 1} meter channel checkboxes`} style={styles.channelGrid}>
                  {previewDevice.channels.map((channel, channelIndex) => {
                    const selected = assignment.channelIds.includes(channel.id);
                    const usedElsewhere = assignmentDrafts.some(
                      (item) => item.id !== assignment.id && item.channelIds.includes(channel.id),
                    );
                    const disabled = channel.purpose === 'SPARE' || usedElsewhere;
                    return (
                      <Pressable
                        key={channel.id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected, disabled }}
                        accessibilityLabel={`Channel ${channel.ordinal}, ${meterChannelPurposeLabel(channel.purpose)}${usedElsewhere ? ', included in another measured group' : channel.purpose === 'SPARE' ? ', no measured group required' : ''}`}
                        accessibilityHint={`${channelIndex + 1} of ${previewDevice.channels.length}. ${disabled ? usedElsewhere ? 'Unavailable because another measured group uses it.' : 'Unavailable because spare channels do not need a measured item.' : 'Double tap to include or remove this channel.'}`}
                        disabled={disabled}
                        onPress={() => {
                          updateAssignment(assignment.id, (current) => {
                            if (selected) {
                              return { ...current, channelIds: current.channelIds.filter((id) => id !== channel.id) };
                            }
                            const currentPurpose = purposeFor(current);
                            if (currentPurpose && currentPurpose !== channel.purpose) {
                              Alert.alert('Channels measure different things', 'A measured group cannot mix main-supply and sub-circuit channels. Create a separate group instead.');
                              return current;
                            }
                            const next = { ...current, channelIds: [...current.channelIds, channel.id] };
                            if (channel.purpose === 'MAIN_SUPPLY' && next.target && !['BOARD', 'GRID_BOUNDARY', 'TBC'].includes(next.target.kind)) {
                              return { ...next, target: null, status: 'TBC' };
                            }
                            if (channel.purpose === 'SUB_CIRCUIT' && next.target?.kind === 'GRID_BOUNDARY') {
                              return { ...next, target: null, status: 'TBC' };
                            }
                            return next;
                          });
                        }}
                        style={{
                          minHeight: 48,
                          minWidth: 92,
                          justifyContent: 'center',
                          borderWidth: 1,
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.muted : colors.card,
                          opacity: disabled ? 0.45 : 1,
                          borderRadius: 10,
                          paddingHorizontal: spacing.sm,
                          paddingVertical: spacing.xs,
                        }}
                      >
                        <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                          {selected ? '✓ ' : ''}Ch {channel.ordinal}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 2 }}>
                          {meterChannelPurposeLabel(channel.purpose)}{usedElsewhere ? ' · in another group' : ''}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <Button
                  title="Create a new site asset for this group"
                  variant="secondary"
                  disabled={readOnly || busy || purposeFor(assignment) !== 'SUB_CIRCUIT'}
                  onPress={() => openQuickAssetEditor(assignment.id)}
                />
                <Button
                  title="Remove measured group"
                  variant="danger"
                  onPress={() => setAssignmentDrafts((current) => current.filter((item) => item.id !== assignment.id))}
                />
              </View>
            </Card>
          );
        })}
        {!readOnly ? (
          <Button
            title={unusedMeterChannelCount > 0
              ? 'Add another measurement group'
              : 'All non-spare channels are grouped'}
            variant="secondary"
            disabled={busy || unusedMeterChannelCount === 0}
            onPress={addAssignment}
          />
        ) : null}
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 20 }}
        >
          {representedMeterChannelCount} of {activeMeterChannelCount} non-spare channels are grouped. Saving keeps every measurement group together with this meter.
        </Text>
      </View>
      <Button
        title={busy ? 'Saving…' : 'Save meter and measurement groups'}
        disabled={busy || readOnly || invalidCapabilityChannels.size > 0}
        style={{ marginTop: spacing.lg }}
        onPress={() => { void saveMeterAndMeasurementGroups(); }}
      />
      {meterId ? (
        <Button
          title="Delete meter"
          variant="danger"
          disabled={readOnly || busy}
          style={{ marginTop: spacing.md }}
          onPress={() => {
            Alert.alert(
              'Delete meter?',
              [
                deletionPreview.assignmentIds.length
                  ? `${deletionPreview.assignmentIds.length} active assignment(s) will be removed:\n${deletionPreview.assignmentIds.join('\n')}`
                  : 'No active assignments depend on this meter.',
                deletionPreview.tbcAssetLabels.length
                  ? `${deletionPreview.tbcAssetLabels.length} affected asset(s) will become TBC:\n${deletionPreview.tbcAssetLabels.join('\n')}`
                  : 'No asset will become TBC.',
                deletionPreview.retainedCompletedFormIds.length
                  ? `${deletionPreview.retainedCompletedFormIds.length} completed form version(s) stay retained:\n${deletionPreview.retainedCompletedFormIds.join('\n')}\n${deletionPreview.retainedEvidenceCount} evidence attachment(s) stay retained.`
                  : `No completed form version is linked. ${deletionPreview.retainedEvidenceCount} evidence attachment(s) stay retained.`,
              ].join('\n\n'),
              [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  setBusy(true);
                  try {
                    const board = await electricalAssetsRepo.getById(boardId);
                    if (!board) throw new Error('Board not found');
                    const installation = await installationsRepo.getById(board.audit_id);
                    if (installation?.status === 'Completed') {
                      throw new Error('Reopen this completed installation before deleting its meter.');
                    }
                    const meters = board.meters.filter((m) => m.id !== meterId);
                    await electricalAssetsRepo.update(boardId, {
                      meters,
                      meter_present: meters.length > 0,
                    });
                    deleteRemovedLocalPhotos([
                      ...persistedMeterPhotoUris,
                      ...meterPhotoUris(meter),
                    ], []);
                    navigation.goBack();
                  } catch (error) {
                    Alert.alert('Meter not deleted', error instanceof Error ? error.message : String(error));
                  } finally {
                    setBusy(false);
                  }
                },
              },
              ],
            );
          }}
        />
      ) : null}
    </FormScrollView>
    <FormModal visible={Boolean(quickAssetGroupId)} title="Add a site asset from this meter" onClose={() => {
      setQuickAssetGroupId(null);
      setQuickAssetChannelId(null);
    }}>
      <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>
        {quickAssetChannelId
          ? 'Create the physical asset and attach this sub-circuit channel to it in the same meter draft.'
          : 'Create the physical asset and select it for this measurement group.'}
      </Text>
      <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>Its confirmed electrical supply will be {board.asset_name}. The asset and its measurement assignment are saved atomically when you save the meter.</Text>
      <SelectChips label="Physical zone" value={quickAssetZoneId} options={zones.map((zone) => zone.id)} getLabel={(id) => zoneName(id)} onChange={setQuickAssetZoneId} />
      <SelectChips label="Asset type" value={quickAssetType} options={[...SITE_ASSET_TYPE_CODES]} getLabel={(type) => SITE_ASSET_TYPE_LABELS[type]} onChange={setQuickAssetType} />
      {quickAssetType === 'OTHER' ? <TextField label="Custom asset type" value={quickAssetCustomType} onChangeText={setQuickAssetCustomType} /> : null}
      <TextField label="Site asset name" maxLength={64} value={quickAssetName} placeholder={quickAssetCustomType || SITE_ASSET_TYPE_LABELS[quickAssetType]} onChangeText={setQuickAssetName} />
      <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>Generated asset ID preview: {quickAssetPreview || 'Choose a physical zone'}</Text>
      <Button title="Create and select asset" disabled={!quickAssetZoneId || busy} onPress={() => {
        if (!quickAssetGroupId) return;
        try {
          if (!zones.some((zone) => zone.id === quickAssetZoneId)) throw new Error('Choose an available physical zone.');
          const created = stagedMeterSiteAsset({ id: createId('site'), installationId, zoneId: quickAssetZoneId, boardId, name: quickAssetName, typeCode: quickAssetType, customType: quickAssetCustomType, timestamp: new Date().toISOString() });
          setStagedAssets((current) => [...current, created]);
          setAssignmentDrafts((current) => {
            const existingIndex = current.findIndex((assignment) => assignment.id === quickAssetGroupId);
            if (existingIndex >= 0) {
              return current.map((assignment, index) => index === existingIndex ? {
                ...assignment,
                target: { kind: 'SITE_ASSET', siteAssetId: created.id },
                status: 'CONFIRMED',
              } : assignment);
            }
            return [...current, {
              id: quickAssetGroupId,
              installationId: board.audit_id,
              meterId: meter.id,
              channelIds: quickAssetChannelId ? [quickAssetChannelId] : [],
              phaseMode: 'SINGLE_PHASE',
              target: { kind: 'SITE_ASSET', siteAssetId: created.id },
              direction: 'CONSUMPTION',
              status: 'CONFIRMED',
            }];
          });
          setQuickAssetGroupId(null);
          setQuickAssetChannelId(null);
        } catch (cause) { Alert.alert('Asset not added', cause instanceof Error ? cause.message : 'Check the asset details.'); }
      }} />
    </FormModal>
  </>;
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '700', marginBottom: spacing.sm },
  channelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
});
