import type { MeterDeviceType, WattwatcherChannel } from '../types';

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
