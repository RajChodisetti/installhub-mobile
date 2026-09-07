import type {
  ElectricalAsset,
  FormSubmission,
  FormValue,
  MeasurementAssignment,
  MeasurementDirection,
  MeasurementTarget,
  Meter,
  MeterChannelPurpose,
  MeterDeviceType,
  WattwatcherPrestart,
  WattwatcherChannel,
} from '../types';
import {
  channelPurposeFromFormAnswer,
  completedFormLoadType,
} from './formMeterPrefill';
import { defaultMeterCustomName } from './namingV2';

const WW_SWITCHBOARD_ANSWER_BY_CODE: Record<string, string> = {
  MSB: 'Main switchboard',
  MSSB: 'Main sub-switchboard',
  DB: 'Distribution board',
  HVAC_DB: 'HVAC distribution board',
  LX_DB: 'Lighting distribution board',
  PV_DB: 'Solar / PV distribution board',
  MCC: 'Motor control centre',
};

/** The portal stores the canonical board's human label in the hidden WW report
 * answer. Keep the local code on the board itself, but emit the same form value
 * so an equivalent commissioning operation has the same backend state. */
export function canonicalWwSwitchboardTypeAnswer(
  board: Pick<ElectricalAsset, 'asset_type' | 'type_code' | 'custom_type_name'>,
): string {
  const code = board.type_code ?? ({
    'HVAC-DB': 'HVAC_DB',
    'LX-DB': 'LX_DB',
    'PV-DB': 'PV_DB',
    Other: 'OTHER',
  } as Record<string, string>)[board.asset_type] ?? board.asset_type;
  if (code === 'OTHER') return board.custom_type_name?.trim() || 'Other';
  return WW_SWITCHBOARD_ANSWER_BY_CODE[code] ?? board.asset_type;
}

/** Direct custom-meter capture owns identity, channel metadata, relationships,
 * notes and evidence, but not the Wattwatchers commissioning questionnaire. */
export function showsWattwatchersCommissioningSections(
  deviceType: MeterDeviceType,
): boolean {
  return deviceType !== 'Other';
}

/** Field-facing labels for channel measurement capture. Persisted canonical
 * values stay unchanged while installers see the operational meaning. */
export function meterChannelPurposeLabel(
  purpose?: MeterChannelPurpose | null,
): string {
  if (purpose === 'MAIN_SUPPLY') return 'Main board supply';
  if (purpose === 'SUB_CIRCUIT') return 'Sub-circuit / asset';
  if (purpose === 'SPARE') return 'Spare / unused';
  return 'Choose channels that measure the same thing';
}

export function phaseGroupingLabel(
  phaseMode: MeasurementAssignment['phaseMode'] | '',
): string {
  if (phaseMode === 'SINGLE_PHASE') return 'Single phase — select 1 channel';
  if (phaseMode === 'THREE_PHASE') return 'Three phase — select 3 channels';
  if (phaseMode === 'OTHER') return 'Other observed grouping';
  return 'Select phase grouping';
}

export function energyFlowLabel(
  direction: MeasurementDirection | '',
): string {
  if (direction === 'CONSUMPTION') return 'Consumption';
  if (direction === 'GENERATION') return 'Generation';
  if (direction === 'BIDIRECTIONAL') return 'Bidirectional';
  return 'Select energy flow';
}

export function measuredItemTypeLabel(
  kind: MeasurementTarget['kind'] | '',
): string {
  if (kind === 'GRID_BOUNDARY') return 'Incoming grid connection';
  if (kind === 'SITE_ASSET') return 'Site asset';
  if (kind === 'BOARD') return 'Switchboard';
  if (kind === 'TBC') return 'To be confirmed';
  return 'Select measured item';
}

/**
 * A site asset can have only one direct meter owner. The current meter keeps
 * its existing target while targets owned by every other meter stay out of
 * the selectable candidate list.
 */
export function siteAssetTargetIdsOwnedByOtherMeters(
  assignments: Pick<MeasurementAssignment, 'meterId' | 'target'>[],
  currentMeterId?: string,
): Set<string> {
  return new Set(assignments.flatMap((assignment) =>
    assignment.target.kind === 'SITE_ASSET' && assignment.meterId !== currentMeterId
      ? [assignment.target.siteAssetId]
      : []));
}

