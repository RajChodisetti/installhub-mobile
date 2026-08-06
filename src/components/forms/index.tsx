import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type {
  BoardTypeCode,
  ElectricalAsset,
  ElectricalSource,
  GridSupply,
  Installation,
  MeasurementAssignment,
  MeasurementDirection,
  Meter,
  MeterDevice,
  MeterDeviceType,
  SiteAsset,
  SiteAssetTypeCode,
  WattwatcherChannel,
  Zone,
} from '../../types';
import { BOARD_TYPE_CODES, METER_DEVICE_TYPES, SITE_ASSET_TYPE_CODES } from '../../types';
import {
  BOARD_TYPE_LABELS,
  SITE_ASSET_TYPE_LABELS,
  boardTypeCode,
  boardTypeFromCode,
  cycleSafeBoardCandidates,
  normalizedSiteCode,
  siteAssetTypeCode,
  siteAssetTypeFromCode,
} from '../../domain/installationV2';
import { createId } from '../../utils';
import { useTheme } from '../../context/AppProviders';
import {
  Button,
  Card,
  PhotoThumbnailGrid,
  SearchBar,
  TextArea,
  TextField,
  SectionHeader,
} from '../ui';
import { BarcodeScanField, withLegacyOption } from '../BarcodeScanField';
import {
  channelAfterPurposeChange,
  channelsAfterDeviceTypeChange,
  energyFlowLabel,
  meterChannelPurposeLabel,
  phaseGroupingLabel,
  showsWattwatchersCommissioningSections,
} from '../../domain/meterCommissioning';
import { radii, spacing, typography } from '../../theme';
import { validateInstallationIdentity } from '../../domain/installationValidation';
import {
  meteringRemovalPreview,
  resolveDeviceCommissioningDetour,
} from '../../domain/assetMeteringWorkflow';
import {
  SOURCE_BOARD_RESULT_LIMIT,
  inheritedSourceForQuickSwitchboard,
  searchSourceBoards,
  sourceKeyAfterKindSelection,
  type QuickSwitchboardDetails,
} from '../../domain/sourcePicker';
import {
  clearSiteAssetEditorDraft,
  loadSiteAssetEditorDraft,
  saveSiteAssetEditorDraft,
  siteAssetEditorDraftScope,
  type SiteAssetEditorDraftSnapshot,
} from '../../services/siteAssetEditorDraft';
import { booleanConsequenceHint } from '../../domain/accessibilityCopy';
import { searchEligibleMeters } from '../../domain/meterSearch';
import {
  DISPLAY_CODE_MAX_LENGTH,
  defaultMeterCustomName,
  nameAfterTypeChange,
} from '../../domain/namingV2';
import {
  deleteRemovedLocalPhotos,
  pickLocalPhoto,
  takeLocalPhoto,
} from '../../services';

const ELIGIBLE_METER_RESULT_LIMIT = 100;

export function SelectChips<T extends string>({
  label,
  value,
  options,
  onChange,
  getLabel = (option) => option,
}: {
  label: string;
  value: T;
  options: T[];
  onChange: (v: T) => void;
  getLabel?: (v: T) => string;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={[typography.label, { color: colors.mutedForeground, marginBottom: 8 }]}>{label}</Text>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}
      >
        {options.map((opt, index) => {
          const active = opt === value;
          return (
            <Pressable
              key={opt}
              onPress={() => onChange(opt)}
              accessibilityRole="radio"
              accessibilityLabel={`${label}: ${getLabel(opt)}`}
              accessibilityHint={`${index + 1} of ${options.length}${active ? ', selected' : ''}`}
              accessibilityState={{ checked: active }}
              style={{
                paddingHorizontal: 10,
                minHeight: 44,
                justifyContent: 'center',
                paddingVertical: 10,
                borderRadius: radii.full,
                backgroundColor: active ? colors.primary : colors.muted,
              }}
            >
              <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontSize: 12, fontWeight: '600' }}>
                {getLabel(opt)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function BoolRow({
  label,
  value,
  onChange,
  accessibilityHint,
}: {
  label: string;
  value?: boolean;
  onChange: (v: boolean) => void;
  accessibilityHint?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: colors.border,
      }}
    >
      <Text style={{ flex: 1, color: colors.foreground, paddingRight: 12 }}>{label}</Text>
      <Switch
        value={!!value}
        onValueChange={onChange}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={accessibilityHint ?? booleanConsequenceHint(label, Boolean(value))}
        accessibilityState={{ checked: Boolean(value) }}
      />
    </View>
  );
}

function PhotoAttachmentField({
  label,
  uris,
  onChange,
  single = false,
}: {
  label: string;
  uris: string[];
  onChange: (uris: string[]) => void;
  single?: boolean;
}) {
  const { colors } = useTheme();
  const [photoBusy, setPhotoBusy] = useState(false);

  const addPhoto = async (source: 'camera' | 'library') => {
    setPhotoBusy(true);
    try {
      const uri = source === 'camera' ? await takeLocalPhoto() : await pickLocalPhoto();
      if (uri) onChange(single ? [uri] : [...uris, uri]);
    } catch (error) {
      Alert.alert(
        'Photo not added',
        error instanceof Error ? error.message : 'The photo could not be added.',
      );
    } finally {
      setPhotoBusy(false);
    }
  };

  const confirmRemove = (uri: string) => {
    Alert.alert('Remove photo?', undefined, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => onChange(single ? [] : uris.filter((item) => item !== uri)),
      },
    ]);
  };

  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={[typography.label, { color: colors.mutedForeground, marginBottom: spacing.sm }]}>
        {label}
      </Text>
      {uris.length ? (
        <PhotoThumbnailGrid uris={uris} onRemove={confirmRemove} />
      ) : (
        <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm }}>
          No photo attached.
        </Text>
      )}
      <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
        <Button
          title={photoBusy
            ? 'Opening…'
            : uris.length
              ? single ? 'Retake photo' : 'Take another photo'
              : 'Take photo'}
          disabled={photoBusy}
          onPress={() => { void addPhoto('camera'); }}
          style={{ flex: 1 }}
        />
        <Button
          title={uris.length
            ? single ? 'Replace from library' : 'Choose another photo'
            : 'Choose photo'}
          variant="secondary"
          disabled={photoBusy}
          onPress={() => { void addPhoto('library'); }}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

