import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type {
  BoardTypeCode,
  ElectricalAsset,
  ElectricalSource,
  GridSupply,
  Installation,
  Meter,
  MeterDeviceType,
  SiteAsset,
  SiteAssetTypeCode,
  WattwatcherChannel,
} from '../../types';
import { BOARD_TYPE_CODES, METER_DEVICE_TYPES, SITE_ASSET_TYPE_CODES } from '../../types';
import {
  BOARD_TYPE_LABELS,
  SITE_ASSET_TYPE_LABELS,
  boardTypeCode,
  boardTypeFromCode,
  siteAssetTypeCode,
  siteAssetTypeFromCode,
} from '../../domain/installationV2';
import { createId } from '../../utils';
import { useTheme } from '../../context/AppProviders';
import { Button, Card, TextArea, TextField, SectionHeader } from '../ui';
import { BarcodeScanField, withLegacyOption } from '../BarcodeScanField';
import {
  channelAfterPurposeChange,
  channelsAfterDeviceTypeChange,
} from '../../domain/meterCommissioning';
import { radii, spacing, typography } from '../../theme';

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
}: {
  label: string;
  value?: boolean;
  onChange: (v: boolean) => void;
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
        accessibilityState={{ checked: Boolean(value) }}
      />
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
    site_address: string;
    inspector_name: string;
    audit_date: string;
    timezone?: string;
  }) => Promise<void> | void;
  submitLabel?: string;
}) {
  const [client_name, setClient] = useState(initial?.client_name ?? '');
  const [site_name, setSite] = useState(initial?.site_name ?? '');
  const [site_address, setAddress] = useState(initial?.site_address ?? '');
  const [inspector_name, setInspector] = useState(initial?.inspector_name ?? '');
  const [audit_date, setDate] = useState(initial?.audit_date ?? new Date().toISOString().slice(0, 10));
  const [timezone, setTimezone] = useState(
    initial?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [busy, setBusy] = useState(false);

  return (
    <View>
      <TextField label="Client name" value={client_name} onChangeText={setClient} />
      <TextField label="Site name" value={site_name} onChangeText={setSite} />
      <TextArea label="Site address" value={site_address} onChangeText={setAddress} />
      <TextField label="Inspector" value={inspector_name} onChangeText={setInspector} />
      <TextField label="Audit date (YYYY-MM-DD)" value={audit_date} onChangeText={setDate} />
      <TextField
        label="Installation timezone"
        accessibilityHint="Use an IANA timezone such as Australia/Sydney"
        value={timezone}
        onChangeText={setTimezone}
      />
      <Button
        title={busy ? 'Saving…' : submitLabel}
        disabled={busy || !client_name || !site_name}
        onPress={async () => {
          setBusy(true);
          try {
            await onSubmit({ client_name, site_name, site_address, inspector_name, audit_date, timezone: timezone.trim() });
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
  onSubmit,
}: {
  initial?: Partial<ElectricalAsset>;
  sourceBoards?: ElectricalAsset[];
  gridSupplies?: GridSupply[];
  onSubmit: (values: Omit<ElectricalAsset, 'id' | 'created_at' | 'updated_at' | 'meters' | 'extra_photos'> & {
    meters?: Meter[];
  }) => Promise<void> | void;
}) {
  const { colors } = useTheme();
  const [asset_name, setName] = useState(initial?.asset_name ?? '');
  const [display_code, setCode] = useState(initial?.display_code ?? '');
  const [customCode, setCustomCode] = useState(Boolean(initial?.display_code_meta?.isOverridden));
  const [type_code, setTypeCode] = useState<BoardTypeCode>(
    initial?.type_code ?? boardTypeCode(initial?.asset_type ?? 'DB'),
  );
  const [custom_type_name, setCustomTypeName] = useState(initial?.custom_type_name ?? '');
  const [location_description, setLoc] = useState(initial?.location_description ?? '');
  const [phase, setPhase] = useState(initial?.phase ?? '3P+N');
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
  const [busy, setBusy] = useState(false);

  return (
    <View>
      <TextField label="Board name" value={asset_name} onChangeText={setName} />
      <SelectChips
        label="Board type"
        value={type_code}
        options={BOARD_TYPE_CODES}
        getLabel={(value) => BOARD_TYPE_LABELS[value]}
        onChange={setTypeCode}
      />
      {type_code === 'OTHER' ? (
        <TextField label="Custom board type" value={custom_type_name} onChangeText={setCustomTypeName} />
      ) : null}
      <BoolRow label="Use custom display code" value={customCode} onChange={setCustomCode} />
      {customCode ? (
        <TextField label="Custom display code" value={display_code} onChangeText={setCode} />
      ) : (
        <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>
          A provisional site/type/sequence code will be generated automatically.
        </Text>
      )}
      <SelectChips
        label="Electrical source"
        value={sourceKey}
        options={[
          ...gridSupplies.map((grid) => `GRID:${grid.id}`),
          ...sourceBoards.filter((board) => board.id !== initial?.id).map((board) => `BOARD:${board.id}`),
          'TBC',
        ]}
        getLabel={(value) => {
          if (value === 'TBC') return 'To be confirmed';
          if (value.startsWith('GRID:')) {
            const grid = gridSupplies.find((item) => `GRID:${item.id}` === value);
            return grid ? `${grid.name}${grid.isDefault ? ' · default' : ''}` : 'Grid supply';
          }
          const board = sourceBoards.find((item) => `BOARD:${item.id}` === value);
          return board ? `${board.display_code} · ${board.asset_name}` : 'Board';
        }}
        onChange={setSourceKey}
      />
      <TextArea label="Location" value={location_description} onChangeText={setLoc} />
      <TextField label="Phase" value={phase} onChangeText={setPhase} />
      <TextField label="Amperage" value={amperage_rating} onChangeText={setAmps} />
      <TextField label="Site NMI" value={site_nmi} onChangeText={setNmi} />
      <TextArea label="Comments" value={comments} onChangeText={setComments} />
      <Button
        title={busy ? 'Saving…' : 'Save board'}
        disabled={busy || !asset_name}
        onPress={async () => {
          setBusy(true);
          try {
            const electrical_source: ElectricalSource = sourceKey === 'TBC'
              ? { kind: 'TBC' }
              : sourceKey.startsWith('GRID:')
                ? { kind: 'GRID', gridSupplyId: sourceKey.slice(5) }
                : { kind: 'BOARD', boardId: sourceKey.slice(6) };
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
              phase,
              amperage_rating,
              site_nmi,
              electrical_parent_id: electrical_source.kind === 'BOARD' ? electrical_source.boardId : null,
              electrical_parent_tbc: electrical_source.kind === 'TBC',
              photo: initial?.photo ?? '',
              meter_present: (initial?.meters?.length ?? 0) > 0,
              sub_circuits_description: initial?.sub_circuits_description ?? '',
              comments,
              meters: initial?.meters,
            });
          } finally {
            setBusy(false);
          }
        }}
      />
    </View>
  );
}

export function SiteAssetForm({
  initial,
  sourceBoards = [],
  gridSupplies = [],
  onSubmit,
}: {
  initial?: Partial<SiteAsset>;
  sourceBoards?: ElectricalAsset[];
  gridSupplies?: GridSupply[];
  onSubmit: (values: Omit<SiteAsset, 'id' | 'created_at' | 'updated_at' | 'extra_photos' | 'meter_channels'> & {
    meter_channels?: SiteAsset['meter_channels'];
  }) => Promise<void> | void;
}) {
  const { colors } = useTheme();
  const [asset_name, setName] = useState(initial?.asset_name ?? '');
  const [type_code, setTypeCode] = useState<SiteAssetTypeCode>(
    initial?.type_code ?? siteAssetTypeCode(initial?.asset_type ?? 'Other'),
  );
  const [custom_type_name, setCustomTypeName] = useState(initial?.custom_type_name ?? '');
  const [display_code, setCode] = useState(initial?.display_code ?? '');
  const [customCode, setCustomCode] = useState(Boolean(initial?.display_code_meta?.isOverridden));
  const [location_description, setLoc] = useState(initial?.location_description ?? '');
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
  const [comments, setComments] = useState(initial?.comments ?? '');
  const [busy, setBusy] = useState(false);

  return (
    <View>
      <TextField label="Asset name" value={asset_name} onChangeText={setName} />
      <SelectChips
        label="Asset type"
        value={type_code}
        options={SITE_ASSET_TYPE_CODES}
        getLabel={(value) => SITE_ASSET_TYPE_LABELS[value]}
        onChange={setTypeCode}
      />
      {type_code === 'OTHER' ? (
        <TextField label="Custom asset type" value={custom_type_name} onChangeText={setCustomTypeName} />
      ) : null}
      <BoolRow label="Use custom display code" value={customCode} onChange={setCustomCode} />
      {customCode ? <TextField label="Custom display code" value={display_code} onChangeText={setCode} /> : null}
      <SelectChips
        label="Electrical source"
        value={sourceKey}
        options={[
          ...gridSupplies.map((grid) => `GRID:${grid.id}`),
          ...sourceBoards.map((board) => `BOARD:${board.id}`),
          'TBC',
        ]}
        getLabel={(value) => {
          if (value === 'TBC') return 'To be confirmed';
          if (value.startsWith('GRID:')) {
            const grid = gridSupplies.find((item) => `GRID:${item.id}` === value);
            return grid ? `${grid.name}${grid.isDefault ? ' · default' : ''}` : 'Grid supply';
          }
          const board = sourceBoards.find((item) => `BOARD:${item.id}` === value);
          return board ? `${board.display_code} · ${board.asset_name}` : 'Board';
        }}
        onChange={setSourceKey}
      />
      <TextArea label="Location" value={location_description} onChangeText={setLoc} />
      <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>
        Metering: {meteringState.kind}. Confirm unmetered/TBC transitions and exact meter-channel mapping in Reconciliation.
      </Text>
      <TextArea label="Comments" value={comments} onChangeText={setComments} />
      <Button
        title={busy ? 'Saving…' : 'Save asset'}
        disabled={busy || !asset_name}
        onPress={async () => {
          setBusy(true);
          try {
            const electrical_source: ElectricalSource = sourceKey === 'TBC'
              ? { kind: 'TBC' }
              : sourceKey.startsWith('GRID:')
                ? { kind: 'GRID', gridSupplyId: sourceKey.slice(5) }
                : { kind: 'BOARD', boardId: sourceKey.slice(6) };
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
              location_photo: initial?.location_photo ?? '',
              electrical_source,
              electrical_board_id: electrical_source.kind === 'BOARD' ? electrical_source.boardId : null,
              electrical_board_tbc: electrical_source.kind === 'TBC',
              metering_state: meteringState,
              meter_present: meteringState.kind === 'METERED',
              meter_switchboard_id: initial?.meter_switchboard_id ?? null,
              meter_switchboard_tbc: initial?.meter_switchboard_tbc ?? false,
              meter_channels: initial?.meter_channels ?? [],
              comments,
            });
          } finally {
            setBusy(false);
          }
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
const ROGOWSKI = ['3000A - 9cm', '3000A - 20cm', '3000A - 29cm'];
const CT_RATINGS = ['60A', '120A', '200A', '400A', '600A'];

export function WattwatcherForm({
  deviceType,
  data,
  onChange,
}: {
  deviceType: MeterDeviceType;
  data: Partial<Meter>;
  onChange: (next: Partial<Meter>) => void;
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
          value={data.device_name ?? ''}
          onChangeText={(v) => onChange({ ...data, device_name: v })}
        />
        <BarcodeScanField
          label="Device number"
          value={data.device_number ?? ''}
          onChangeText={(v) => onChange({ ...data, device_number: v })}
          placeholder="e.g. D001"
        />
        <BarcodeScanField
          label="Device ID / serial"
          value={data.device_id ?? ''}
          onChangeText={(v) => onChange({ ...data, device_id: v })}
          placeholder="e.g. DD03710160579"
        />
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
            onChange({ ...data, device_type: value, ww_channels: nextChannels });
          }}
        />
        {isOther ? (
          <>
            <TextField
              label="Manufacturer"
              value={data.custom_manufacturer_name ?? ''}
              onChangeText={(value) => onChange({ ...data, custom_manufacturer_name: value })}
            />
            <TextField
              label="Custom model"
              value={data.custom_model_name ?? ''}
              onChangeText={(value) => onChange({ ...data, custom_model_name: value })}
            />
          </>
        ) : null}
      </Card>

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
        <TextField label="Antenna" value={sb.antenna_type ?? ''} onChangeText={(v) => setSection('ww_switchboard', 'antenna_type', v)} />
        <TextField label="Signal" value={sb.signal_strength ?? ''} onChangeText={(v) => setSection('ww_switchboard', 'signal_strength', v)} />
        <TextArea label="Notes" value={sb.notes ?? ''} onChangeText={(v) => setSection('ww_switchboard', 'notes', v)} />
      </Card>

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

      {isOther ? (
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
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>
          Photos upload will use cloud API later. Local URIs can be attached in a future iteration.
        </Text>
      </Card>
    </View>
  );
}

export function createEmptyMeter(deviceType: MeterDeviceType = 'A3RM'): Meter {
  return {
    id: createId('meter'),
    device_name: '',
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