/**
 * Fixed Wattwatchers models own exact channel counts. Other meters preserve
 * their explicit channels, always expose at least one, and keep display-order
 * ordinals aligned with the portal editor.
 */
export function channelsAfterDeviceTypeChange(
  currentType: MeterDeviceType,
  nextType: MeterDeviceType,
  channels: WattwatcherChannel[],
): WattwatcherChannel[] {
  const sensorCompatibleChannel = (channel: WattwatcherChannel): WattwatcherChannel => (
    currentType === nextType
      ? channelWithModelValidSensor(nextType, channel)
      : channelWithoutSensorMetadata(channel)
  );
  if (nextType === 'Other') {
    const customChannels = channels.length ? channels : [{ ordinal: 1, purpose: 'SPARE' }];
    return customChannels.map((channel, index) => ({
      ...sensorCompatibleChannel(channel),
      ordinal: index + 1,
      purpose: channel.purpose || 'SPARE',
    }));
  }
  const count = nextType === 'A6M' ? 6 : 3;
  return [
    ...channels,
    ...Array.from({ length: count }, (_, index) => ({ ordinal: index + 1, purpose: 'SPARE' as const })),
  ].slice(0, count).map((channel, index) => ({
    ...sensorCompatibleChannel(channel),
    ordinal: index + 1,
    purpose: channel.purpose || 'SPARE',
  }));
}

export function channelWithModelValidSensor(
  deviceType: MeterDeviceType,
  channel: WattwatcherChannel,
): WattwatcherChannel {
  if (deviceType === 'A6M') {
    const next = { ...channel };
    delete next.rogowski_size;
    return next;
  }
  if (deviceType === 'A3RM') {
    const next = { ...channel };
    delete next.ct_ratio;
    return next;
  }
  return channel;
}

function channelWithoutSensorMetadata(channel: WattwatcherChannel): WattwatcherChannel {
  const next = { ...channel };
  delete next.rogowski_size;
  delete next.ct_ratio;
  return next;
}

export function channelAfterSensorRatingChange(
  deviceType: MeterDeviceType,
  channel: WattwatcherChannel,
  value: string,
): WattwatcherChannel {
  if (deviceType === 'A6M') {
    const next = { ...channel, ct_ratio: value };
    delete next.rogowski_size;
    return next;
  }
  const next = { ...channel, rogowski_size: value };
  delete next.ct_ratio;
  return next;
}

/** Match the portal's visible channel-layout warning rules. */
export function meterChannelsNeedLayoutRepair(
  deviceType: MeterDeviceType,
  channels: WattwatcherChannel[],
): boolean {
  const expected = deviceType === 'A3RM' ? 3 : deviceType === 'A6M' ? 6 : null;
  return (expected !== null && channels.length !== expected)
    || channels.some((channel, index) => channel.ordinal !== index + 1);
}

/** Ensure editor actions operate on stable channel IDs before assignments are
 * created, removed, or filtered. Existing IDs are retained wherever possible. */
export function normalizedMeterEditorChannels(
  meterId: string,
  channels: WattwatcherChannel[],
): WattwatcherChannel[] {
  const used = new Set<string>();
  return channels.map((channel, index) => {
    let id = channel.id?.trim() || '';
    if (!id || used.has(id)) {
      let suffix = index + 1;
      id = `${meterId}:${suffix}`;
      while (used.has(id)) {
        suffix += 1;
        id = `${meterId}:${suffix}`;
      }
    }
    used.add(id);
    return {
      ...channel,
      id,
      ordinal: index + 1,
      purpose: channel.purpose || 'SPARE',
    };
  });
}

export function addCustomMeterChannel(
  meterId: string,
  channels: WattwatcherChannel[],
): WattwatcherChannel[] {
  const normalized = normalizedMeterEditorChannels(meterId, channels);
  const used = new Set(normalized.map((channel) => channel.id));
  let suffix = 1;
  while (used.has(`${meterId}:${suffix}`)) suffix += 1;
  return [...normalized, {
    id: `${meterId}:${suffix}`,
    ordinal: normalized.length + 1,
    purpose: 'SPARE',
  }];
}

export function removeCustomMeterChannel(
  meterId: string,
  channels: WattwatcherChannel[],
  index: number,
): { channels: WattwatcherChannel[]; removedChannelId?: string } {
  const normalized = normalizedMeterEditorChannels(meterId, channels);
  const removedChannelId = normalized[index]?.id;
  return {
    removedChannelId,
    channels: normalized
      .filter((_, channelIndex) => channelIndex !== index)
      .map((channel, channelIndex) => ({ ...channel, ordinal: channelIndex + 1 })),
  };
}

