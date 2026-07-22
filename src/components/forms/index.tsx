import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type {
  BoardType,
  ElectricalAsset,
  Installation,
  Meter,
  MeterDeviceType,
  SiteAsset,
  SiteAssetType,
  WattwatcherChannel,
} from '../../types';
import { BOARD_TYPES, METER_DEVICE_TYPES, SITE_ASSET_TYPES } from '../../types';
import { createId } from '../../utils';
import { useTheme } from '../../context/AppProviders';
import { Button, Card, TextArea, TextField, SectionHeader } from '../ui';
import { BarcodeScanField, withLegacyOption } from '../BarcodeScanField';
import { radii, spacing, typography } from '../../theme';

function SelectChips<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: T[];
  onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={[typography.label, { color: colors.mutedForeground, marginBottom: 8 }]}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((opt) => {
          const active = opt === value;
          return (
            <Pressable
              key={opt}
              onPress={() => onChange(opt)}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderRadius: radii.full,
                backgroundColor: active ? colors.primary : colors.muted,
              }}
            >
              <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontSize: 12, fontWeight: '600' }}>
                {opt}
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
      <Switch value={!!value} onValueChange={onChange} />
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
  }) => Promise<void> | void;
  submitLabel?: string;
}) {
  const [client_name, setClient] = useState(initial?.client_name ?? '');
  const [site_name, setSite] = useState(initial?.site_name ?? '');
  const [site_address, setAddress] = useState(initial?.site_address ?? '');
  const [inspector_name, setInspector] = useState(initial?.inspector_name ?? '');
  const [audit_date, setDate] = useState(initial?.audit_date ?? new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  return (
    <View>
      <TextField label="Client name" value={client_name} onChangeText={setClient} />
      <TextField label="Site name" value={site_name} onChangeText={setSite} />
      <TextArea label="Site address" value={site_address} onChangeText={setAddress} />
      <TextField label="Inspector" value={inspector_name} onChangeText={setInspector} />
      <TextField label="Audit date (YYYY-MM-DD)" value={audit_date} onChangeText={setDate} />
      <Button
        title={busy ? 'Saving…' : submitLabel}
        disabled={busy || !client_name || !site_name}
        onPress={async () => {
          setBusy(true);
          try {
            await onSubmit({ client_name, site_name, site_address, inspector_name, audit_date });
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
  onSubmit,
}: {
  initial?: Partial<ElectricalAsset>;
  onSubmit: (values: Omit<ElectricalAsset, 'id' | 'created_at' | 'updated_at' | 'meters' | 'extra_photos'> & {
    meters?: Meter[];
  }) => Promise<void> | void;
}) {
  const [asset_name, setName] = useState(initial?.asset_name ?? '');
  const [display_code, setCode] = useState(initial?.display_code ?? '');
  const [asset_type, setType] = useState<BoardType>(initial?.asset_type ?? 'DB');
  const [location_description, setLoc] = useState(initial?.location_description ?? '');
  const [phase, setPhase] = useState(initial?.phase ?? '3P+N');
  const [amperage_rating, setAmps] = useState(initial?.amperage_rating ?? '');
  const [site_nmi, setNmi] = useState(initial?.site_nmi ?? '');
  const [electrical_parent_tbc, setTbc] = useState(!!initial?.electrical_parent_tbc);
  const [comments, setComments] = useState(initial?.comments ?? '');
  const [busy, setBusy] = useState(false);

  return (
    <View>
      <TextField label="Board name" value={asset_name} onChangeText={setName} />
      <TextField label="Display code" value={display_code} onChangeText={setCode} />
      <SelectChips label="Board type" value={asset_type} options={BOARD_TYPES} onChange={setType} />
      <TextArea label="Location" value={location_description} onChangeText={setLoc} />
      <TextField label="Phase" value={phase} onChangeText={setPhase} />
      <TextField label="Amperage" value={amperage_rating} onChangeText={setAmps} />
      <TextField label="Site NMI" value={site_nmi} onChangeText={setNmi} />
      <BoolRow label="Electrical parent TBC" value={electrical_parent_tbc} onChange={setTbc} />
      <TextArea label="Comments" value={comments} onChangeText={setComments} />
      <Button
        title={busy ? 'Saving…' : 'Save board'}
        disabled={busy || !asset_name}
        onPress={async () => {
          setBusy(true);
          try {
            await onSubmit({
              audit_id: initial?.audit_id ?? '',
              zone_id: initial?.zone_id ?? '',
              asset_name,
              display_code: display_code || asset_name,
              asset_type,
              location_description,
              phase,
              amperage_rating,
              site_nmi,
              electrical_parent_id: electrical_parent_tbc ? null : initial?.electrical_parent_id ?? null,
              electrical_parent_tbc,
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
  onSubmit,
}: {
  initial?: Partial<SiteAsset>;
  onSubmit: (values: Omit<SiteAsset, 'id' | 'created_at' | 'updated_at' | 'extra_photos' | 'meter_channels'> & {
    meter_channels?: SiteAsset['meter_channels'];
  }) => Promise<void> | void;
}) {
  const [asset_name, setName] = useState(initial?.asset_name ?? '');
  const [asset_type, setType] = useState<SiteAssetType>(initial?.asset_type ?? 'Other');
  const [display_code, setCode] = useState(initial?.display_code ?? '');
  const [location_description, setLoc] = useState(initial?.location_description ?? '');
  const [electrical_board_tbc, setBoardTbc] = useState(!!initial?.electrical_board_tbc);
  const [meter_present, setMeterPresent] = useState(!!initial?.meter_present);
  const [comments, setComments] = useState(initial?.comments ?? '');
  const [busy, setBusy] = useState(false);

  return (
    <View>
      <TextField label="Asset name" value={asset_name} onChangeText={setName} />
      <SelectChips label="Asset type" value={asset_type} options={SITE_ASSET_TYPES} onChange={setType} />
      <TextField label="Display code" value={display_code} onChangeText={setCode} />
      <TextArea label="Location" value={location_description} onChangeText={setLoc} />
      <BoolRow label="Electrical board TBC" value={electrical_board_tbc} onChange={setBoardTbc} />
      <BoolRow label="Meter present" value={meter_present} onChange={setMeterPresent} />
      <TextArea label="Comments" value={comments} onChangeText={setComments} />
      <Button
        title={busy ? 'Saving…' : 'Save asset'}
        disabled={busy || !asset_name}
        onPress={async () => {
          setBusy(true);
          try {
            await onSubmit({
              audit_id: initial?.audit_id ?? '',
              zone_id: initial?.zone_id ?? '',
              asset_name,
              asset_type,
              display_code,
              location_description,
              location_photo: initial?.location_photo ?? '',
              electrical_board_id: electrical_board_tbc ? null : initial?.electrical_board_id ?? null,
              electrical_board_tbc,
              meter_present,
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
const ROGOWSKI = ['3000A-9cm', '3000A-20cm', '3000A-29cm', 'Not Used'];
const CT_RATINGS = ['CT-60A', 'CT-120A', 'CT-200A', 'CT-400A', 'CT-600A', 'Not Used'];

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
  const channelCount = deviceType === 'A6M' ? 6 : 3;
  const channels: WattwatcherChannel[] = [
    ...(data.ww_channels ?? []),
    ...Array.from({ length: channelCount }, () => ({})),
  ].slice(0, channelCount);
  const isA6M = deviceType === 'A6M';
  const isA3RM = deviceType === 'A3RM';

  const setSection = <K extends keyof Meter>(section: K, key: string, val: unknown) => {
    const prev = (data[section] as Record<string, unknown>) || {};
    onChange({ ...data, [section]: { ...prev, [key]: val } });
  };

  const setChannel = (idx: number, key: string, val: string) => {
    const next = channels.map((c, i) => (i === idx ? { ...c, [key]: val } : c));
    onChange({ ...data, ww_channels: next });
  };

  const pre = data.ww_prestart || {};
  const sb = data.ww_switchboard || {};
  const ver = data.ww_verification || {};
  const com = data.ww_commissioning || {};

  return (
    <View style={{ gap: spacing.md }}>
      <Card>
        <SectionHeader title={`${deviceType} identity`} />
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
          onChange={(v) => onChange({ ...data, device_type: v })}
        />
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

      {channels.map((ch, idx) => (
        <Card key={`ch-${idx}`}>
          <SectionHeader title={`Channel ${idx + 1}`} />
          <SelectChips
            label="Purpose"
            value={(ch.purpose as (typeof CHANNEL_PURPOSES)[number]) || 'SPARE'}
            options={[...CHANNEL_PURPOSES]}
            onChange={(v) => setChannel(idx, 'purpose', v)}
          />
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
                  value={(ch.ct_ratio as string) || 'Not Used'}
                  options={withLegacyOption(CT_RATINGS, ch.ct_ratio)}
                  onChange={(v) => setChannel(idx, 'ct_ratio', v)}
                />
              ) : null}
              {isA3RM ? (
                <SelectChips
                  label="Rogowski coil"
                  value={(ch.rogowski_size as string) || 'Not Used'}
                  options={withLegacyOption(ROGOWSKI, ch.rogowski_size)}
                  onChange={(v) => setChannel(idx, 'rogowski_size', v)}
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
    ww_channels: Array.from({ length: deviceType === 'A6M' ? 6 : 3 }, () => ({})),
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
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
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
          <Pressable onPress={onClose}>
            <Text style={{ color: colors.primary, fontWeight: '700' }}>Close</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 40 }}>{children}</ScrollView>
      </View>
    </Modal>
  );
}
