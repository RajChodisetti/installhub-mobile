import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
  MeasurementAssignment,
  MeasurementDirection,
  MeasurementTarget,
  Meter,
  MeterChannelPurpose,
  SiteAsset,
  Zone,
} from '../types';
import { meterDeviceFromLegacy } from '../domain/installationV2';
import {
  energyFlowLabel,
  measuredItemTypeLabel,
  meterChannelPurposeLabel,
  phaseGroupingLabel,
  siteAssetTargetIdsOwnedByOtherMeters,
} from '../domain/meterCommissioning';
import { SelectChips, WattwatcherForm, createEmptyMeter } from '../components/forms';
import { Button, Card, LoadingState, SearchBar, SectionHeader } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { createId } from '../utils';
import { boundedPickerResults } from '../domain/sourcePicker';
import { deleteRemovedLocalPhotos } from '../services';

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
  const [busy, setBusy] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [lockedByCompletedForm, setLockedByCompletedForm] = useState(false);
  const [completedFormId, setCompletedFormId] = useState<string | null>(null);
  const [board, setBoard] = useState<ElectricalAsset | null>(null);
  const [boards, setBoards] = useState<ElectricalAsset[]>([]);
  const [gridSupplies, setGridSupplies] = useState<GridSupply[]>([]);
  const [assets, setAssets] = useState<SiteAsset[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [assignmentDrafts, setAssignmentDrafts] = useState<AssignmentDraft[]>([]);
  const [siteAssetIdsOwnedByOtherMeters, setSiteAssetIdsOwnedByOtherMeters] = useState<Set<string>>(new Set());
  const [targetSearch, setTargetSearch] = useState<Record<string, string>>({});
  const [deletionPreview, setDeletionPreview] = useState({
    assignmentIds: [] as string[],
    tbcAssetLabels: [] as string[],
    retainedCompletedFormIds: [] as string[],
    retainedEvidenceCount: 0,
  });

  useEffect(() => {
    (async () => {
      const board = await electricalAssetsRepo.getById(boardId);
      if (!board) {
        setLoading(false);
        return;
      }
      if (board.audit_id !== installationId) {
        Alert.alert('Meter unavailable', 'This meter does not belong to the selected installation.');
        navigation.goBack();
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
      const installationZones = await Promise.all(
        [...new Set(installationBoards.map((item) => item.zone_id).concat(installationAssets.map((item) => item.zone_id)))]
          .map((id) => zonesRepo.getById(id)),
      );
      setBoard(board);
      setBoards(installationBoards);
      setGridSupplies(grids);
      setAssets(installationAssets);
      setZones(installationZones.filter((item): item is Zone => Boolean(item)));
      setAssignmentDrafts(assignments.filter((assignment) => assignment.meterId === meterId));
      setSiteAssetIdsOwnedByOtherMeters(siteAssetTargetIdsOwnedByOtherMeters(assignments, meterId));
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
        const nextMeter = board.meters.find((m) => m.id === meterId) ?? createEmptyMeter(deviceType);
        setMeter(nextMeter);
        setPersistedMeterPhotoUris(meterPhotoUris(nextMeter));
      } else {
        const nextMeter = createEmptyMeter(deviceType);
        setMeter(nextMeter);
        setPersistedMeterPhotoUris([]);
      }
      setLoading(false);
    })();
  }, [boardId, meterId, deviceType, installationId, navigation]);

  if (loading || !meter || !board) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  const previewDevice = meterDeviceFromLegacy(board.audit_id, board, meter);
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
      return bound(assets
        .filter((item) => item.electrical_source?.kind === 'BOARD' &&
          boardIsUpstreamOf(boards, board.id, item.electrical_source.boardId) &&
          !siteAssetIdsOwnedByOtherMeters.has(item.id))
        .map((item) => ({
          key: item.id,
          label: `${item.asset_name} · ${item.asset_type}`,
          subtitle: `${item.asset_type} · ${zoneName(item.zone_id)}`,
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
      phaseMode: '',
      target: null,
      direction: '',
      status: 'TBC',
    }]);
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.heading, { color: colors.foreground, marginBottom: spacing.lg }]}>
        {meter.device_type === 'Other' ? 'Other Meter' : `Wattwatcher ${meter.device_type}`}
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
      <View
        pointerEvents={readOnly || lockedByCompletedForm ? 'none' : 'auto'}
        style={{ opacity: readOnly || lockedByCompletedForm ? 0.68 : 1 }}
      >
        <WattwatcherForm
          deviceType={meter.device_type}
          data={meter}
          lockDeviceType={deviceType === 'Other'}
          onChange={(next) => setMeter({ ...meter, ...next })}
        />
      </View>

      <View style={{ marginTop: spacing.xl }}>
        <SectionHeader title="What each channel measures" actionLabel={readOnly ? undefined : '+ Add group'} onAction={readOnly ? undefined : addAssignment} />
        <Text style={{ color: colors.mutedForeground, lineHeight: 20, marginBottom: spacing.md }}>
          Create one measured group for each load or supply. Group channels only when they measure the same thing, then choose the phase grouping, energy flow, and measured item. Every non-spare channel must appear once; spare channels need no group.
        </Text>
        {!assignmentDrafts.length ? (
          <Card style={{ marginBottom: spacing.md }}>
            <Text style={{ color: colors.mutedForeground }}>
              No channel measurements recorded yet. Add a group for every non-spare channel.
            </Text>
          </Card>
        ) : null}
        {assignmentDrafts.map((assignment, index) => {
          const assignmentPurpose = purposeFor(assignment);
          const candidateResults = candidatesFor(assignment);
          const candidates = candidateResults.visible;
          const activeChannelCount = previewDevice.channels.filter((channel) => channel.purpose !== 'SPARE').length;
          const representedChannelCount = new Set(assignmentDrafts.flatMap((item) => item.channelIds)).size;
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
                <SectionHeader title={`Measured group ${index + 1}`} />
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
                  label="Energy flow"
                  value={assignment.direction}
                  options={['', 'CONSUMPTION', 'GENERATION', 'BIDIRECTIONAL']}
                  getLabel={energyFlowLabel}
                  onChange={(direction) => updateAssignment(assignment.id, (current) => ({ ...current, direction }))}
                />
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Meter channels</Text>
                <Text
                  accessibilityRole="summary"
                  accessibilityLiveRegion="polite"
                  style={{ color: colors.mutedForeground, marginBottom: spacing.sm, lineHeight: 20 }}
                >
                  This group needs {requiredInGroup}; {assignment.channelIds.length} selected here. {representedChannelCount} of {activeChannelCount} non-spare channels are included across all groups.
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
                <SelectChips
                  label="What these channels measure"
                  value={assignment.target?.kind ?? ''}
                  options={['', ...targetKindsFor(assignment)]}
                  getLabel={measuredItemTypeLabel}
                  onChange={(kind) => kind
                    ? setTargetKind(assignment, kind)
                    : updateAssignment(assignment.id, (current) => ({ ...current, target: null, status: 'TBC' }))}
                />
                {assignment.target && assignment.target.kind !== 'TBC' ? (
                  <View style={{ marginBottom: spacing.md }}>
                    <SearchBar
                      value={targetSearch[assignment.id] ?? ''}
                      onChangeText={(value) => setTargetSearch((current) => ({ ...current, [assignment.id]: value }))}
                      placeholder="Search switchboards or site assets"
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
                            onPress={() => updateAssignment(assignment.id, (current) => ({
                              ...current,
                              target: candidate.target,
                              status: 'CONFIRMED',
                            }))}
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
                <Button
                  title="Remove measured group"
                  variant="danger"
                  onPress={() => setAssignmentDrafts((current) => current.filter((item) => item.id !== assignment.id))}
                />
              </View>
            </Card>
          );
        })}
      </View>
      <Button
        title={busy ? 'Saving…' : 'Save device & channel measurements'}
        disabled={busy || readOnly}
        style={{ marginTop: spacing.lg }}
        onPress={async () => {
          setBusy(true);
          try {
            const finalizedAssignments: MeasurementAssignment[] = assignmentDrafts.map((assignment, index) => {
              if (!assignment.phaseMode) {
                throw new Error(`Choose the phase grouping for measured group ${index + 1}.`);
              }
              if (!assignment.direction) {
                throw new Error(`Choose the energy flow for measured group ${index + 1}.`);
              }
              if (!assignment.target) {
                throw new Error(`Choose what the channels measure for measured group ${index + 1}.`);
              }
              if (
                (assignment.target.kind === 'BOARD' && !assignment.target.boardId) ||
                (assignment.target.kind === 'GRID_BOUNDARY' && !assignment.target.gridSupplyId) ||
                (assignment.target.kind === 'SITE_ASSET' && !assignment.target.siteAssetId)
              ) {
                throw new Error(`Choose the exact switchboard, grid connection, or site asset for measured group ${index + 1}.`);
              }
              return {
                ...assignment,
                phaseMode: assignment.phaseMode,
                target: assignment.target,
                direction: assignment.direction,
                status: assignment.target.kind === 'TBC' ? 'TBC' : 'CONFIRMED',
              };
            });
            if (!meter.device_id.trim()) {
              throw new Error('Device ID / serial is required.');
            }
            if (meter.device_type === 'Other') {
              if (!meter.custom_manufacturer_name?.trim() || !meter.custom_model_name?.trim()) {
                throw new Error('Custom meters require manufacturer and model.');
              }
              if (!(meter.ww_channels?.length)) {
                throw new Error('Declare at least one channel for this custom meter.');
              }
              const missingCapabilities = meter.ww_channels.findIndex(
                (channel) => !channel.capabilities || Object.keys(channel.capabilities).length === 0,
              );
              if (missingCapabilities >= 0) {
                throw new Error(`Declare capabilities for custom meter channel ${missingCapabilities + 1}.`);
              }
              const invalidOrdinal = meter.ww_channels.findIndex(
                (channel) => !Number.isSafeInteger(channel.ordinal) || (channel.ordinal ?? 0) < 1,
              );
              if (invalidOrdinal >= 0) {
                throw new Error(`Custom meter channel ${invalidOrdinal + 1} requires a stable positive ordinal.`);
              }
            }
            await electricalAssetsRepo.saveMeterConfiguration(
              boardId,
              meter,
              finalizedAssignments,
            );
            deleteRemovedLocalPhotos(persistedMeterPhotoUris, meterPhotoUris(meter));
            setPersistedMeterPhotoUris(meterPhotoUris(meter));
            navigation.goBack();
          } catch (e) {
            Alert.alert('Error', e instanceof Error ? e.message : 'Save failed');
          } finally {
            setBusy(false);
          }
        }}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '700', marginBottom: spacing.sm },
  channelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
});
