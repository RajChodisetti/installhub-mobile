import type { MeterDevice } from '../types';

export interface MeterSearchResult {
  total: number;
  visible: MeterDevice[];
}

export function searchEligibleMeters(
  meters: MeterDevice[],
  query: string,
  limit: number,
): MeterSearchResult {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Meter search limit must be positive.');
  const normalized = query.trim().toLocaleLowerCase();
  const matches = [...meters]
    .filter((meter) => !normalized || [
      meter.displayName.value,
      meter.deviceModel,
      meter.serialNumber,
      meter.customManufacturerName,
      meter.customModelName,
    ].filter(Boolean).join(' ').toLocaleLowerCase().includes(normalized))
    .sort((left, right) =>
      left.displayName.value.localeCompare(right.displayName.value) || left.id.localeCompare(right.id));
  return { total: matches.length, visible: matches.slice(0, limit) };
}