export function InstallationForm({
  initial,
  onSubmit,
  submitLabel = 'Save',
}: {
  initial?: Partial<Installation>;
  onSubmit: (values: {
    client_name: string;
    site_name: string;
    site_code: string;
    site_address: string;
    inspector_name: string;
    audit_date: string;
    timezone?: string;
  }) => Promise<void> | void;
  submitLabel?: string;
}) {
  const { colors } = useTheme();
  const [client_name, setClient] = useState(initial?.client_name ?? '');
  const [site_name, setSite] = useState(initial?.site_name ?? '');
  const [site_code, setSiteCode] = useState(
    initial?.site_code?.trim() || normalizedSiteCode(initial?.site_name ?? ''),
  );
  const siteCodeEdited = useRef(Boolean(initial?.site_code?.trim()));
  const [site_address, setAddress] = useState(initial?.site_address ?? '');
  const [inspector_name, setInspector] = useState(initial?.inspector_name ?? '');
  const [audit_date, setDate] = useState(initial?.audit_date ?? new Date().toISOString().slice(0, 10));
  const [timezone, setTimezone] = useState(
    initial?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [busy, setBusy] = useState(false);
  const [validationErrors, setValidationErrors] = useState<ReturnType<typeof validateInstallationIdentity>>([]);
  const errorFor = (field: string) => validationErrors.find((error) => error.field === field)?.message;

  return (
    <View>
      <TextField label="Client name" value={client_name} error={errorFor('client_name')} onChangeText={setClient} />
      <TextField
        label="Site name"
        value={site_name}
        error={errorFor('site_name')}
        onChangeText={(value) => {
          setSite(value);
          if (!siteCodeEdited.current) setSiteCode(normalizedSiteCode(value));
        }}
      />
      <TextField
        label="Installation short code"
        accessibilityHint="Used as the first segment of generated board, asset, and meter codes"
        value={site_code}
        error={errorFor('site_code')}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={16}
        onChangeText={(value) => {
          siteCodeEdited.current = true;
          setSiteCode(value.toUpperCase());
        }}
      />
      <TextArea label="Site address" value={site_address} error={errorFor('site_address')} onChangeText={setAddress} />
      <TextField label="Inspector" value={inspector_name} error={errorFor('inspector_name')} onChangeText={setInspector} />
      <TextField label="Audit date (YYYY-MM-DD)" value={audit_date} error={errorFor('audit_date')} onChangeText={setDate} />
      <TextField
        label="Installation timezone"
        accessibilityHint="Use an IANA timezone such as Australia/Sydney"
        value={timezone}
        error={errorFor('timezone')}
        onChangeText={setTimezone}
      />
      {validationErrors.length ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={{ color: colors.destructive, marginBottom: spacing.md, lineHeight: 20 }}
        >
          {validationErrors.length} installation detail{validationErrors.length === 1 ? '' : 's'} need attention. Correct the labelled fields above.
        </Text>
      ) : null}
      <Button
        title={busy ? 'Saving…' : submitLabel}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            const values = {
              client_name: client_name.trim(),
              site_name: site_name.trim(),
              site_code: site_code.trim().toUpperCase(),
              site_address: site_address.trim(),
              inspector_name: inspector_name.trim(),
              audit_date: audit_date.trim(),
              timezone: timezone.trim(),
            };
            const errors = validateInstallationIdentity(values);
            if (errors.length) {
              setValidationErrors(errors);
              return;
            }
            setValidationErrors([]);
            await onSubmit(values);
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}

export function ElectricalAssetForm({
  initial,
  sourceBoards = [],
  gridSupplies = [],
  zones = [],
  onSubmit,
}: {
  initial?: Partial<ElectricalAsset>;
  sourceBoards?: ElectricalAsset[];
  gridSupplies?: GridSupply[];
  zones?: Zone[];
  onSubmit: (values: Omit<ElectricalAsset, 'id' | 'created_at' | 'updated_at' | 'meters' | 'extra_photos'> & {
    meters?: Meter[];
    extra_photos?: string[];
  }, options: { commissionMeter: boolean; removeMeters: boolean }) => Promise<void> | void;
}) {
  const { colors } = useTheme();
  const initialTypeCode = initial?.type_code ?? boardTypeCode(initial?.asset_type ?? 'DB');
  const initialDefaultName = initialTypeCode === 'OTHER'
    ? initial?.custom_type_name?.trim() || BOARD_TYPE_LABELS[initialTypeCode]
    : BOARD_TYPE_LABELS[initialTypeCode];
  const [asset_name, setName] = useState(initial?.asset_name?.trim() || initialDefaultName);
  const nameEdited = useRef(Boolean(initial?.asset_name?.trim()));
  const display_code = initial?.display_code ?? '';
  const customCode = Boolean(initial?.display_code_meta?.isOverridden);
  const [type_code, setTypeCode] = useState<BoardTypeCode>(
    initialTypeCode,
  );
  const [custom_type_name, setCustomTypeName] = useState(initial?.custom_type_name ?? '');
  const [location_description, setLoc] = useState(initial?.location_description ?? '');
  const [photo, setPhoto] = useState(initial?.photo ?? '');
  const [extra_photos, setExtraPhotos] = useState(initial?.extra_photos ?? []);
  const [sub_circuits_description, setSubCircuitsDescription] = useState(
    initial?.sub_circuits_description ?? '',
  );
  const [amperage_rating, setAmps] = useState(initial?.amperage_rating ?? '');
  const [site_nmi, setNmi] = useState(initial?.site_nmi ?? '');
  const initialSource = initial?.electrical_source ?? (
    initial?.electrical_parent_tbc
      ? { kind: 'TBC' as const }
      : initial?.electrical_parent_id
        ? { kind: 'BOARD' as const, boardId: initial.electrical_parent_id }
        : { kind: 'TBC' as const }
  );
  const [sourceKey, setSourceKey] = useState(
    initialSource.kind === 'GRID'
      ? `GRID:${initialSource.gridSupplyId}`
      : initialSource.kind === 'BOARD'
        ? `BOARD:${initialSource.boardId}`
        : 'TBC',
  );
  const [comments, setComments] = useState(initial?.comments ?? '');
  const [parentSearch, setParentSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const parentCandidateResults = useMemo(() => {
    const safe = cycleSafeBoardCandidates(sourceBoards, initial?.id);
    return searchSourceBoards(
      safe,
      zones,
      parentSearch,
      SOURCE_BOARD_RESULT_LIMIT,
      sourceKey.startsWith('BOARD:') ? sourceKey.slice(6) : undefined,
    );
  }, [initial?.id, parentSearch, sourceBoards, sourceKey, zones]);
  const parentCandidates = parentCandidateResults.visible;
  const sourceKind = sourceKey === 'TBC'
    ? 'TBC'
    : sourceKey.startsWith('GRID:')
      ? 'GRID'
      : 'BOARD';

  return (
    <View>
      <TextField
        label={`Board name (${DISPLAY_CODE_MAX_LENGTH} characters max)`}
        value={asset_name}
        maxLength={DISPLAY_CODE_MAX_LENGTH}
        error={asset_name.trim().length > DISPLAY_CODE_MAX_LENGTH
          ? `Use ${DISPLAY_CODE_MAX_LENGTH} characters or fewer.`
          : undefined}
        onChangeText={(value) => {
          nameEdited.current = true;
          setName(value);
        }}
      />
      <SelectChips
        label="Board type"
        value={type_code}
        options={BOARD_TYPE_CODES}
        getLabel={(value) => BOARD_TYPE_LABELS[value]}
        onChange={(value) => {
          if (!nameEdited.current) setName(BOARD_TYPE_LABELS[value]);
          setTypeCode(value);
        }}
      />
      {type_code === 'OTHER' ? (
        <TextField label="Custom board type" value={custom_type_name} onChangeText={(value) => {
          setCustomTypeName(value);
          if (!nameEdited.current) {
            setName((value.trim() || BOARD_TYPE_LABELS.OTHER).slice(0, DISPLAY_CODE_MAX_LENGTH));
          }
        }} />
      ) : null}
      <SelectChips
        label="Electrical source type"
        value={sourceKind}
        options={['GRID', 'BOARD', 'TBC']}
        getLabel={(value) => value === 'GRID' ? 'Grid supply' : value === 'BOARD' ? 'Parent board' : 'To be confirmed'}
        onChange={(value) => {
          if (value === 'TBC') setSourceKey('TBC');
          else if (value === 'GRID') setSourceKey(`GRID:${gridSupplies.find((item) => item.isDefault)?.id ?? gridSupplies[0]?.id ?? ''}`);
          else setSourceKey(sourceKeyAfterKindSelection('BOARD'));
        }}
      />
      {sourceKind === 'GRID' ? (
        <SelectChips
          label="Grid supply"
          value={sourceKey}
          options={gridSupplies.map((grid) => `GRID:${grid.id}`)}
          getLabel={(value) => {
            const grid = gridSupplies.find((item) => `GRID:${item.id}` === value);
            return grid ? `${grid.name}${grid.isDefault ? ' · default' : ''}` : 'Grid supply';
          }}
          onChange={setSourceKey}
        />
      ) : null}
      {sourceKind === 'BOARD' ? (
        <View style={{ marginBottom: spacing.md }}>
          <Text style={[typography.label, { color: colors.mutedForeground, marginBottom: spacing.sm }]}>Parent board</Text>
          <SearchBar
            value={parentSearch}
            onChangeText={setParentSearch}
            placeholder="Search name, type, or zone"
          />
          <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm }}>
            {parentCandidateResults.total > SOURCE_BOARD_RESULT_LIMIT
              ? `Showing ${SOURCE_BOARD_RESULT_LIMIT} of ${parentCandidateResults.total} cycle-safe matches. Refine the search to choose another board.`
              : `${parentCandidateResults.total} cycle-safe parent${parentCandidateResults.total === 1 ? '' : 's'}.`}
            {parentCandidateResults.selectedPinned ? ' The selected parent remains pinned.' : ''}
          </Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="Parent board">
            {parentCandidates.map((board) => {
              const value = `BOARD:${board.id}`;
              const selected = sourceKey === value;
              const zone = zones.find((item) => item.id === board.zone_id);
              return (
                <Pressable
                  key={board.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`${board.asset_name}, ${board.asset_type}, ${zone?.zone_name ?? 'unknown zone'}`}
                  onPress={() => setSourceKey(value)}
                  style={{
                    minHeight: 54,
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: selected ? colors.primary : colors.border,
                    borderRadius: radii.md,
                    paddingHorizontal: spacing.md,
                    marginBottom: spacing.sm,
                    backgroundColor: selected ? colors.muted : colors.card,
                  }}
                >
                  <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                    {selected ? '✓ ' : ''}{board.asset_name}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, marginTop: 3 }}>
                    {board.asset_type} · {zone?.zone_name ?? 'Unknown zone'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {!parentCandidateResults.total ? (
            <Text style={{ color: colors.mutedForeground }}>No cycle-safe parent matches this search.</Text>
          ) : null}
        </View>
      ) : null}
      <TextArea label="Location" value={location_description} onChangeText={setLoc} />
      <PhotoAttachmentField
        label="Location photo"
        uris={photo ? [photo] : []}
        single
        onChange={(uris) => setPhoto(uris[0] ?? '')}
      />
      <TextField label="Amperage" value={amperage_rating} onChangeText={setAmps} />
      <TextField label="Site NMI" value={site_nmi} onChangeText={setNmi} />
      <TextArea
        label="Sub-circuits description"
        value={sub_circuits_description}
        onChangeText={setSubCircuitsDescription}
        placeholder="Outgoing circuits from this board"
      />
      <TextArea label="Comments" value={comments} onChangeText={setComments} />
      <PhotoAttachmentField
        label="Additional photos"
        uris={extra_photos}
        onChange={setExtraPhotos}
      />
      <Button
        title={busy ? 'Saving…' : 'Save board'}
        disabled={busy || !asset_name.trim() || asset_name.trim().length > DISPLAY_CODE_MAX_LENGTH}
        onPress={async () => {
          setBusy(true);
          try {
            const electrical_source: ElectricalSource = sourceKey === 'TBC'
              ? { kind: 'TBC' }
              : sourceKey.startsWith('GRID:')
                ? { kind: 'GRID', gridSupplyId: sourceKey.slice(5) }
                : { kind: 'BOARD', boardId: sourceKey.slice(6) };
            if (electrical_source.kind === 'BOARD' && !electrical_source.boardId) {
              throw new Error('Choose a cycle-safe parent board or mark the source TBC.');
            }
            if (electrical_source.kind === 'GRID' && !electrical_source.gridSupplyId) {
              throw new Error('Choose the Grid supply or mark the source TBC.');
            }
            await onSubmit({
              audit_id: initial?.audit_id ?? '',
              zone_id: initial?.zone_id ?? '',
              asset_name,
              display_code: customCode ? display_code : initial?.display_code_meta?.value ?? '',
              display_code_meta: customCode
                ? {
                    value: display_code.trim(),
                    generatedValue: initial?.display_code_meta?.generatedValue ?? display_code.trim(),
                    isOverridden: true,
                    ruleVersion: 1,
                    overrideReason: 'Installer custom code',
                    provisional: initial?.display_code_meta?.provisional ?? true,
                  }
                : initial?.display_code_meta,
              asset_type: boardTypeFromCode(type_code),
              type_code,
              custom_type_name: type_code === 'OTHER' ? custom_type_name.trim() : undefined,
              electrical_source,
              location_description,
              // Retain imported legacy data on edit, but switchboards no longer
              // author a phase value. Phase belongs to meter/channel mappings.
              phase: initial?.phase,
              amperage_rating,
              site_nmi,
              electrical_parent_id: electrical_source.kind === 'BOARD' ? electrical_source.boardId : null,
              electrical_parent_tbc: electrical_source.kind === 'TBC',
              photo,
              extra_photos,
              meter_present: (initial?.meters?.length ?? 0) > 0,
              sub_circuits_description,
              comments,
              meters: initial?.meters,
            }, {
              commissionMeter: false,
              removeMeters: false,
            });
            deleteRemovedLocalPhotos(
              [initial?.photo, ...(initial?.extra_photos ?? [])],
              [photo, ...extra_photos],
            );
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}

export function QuickSwitchboardForm({
  inheritedSource,
  sourceBoards = [],
  gridSupplies = [],
  onSubmit,
}: {
  inheritedSource: ElectricalSource;
  sourceBoards?: ElectricalAsset[];
  gridSupplies?: GridSupply[];
  onSubmit: (details: QuickSwitchboardDetails) => Promise<void> | void;
}) {
  const { colors } = useTheme();
  const [name, setName] = useState(BOARD_TYPE_LABELS.DB);
  const nameEdited = useRef(false);
  const [typeCode, setTypeCode] = useState<BoardTypeCode>('DB');
  const [customTypeName, setCustomTypeName] = useState('');
  const [busy, setBusy] = useState(false);
  const inheritedLabel = inheritedSource.kind === 'GRID'
    ? gridSupplies.find((grid) => grid.id === inheritedSource.gridSupplyId)?.name ?? 'Incoming grid connection'
    : inheritedSource.kind === 'BOARD'
      ? sourceBoards.find((board) => board.id === inheritedSource.boardId)?.asset_name ?? 'Upstream switchboard'
      : 'To be confirmed';
  const valid = Boolean(name.trim())
    && name.trim().length <= DISPLAY_CODE_MAX_LENGTH
    && (typeCode !== 'OTHER' || Boolean(customTypeName.trim()));

  return (
    <View>
      <TextField
        label={`Switchboard name (${DISPLAY_CODE_MAX_LENGTH} characters max)`}
        value={name}
        maxLength={DISPLAY_CODE_MAX_LENGTH}
        error={name.trim().length > DISPLAY_CODE_MAX_LENGTH
          ? `Use ${DISPLAY_CODE_MAX_LENGTH} characters or fewer.`
          : undefined}
        onChangeText={(value) => {
          nameEdited.current = true;
          setName(value);
        }}
      />
      <SelectChips
        label="Switchboard type"
        value={typeCode}
        options={BOARD_TYPE_CODES}
        getLabel={(value) => BOARD_TYPE_LABELS[value]}
        onChange={(value) => {
          if (!nameEdited.current) setName(BOARD_TYPE_LABELS[value]);
          setTypeCode(value);
        }}
      />
      {typeCode === 'OTHER' ? (
        <TextField label="Custom switchboard type" value={customTypeName} onChangeText={(value) => {
          setCustomTypeName(value);
          if (!nameEdited.current) {
            setName((value.trim() || BOARD_TYPE_LABELS.OTHER).slice(0, DISPLAY_CODE_MAX_LENGTH));
          }
        }} />
      ) : null}
      <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md, lineHeight: 20 }}>
        Upstream source inherited from the asset: {inheritedLabel}.
      </Text>
      <Button
        title={busy ? 'Adding…' : 'Add and select switchboard'}
        disabled={busy || !valid}
        onPress={() => { void (async () => {
          setBusy(true);
          try {
            await onSubmit({ name, typeCode, customTypeName });
          } finally {
            setBusy(false);
          }
        })(); }}
      />
    </View>
  );
}

export type SiteAssetMeteringDraft =
  | {
      kind: 'METERED';
      meterId: string;
      channelIds: string[];
      phaseMode: MeasurementAssignment['phaseMode'];
      direction: MeasurementDirection;
    }
  | { kind: 'UNMETERED' }
  | { kind: 'TBC' };

function boardIsUpstreamOnPath(
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

export function SiteAssetForm({
  initial,
  sourceBoards = [],
  gridSupplies = [],
  zones = [],
  meterDevices = [],
  measurementAssignments = [],
  active = false,
  onAddSourceBoard,
  sourceBoardReturnToken = 0,
  newSourceBoardId,
  onAddDevice,
  deviceDetourReturnToken = 0,
  onDraftRestored,
  onDiscardDraft,
  onSubmit,
}: {
  initial?: Partial<SiteAsset>;
  sourceBoards?: ElectricalAsset[];
  gridSupplies?: GridSupply[];
  zones?: Zone[];
  meterDevices?: MeterDevice[];
  measurementAssignments?: MeasurementAssignment[];
  active?: boolean;
  onAddSourceBoard?: (inheritedSource: ElectricalSource) => void;
  sourceBoardReturnToken?: number;
  newSourceBoardId?: string;
  onAddDevice?: (boardId: string) => void;
  deviceDetourReturnToken?: number;
  onDraftRestored?: () => void;
  onDiscardDraft?: () => void;
  onSubmit: (values: Omit<SiteAsset, 'id' | 'created_at' | 'updated_at' | 'extra_photos' | 'meter_channels'> & {
    extra_photos?: string[];
    meter_channels?: SiteAsset['meter_channels'];
  }, metering: SiteAssetMeteringDraft) => Promise<void> | void;
}) {
  const { colors } = useTheme();
  const initialTypeCode = initial?.type_code ?? siteAssetTypeCode(initial?.asset_type ?? 'Other');
  const initialDefaultName = initialTypeCode === 'OTHER'
    ? initial?.custom_type_name?.trim() || SITE_ASSET_TYPE_LABELS[initialTypeCode]
    : SITE_ASSET_TYPE_LABELS[initialTypeCode];
  const [asset_name, setName] = useState(initial?.asset_name?.trim() || initialDefaultName);
  const nameEdited = useRef(Boolean(initial?.asset_name?.trim()));
  const [type_code, setTypeCode] = useState<SiteAssetTypeCode>(
    initialTypeCode,
  );
  const [custom_type_name, setCustomTypeName] = useState(initial?.custom_type_name ?? '');
  const [display_code, setCode] = useState(initial?.display_code ?? '');
  const [customCode, setCustomCode] = useState(Boolean(initial?.display_code_meta?.isOverridden));
  const [location_description, setLoc] = useState(initial?.location_description ?? '');
  const [location_photo, setLocationPhoto] = useState(initial?.location_photo ?? '');
  const [extra_photos, setExtraPhotos] = useState(initial?.extra_photos ?? []);
  const initialSource = initial?.electrical_source ?? (
    initial?.electrical_board_tbc || !initial?.electrical_board_id
      ? { kind: 'TBC' as const }
      : { kind: 'BOARD' as const, boardId: initial.electrical_board_id }
  );
  const [sourceKey, setSourceKey] = useState(
    initialSource.kind === 'GRID'
      ? `GRID:${initialSource.gridSupplyId}`
      : initialSource.kind === 'BOARD'
        ? `BOARD:${initialSource.boardId}`
        : 'TBC',
  );
  const meteringState = initial?.metering_state ?? { kind: 'TBC' as const };
  const initialAssignment = meteringState.kind === 'METERED'
    ? measurementAssignments.find((item) =>
        meteringState.measurementAssignmentIds.includes(item.id))
    : undefined;
  const [meteringKind, setMeteringKind] = useState<SiteAssetMeteringDraft['kind']>(meteringState.kind);
  const [selectedMeterId, setSelectedMeterId] = useState(initialAssignment?.meterId ?? '');
  const [selectedChannelIds, setSelectedChannelIds] = useState(initialAssignment?.channelIds ?? []);
  const [phaseMode, setPhaseMode] = useState<MeasurementAssignment['phaseMode']>(
    initialAssignment?.phaseMode ?? 'SINGLE_PHASE',
  );
  const [direction, setDirection] = useState<MeasurementDirection | ''>(
    initialAssignment?.direction ?? '',
  );
  const [sourceBoardSearch, setSourceBoardSearch] = useState('');
  const [meterSearch, setMeterSearch] = useState('');
  const [deviceDetour, setDeviceDetour] = useState<{
    beforeMeterIds: string[];
    startReturnToken: number;
  } | null>(null);
  const [meterAnnouncement, setMeterAnnouncement] = useState('');
  const [comments, setComments] = useState(initial?.comments ?? '');
  const [busy, setBusy] = useState(false);
  const [draftHydrated, setDraftHydrated] = useState(false);
  const [draftPersistenceError, setDraftPersistenceError] = useState('');
  const restoredDraft = useRef(false);
  const previousSourceBoardReturnToken = useRef(sourceBoardReturnToken);
  const draftScope = useMemo(() => siteAssetEditorDraftScope({
    assetId: initial?.id,
    installationId: initial?.audit_id,
    zoneId: initial?.zone_id,
  }), [initial?.audit_id, initial?.id, initial?.zone_id]);
  const draftInstallationId = initial?.audit_id ?? '';
  const draftAssetId = initial?.id;
  const selectedSourceBoardId = sourceKey.startsWith('BOARD:') ? sourceKey.slice(6) : '';
  const sourceKind = sourceKey === 'TBC'
    ? 'TBC'
    : sourceKey.startsWith('GRID:')
      ? 'GRID'
      : 'BOARD';
  const sourceBoardResults = useMemo(
    () => searchSourceBoards(
      sourceBoards,
      zones,
      sourceBoardSearch,
      SOURCE_BOARD_RESULT_LIMIT,
      selectedSourceBoardId || undefined,
    ),
    [selectedSourceBoardId, sourceBoardSearch, sourceBoards, zones],
  );
  const ownAssignmentIds = new Set(
    meteringState.kind === 'METERED' ? meteringState.measurementAssignmentIds : [],
  );
  const eligibleMeters = useMemo(() => {
    if (!selectedSourceBoardId) return [];
    return meterDevices.filter((meter) =>
      boardIsUpstreamOnPath(sourceBoards, meter.installedOnBoardId, selectedSourceBoardId));
  }, [meterDevices, selectedSourceBoardId, sourceBoards]);
  const eligibleMeterResults = useMemo(
    () => searchEligibleMeters(
      eligibleMeters,
      meterSearch,
      ELIGIBLE_METER_RESULT_LIMIT,
      selectedMeterId,
      (meter) => {
        const meterBoard = sourceBoards.find((item) => item.id === meter.installedOnBoardId);
        return [meter.deviceNumber, meterBoard?.asset_name];
      },
    ),
    [eligibleMeters, meterSearch, selectedMeterId, sourceBoards],
  );
  const selectedMeter = meterDevices.find((item) => item.id === selectedMeterId);
  const selectedPhaseCount = phaseMode === 'SINGLE_PHASE' ? 1 : phaseMode === 'THREE_PHASE' ? 3 : null;
  const selectedGroupComplete = selectedPhaseCount === null
    ? selectedChannelIds.length > 0
    : selectedChannelIds.length === selectedPhaseCount;
  const removalPreview = useMemo(
    () => meteringRemovalPreview(initial?.metering_state, measurementAssignments, meterDevices),
    [initial?.metering_state, measurementAssignments, meterDevices],
  );

  const currentDraftSnapshot = (
    detourOverride: typeof deviceDetour = deviceDetour,
  ): SiteAssetEditorDraftSnapshot => ({
    version: 1,
    assetName: asset_name,
    typeCode: type_code,
    customTypeName: custom_type_name,
    displayCode: display_code,
    customCode,
    locationDescription: location_description,
    locationPhoto: location_photo,
    extraPhotos: extra_photos,
    sourceKey,
    sourceBoardSearch,
    meteringKind,
    selectedMeterId,
    selectedChannelIds,
    phaseMode,
    direction,
    meterSearch,
    comments,
    deviceDetour: detourOverride,
  });

  useEffect(() => {
    let live = true;
    setDraftHydrated(false);
    const applySaved = (saved: SiteAssetEditorDraftSnapshot) => {
      if (!live) return;
      restoredDraft.current = true;
      nameEdited.current = true;
      setName(saved.assetName);
      setTypeCode(saved.typeCode);
      setCustomTypeName(saved.customTypeName);
      setCode(saved.displayCode);
      setCustomCode(saved.customCode);
      setLoc(saved.locationDescription);
      setLocationPhoto(saved.locationPhoto ?? initial?.location_photo ?? '');
      setExtraPhotos(saved.extraPhotos ?? initial?.extra_photos ?? []);
      setSourceKey(saved.sourceKey);
      setSourceBoardSearch(saved.sourceBoardSearch);
      setMeteringKind(saved.meteringKind);
      setSelectedMeterId(saved.selectedMeterId);
      setSelectedChannelIds(saved.selectedChannelIds);
      setPhaseMode(saved.phaseMode);
      setDirection(saved.direction);
      setMeterSearch(saved.meterSearch);
      setComments(saved.comments);
      setDeviceDetour(saved.deviceDetour
        ? { ...saved.deviceDetour, startReturnToken: deviceDetourReturnToken - 1 }
        : null);
      setDraftHydrated(true);
      onDraftRestored?.();
    };
    void loadSiteAssetEditorDraft(draftScope).then((result) => {
      if (!live) return;
      if (result.status === 'READY') {
        applySaved(result.draft);
      } else if (result.status === 'CONFLICT') {
        Alert.alert(
          'Saved draft conflicts with newer site data',
          'The installation or asset changed after this recovery draft began. Review it explicitly, or discard it to keep the newer canonical data.',
          [
            {
              text: 'Discard saved draft',
              style: 'destructive',
              onPress: () => { void clearSiteAssetEditorDraft(draftScope).finally(() => {
                if (live) setDraftHydrated(true);
              }); },
            },
            { text: 'Review saved draft', onPress: () => applySaved(result.draft) },
          ],
          { cancelable: false },
        );
      } else {
        setDraftHydrated(true);
        if (result.status === 'CORRUPT') {
          Alert.alert('Recovery draft removed', 'The saved asset draft failed integrity verification and was not applied.');
        }
      }
    }).catch((error) => {
      if (!live) return;
      setDraftHydrated(true);
      setDraftPersistenceError(error instanceof Error ? error.message : 'The recovery draft could not be read.');
    });
    return () => { live = false; };
  }, [draftScope]);

  useEffect(() => {
    if (!draftHydrated || (!active && !restoredDraft.current)) return;
    void saveSiteAssetEditorDraft(draftScope, {
      installationId: draftInstallationId,
      assetId: draftAssetId,
      draft: currentDraftSnapshot(),
    })
      .then(() => setDraftPersistenceError(''))
      .catch((error) => setDraftPersistenceError(
        error instanceof Error ? error.message : 'The asset recovery draft could not be saved.',
      ));
  }, [
    active, asset_name, comments, customCode, custom_type_name, deviceDetour,
    direction, display_code, draftAssetId, draftHydrated, draftInstallationId, draftScope, extra_photos,
    location_description, location_photo,
    meterSearch, meteringKind, phaseMode, selectedChannelIds, selectedMeterId,
    sourceBoardSearch, sourceKey, type_code,
  ]);

  useEffect(() => {
    if (draftHydrated && restoredDraft.current) return;
    if (!selectedMeterId && initialAssignment?.meterId) {
      setSelectedMeterId(initialAssignment.meterId);
      setSelectedChannelIds(initialAssignment.channelIds);
      setPhaseMode(initialAssignment.phaseMode);
      setDirection(initialAssignment.direction);
    }
  }, [draftHydrated, initialAssignment, selectedMeterId]);

  useEffect(() => {
    if (previousSourceBoardReturnToken.current === sourceBoardReturnToken) return;
    previousSourceBoardReturnToken.current = sourceBoardReturnToken;
    if (!newSourceBoardId) return;
    setSourceKey(`BOARD:${newSourceBoardId}`);
    setSourceBoardSearch('');
    setSelectedMeterId('');
    setSelectedChannelIds([]);
    setMeterAnnouncement('The new switchboard is selected as this asset’s electrical source.');
  }, [newSourceBoardId, sourceBoardReturnToken]);

  useEffect(() => {
    if (!deviceDetour || deviceDetourReturnToken === deviceDetour.startReturnToken) return;
    const addedEligibleIds = eligibleMeters
      .map((item) => item.id)
      .filter((id) => !deviceDetour.beforeMeterIds.includes(id));
    const resolved = resolveDeviceCommissioningDetour({
      draft: true,
      beforeMeterIds: deviceDetour.beforeMeterIds,
      eligibleAfterMeterIds: eligibleMeters.map((item) => item.id),
      outcome: addedEligibleIds.length ? 'SUCCESS' : 'CANCELLED',
    });
    if (resolved.newMeterId) {
      const commissioned = eligibleMeters.find((item) => item.id === resolved.newMeterId);
      setSelectedMeterId(resolved.newMeterId);
      setSelectedChannelIds([]);
      setMeterAnnouncement(`${commissioned?.displayName.value ?? 'New device'} is selected. Choose its channels.`);
    } else if (addedEligibleIds.length > 1) {
      setMeterAnnouncement('More than one new eligible device was found. Choose the intended device; your asset draft is preserved.');
    } else {
      setMeterAnnouncement('No new device was commissioned. Your asset draft is preserved.');
    }
    setDeviceDetour(null);
  }, [deviceDetour, deviceDetourReturnToken, eligibleMeters]);

  const requestMeteringKind = (next: 'METERED' | 'UNMETERED') => {
    if (
      initial?.metering_state?.kind === 'METERED' &&
      next !== 'METERED' &&
      removalPreview.assignmentIds.length
    ) {
      Alert.alert(
        next === 'UNMETERED' ? 'Confirm unmetered asset' : 'Move metering to TBC',
        [
          `This removes ${removalPreview.assignmentIds.length} exact assignment(s):`,
          removalPreview.assignmentIds.join('\n'),
          removalPreview.channelLabels.length
            ? `Channels released:\n${removalPreview.channelLabels.join('\n')}`
            : 'No channel labels are available.',
          'Commissioning forms and evidence remain retained.',
        ].join('\n\n'),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: next === 'UNMETERED' ? 'Confirm unmetered' : 'Set TBC',
            style: next === 'UNMETERED' ? 'destructive' : 'default',
            onPress: () => setMeteringKind(next),
          },
        ],
      );
      return;
    }
    setMeteringKind(next);
  };

  return (
    <View>
      <TextField
        label={`Asset name (${DISPLAY_CODE_MAX_LENGTH} characters max)`}
        value={asset_name}
        maxLength={DISPLAY_CODE_MAX_LENGTH}
        error={asset_name.trim().length > DISPLAY_CODE_MAX_LENGTH
          ? `Use ${DISPLAY_CODE_MAX_LENGTH} characters or fewer.`
          : undefined}
        onChangeText={(value) => {
          nameEdited.current = true;
          setName(value);
        }}
      />
      <SelectChips
        label="Asset type"
        value={type_code}
        options={SITE_ASSET_TYPE_CODES}
        getLabel={(value) => SITE_ASSET_TYPE_LABELS[value]}
        onChange={(value) => {
          if (!nameEdited.current) setName(SITE_ASSET_TYPE_LABELS[value]);
          setTypeCode(value);
        }}
      />
      {type_code === 'OTHER' ? (
        <TextField label="Custom asset type" value={custom_type_name} onChangeText={(value) => {
          setCustomTypeName(value);
          if (!nameEdited.current) {
            setName((value.trim() || SITE_ASSET_TYPE_LABELS.OTHER).slice(0, DISPLAY_CODE_MAX_LENGTH));
          }
        }} />
      ) : null}
      <SelectChips
        label="Electrical source type"
        value={sourceKind}
        options={['GRID', 'BOARD', 'TBC']}
        getLabel={(value) => {
          if (value === 'GRID') return 'Grid supply';
          if (value === 'BOARD') return 'Parent board';
          return 'To be confirmed';
        }}
        onChange={(value) => setSourceKey(sourceKeyAfterKindSelection(value))}
      />
      {sourceKind === 'GRID' ? (
        <SelectChips
          label="Grid supply"
          value={sourceKey}
          options={gridSupplies.map((grid) => `GRID:${grid.id}`)}
          getLabel={(value) => {
            const grid = gridSupplies.find((item) => `GRID:${item.id}` === value);
            return grid ? `${grid.name}${grid.isDefault ? ' · default' : ''}` : 'Grid supply';
          }}
          onChange={setSourceKey}
        />
      ) : null}
      {sourceKind === 'BOARD' ? (
        <View style={{ marginBottom: spacing.md }}>
          <Text style={[typography.label, { color: colors.mutedForeground, marginBottom: spacing.sm }]}>Parent board</Text>
          <SearchBar
            value={sourceBoardSearch}
            onChangeText={setSourceBoardSearch}
            placeholder="Search name, type, or zone"
          />
          <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm }}>
            {sourceBoardResults.total > SOURCE_BOARD_RESULT_LIMIT
              ? `Showing ${SOURCE_BOARD_RESULT_LIMIT} of ${sourceBoardResults.total} matches. Refine the search to choose another board.`
              : `${sourceBoardResults.total} matching board${sourceBoardResults.total === 1 ? '' : 's'}.`}
            {sourceBoardResults.selectedPinned ? ' The selected board remains pinned.' : ''}
          </Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="Parent board">
            {sourceBoardResults.visible.map((sourceBoard) => {
              const value = `BOARD:${sourceBoard.id}`;
              const selected = sourceKey === value;
              const sourceZone = zones.find((item) => item.id === sourceBoard.zone_id);
              return (
                <Pressable
                  key={sourceBoard.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`${sourceBoard.asset_name}, ${sourceBoard.asset_type}, ${sourceZone?.zone_name ?? 'unknown zone'}`}
                  onPress={() => setSourceKey(value)}
                  style={{
                    minHeight: 54,
                    justifyContent: 'center',
                    borderWidth: 1,
                    borderColor: selected ? colors.primary : colors.border,
                    borderRadius: radii.md,
                    paddingHorizontal: spacing.md,
                    marginBottom: spacing.sm,
                    backgroundColor: selected ? colors.muted : colors.card,
                  }}
                >
                  <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                    {selected ? '✓ ' : ''}{sourceBoard.asset_name}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, marginTop: 3 }}>
                    {sourceBoard.asset_type} · {sourceZone?.zone_name ?? 'Unknown zone'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {!sourceBoardResults.total ? (
            <Text style={{ color: colors.mutedForeground }}>No boards match this search.</Text>
          ) : null}
          {onAddSourceBoard ? (
            <Button
              title="Add a new switchboard, then return here"
              variant="secondary"
              style={{ marginTop: spacing.sm }}
              onPress={() => {
                void saveSiteAssetEditorDraft(draftScope, {
                  installationId: draftInstallationId,
                  assetId: draftAssetId,
                  draft: currentDraftSnapshot(),
                })
                  .then(() => onAddSourceBoard(inheritedSourceForQuickSwitchboard(
                    sourceKey,
                    initialSource,
                    gridSupplies,
                  )))
                  .catch(() => Alert.alert(
                    'Draft not protected',
                    'The asset draft could not be saved, so switchboard creation was not opened.',
                  ));
              }}
            />
          ) : null}
        </View>
      ) : null}
      <TextArea label="Location" value={location_description} onChangeText={setLoc} />
      <PhotoAttachmentField
        label="Location photo"
        uris={location_photo ? [location_photo] : []}
        single
        onChange={(uris) => setLocationPhoto(uris[0] ?? '')}
      />
      <Card style={{ marginBottom: spacing.md }}>
        <SectionHeader title="How this asset is measured" />
        <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md, lineHeight: 20 }}>
          Choose the observed state. Metered assets must be linked to the exact physical device and channels; confirmed-unmetered assets need no device link.
        </Text>
        <SelectChips<SiteAssetMeteringDraft['kind']>
          label="Metering state"
          value={meteringKind}
          options={['METERED', 'UNMETERED']}
          getLabel={(value) => value === 'METERED' ? 'Metered' : 'Confirmed unmetered'}
          onChange={(value) => {
            if (value !== 'TBC') requestMeteringKind(value);
          }}
        />
        {meteringKind === 'TBC' ? (
          <Text accessibilityRole="alert" style={{ color: colors.destructive, marginBottom: spacing.md, lineHeight: 20 }}>
            This older record has an unresolved metering state. Choose Metered or Confirmed unmetered before saving.
          </Text>
        ) : null}
        {meteringKind === 'METERED' ? (
          <>
            {!selectedSourceBoardId ? (
              <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md, lineHeight: 20 }}>
                Choose a board as the electrical source before selecting its upstream meter and channels.
              </Text>
            ) : (
              <>
                <SearchBar
                  value={meterSearch}
                  onChangeText={setMeterSearch}
                  placeholder="Search device ID, name, type, or board"
                />
                <Text style={{ color: colors.foreground, fontWeight: '700', marginBottom: spacing.xs }}>
                  Exact metering device
                </Text>
                <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm, lineHeight: 20 }}>
                  Choose the physical device whose channels measure this asset. Only devices on the confirmed supply path are shown.
                </Text>
                <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm }}>
                  {eligibleMeterResults.total > ELIGIBLE_METER_RESULT_LIMIT
                    ? `Showing ${ELIGIBLE_METER_RESULT_LIMIT} of ${eligibleMeterResults.total} matches. Refine the search to choose another device.`
                    : `${eligibleMeterResults.total} matching device${eligibleMeterResults.total === 1 ? '' : 's'}.`}
                  {eligibleMeterResults.selectedPinned ? ' The selected device remains pinned.' : ''}
                </Text>
                <View accessibilityRole="radiogroup" accessibilityLabel="Eligible meter device">
                  {eligibleMeterResults.visible.map((meter) => {
                    const selected = selectedMeterId === meter.id;
                    const meterBoard = sourceBoards.find((item) => item.id === meter.installedOnBoardId);
                    return (
                      <Pressable
                        key={meter.id}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        accessibilityLabel={`${meter.displayName.value}, ${meter.serialNumber}, installed on ${meterBoard?.asset_name ?? 'switchboard'}`}
                        onPress={() => {
                          setSelectedMeterId(meter.id);
                          setSelectedChannelIds([]);
                        }}
                        style={{
                          minHeight: 54,
                          justifyContent: 'center',
                          borderWidth: 1,
                          borderColor: selected ? colors.primary : colors.border,
                          borderRadius: radii.md,
                          paddingHorizontal: spacing.md,
                          marginBottom: spacing.sm,
                          backgroundColor: selected ? colors.muted : colors.card,
                        }}
                      >
                        <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                          {selected ? '✓ ' : ''}{meter.displayName.value}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, marginTop: 3 }}>
                          {meter.deviceModel} · {meter.serialNumber || 'No serial'} · {meterBoard?.asset_name ?? 'Unknown switchboard'}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {!eligibleMeterResults.visible.length ? (
                  <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>
                    No commissioned device is available on this asset’s source path.
                  </Text>
                ) : null}
                {onAddDevice ? (
                  <Button
                    title="Commission a new device, then return here"
                    variant="secondary"
                    onPress={() => {
                      const nextDetour = {
                        beforeMeterIds: meterDevices.map((item) => item.id),
                        startReturnToken: deviceDetourReturnToken,
                      };
                      setDeviceDetour(nextDetour);
                      setMeterAnnouncement('');
                      void saveSiteAssetEditorDraft(
                        draftScope,
                        {
                          installationId: draftInstallationId,
                          assetId: draftAssetId,
                          draft: currentDraftSnapshot(nextDetour),
                        },
                      )
                        .then(() => onAddDevice(selectedSourceBoardId))
                        .catch(() => Alert.alert(
                          'Draft not protected',
                          'The asset draft could not be saved on this device, so device commissioning was not opened.',
                        ));
                    }}
                    style={{ marginBottom: spacing.md }}
                  />
                ) : null}
                {meterAnnouncement ? (
                  <Text
                    accessibilityRole="summary"
                    accessibilityLiveRegion="polite"
                    style={{ color: colors.primary, marginBottom: spacing.md }}
                  >
                    {meterAnnouncement}
                  </Text>
                ) : null}
              </>
            )}
            {selectedMeter ? (
              <>
                <SelectChips
                  label="Phase grouping"
                  value={phaseMode}
                  options={['SINGLE_PHASE', 'THREE_PHASE', 'OTHER']}
                  getLabel={phaseGroupingLabel}
                  onChange={setPhaseMode}
                />
                <SelectChips
                  label="Energy flow"
                  value={direction}
                  options={['', 'CONSUMPTION', 'GENERATION', 'BIDIRECTIONAL']}
                  getLabel={energyFlowLabel}
                  onChange={setDirection}
                />
                <Text style={[typography.label, { color: colors.mutedForeground, marginBottom: spacing.sm }]}>Meter channels that measure this asset</Text>
                <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm, lineHeight: 20 }}>
                  Select the exact non-spare channel or group, then record its phase grouping and whether this asset consumes energy, generates energy, or can do both.
                </Text>
                <Text
                  accessibilityRole="summary"
                  accessibilityLiveRegion="polite"
                  style={{ color: colors.mutedForeground, marginBottom: spacing.sm, lineHeight: 20 }}
                >
                  {phaseMode === 'SINGLE_PHASE'
                    ? `Single phase requires exactly 1 channel; ${selectedChannelIds.length} selected.`
                    : phaseMode === 'THREE_PHASE'
                      ? `Three phase requires exactly 3 channels; ${selectedChannelIds.length} selected.`
                      : `Other group requires at least 1 channel; ${selectedChannelIds.length} selected.`}
                  {selectedGroupComplete ? ' Channel group complete.' : ' Complete the channel group before saving.'}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
                  {selectedMeter.channels.map((channel, channelIndex) => {
                    const selected = selectedChannelIds.includes(channel.id);
                    const assignedElsewhere = measurementAssignments.some((assignment) =>
                      !ownAssignmentIds.has(assignment.id) &&
                      assignment.target.kind !== 'TBC' &&
                      assignment.channelIds.includes(channel.id));
                    const disabled = channel.purpose !== 'SUB_CIRCUIT' || assignedElsewhere;
                    return (
                      <Pressable
                        key={channel.id}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: selected, disabled }}
                        accessibilityLabel={`Channel ${channel.ordinal}, ${meterChannelPurposeLabel(channel.purpose)}${assignedElsewhere ? ', included in another measured group' : ''}`}
                        accessibilityHint={`${channelIndex + 1} of ${selectedMeter.channels.length}. ${disabled ? assignedElsewhere ? 'Unavailable because another confirmed measured group uses it.' : 'Unavailable because only sub-circuit channels can measure a site asset.' : 'Double tap to include or remove this channel.'}`}
                        disabled={disabled}
                        onPress={() => setSelectedChannelIds((current) => selected
                          ? current.filter((id) => id !== channel.id)
                          : [...current, channel.id])}
                        style={{
                          minHeight: 48,
                          minWidth: 92,
                          justifyContent: 'center',
                          borderWidth: 1,
                          borderColor: selected ? colors.primary : colors.border,
                          backgroundColor: selected ? colors.muted : colors.card,
                          opacity: disabled ? 0.45 : 1,
                          borderRadius: radii.md,
                          paddingHorizontal: spacing.sm,
                        }}
                      >
                        <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                          {selected ? '✓ ' : ''}Ch {channel.ordinal}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontSize: 11, marginTop: 2 }}>
                          {assignedElsewhere ? 'In another group' : meterChannelPurposeLabel(channel.purpose)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}
          </>
        ) : meteringKind === 'UNMETERED' ? (
          <Text style={{ color: colors.mutedForeground, lineHeight: 20 }}>
            Confirmed: this asset is intentionally not directly metered.
          </Text>
        ) : null}
      </Card>
      <TextArea label="Comments" value={comments} onChangeText={setComments} />
      <PhotoAttachmentField
        label="Additional photos"
        uris={extra_photos}
        onChange={setExtraPhotos}
      />
      {draftPersistenceError ? (
        <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={{ color: colors.destructive, marginBottom: spacing.md }}>
          Draft protection failed: {draftPersistenceError}
        </Text>
      ) : null}
      <Button
        title={busy ? 'Saving…' : 'Save asset'}
        disabled={busy || !asset_name.trim() || asset_name.trim().length > DISPLAY_CODE_MAX_LENGTH}
        onPress={async () => {
          setBusy(true);
          try {
            const electrical_source: ElectricalSource = sourceKey === 'TBC'
              ? { kind: 'TBC' }
              : sourceKey.startsWith('GRID:')
                ? { kind: 'GRID', gridSupplyId: sourceKey.slice(5) }
                : { kind: 'BOARD', boardId: sourceKey.slice(6) };
            if (electrical_source.kind === 'BOARD' && !electrical_source.boardId) {
              throw new Error('Choose a source board or mark the source TBC.');
            }
            if (electrical_source.kind === 'GRID' && !electrical_source.gridSupplyId) {
              throw new Error('Choose a Grid supply or mark the source TBC.');
            }
            let meteringDraft: SiteAssetMeteringDraft;
            if (meteringKind === 'METERED') {
              if (!selectedSourceBoardId) throw new Error('Choose a source board for this metered asset.');
              if (!selectedMeter || !eligibleMeters.some((item) => item.id === selectedMeter.id)) {
                throw new Error('Choose an eligible commissioned device on the electrical source path.');
              }
              const channels = selectedChannelIds.map((id) =>
                selectedMeter.channels.find((channel) => channel.id === id));
              if (!channels.length || channels.some((channel) => !channel || channel.purpose !== 'SUB_CIRCUIT')) {
                throw new Error('Choose one or more available sub-circuit channels.');
              }
              const expectedCount = phaseMode === 'SINGLE_PHASE' ? 1 : phaseMode === 'THREE_PHASE' ? 3 : null;
              if ((expectedCount !== null && selectedChannelIds.length !== expectedCount) ||
                  (expectedCount === null && !selectedChannelIds.length)) {
                throw new Error('Selected channel count must match the phase grouping.');
              }
              if (!direction) throw new Error('Choose the energy flow.');
              meteringDraft = {
                kind: 'METERED', meterId: selectedMeter.id,
                channelIds: selectedChannelIds, phaseMode, direction,
              };
            } else if (meteringKind === 'UNMETERED') {
              meteringDraft = { kind: 'UNMETERED' };
            } else {
              throw new Error('Choose Metered or Confirmed unmetered before saving this asset.');
            }
            await onSubmit({
              audit_id: initial?.audit_id ?? '',
              zone_id: initial?.zone_id ?? '',
              asset_name,
              asset_type: siteAssetTypeFromCode(type_code),
              type_code,
              custom_type_name: type_code === 'OTHER' ? custom_type_name.trim() : undefined,
              display_code: customCode ? display_code : initial?.display_code_meta?.value ?? '',
              display_code_meta: customCode
                ? {
                    value: display_code.trim(), generatedValue: initial?.display_code_meta?.generatedValue ?? display_code.trim(),
                    isOverridden: true, ruleVersion: 1, overrideReason: 'Installer custom code', provisional: initial?.display_code_meta?.provisional ?? true,
                  }
                : initial?.display_code_meta,
              location_description,
              location_photo,
              electrical_source,
              electrical_board_id: electrical_source.kind === 'BOARD' ? electrical_source.boardId : null,
              electrical_board_tbc: electrical_source.kind === 'TBC',
              metering_state: initial?.metering_state ?? { kind: 'TBC' },
              meter_present: initial?.meter_present ?? false,
              meter_switchboard_id: initial?.meter_switchboard_id ?? null,
              meter_switchboard_tbc: initial?.meter_switchboard_tbc ?? false,
              meter_channels: initial?.meter_channels ?? [],
              comments,
              extra_photos,
            }, meteringDraft);
            deleteRemovedLocalPhotos(
              [initial?.location_photo, ...(initial?.extra_photos ?? [])],
              [location_photo, ...extra_photos],
            );
            try {
              await clearSiteAssetEditorDraft(draftScope);
              restoredDraft.current = false;
            } catch {
              Alert.alert(
                'Asset saved; draft cleanup pending',
                'The asset was saved, but its recovery draft could not be cleared. Discard the restored copy before making another edit.',
              );
            }
          } catch (error) {
            Alert.alert('Asset not saved', error instanceof Error ? error.message : 'The asset could not be saved.');
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button
        title="Discard saved asset draft"
        variant="danger"
        style={{ marginTop: spacing.md }}
        onPress={() => {
          Alert.alert(
            'Discard asset draft?',
            'This clears the saved editor state, including a pending device-commissioning detour.',
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Discard draft',
                style: 'destructive',
                onPress: () => { void (async () => {
                  await clearSiteAssetEditorDraft(draftScope);
                  restoredDraft.current = false;
                  onDiscardDraft?.();
                })(); },
              },
            ],
          );
        }}
      />
    </View>
  );
}

