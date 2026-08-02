import type {
  ElectricalAsset,
  FormSubmission,
  FormValue,
  MeasurementAssignment,
  Meter,
  MeterDeviceType,
  WattwatcherChannel,
} from '../types';
import {
  channelPurposeFromFormAnswer,
  completedFormLoadType,
} from './formMeterPrefill';

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

/**
 * Board identity in a commissioning form is a projection of the canonical
 * board, never a second editable copy. Applying it again at completion also
 * protects drafts created by older app versions.
 */
export function answersWithCanonicalBoardContext(
  answers: Record<string, FormValue>,
  board: ElectricalAsset,
): Record<string, FormValue> {
  return {
    ...answers,
    'auditor.switchboard_name': board.asset_name,
    'auditor.switchboard_location': board.location_description ?? '',
    'auditor.switchboard_type': board.asset_type,
    'auditor.site_nmi': board.site_nmi ?? '',
  };
}

/** Build the single stable operational meter owned by a WW commissioning form. */
export function meterFromInstallationForm(
  form: FormSubmission,
  board: ElectricalAsset,
  meterId: string,
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
  const deviceIdKey = form.form_type === 'ww-installation'
    ? 'device.id'
    : 'auditor.serial_number';
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
    device_name: `${deviceType} Auditor`,
    device_type: deviceType,
    device_id: String(form.answers[deviceIdKey] ?? ''),
    device_number: String(form.answers['device.number'] ?? ''),
    ww_channels: channels,
  };
}
