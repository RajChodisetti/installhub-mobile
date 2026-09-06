import type {
  ElectricalAsset,
  Installation,
  MeterDevice,
  Zone,
} from '../types';
import { BOARD_TYPE_LABELS } from './installationV2';

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

export const INSTALLATION_DEVICE_RESULT_LIMIT = 250;

export function supportsCommsReplacement(meter: Pick<MeterDevice, 'deviceFamily' | 'deviceModel'>): boolean {
  return meter.deviceFamily === 'WATTWATCHERS' && (meter.deviceModel === 'A3RM' || meter.deviceModel === 'A6M');
}

export function deviceSearchIdentity(meter: MeterDevice) {
  const manufacturer = meter.deviceFamily === 'OTHER' ? meter.customManufacturerName?.trim() : 'Wattwatchers';
  const model = meter.deviceModel === 'OTHER' ? meter.customModelName?.trim() || 'metering device' : meter.deviceModel;
  const name = [manufacturer, model].filter(Boolean).join(' ');
  const displayName = meter.displayName.value.trim();
  const normalized = (value: string) => value.replace(/\s+/g, ' ').toLocaleLowerCase('en-AU');
  return { name, customName: meter.customName?.trim() || '',
    assetId: normalized(displayName) === normalized(name) ? '' : displayName };
}

export function deviceRecordBelongsToInstallation(
  record: DeviceSearchRecord,
  installationId: string,
): boolean {
  return record.installation.id === installationId &&
    record.meter.installationId === installationId &&
    record.board.audit_id === installationId &&
    record.zone.audit_id === installationId &&
    record.meter.installedOnBoardId === record.board.id &&
    record.board.zone_id === record.zone.id;
}

/** Search devices from one installation without treating their human labels
 * as machine identities. The installation filter is repeated at this domain
 * boundary so a stale or over-broad data source cannot leak another site's
 * devices into results or replacement actions. */
export function searchInstallationDevices(
  records: DeviceSearchRecord[],
  installationId: string,
  query: string,
  limit = INSTALLATION_DEVICE_RESULT_LIMIT,
): DeviceSearchResult {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('Device search limit must be positive.');
  }
  const tokens = query.trim().toLocaleLowerCase('en-AU').split(/\s+/).filter(Boolean);
  const matches = [...records]
    .filter((record) => deviceRecordBelongsToInstallation(record, installationId))
    .filter(({ meter, board, zone, installation }) => tokens.every((token) => [
      meter.id,
      meter.serialNumber,
      meter.deviceNumber,
      meter.displayName.value,
      meter.customName,
      meter.deviceFamily,
      deviceSearchIdentity(meter).name,
      meter.deviceModel,
      meter.customManufacturerName,
      meter.customModelName,
      board.id,
      board.display_code,
      board.asset_name,
      board.asset_type,
      board.type_code ? BOARD_TYPE_LABELS[board.type_code] : BOARD_TYPE_LABELS[board.asset_type.replace(/-/g, '_').toUpperCase() as keyof typeof BOARD_TYPE_LABELS],
      zone.zone_name,
      installation.site_name,
      installation.client_name,
      installation.site_address,
    ].filter(Boolean).join(' ').toLocaleLowerCase('en-AU').includes(token)))
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