const CHANNEL_PURPOSES = ['MAIN_SUPPLY', 'SUB_CIRCUIT', 'SPARE'] as const;
const LOAD_TYPES = [
  'Mains Supply',
  'HVAC',
  'Lighting',
  'Solar PV',
  'Forklift Charger',
  'Hot Water',
  'General Power',
  'Other',
  'Not Used',
];
const ROGOWSKI = [
  '10cm-200A',
  '10cm-333mV',
  '20cm-3000A',
  '30cm-3000A',
  '45cm-3000A',
  'Not Used',
];
const CT_RATINGS = ['CT-60A', 'CT-120A', 'CT-250A', 'CT-400A', 'CT-600A', 'Not Used'];
const SIGNAL_STRENGTHS = ['Low', 'Medium', 'High'];
const ANTENNA_TYPES = ['Internal', 'External', 'CSM550 - External High Gain', 'Other'];
const METER_CLASSIFICATIONS = [
  'Utility / Gate Meter',
  'Sub-meter',
  'Check Meter',
  'Solar / Generation Meter',
  'Other',
];
const METER_COVERAGE = [
  'Entire Board Load',
  'Specific Outgoing Circuit',
  'Multiple Circuits',
  'Unknown',
];

export function WattwatcherForm({
  deviceType,
  data,
  onChange,
  lockDeviceType = false,
}: {
  deviceType: MeterDeviceType;
  data: Partial<Meter>;
  onChange: (next: Partial<Meter>) => void;
  lockDeviceType?: boolean;
}) {
  const { colors } = useTheme();
  const selectedType = data.device_type ?? deviceType;
  const channelCount = selectedType === 'A6M'
    ? 6
    : selectedType === 'A3RM'
      ? 3
      : data.ww_channels?.length ?? 0;
  const channels: WattwatcherChannel[] = [
    ...(data.ww_channels ?? []),
    ...Array.from({ length: channelCount }, () => ({})),
  ].slice(0, channelCount);
  const isA6M = selectedType === 'A6M';
  const isA3RM = selectedType === 'A3RM';
  const isOther = selectedType === 'Other';
  const showWattwatchersSections = showsWattwatchersCommissioningSections(selectedType);

  const setSection = <K extends keyof Meter>(section: K, key: string, val: unknown) => {
    const prev = (data[section] as Record<string, unknown>) || {};
    onChange({ ...data, [section]: { ...prev, [key]: val } });
  };

  const setChannel = (idx: number, key: string, val: unknown) => {
    const next = channels.map((c, i) => (i === idx ? { ...c, [key]: val } : c));
    onChange({ ...data, ww_channels: next });
  };

  const setChannelPurpose = (idx: number, purpose: string) => {
    const next = channels.map((channel, index) =>
      index === idx ? channelAfterPurposeChange(channel, purpose) : channel);
    onChange({ ...data, ww_channels: next });
  };

  const pre = data.ww_prestart || {};
  const sb = data.ww_switchboard || {};
  const ver = data.ww_verification || {};
  const com = data.ww_commissioning || {};

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <SectionHeader title={`${selectedType} identity`} />
        <TextField
          label="Device name"
          maxLength={64}
          value={data.custom_name ?? defaultMeterCustomName(
            selectedType,
            data.custom_model_name,
            data.custom_manufacturer_name,
          )}
          onChangeText={(v) => onChange({ ...data, custom_name: v })}
        />
        <BarcodeScanField
          label="Device ID / serial *"
          value={data.device_id ?? ''}
          onChangeText={(v) => onChange({
            ...data,
            device_id: v,
            device_number: isOther
              ? data.device_number
              : data.device_number?.trim() ? data.device_number : v,
          })}
          placeholder="e.g. DD03710160579"
        />
        <BarcodeScanField
          label="Site / asset tag (optional)"
          value={data.device_number ?? ''}
          onChangeText={(v) => onChange({ ...data, device_number: v })}
          placeholder="Optional site tag; not the Device ID / serial"
        />
        <Text style={{ color: colors.mutedForeground, marginTop: -spacing.sm, marginBottom: spacing.md, lineHeight: 19 }}>
          Use this only for a separate site label or asset tag. The Device ID / serial above remains the physical device identity.
        </Text>
        {lockDeviceType ? (
          <View style={{ marginBottom: spacing.md }}>
            <Text style={[typography.label, { color: colors.mutedForeground, marginBottom: 8 }]}>Device type</Text>
            <Text style={{ color: colors.foreground, fontWeight: '700' }}>{selectedType}</Text>
            <Text style={{ color: colors.mutedForeground, marginTop: 6 }}>
              Wattwatchers devices must be added through the full installation form.
            </Text>
          </View>
        ) : (
          <SelectChips
            label="Device type"
            value={(data.device_type as MeterDeviceType) || deviceType}
            options={METER_DEVICE_TYPES}
            onChange={(value) => {
              const nextChannels = channelsAfterDeviceTypeChange(
                selectedType,
                value,
                data.ww_channels ?? [],
              );
              onChange({
                ...data,
                device_type: value,
                custom_name: nameAfterTypeChange(
                  data.custom_name ?? '',
                  defaultMeterCustomName(
                    selectedType,
                    data.custom_model_name,
                    data.custom_manufacturer_name,
                  ),
                  defaultMeterCustomName(value, data.custom_model_name, data.custom_manufacturer_name),
                ),
                ww_channels: nextChannels,
              });
            }}
          />
        )}
        {isOther ? (
          <>
            <TextField
              label="Manufacturer"
              value={data.custom_manufacturer_name ?? ''}
              onChangeText={(value) => onChange({
                ...data,
                custom_manufacturer_name: value,
                custom_name: nameAfterTypeChange(
                  data.custom_name ?? '',
                  defaultMeterCustomName(
                    'Other', data.custom_model_name, data.custom_manufacturer_name,
                  ),
                  defaultMeterCustomName('Other', data.custom_model_name, value),
                ),
              })}
            />
            <TextField
              label="Custom model"
              value={data.custom_model_name ?? ''}
              onChangeText={(value) => onChange({
                ...data,
                custom_model_name: value,
                custom_name: nameAfterTypeChange(
                  data.custom_name ?? '',
                  defaultMeterCustomName(
                    'Other', data.custom_model_name, data.custom_manufacturer_name,
                  ),
                  defaultMeterCustomName('Other', value, data.custom_manufacturer_name),
                ),
              })}
            />
            <SelectChips
              label="Meter classification"
              value={data.classification ?? ''}
              options={withLegacyOption(METER_CLASSIFICATIONS, data.classification)}
              onChange={(value) => onChange({ ...data, classification: value })}
            />
            <SelectChips
              label="Coverage type"
              value={data.coverage ?? ''}
              options={withLegacyOption(METER_COVERAGE, data.coverage)}
              onChange={(value) => onChange({ ...data, coverage: value })}
            />
          </>
        ) : null}
      </Card>

      {showWattwatchersSections ? (
        <>
          <Card>
            <SectionHeader title="Pre-start" />
            <BoolRow label="Site induction required?" value={pre.site_induction} onChange={(v) => setSection('ww_prestart', 'site_induction', v)} />
            <BoolRow label="Safe access?" value={pre.safe_access} onChange={(v) => setSection('ww_prestart', 'safe_access', v)} />
            <BoolRow label="Correct PPE?" value={pre.correct_ppe} onChange={(v) => setSection('ww_prestart', 'correct_ppe', v)} />
            <BoolRow label="Aware of LIVE points?" value={pre.live_points_aware} onChange={(v) => setSection('ww_prestart', 'live_points_aware', v)} />
            <BoolRow label="Can isolate power?" value={pre.can_isolate} onChange={(v) => setSection('ww_prestart', 'can_isolate', v)} />
            <BoolRow label="Additional hazards?" value={pre.additional_hazards} onChange={(v) => setSection('ww_prestart', 'additional_hazards', v)} />
            <BoolRow label="Safe to proceed?" value={pre.safe_to_proceed} onChange={(v) => setSection('ww_prestart', 'safe_to_proceed', v)} />
          </Card>

          <Card>
            <SectionHeader title="Switchboard & device" />
            <TextField label="Switchboard name" value={sb.sb_name ?? ''} onChangeText={(v) => setSection('ww_switchboard', 'sb_name', v)} />
            <TextField label="Location" value={sb.sb_location ?? ''} onChangeText={(v) => setSection('ww_switchboard', 'sb_location', v)} />
            <BarcodeScanField
              label="Auditor serial (optional)"
              value={sb.device_serial ?? ''}
              onChangeText={(v) => setSection('ww_switchboard', 'device_serial', v)}
              placeholder="Scan or type serial"
            />
            <TextField label="Firmware" value={sb.firmware ?? ''} onChangeText={(v) => setSection('ww_switchboard', 'firmware', v)} />
            <SelectChips
              label="Antenna"
              value={sb.antenna_type ?? ''}
              options={withLegacyOption(ANTENNA_TYPES, sb.antenna_type)}
              onChange={(v) => setSection('ww_switchboard', 'antenna_type', v)}
            />
            <SelectChips
              label="Signal"
              value={sb.signal_strength ?? ''}
              options={withLegacyOption(SIGNAL_STRENGTHS, sb.signal_strength)}
              onChange={(v) => setSection('ww_switchboard', 'signal_strength', v)}
            />
            <TextArea label="Notes" value={sb.notes ?? ''} onChangeText={(v) => setSection('ww_switchboard', 'notes', v)} />
          </Card>
        </>
      ) : null}

      <Text
        accessibilityRole="summary"
        accessibilityLiveRegion="polite"
        style={{ color: colors.mutedForeground }}
      >
        {isOther
          ? `Custom meter: declare at least 1 channel and non-empty capabilities for every channel. ${channels.length} declared.`
          : `${selectedType} requires exactly ${channelCount} channels. ${channels.length} declared.`}
      </Text>
      {channels.map((ch, idx) => (
        <Card key={`ch-${idx}`}>
          <SectionHeader title={`Channel ${ch.ordinal ?? idx + 1}`} />
          <SelectChips
            label="Purpose"
            value={(ch.purpose as (typeof CHANNEL_PURPOSES)[number]) || 'SPARE'}
            options={[...CHANNEL_PURPOSES]}
            onChange={(v) => setChannelPurpose(idx, v)}
          />
          <TextField
            label="Phase label (optional)"
            value={ch.phase_label ?? ''}
            onChangeText={(value) => setChannel(idx, 'phase_label', value)}
            placeholder="e.g. L1"
          />
          {isOther ? (
            <TextField
              label="Capabilities (comma-separated)"
              value={Array.isArray(ch.capabilities?.labels)
                ? ch.capabilities.labels.filter((item): item is string => typeof item === 'string').join(', ')
                : ''}
              onChangeText={(value) => {
                const labels = value.split(',').map((item) => item.trim()).filter(Boolean);
                setChannel(idx, 'capabilities', labels.length ? { labels } : undefined);
              }}
            />
          ) : null}
          {ch.purpose !== 'SPARE' ? (
            <>
              <SelectChips
                label="Load type"
                value={(ch.load_type as string) || 'Not Used'}
                options={LOAD_TYPES}
                onChange={(v) => setChannel(idx, 'load_type', v)}
              />
              {isA6M ? (
                <SelectChips
                  label="CT rating"
                  value={(ch.ct_ratio as string) || ''}
                  options={withLegacyOption(CT_RATINGS, ch.ct_ratio)}
                  onChange={(v) => setChannel(idx, 'ct_ratio', v)}
                />
              ) : null}
              {isA3RM ? (
                <SelectChips
                  label="Rogowski coil"
                  value={(ch.rogowski_size as string) || ''}
                  options={withLegacyOption(ROGOWSKI, ch.rogowski_size)}
                  onChange={(v) => setChannel(idx, 'rogowski_size', v)}
                />
              ) : null}
              {isOther ? (
                <TextField
                  label="Sensor rating"
                  value={ch.rogowski_size ?? ''}
                  onChangeText={(value) => setChannel(idx, 'rogowski_size', value)}
                />
              ) : null}
              <TextField
                label="Description"
                value={ch.description ?? ''}
                onChangeText={(v) => setChannel(idx, 'description', v)}
              />
            </>
          ) : null}
        </Card>
      ))}

      {!showWattwatchersSections ? (
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Button
            title="Add channel"
            variant="secondary"
            onPress={() => onChange({
              ...data,
              ww_channels: [
                ...(data.ww_channels ?? []),
                { ordinal: (data.ww_channels?.length ?? 0) + 1 },
              ],
            })}
            style={{ flexGrow: 1 }}
          />
          <Button
            title="Remove last channel"
            variant="ghost"
            disabled={!channelCount}
            onPress={() => onChange({
              ...data,
              ww_channels: (data.ww_channels ?? []).slice(0, -1),
            })}
            style={{ flexGrow: 1 }}
          />
        </View>
      ) : null}

      {!showWattwatchersSections ? (
        <Card>
          <SectionHeader title="Notes & evidence" />
          <TextArea
            label="Device notes"
            value={sb.notes ?? com.notes ?? ''}
            onChangeText={(value) => setSection('ww_switchboard', 'notes', value)}
          />
          <PhotoAttachmentField
            label="Installed device photo"
            uris={data.ww_photos?.device_installed ? [data.ww_photos.device_installed] : []}
            single
            onChange={(uris) => onChange({
              ...data,
              ww_photos: {
                ...(data.ww_photos ?? {}),
                device_installed: uris[0],
              },
            })}
          />
          <PhotoAttachmentField
            label="Device label / serial photo"
            uris={data.ww_photos?.labeling ? [data.ww_photos.labeling] : []}
            single
            onChange={(uris) => onChange({
              ...data,
              ww_photos: {
                ...(data.ww_photos ?? {}),
                labeling: uris[0],
              },
            })}
          />
          <PhotoAttachmentField
            label="Additional device evidence"
            uris={data.ww_photos?.extra ?? []}
            onChange={(extra) => onChange({
              ...data,
              ww_photos: {
                ...(data.ww_photos ?? {}),
                extra,
              },
            })}
          />
          <Text style={{ color: colors.mutedForeground, lineHeight: 19 }}>
            Evidence is stored in app-owned local media and included when this installation is backed up.
          </Text>
        </Card>
      ) : (
        <>
          <Card>
            <SectionHeader title="Verification" />
            <BoolRow label="Voltage checked" value={ver.voltage_checked} onChange={(v) => setSection('ww_verification', 'voltage_checked', v)} />
            <BoolRow label="Polarity checked" value={ver.polarity_checked} onChange={(v) => setSection('ww_verification', 'polarity_checked', v)} />
            <BoolRow label="Communications OK" value={ver.communications_ok} onChange={(v) => setSection('ww_verification', 'communications_ok', v)} />
            <TextArea label="Notes" value={ver.notes ?? ''} onChangeText={(v) => setSection('ww_verification', 'notes', v)} />
          </Card>

          <Card>
            <SectionHeader title="Commissioning" />
            <BoolRow label="Device online" value={com.device_online} onChange={(v) => setSection('ww_commissioning', 'device_online', v)} />
            <BoolRow label="Channels reporting" value={com.channels_reporting} onChange={(v) => setSection('ww_commissioning', 'channels_reporting', v)} />
            <BoolRow label="Labeled" value={com.labeled} onChange={(v) => setSection('ww_commissioning', 'labeled', v)} />
            <BoolRow label="Photos taken" value={com.photos_taken} onChange={(v) => setSection('ww_commissioning', 'photos_taken', v)} />
            <TextArea label="Notes" value={com.notes ?? ''} onChangeText={(v) => setSection('ww_commissioning', 'notes', v)} />
          </Card>
        </>
      )}
    </View>
  );
}

export function createEmptyMeter(deviceType: MeterDeviceType = 'A3RM'): Meter {
  return {
    id: createId('meter'),
    device_name: '',
    custom_name: defaultMeterCustomName(deviceType),
    device_type: deviceType,
    device_id: '',
    device_number: '',
    ww_prestart: {},
    ww_switchboard: {},
    ww_channels: Array.from(
      { length: deviceType === 'A6M' ? 6 : deviceType === 'A3RM' ? 3 : 0 },
      (_, index) => ({ ordinal: index + 1 }),
    ),
    ww_verification: {},
    ww_commissioning: {},
    ww_photos: { extra: [] },
  };
}

export function FormModal({
  visible,
  title,
  onClose,
  children,
  scroll = true,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  scroll?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <View
          style={{
            padding: spacing.lg,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <Text style={[typography.heading, { color: colors.foreground }]}>{title}</Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel={`Close ${title}`}
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}
          >
            <Text style={{ color: colors.primary, fontWeight: '700' }}>Close</Text>
          </Pressable>
        </View>
        {scroll ? (
          <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}>{children}</ScrollView>
        ) : (
          <View style={{ flex: 1 }}>{children}</View>
        )}
      </View>
    </Modal>
  );
}