/** Spare channels retain identity/capabilities but cannot carry load/sensor details. */
export function channelAfterPurposeChange(
  channel: WattwatcherChannel,
  purpose: string,
): WattwatcherChannel {
  if (purpose !== 'SPARE') return { ...channel, purpose };
  return {
    ...channel,
    purpose,
    phase_label: undefined,
    load_type: undefined,
    custom_load_type_name: undefined,
    rogowski_size: undefined,
    description: undefined,
    ct_ratio: undefined,
  };
}

export function deviceLabelPrefix(siteName: string, zoneName: string): string {
  return [siteName.trim(), zoneName.trim()].filter(Boolean).join(' - ');
}

export function humanDeviceLabel(
  prefix: string,
  deviceType: MeterDeviceType,
  serialNumber = '',
): string {
  const normalizedPrefix = prefix.trim();
  const normalizedSerial = serialNumber.trim();
  const serialToken = normalizedSerial.length > 20
    ? normalizedSerial.slice(-20)
    : normalizedSerial;
  const suffix = ` - ${deviceType}${serialToken ? ` - ${serialToken}` : ''}`;
  if (!normalizedPrefix) return `${deviceType}${serialToken ? ` - ${serialToken}` : ' Auditor'}`;
  return `${normalizedPrefix.slice(0, 64 - suffix.length).trimEnd()}${suffix}`;
}

/**
 * Board identity in a commissioning form is a projection of the canonical
 * board, never a second editable copy. Applying it again at completion also
 * protects drafts created by older app versions.
 */
export function answersWithCanonicalBoardContext(
  answers: Record<string, FormValue>,
  board: ElectricalAsset,
  gridNmi = board.site_nmi ?? '',
): Record<string, FormValue> {
  return {
    ...answers,
    'auditor.switchboard_name': board.asset_name,
    'auditor.switchboard_location': board.location_description ?? '',
    'auditor.switchboard_type': canonicalWwSwitchboardTypeAnswer(board),
    'auditor.site_nmi': gridNmi,
  };
}

const PRESTART_FORM_FIELDS = [
  ['site_induction', 'prestart.site_induction'],
  ['safe_access', 'prestart.safe_access'],
  ['correct_ppe', 'prestart.correct_ppe'],
  ['live_points_aware', 'prestart.live_points'],
  ['can_isolate', 'prestart.can_isolate'],
  ['additional_hazards', 'prestart.additional_hazards'],
  ['safe_to_proceed', 'prestart.safe_to_proceed'],
] as const satisfies ReadonlyArray<readonly [keyof WattwatcherPrestart, string]>;

function prestartFromFormAnswers(
  answers: Record<string, FormValue>,
  existing?: WattwatcherPrestart,
): WattwatcherPrestart | undefined {
  const prestart: WattwatcherPrestart = {};
  for (const [field, answerKey] of PRESTART_FORM_FIELDS) {
    const prior = existing?.[field];
    if (typeof prior === 'boolean') prestart[field] = prior;
    const answer = answers[answerKey];
    if (answer === 'yes') prestart[field] = true;
    if (answer === 'no') prestart[field] = false;
  }
  return Object.keys(prestart).length ? prestart : undefined;
}

