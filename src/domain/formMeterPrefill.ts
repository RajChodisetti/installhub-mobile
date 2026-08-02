import type {
  FormValue,
  MeterChannelPurpose,
  MeterDevice,
  SiteAssetTypeCode,
} from '../types';

export const WW_CHANNEL_PURPOSE_FORM_OPTIONS = [
  'Main board supply',
  'Sub-circuit / asset',
  'Spare / unused',
] as const;

const FORM_PURPOSE_BY_CANONICAL: Record<MeterChannelPurpose, string> = {
  MAIN_SUPPLY: 'Main board supply',
  SUB_CIRCUIT: 'Sub-circuit / asset',
  SPARE: 'Spare / unused',
};

const FORM_LOAD_BY_CANONICAL: Partial<Record<SiteAssetTypeCode, string>> = {
  PV: 'Solar PV',
  HVAC: 'HVAC',
  LIGHTING: 'Lighting',
  EV_CHARGER: 'Other',
  VEHICLE_HOIST: 'Other',
  FORKLIFT: 'Forklift Charger',
  EXHAUST_FAN_SYSTEM: 'Other',
  POWER_OUTLET: 'General Power',
  HEATER_GEYSER: 'Hot Water',
  OTHER: 'Other',
};

const LEGACY_LOAD_BY_CANONICAL: Record<SiteAssetTypeCode, string> = {
  PV: 'Solar PV',
  HVAC: 'HVAC',
  LIGHTING: 'Lighting',
  EV_CHARGER: 'EV Charger',
  VEHICLE_HOIST: 'Vehicle Hoist',
  FORKLIFT: 'Forklift Charger',
  EXHAUST_FAN_SYSTEM: 'Exhaust / Fan System',
  POWER_OUTLET: 'General Power',
  HEATER_GEYSER: 'Hot Water',
  OTHER: 'Other',
};

export function channelPurposeFromFormAnswer(
  purpose: FormValue | undefined,
  load: FormValue | undefined,
): MeterChannelPurpose {
  const value = String(purpose ?? '');
  if (value === 'MAIN_SUPPLY' || value === 'Main board supply') return 'MAIN_SUPPLY';
  if (value === 'SUB_CIRCUIT' || value === 'Sub-circuit / asset') return 'SUB_CIRCUIT';
  if (value === 'SPARE' || value === 'Spare / unused') return 'SPARE';

  const legacyLoad = String(load ?? '');
  if (!legacyLoad.trim() || legacyLoad === 'Not Used') return 'SPARE';
  if (legacyLoad === 'Mains Supply') return 'MAIN_SUPPLY';
  return 'SUB_CIRCUIT';
}

export function completedFormLoadType(
  selectedLoad: FormValue | undefined,
  customLoadType: FormValue | undefined,
): string {
  const load = String(selectedLoad ?? '');
  const custom = String(customLoadType ?? '').trim();
  return load === 'Other' && custom ? custom : load;
}

/** Snapshot an existing canonical Wattwatchers device into a new WW draft. */
export function installationFormAnswersForMeter(
  meter: MeterDevice,
): Record<string, FormValue> {
  const answers: Record<string, FormValue> = {
    'device.id': meter.serialNumber,
    'device.number': meter.deviceNumber ?? '',
  };
  if (meter.deviceModel === 'A3RM' || meter.deviceModel === 'A6M') {
    answers['device.type'] = meter.deviceModel;
  }

  const channelLimit = meter.deviceModel === 'A3RM'
    ? 3
    : meter.deviceModel === 'A6M'
      ? 6
      : 0;
  const seenOrdinals = new Set<number>();
  for (const channel of [...meter.channels].sort(
    (left, right) => left.ordinal - right.ordinal || left.id.localeCompare(right.id),
  )) {
    if (channel.ordinal < 1 || channel.ordinal > channelLimit || seenOrdinals.has(channel.ordinal)) {
      continue;
    }
    seenOrdinals.add(channel.ordinal);
    const prefix = `channel.${channel.ordinal}`;
    answers[`${prefix}.purpose`] = FORM_PURPOSE_BY_CANONICAL[channel.purpose];
    if (channel.purpose === 'SPARE') continue;

    if (channel.purpose === 'MAIN_SUPPLY') {
      answers[`${prefix}.load`] = 'Mains Supply';
    } else if (channel.loadTypeCode) {
      const formLoad = FORM_LOAD_BY_CANONICAL[channel.loadTypeCode];
      if (formLoad) answers[`${prefix}.load`] = formLoad;
      const retainedCanonicalLoad = channel.loadTypeCode === 'OTHER'
        ? channel.customLoadTypeName?.trim()
        : LEGACY_LOAD_BY_CANONICAL[channel.loadTypeCode];
      if (formLoad === 'Other' && retainedCanonicalLoad) {
        answers[`${prefix}.custom_load_type`] = retainedCanonicalLoad;
      }
    }
    if (channel.sensorRating !== undefined) {
      answers[`${prefix}.rating`] = channel.sensorRating;
    }
    if (channel.description !== undefined) {
      answers[`${prefix}.description`] = channel.description;
    }
  }
  return answers;
}
