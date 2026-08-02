import type { MeterDevice } from '../types';

export interface MeterSearchResult {
  total: number;
  visible: MeterDevice[];
  selectedPinned: boolean;
}

export function searchEligibleMeters(
  meters: MeterDevice[],
  query: string,
  limit: number,
  selectedMeterId?: string,
  additionalSearchValues: (meter: MeterDevice) => Array<string | undefined> = () => [],
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
      ...additionalSearchValues(meter),
    ].filter(Boolean).join(' ').toLocaleLowerCase().includes(normalized))
    .sort((left, right) =>
      left.displayName.value.localeCompare(right.displayName.value) || left.id.localeCompare(right.id));
  let visible = matches.slice(0, limit);
  const selected = selectedMeterId ? meters.find((meter) => meter.id === selectedMeterId) : undefined;
  const selectedPinned = Boolean(selected && !visible.some((meter) => meter.id === selected.id));
  if (selected && selectedPinned) visible = [selected, ...visible].slice(0, limit);
  return { total: matches.length, visible, selectedPinned };
}
