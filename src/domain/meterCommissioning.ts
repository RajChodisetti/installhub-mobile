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
  if (purpose === 'MAIN_SUPPLY') return 'Main supply';
  if (purpose === 'SUB_CIRCUIT') return 'Sub-circuit or site asset';
  if (purpose === 'SPARE') return 'Spare / unused';
  return 'Choose channels that measure the same thing';
}

export function phaseGroupingLabel(
  phaseMode: MeasurementAssignment['phaseMode'] | '',
): string {
  if (phaseMode === 'SINGLE_PHASE') return 'Single phase · 1 channel';
  if (phaseMode === 'THREE_PHASE') return 'Three phase · 3 channels';
  if (phaseMode === 'OTHER') return 'Custom grouping';
  return 'Choose phase grouping';
}

export function energyFlowLabel(
  direction: MeasurementDirection | '',
): string {
  if (direction === 'CONSUMPTION') return 'Consumes energy';
  if (direction === 'GENERATION') return 'Generates energy';
  if (direction === 'BIDIRECTIONAL') return 'Can consume or generate';
  return 'Choose energy flow';
}

export function measuredItemTypeLabel(
  kind: MeasurementTarget['kind'] | '',
): string {
  if (kind === 'GRID_BOUNDARY') return 'Incoming grid connection';
  if (kind === 'SITE_ASSET') return 'Site asset / equipment';
  if (kind === 'BOARD') return 'Switchboard';
  if (kind === 'TBC') return 'To be confirmed';
  return 'Choose what is measured';
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
 * Fixed Wattwatchers models own exact channel counts. Switching into Other
 * starts an explicit definition instead of silently inheriting three A3RM
 * channels; subsequent Other edits preserve the installer's channel list.
 */
export function channelsAfterDeviceTypeChange(
  currentType: MeterDeviceType,
  nextType: MeterDeviceType,
  channels: WattwatcherChannel[],
): WattwatcherChannel[] {
  if (nextType === 'Other') return currentType === 'Other' ? channels : [];
  const count = nextType === 'A6M' ? 6 : 3;
  return [
    ...channels,
    ...Array.from({ length: count }, (_, index) => ({ ordinal: index + 1 })),
  ].slice(0, count).map((channel, index) => ({
    ...channel,
    ordinal: index + 1,
  }));
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
    load_type: undefined,
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
    'auditor.switchboard_type': board.asset_type,
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
      load_type: isSpare ? undefined : persistedLoad,
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