/** Build the single stable operational meter owned by a WW commissioning form. */
export function meterFromInstallationForm(
  form: FormSubmission,
  board: ElectricalAsset,
  meterId: string,
  labelPrefix = '',
): Meter {
  if (!['ww-installation', 'a3rm-installation', 'a6m-installation'].includes(form.form_type)) {
    throw new Error('This form does not commission a Wattwatchers meter.');
  }
  const existing = board.meters.find((item) => item.id === meterId);
  const deviceType: MeterDeviceType = form.form_type === 'ww-installation'
    ? String(form.answers['device.type']) as MeterDeviceType
    : form.form_type === 'a3rm-installation'
      ? 'A3RM'
      : 'A6M';
  if (deviceType !== 'A3RM' && deviceType !== 'A6M') {
    throw new Error('Choose A3RM or A6M before completing this commissioning form.');
  }
  const channelCount = deviceType === 'A3RM' ? 3 : 6;
  const prestart = prestartFromFormAnswers(form.answers, existing?.ww_prestart);
  const deviceIdKey = form.form_type === 'ww-installation'
    ? 'device.id'
    : 'auditor.serial_number';
  const deviceId = String(form.answers[deviceIdKey] ?? '');
  const customName = String(form.answers['device.name'] ?? '').trim().slice(0, 64)
    || existing?.custom_name?.trim().slice(0, 64)
    || defaultMeterCustomName(deviceType);
  const channels = Array.from({ length: channelCount }, (_, index) => {
    const ordinal = index + 1;
    const load = String(form.answers[`channel.${ordinal}.load`] ?? '');
    const persistedLoad = completedFormLoadType(
      load,
      form.answers[`channel.${ordinal}.custom_load_type`],
    );
    const customLoadTypeName = load === 'Other'
      ? String(form.answers[`channel.${ordinal}.custom_load_type`] ?? '').trim() || undefined
      : undefined;
    const rating = String(form.answers[`channel.${ordinal}.rating`] ?? '');
    const previous = existing?.ww_channels?.find(
      (channel, previousIndex) => (channel.ordinal ?? previousIndex + 1) === ordinal,
    );
    const purpose = channelPurposeFromFormAnswer(
      form.answers[`channel.${ordinal}.purpose`],
      load,
    );
    const isSpare = purpose === 'SPARE';
    return {
      ...previous,
      id: previous?.id ?? `${meterId}:${ordinal}`,
      ordinal,
      purpose,
      load_type: isSpare ? undefined : load === 'Other' ? 'Other' : persistedLoad,
      custom_load_type_name: isSpare ? undefined : customLoadTypeName,
      description: isSpare
        ? undefined
        : String(form.answers[`channel.${ordinal}.description`] ?? ''),
      ...(deviceType === 'A3RM'
        ? { rogowski_size: isSpare ? undefined : rating, ct_ratio: undefined }
        : { ct_ratio: isSpare ? undefined : rating, rogowski_size: undefined }),
    } satisfies WattwatcherChannel;
  });
  return {
    ...(existing ?? {}),
    id: meterId,
    device_name: humanDeviceLabel(labelPrefix, deviceType, deviceId),
    custom_name: customName,
    device_type: deviceType,
    device_id: deviceId,
    device_number: String(form.answers['device.number'] ?? '').trim() || deviceId,
    ww_prestart: prestart,
    ww_channels: channels,
  };
}

/**
 * Turns optional editor rows into assignments accepted by the structural write
 * contract. Empty rows disappear. Malformed groups keep the first usable,
 * unique, same-purpose channel subset and become explicit TBC work instead of
 * blocking an otherwise unrelated meter save.
 */
export function structurallySavableMeterAssignments(
  assignments: MeasurementAssignment[],
  channels: WattwatcherChannel[],
): MeasurementAssignment[] {
  const purposeById = new Map(channels.map((channel) => [channel.id, channel.purpose]));
  const usedChannelIds = new Set<string>();

  return assignments.flatMap((assignment) => {
    if (!assignment.channelIds.length) return [];
    const retained: string[] = [];
    const localIds = new Set<string>();
    let sharedPurpose: WattwatcherChannel['purpose'] | undefined;
    let structurallyChanged = false;

    for (const channelId of assignment.channelIds) {
      const purpose = purposeById.get(channelId);
      if (
        localIds.has(channelId)
        || usedChannelIds.has(channelId)
        || !purpose
        || purpose === 'SPARE'
        || (sharedPurpose !== undefined && purpose !== sharedPurpose)
      ) {
        structurallyChanged = true;
        continue;
      }
      localIds.add(channelId);
      usedChannelIds.add(channelId);
      sharedPurpose = purpose;
      retained.push(channelId);
    }

    if (!retained.length) return [];
    const phaseMode = retained.length === 1
      ? 'SINGLE_PHASE'
      : retained.length === 3
        ? 'THREE_PHASE'
        : 'OTHER';
    structurallyChanged ||= phaseMode !== assignment.phaseMode
      || retained.length !== assignment.channelIds.length;
    const target = structurallyChanged ? { kind: 'TBC' as const } : assignment.target;
    return [{
      ...assignment,
      channelIds: retained,
      phaseMode,
      target,
      status: target.kind === 'TBC' ? 'TBC' : 'CONFIRMED',
    }];
  });
}
