import type { MeterDevice } from '../types';

export const MAX_REPLACEMENT_METERS = 50;
export const MAX_REPLACEMENT_METER_NUMBER_LENGTH = 200;
export const MAX_STORED_REPLACEMENT_METER_NUMBERS_LENGTH = 10_000;

export function normalizeReplacementMeterNumbers(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const candidate of values) {
    const value = candidate.trim();
    const key = value.toLocaleLowerCase('en-AU');
    if (!value || seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

export function replacementMeterNumbersFromStored(value?: string | null): string[] {
  return normalizeReplacementMeterNumbers(value?.split(/\r?\n/) ?? []);
}

export function storedReplacementMeterNumbers(values: readonly string[]): string | null {
  const normalized = normalizeReplacementMeterNumbers(values);
  if (!normalized.length) return null;
  if (normalized.some((meterNumber) => meterNumber.length > MAX_REPLACEMENT_METER_NUMBER_LENGTH)) {
    throw new Error(
      `Each meter to replace must use at most ${MAX_REPLACEMENT_METER_NUMBER_LENGTH} characters.`,
    );
  }
  if (normalized.length > MAX_REPLACEMENT_METERS) {
    throw new Error(`Select at most ${MAX_REPLACEMENT_METERS} unique meters to replace.`);
  }
  const stored = normalized.join('\n');
  if (stored.length > MAX_STORED_REPLACEMENT_METER_NUMBERS_LENGTH) {
    throw new Error(
      `Meters to replace must use at most ${MAX_STORED_REPLACEMENT_METER_NUMBERS_LENGTH.toLocaleString('en-AU')} characters in total.`,
    );
  }
  return stored;
}

export function plannedReplacementMeterNumber(
  stored: string | null | undefined,
  query: string,
): string | null {
  const key = query.trim().toLocaleLowerCase('en-AU');
  if (!key) return null;
  return replacementMeterNumbersFromStored(stored)
    .find((meterNumber) => meterNumber.toLocaleLowerCase('en-AU') === key) ?? null;
}

export function replacementMeterSuggestions(
  meters: readonly MeterDevice[],
): Array<{ meterId: string; meterNumber: string; label: string }> {
  const seen = new Set<string>();
  return meters.flatMap((meter) => {
    if (meter.lifecycleState && meter.lifecycleState !== 'ACTIVE') return [];
    const meterNumber = meter.serialNumber.trim();
    const key = meterNumber.toLocaleLowerCase('en-AU');
    if (!meterNumber || seen.has(key)) return [];
    seen.add(key);
    const deviceNumber = meter.deviceNumber?.trim();
    return [{
      meterId: meter.id,
      meterNumber,
      label: [
        meterNumber,
        deviceNumber && deviceNumber !== meterNumber
          ? `site tag ${deviceNumber}`
          : '',
        meter.deviceModel,
      ].filter(Boolean).join(' · '),
    }];
  });
}
