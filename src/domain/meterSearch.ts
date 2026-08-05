import type {
  ElectricalAsset,
  Installation,
  MeterDevice,
  Zone,
} from '../types';

export interface MeterSearchResult {
  total: number;
  visible: MeterDevice[];
  selectedPinned: boolean;
}

export interface DeviceSearchRecord {
  meter: MeterDevice;
  board: ElectricalAsset;
  zone: Zone;
  installation: Installation;
}

export interface DeviceSearchResult {
  total: number;
  visible: DeviceSearchRecord[];
}

export const GLOBAL_DEVICE_RESULT_LIMIT = 250;

/** Search every locally accessible device without treating its human label as
 * a machine identity. Stable meter IDs and serials remain independent search
 * values and navigation keys. */
export function searchAllDevices(
  records: DeviceSearchRecord[],
  query: string,
  limit = GLOBAL_DEVICE_RESULT_LIMIT,
): DeviceSearchResult {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('Device search limit must be positive.');
  }
  const normalized = query.trim().toLocaleLowerCase();
  const matches = [...records]
    .filter(({ meter, board, zone, installation }) => !normalized || [
      meter.id,
      meter.serialNumber,
      meter.deviceNumber,
      meter.displayName.value,
      meter.deviceModel,
      meter.customManufacturerName,
      meter.customModelName,
      board.id,
      board.display_code,
      board.asset_name,
      board.asset_type,
      zone.zone_name,
      installation.site_name,
      installation.client_name,
      installation.site_address,
    ].filter(Boolean).join(' ').toLocaleLowerCase().includes(normalized))
    .sort((left, right) =>
      left.installation.site_name.localeCompare(right.installation.site_name) ||
      left.zone.zone_name.localeCompare(right.zone.zone_name) ||
      left.meter.displayName.value.localeCompare(right.meter.displayName.value) ||
      left.meter.id.localeCompare(right.meter.id));
  return { total: matches.length, visible: matches.slice(0, limit) };
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
