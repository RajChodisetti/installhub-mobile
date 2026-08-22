import { sha256 } from 'js-sha256';
import {
  validIanaTimezone,
  validateInstallationIdentity,
} from './installationValidation';
import {
  defaultMeterCustomName,
  namingInventoryForInstallation,
  provisionalDisplayCodeV2,
  resolvedZoneCodes,
  synchronizeZoneSequenceHighWater,
} from './namingV2';
import type {
  AppDataStore,
  BoardType,
  BoardTypeCode,
  DisplayCode,
  ElectricalAsset,
  ElectricalSource,
  GridSupply,
  Installation,
  InstallationReadiness,
  MeasurementAssignment,
  MeasurementDirection,
  MeasurementTarget,
  Meter,
  MeterChannel,
  MeterChannelPurpose,
  MeterDevice,
  MeteringState,
  ReadinessIssue,
  SiteAsset,
  SiteAssetType,
  SiteAssetTypeCode,
  VirtualMeterDefinition,
} from '../types';

export const INSTALLATION_TREE_SCHEMA_VERSION = 2 as const;
export const LOCAL_STORE_SCHEMA_VERSION = 3 as const;
export const DISPLAY_CODE_RULE_VERSION = 1 as const;
export const CANONICALIZER_VERSION = 1 as const;
export const VALIDATOR_VERSION = 1 as const;
export const TAXONOMY_CATALOG_VERSION = 1 as const;

export const BOARD_TYPE_LABELS: Record<BoardTypeCode, string> = {
  MSB: 'Main Switchboard',
  MSSB: 'Main Sub-Switchboard',
  DB: 'Distribution Board',
  HVAC_DB: 'HVAC Distribution Board',
  LX_DB: 'Lighting Distribution Board',
  PV_DB: 'PV/Solar Distribution Board',
  MCC: 'Motor Control Centre',
  OTHER: 'Other',
};

export const SITE_ASSET_TYPE_LABELS: Record<SiteAssetTypeCode, string> = {
  PV: 'Solar / PV',
  HVAC: 'AC / HVAC',
  LIGHTING: 'Lighting',
  EV_CHARGER: 'EV Charger',
  VEHICLE_HOIST: 'Vehicle Hoist',
  FORKLIFT: 'Forklift',
  EXHAUST_FAN_SYSTEM: 'Exhaust Fan System',
  POWER_OUTLET: 'Power Outlet',
  HEATER_GEYSER: 'Heater / Geyser',
  REFRIGERATION: 'Refrigeration',
  COMPRESSED_AIR: 'Compressed Air',
  OTHER: 'Other',
};

const LEGACY_BOARD_TYPE_TO_CODE: Record<BoardType, BoardTypeCode> = {
  MSB: 'MSB',
  MSSB: 'MSSB',
  DB: 'DB',
  'HVAC-DB': 'HVAC_DB',
  'LX-DB': 'LX_DB',
  'PV-DB': 'PV_DB',
  MCC: 'MCC',
  Other: 'OTHER',
};

const BOARD_CODE_TO_LEGACY: Record<BoardTypeCode, BoardType> = {
  MSB: 'MSB',
  MSSB: 'MSSB',
  DB: 'DB',
  HVAC_DB: 'HVAC-DB',
  LX_DB: 'LX-DB',
  PV_DB: 'PV-DB',
  MCC: 'MCC',
  OTHER: 'Other',
};

const LEGACY_SITE_TYPE_TO_CODE: Record<SiteAssetType, SiteAssetTypeCode> = {
  HVAC: 'HVAC',
  Lighting: 'LIGHTING',
  'Solar / PV': 'PV',
  'EV Charger': 'EV_CHARGER',
  'Exhaust / Fan System': 'EXHAUST_FAN_SYSTEM',
  'Power Outlet': 'POWER_OUTLET',
  'Hot Water': 'HEATER_GEYSER',
  Refrigeration: 'OTHER',
  'Compressed Air': 'OTHER',
  Other: 'OTHER',
};

const SITE_CODE_TO_LEGACY: Record<SiteAssetTypeCode, SiteAssetType> = {
  PV: 'Solar / PV',
  HVAC: 'HVAC',
  LIGHTING: 'Lighting',
  EV_CHARGER: 'EV Charger',
  VEHICLE_HOIST: 'Other',
  FORKLIFT: 'Other',
  EXHAUST_FAN_SYSTEM: 'Exhaust / Fan System',
  POWER_OUTLET: 'Power Outlet',
  HEATER_GEYSER: 'Hot Water',
  REFRIGERATION: 'Refrigeration',
  COMPRESSED_AIR: 'Compressed Air',
  OTHER: 'Other',
};

function taxonomyKey(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
}

const LEGACY_BOARD_ALIASES: Record<string, BoardTypeCode> = {
  MS8: 'MSB',
  MSB: 'MSB',
  MAINSNACHBOARD: 'MSB',
  MAINSWITCHBOARD: 'MSB',
  MSSB: 'MSSB',
  MAINSUBSWITCHBOARD: 'MSSB',
  DB: 'DB',
  DISTRIBUTIONBOARD: 'DB',
  HVACDB: 'HVAC_DB',
  HVACDISTRIBUTIONBOARD: 'HVAC_DB',
  LXDB: 'LX_DB',
  LIGHTINGDISTRIBUTIONBOARD: 'LX_DB',
  PVDB: 'PV_DB',
  PVSOLARDISTRIBUTIONBOARD: 'PV_DB',
  MCC: 'MCC',
  MOTORCONTROLCENTRE: 'MCC',
  MOTORCONTROLCENTER: 'MCC',
  OTHER: 'OTHER',
};

const LEGACY_SITE_ALIASES: Record<string, SiteAssetTypeCode> = {
  PV: 'PV',
  SOLAR: 'PV',
  SOLARPV: 'PV',
  HVAC: 'HVAC',
  ACHVAC: 'HVAC',
  LIGHTING: 'LIGHTING',
  LIGHTNING: 'LIGHTING',
  EVCHARGER: 'EV_CHARGER',
  VEHICLEHOIST: 'VEHICLE_HOIST',
  VEHICLEHOISTS: 'VEHICLE_HOIST',
  FORKLIFT: 'FORKLIFT',
  FORKLIFTCHARGER: 'FORKLIFT',
  EXHAUSTFANSYSTEM: 'EXHAUST_FAN_SYSTEM',
  EXHAUSTFANSSYSTEM: 'EXHAUST_FAN_SYSTEM',
  POWEROUTLET: 'POWER_OUTLET',
  GENERALPOWER: 'POWER_OUTLET',
  HOTWATER: 'HEATER_GEYSER',
  HEATERGEYSER: 'HEATER_GEYSER',
  OTHER: 'OTHER',
};

export function boardTypeCode(value: BoardType | string): BoardTypeCode {
  return LEGACY_BOARD_TYPE_TO_CODE[value as BoardType]
    ?? LEGACY_BOARD_ALIASES[taxonomyKey(value)]
    ?? 'OTHER';
}

export function boardTypeFromCode(value: BoardTypeCode): BoardType {
  return BOARD_CODE_TO_LEGACY[value];
}

export function siteAssetTypeCode(value: SiteAssetType | string): SiteAssetTypeCode {
  return LEGACY_SITE_TYPE_TO_CODE[value as SiteAssetType]
    ?? LEGACY_SITE_ALIASES[taxonomyKey(value)]
    ?? 'OTHER';
}

export function siteAssetTypeFromCode(value: SiteAssetTypeCode): SiteAssetType {
  return SITE_CODE_TO_LEGACY[value];
}

export const INSTALLATION_SITE_CODE_MAX_LENGTH = 16;
export const INSTALLATION_SITE_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

export function isValidInstallationSiteCode(value: string): boolean {
  return value.length >= 1
    && value.length <= INSTALLATION_SITE_CODE_MAX_LENGTH
    && INSTALLATION_SITE_CODE_PATTERN.test(value);
}

export function normalizedSiteCode(siteName: string): string {
  const words = siteName
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'SITE';
  return words.map((word) => word[0]).join('').toUpperCase().slice(0, 8) || 'SITE';
}

/** Project a grandfathered site code to the same bounded prefix used by the
 * API and portal. The authoritative installation value is never overwritten. */
export function installationDisplayCodePrefix(value: string): string {
  const prefix = value
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, INSTALLATION_SITE_CODE_MAX_LENGTH)
    .replace(/-+$/g, '');
  return prefix || 'SITE';
}

export function installationSiteCodeForNewCopy(
  sourceSiteCode: string | undefined,
  copiedSiteName: string,
): string {
  return sourceSiteCode && isValidInstallationSiteCode(sourceSiteCode)
    ? sourceSiteCode
    : normalizedSiteCode(copiedSiteName);
}

export function primaryGridSupplyId(installationId: string): string {
  return `grid_${installationId}_primary`;
}

function displayCodeFromLegacy(
  value: string,
  generatedValue?: string,
  isOverridden?: boolean,
): DisplayCode {
  const trimmed = value.trim();
  const generated = (generatedValue ?? trimmed).trim();
  return {
    value: trimmed,
    generatedValue: generated,
    isOverridden: isOverridden
      ?? Boolean(trimmed && generated && trimmed !== generated),
    ruleVersion: DISPLAY_CODE_RULE_VERSION,
    provisional: true,
  };
}

function displayCodeKey(value: string): string {
  return value.replace(/\s+/g, '').toLocaleUpperCase();
}

function inferredSequence(value: string, typeCode: string): number {
  const match = value.match(new RegExp(`-${typeCode}-(\\d+)$`, 'i'));
  return match ? Number(match[1]) || 0 : 0;
}

export function nextDisplayCode(
  installation: Installation,
  typeCode: BoardTypeCode | SiteAssetTypeCode,
): DisplayCode {
  const sequence = (installation.display_code_sequences?.[typeCode] ?? 0) + 1;
  installation.display_code_sequences = {
    ...installation.display_code_sequences,
    [typeCode]: sequence,
  };
  const siteCode = installation.site_code || normalizedSiteCode(installation.site_name);
  const generatedValue = `${installationDisplayCodePrefix(siteCode)}-${typeCode}-${String(sequence).padStart(3, '0')}`;
  return {
    value: generatedValue,
    generatedValue,
    isOverridden: false,
    ruleVersion: DISPLAY_CODE_RULE_VERSION,
    provisional: true,
  };
}

function canonicalModel(deviceType: Meter['device_type']): MeterDevice['deviceModel'] {
  if (deviceType === 'A3RM' || deviceType === 'A6M') return deviceType;
  return 'OTHER';
}

function legacyModel(deviceModel: MeterDevice['deviceModel']): Meter['device_type'] {
  return deviceModel === 'OTHER' ? 'Other' : deviceModel;
}

function legacyChannelToCanonical(
  meterId: string,
  channel: NonNullable<Meter['ww_channels']>[number],
  index: number,
): MeterChannel {
  const ordinal = Number.isSafeInteger(channel.ordinal) && (channel.ordinal ?? 0) > 0
    ? channel.ordinal!
    : index + 1;
  const purpose = channel.purpose === 'MAIN_SUPPLY'
    || channel.purpose === 'SUB_CIRCUIT'
    || channel.purpose === 'SPARE'
    ? channel.purpose
    : channel.load_type === 'Mains Supply'
      ? 'MAIN_SUPPLY'
      : channel.load_type === 'Not Used'
        ? 'SPARE'
        : 'SUB_CIRCUIT';
  const loadTypeCode = purpose === 'SUB_CIRCUIT' && channel.load_type
    ? siteAssetTypeCode(channel.load_type as SiteAssetType)
    : undefined;
  return {
    id: channel.id?.trim() || `${meterId}:${ordinal}`,
    ordinal,
    purpose,
    phaseLabel: channel.phase_label,
    capabilities: channel.capabilities,
    loadTypeCode,
    customLoadTypeName: loadTypeCode === 'OTHER' && channel.load_type
      ? channel.load_type
      : undefined,
    sensorRating: channel.rogowski_size ?? channel.ct_ratio,
    description: channel.description,
  };
}

export function meterDeviceFromLegacy(
  installationId: string,
  board: ElectricalAsset,
  meter: Meter,
  existing?: MeterDevice,
): MeterDevice {
  const model = canonicalModel(meter.device_type);
  const expected = model === 'A3RM' ? 3 : model === 'A6M' ? 6 : 0;
  const channels = [...(meter.ww_channels ?? [])];
  while (channels.length < expected) channels.push({});
  const customName = meter.custom_name?.trim().slice(0, 64)
    || existing?.customName?.trim().slice(0, 64)
    || defaultMeterCustomName(model, meter.custom_model_name, meter.custom_manufacturer_name);
  const generatedName = meter.device_name.trim() || meter.device_id.trim() || meter.id;
  return {
    id: meter.id,
    installationId,
    installedOnBoardId: board.id,
    deviceFamily: model === 'OTHER' ? 'OTHER' : 'WATTWATCHERS',
    deviceModel: model,
    customManufacturerName: model === 'OTHER' ? meter.custom_manufacturer_name : undefined,
    customModelName: model === 'OTHER' ? meter.custom_model_name : undefined,
    customName,
    deviceNumber: meter.device_number ?? existing?.deviceNumber,
    serialNumber: meter.device_id,
    displayName: existing?.displayName ?? displayCodeFromLegacy(
      generatedName,
      meter.id,
      Boolean(meter.device_name.trim()),
    ),
    // Other devices deliberately preserve the explicit count, including zero;
    // the readiness engine asks the installer to declare capabilities.
    channels: channels.map((channel, index) =>
      legacyChannelToCanonical(meter.id, channel, index)),
    commissioningData: {
      classification: meter.classification ?? null,
      coverage: meter.coverage ?? null,
      prestart: meter.ww_prestart ? {
        siteInduction: meter.ww_prestart.site_induction,
        safeAccess: meter.ww_prestart.safe_access,
        correctPpe: meter.ww_prestart.correct_ppe,
        livePointsAware: meter.ww_prestart.live_points_aware,
        canIsolate: meter.ww_prestart.can_isolate,
        additionalHazards: meter.ww_prestart.additional_hazards,
        safeToProceed: meter.ww_prestart.safe_to_proceed,
      } : undefined,
      switchboard: meter.ww_switchboard ? {
        name: meter.ww_switchboard.sb_name ?? null,
        location: meter.ww_switchboard.sb_location ?? null,
        deviceSerial: meter.ww_switchboard.device_serial ?? null,
        firmware: meter.ww_switchboard.firmware ?? null,
        antennaType: meter.ww_switchboard.antenna_type ?? null,
        signalStrength: meter.ww_switchboard.signal_strength ?? null,
        notes: meter.ww_switchboard.notes ?? null,
      } : undefined,
      verification: meter.ww_verification ? {
        voltageChecked: meter.ww_verification.voltage_checked,
        polarityChecked: meter.ww_verification.polarity_checked,
        communicationsOk: meter.ww_verification.communications_ok,
        notes: meter.ww_verification.notes ?? null,
      } : undefined,
      commissioning: meter.ww_commissioning ? {
        deviceOnline: meter.ww_commissioning.device_online,
        channelsReporting: meter.ww_commissioning.channels_reporting,
        labeled: meter.ww_commissioning.labeled,
        photosTaken: meter.ww_commissioning.photos_taken,
        notes: meter.ww_commissioning.notes ?? null,
      } : undefined,
    },
    wwPhotos: meter.ww_photos
      ? {
          deviceInstalled: meter.ww_photos.device_installed,
          switchboardOverview: meter.ww_photos.switchboard_overview,
          labeling: meter.ww_photos.labeling,
          extra: meter.ww_photos.extra,
        }
      : undefined,
    notes: meter.ww_switchboard?.notes ?? meter.ww_commissioning?.notes,
  };
}

function legacyMeterFromCanonical(device: MeterDevice, existing?: Meter): Meter {
  const commissioning = device.commissioningData;
  return {
    ...(existing ?? {
      id: device.id,
      device_name: device.displayName.value,
      device_type: legacyModel(device.deviceModel),
      device_id: device.serialNumber,
    }),
    id: device.id,
    device_name: device.displayName.value,
    custom_name: device.customName
      ?? defaultMeterCustomName(
        device.deviceModel,
        device.customModelName,
        device.customManufacturerName,
      ),
    device_id: device.serialNumber,
    device_number: device.deviceNumber,
    custom_manufacturer_name: device.customManufacturerName,
    custom_model_name: device.customModelName,
    ...(commissioning ? {
      classification: commissioning.classification ?? undefined,
      coverage: commissioning.coverage ?? undefined,
      ww_prestart: commissioning.prestart ? {
        site_induction: commissioning.prestart.siteInduction,
        safe_access: commissioning.prestart.safeAccess,
        correct_ppe: commissioning.prestart.correctPpe,
        live_points_aware: commissioning.prestart.livePointsAware,
        can_isolate: commissioning.prestart.canIsolate,
        additional_hazards: commissioning.prestart.additionalHazards,
        safe_to_proceed: commissioning.prestart.safeToProceed,
      } : undefined,
      ww_verification: commissioning.verification ? {
        voltage_checked: commissioning.verification.voltageChecked,
        polarity_checked: commissioning.verification.polarityChecked,
        communications_ok: commissioning.verification.communicationsOk,
        notes: commissioning.verification.notes ?? undefined,
      } : undefined,
      ww_commissioning: commissioning.commissioning ? {
        device_online: commissioning.commissioning.deviceOnline,
        channels_reporting: commissioning.commissioning.channelsReporting,
        labeled: commissioning.commissioning.labeled,
        photos_taken: commissioning.commissioning.photosTaken,
        notes: commissioning.commissioning.notes ?? undefined,
      } : undefined,
    } : {}),
    ww_channels: [...device.channels]
      .sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id))
      .map((channel) => ({
        id: channel.id,
        ordinal: channel.ordinal,
        purpose: channel.purpose,
        phase_label: channel.phaseLabel,
        capabilities: channel.capabilities,
        load_type: channel.loadTypeCode === 'OTHER'
          ? channel.customLoadTypeName ?? 'Other'
          : channel.loadTypeCode
            ? siteAssetTypeFromCode(channel.loadTypeCode)
            : undefined,
        rogowski_size: device.deviceModel === 'A6M' ? undefined : channel.sensorRating,
        ct_ratio: device.deviceModel === 'A6M' ? channel.sensorRating : undefined,
        description: channel.description,
      })),
    ww_photos: device.wwPhotos
      ? {
          device_installed: device.wwPhotos.deviceInstalled,
          switchboard_overview: device.wwPhotos.switchboardOverview,
          labeling: device.wwPhotos.labeling,
          extra: device.wwPhotos.extra,
        }
      : undefined,
    ww_switchboard: {
      ...(existing?.ww_switchboard ?? {}),
      ...(commissioning?.switchboard ? {
        sb_name: commissioning.switchboard.name ?? undefined,
        sb_location: commissioning.switchboard.location ?? undefined,
        device_serial: commissioning.switchboard.deviceSerial ?? undefined,
        firmware: commissioning.switchboard.firmware ?? undefined,
        antenna_type: commissioning.switchboard.antennaType ?? undefined,
        signal_strength: commissioning.switchboard.signalStrength ?? undefined,
        notes: commissioning.switchboard.notes ?? undefined,
      } : { notes: device.notes }),
    },
  };
}

function ensureInstallationMetadata(installation: Installation): void {
  if (
    installation.status === 'Completed' &&
    !installation.record_version_number &&
    !installation.completed_at
  ) {
    installation.legacy_completed_unpinned = true;
    installation.status = 'Draft';
  }
  installation.tree_schema_version = INSTALLATION_TREE_SCHEMA_VERSION;
  installation.external_key ||= `local:${installation.id}`;
  if (!installation.site_code?.trim()) {
    installation.site_code = normalizedSiteCode(installation.site_name);
  }
  installation.site_country_code = installation.site_country_code?.trim().toUpperCase() || 'AU';
  installation.tree_revision = Math.max(0, installation.tree_revision ?? 0);
  if (installation.server_tree_revision === undefined) {
    const exactCanonicalRevision = installation.server_derived?.treeRevision;
    const immutableCompletedRevision =
      installation.status === 'Completed' && installation.record_version_number
        ? installation.tree_revision
        : undefined;
    const legacyServerRevision = exactCanonicalRevision ?? immutableCompletedRevision;
    if (Number.isSafeInteger(legacyServerRevision) && (legacyServerRevision ?? -1) >= 0) {
      // These two legacy anchors were written only from authoritative server
      // responses. A mutable Draft tree_revision alone is never safe to infer.
      installation.server_tree_revision = legacyServerRevision;
    }
  }
  if (
    installation.server_tree_revision !== undefined &&
    (!Number.isSafeInteger(installation.server_tree_revision) || installation.server_tree_revision < 0)
  ) {
    installation.server_tree_revision = undefined;
  }
  installation.backup_conflict ??= { kind: 'NONE' };
  installation.display_code_sequences ??= {};
}

function ensureGridSupply(store: AppDataStore, installation: Installation): GridSupply {
  const existingSupplies = store.gridSupplies.filter(
    (grid) => grid.installationId === installation.id,
  );
  if (existingSupplies.length) {
    const sorted = [...existingSupplies].sort((a, b) => a.id.localeCompare(b.id));
    const selectedDefault = sorted.find((grid) => grid.isDefault) ?? sorted[0]!;
    for (const supply of existingSupplies) supply.isDefault = supply.id === selectedDefault.id;
    return selectedDefault;
  }
  const grid: GridSupply = {
    id: primaryGridSupplyId(installation.id),
    installationId: installation.id,
    name: 'Grid supply',
    isDefault: true,
  };
  store.gridSupplies.push(grid);
  return grid;
}

function sourceFromLegacyBoard(board: ElectricalAsset, gridSupply: GridSupply): ElectricalSource {
  if (board.electrical_parent_tbc) return { kind: 'TBC' };
  if (board.electrical_parent_id) {
    return { kind: 'BOARD', boardId: board.electrical_parent_id };
  }
  // Root-like evidence is required; an arbitrary null parent is not silently Grid.
  if (Boolean(board.site_nmi?.trim())) {
    return { kind: 'GRID', gridSupplyId: gridSupply.id };
  }
  return { kind: 'TBC' };
}

function sourceFromLegacyAsset(asset: SiteAsset): ElectricalSource {
  if (asset.electrical_board_tbc || !asset.electrical_board_id) return { kind: 'TBC' };
  return { kind: 'BOARD', boardId: asset.electrical_board_id };
}

function channelOrdinals(values: NonNullable<SiteAsset['meter_channels']>): number[] {
  return values
    .map((value) => Number(value.channel.match(/\d+/)?.[0] ?? 0))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
}

function assignmentFromUnambiguousLegacy(
  store: AppDataStore,
  asset: SiteAsset,
): MeasurementAssignment | null {
  if (!asset.meter_present || asset.meter_switchboard_tbc || !asset.meter_switchboard_id) {
    return null;
  }
  const devices = store.meterDevices.filter(
    (meter) =>
      meter.installationId === asset.audit_id &&
      meter.installedOnBoardId === asset.meter_switchboard_id,
  );
  if (devices.length !== 1) return null;
  const ordinals = channelOrdinals(asset.meter_channels ?? []);
  if (!ordinals.length) return null;
  const meter = devices[0];
  const ids = ordinals.map((ordinal) =>
    meter.channels.find((channel) => channel.ordinal === ordinal)?.id);
  if (ids.some((id) => !id)) return null;
  const channelIds = ids as string[];
  return {
    id: `${asset.id}:measurement`,
    installationId: asset.audit_id,
    meterId: meter.id,
    channelIds,
    phaseMode: channelIds.length === 3 ? 'THREE_PHASE' : channelIds.length === 1 ? 'SINGLE_PHASE' : 'OTHER',
    target: { kind: 'SITE_ASSET', siteAssetId: asset.id },
    direction: asset.type_code === 'PV' ? 'GENERATION' : 'CONSUMPTION',
    status: 'CONFIRMED',
  };
}

function normalizeDisplaySequences(store: AppDataStore, installation: Installation): void {
  const sequence = { ...(installation.display_code_sequences ?? {}) };
  for (const board of store.electricalAssets.filter((item) => item.audit_id === installation.id)) {
    const code = board.type_code ?? boardTypeCode(board.asset_type);
    sequence[code] = Math.max(sequence[code] ?? 0, inferredSequence(board.display_code, code));
  }
  for (const asset of store.siteAssets.filter((item) => item.audit_id === installation.id)) {
    const code = asset.type_code ?? siteAssetTypeCode(asset.asset_type);
    sequence[code] = Math.max(sequence[code] ?? 0, inferredSequence(asset.display_code ?? '', code));
  }
  installation.display_code_sequences = sequence;
}

/**
 * Idempotently promotes a complete legacy/local store to the v2 canonical
 * model. Existing canonical meter rows always win; nested meters are only an
 * import source when a canonical row with that stable ID does not yet exist.
 */
export function normalizeCanonicalStore(store: AppDataStore): AppDataStore {
  store.schemaVersion = LOCAL_STORE_SCHEMA_VERSION;
  store.gridSupplies ??= [];
  store.meterDevices ??= [];
  store.measurementAssignments ??= [];
  store.siteAssetEditorDrafts ??= [];

  for (const installation of store.installations) {
    ensureInstallationMetadata(installation);
    const installationZones = store.zones.filter((zone) => zone.audit_id === installation.id);
    const zoneCodes = resolvedZoneCodes(installationZones);
    for (const zone of installationZones) zone.zone_code = zoneCodes.get(zone.id);
    const grid = ensureGridSupply(store, installation);

    for (const board of store.electricalAssets.filter((item) => item.audit_id === installation.id)) {
      board.type_code ??= boardTypeCode(board.asset_type);
      if (board.type_code === 'OTHER') {
        board.custom_type_name ??= board.asset_type === 'Other' ? undefined : board.asset_type;
      }
      board.display_code_meta ??= board.display_code.trim()
        ? displayCodeFromLegacy(board.display_code)
        : provisionalDisplayCodeV2(
            installation,
            namingInventoryForInstallation(store, installation.id),
            {
              zoneId: board.zone_id,
              customName: board.asset_name,
              fallbackType: BOARD_TYPE_LABELS[board.type_code],
              excludeId: board.id,
            },
          );
      board.display_code = board.display_code_meta.value;
      board.electrical_source ??= sourceFromLegacyBoard(board, grid);
      if (board.electrical_source.kind === 'BOARD') {
        board.electrical_parent_id = board.electrical_source.boardId;
        board.electrical_parent_tbc = false;
      } else {
        board.electrical_parent_id = null;
        board.electrical_parent_tbc = board.electrical_source.kind === 'TBC';
      }

      for (const meter of board.meters) {
        if (!store.meterDevices.some((item) => item.id === meter.id)) {
          store.meterDevices.push(meterDeviceFromLegacy(installation.id, board, meter));
        }
      }
    }

    for (const meter of store.meterDevices.filter(
      (item) => item.installationId === installation.id,
    )) {
      meter.customName = (
        meter.customName?.trim()
        || defaultMeterCustomName(
          meter.deviceModel,
          meter.customModelName,
          meter.customManufacturerName,
        )
      ).slice(0, 64);
    }

    // Seed sequence counters from every existing board/asset code before any
    // missing code is allocated, so migration never creates a duplicate.
    normalizeDisplaySequences(store, installation);

    for (const asset of store.siteAssets.filter((item) => item.audit_id === installation.id)) {
      asset.type_code ??= siteAssetTypeCode(asset.asset_type);
      if (asset.type_code === 'OTHER' && asset.asset_type !== 'Other') {
        asset.custom_type_name ??= asset.asset_type;
      }
      asset.display_code_meta ??= asset.display_code?.trim()
        ? displayCodeFromLegacy(asset.display_code)
        : provisionalDisplayCodeV2(
            installation,
            namingInventoryForInstallation(store, installation.id),
            {
              zoneId: asset.zone_id,
              customName: asset.asset_name,
              fallbackType: SITE_ASSET_TYPE_LABELS[asset.type_code],
              excludeId: asset.id,
            },
          );
      asset.display_code = asset.display_code_meta.value;
      asset.electrical_source ??= sourceFromLegacyAsset(asset);
      if (asset.electrical_source.kind === 'BOARD') {
        asset.electrical_board_id = asset.electrical_source.boardId;
        asset.electrical_board_tbc = false;
      } else {
        asset.electrical_board_id = null;
        asset.electrical_board_tbc = asset.electrical_source.kind === 'TBC';
      }

      const existingAssignments = store.measurementAssignments.filter(
        (assignment) =>
          assignment.installationId === installation.id &&
          assignment.target.kind === 'SITE_ASSET' &&
          assignment.target.siteAssetId === asset.id,
      );
      if (!existingAssignments.length) {
        const migrated = assignmentFromUnambiguousLegacy(store, asset);
        if (migrated) {
          store.measurementAssignments.push(migrated);
          existingAssignments.push(migrated);
        }
      }
      asset.metering_state ??= existingAssignments.length
        ? { kind: 'METERED', measurementAssignmentIds: existingAssignments.map((item) => item.id) }
        : { kind: 'TBC' };
    }

    normalizeDisplaySequences(store, installation);
    synchronizeZoneSequenceHighWater(
      installation,
      namingInventoryForInstallation(store, installation.id),
    );
    projectCanonicalCompatibility(store, installation.id);
  }

  return store;
}

/** Rebuilds legacy fields from the canonical owner for installed v1 clients. */
export function projectCanonicalCompatibility(store: AppDataStore, installationId: string): void {
  const devices = store.meterDevices
    .filter((item) => item.installationId === installationId)
    .sort((a, b) => a.id.localeCompare(b.id));
  for (const board of store.electricalAssets.filter((item) => item.audit_id === installationId)) {
    const existing = new Map(board.meters.map((meter) => [meter.id, meter]));
    board.meters = devices
      .filter((meter) => meter.installedOnBoardId === board.id)
      .map((meter) => legacyMeterFromCanonical(meter, existing.get(meter.id)));
    board.meter_present = board.meters.length > 0;
    board.asset_type = boardTypeFromCode(board.type_code ?? boardTypeCode(board.asset_type));
    board.display_code = board.display_code_meta?.value ?? board.display_code;
    if (board.electrical_source?.kind === 'BOARD') {
      board.electrical_parent_id = board.electrical_source.boardId;
      board.electrical_parent_tbc = false;
    } else {
      board.electrical_parent_id = null;
      board.electrical_parent_tbc = board.electrical_source?.kind === 'TBC';
    }
  }

  for (const asset of store.siteAssets.filter((item) => item.audit_id === installationId)) {
    asset.asset_type = siteAssetTypeFromCode(asset.type_code ?? siteAssetTypeCode(asset.asset_type));
    asset.display_code = asset.display_code_meta?.value ?? asset.display_code;
    if (asset.electrical_source?.kind === 'BOARD') {
      asset.electrical_board_id = asset.electrical_source.boardId;
      asset.electrical_board_tbc = false;
    } else {
      asset.electrical_board_id = null;
      // Legacy null+false is only the compatibility projection of an explicit
      // canonical Grid source. It is never used to infer Grid on migration.
      asset.electrical_board_tbc = asset.electrical_source?.kind === 'TBC';
    }
    const ids = asset.metering_state?.kind === 'METERED'
      ? new Set(asset.metering_state.measurementAssignmentIds)
      : new Set<string>();
    const assignments = store.measurementAssignments.filter((item) => ids.has(item.id));
    asset.meter_present = asset.metering_state?.kind === 'METERED';
    const firstMeter = assignments.length
      ? store.meterDevices.find((meter) => meter.id === assignments[0].meterId)
      : undefined;
    asset.meter_switchboard_id = firstMeter?.installedOnBoardId ?? null;
    asset.meter_switchboard_tbc = asset.metering_state?.kind === 'TBC';
    asset.meter_channels = assignments.flatMap((assignment) => assignment.channelIds.map((channelId) => {
      const ordinal = firstMeter?.channels.find((channel) => channel.id === channelId)?.ordinal;
      return { channel: String(ordinal ?? channelId), description: '' };
    }));
  }
}

/** Applies edits made by the legacy nested-meter form into canonical storage. */
export function replaceBoardMetersFromLegacy(
  store: AppDataStore,
  board: ElectricalAsset,
  meters: Meter[],
): void {
  const incomingIds = new Set(meters.map((meter) => meter.id));
  const removedMeterIds = new Set(
    store.meterDevices
      .filter((meter) => meter.installedOnBoardId === board.id && !incomingIds.has(meter.id))
      .map((meter) => meter.id),
  );
  store.meterDevices = store.meterDevices.filter(
    (meter) => meter.installedOnBoardId !== board.id || incomingIds.has(meter.id),
  );
  for (const meter of meters) {
    const index = store.meterDevices.findIndex((item) => item.id === meter.id);
    const existing = index >= 0 ? store.meterDevices[index] : undefined;
    const canonical = meterDeviceFromLegacy(board.audit_id, board, meter, existing);
    const installation = store.installations.find((item) => item.id === board.audit_id);
    if (!installation) throw new Error('Installation not found.');
    const fallbackName = defaultMeterCustomName(
      canonical.deviceModel,
      canonical.customModelName,
      canonical.customManufacturerName,
    );
    canonical.customName = (canonical.customName?.trim() || fallbackName).slice(0, 64);
    canonical.displayName = provisionalDisplayCodeV2(
      installation,
      namingInventoryForInstallation(store, board.audit_id),
      {
        zoneId: board.zone_id,
        customName: canonical.customName,
        fallbackType: fallbackName,
        excludeId: canonical.id,
        current: existing?.displayName,
      },
    );
    if (index >= 0) store.meterDevices[index] = canonical;
    else store.meterDevices.push(canonical);
  }
  const validMeterIds = new Set(store.meterDevices.map((meter) => meter.id));
  for (const form of store.formSubmissions) {
    if (form.form_type !== 'ww-installation' || !form.meter_id) continue;
    if (form.status === 'Completed' && removedMeterIds.has(form.meter_id)) {
      form.historical_meter_removed = true;
    } else if (validMeterIds.has(form.meter_id)) {
      form.historical_meter_removed = false;
    }
  }
  store.measurementAssignments = store.measurementAssignments.filter(
    (assignment) => validMeterIds.has(assignment.meterId),
  );
  for (const asset of store.siteAssets.filter((item) => item.audit_id === board.audit_id)) {
    if (asset.metering_state?.kind !== 'METERED') continue;
    const assignmentIds = asset.metering_state.measurementAssignmentIds.filter((id) =>
      store.measurementAssignments.some((assignment) => assignment.id === id));
    asset.metering_state = assignmentIds.length
      ? { kind: 'METERED', measurementAssignmentIds: assignmentIds }
      : { kind: 'TBC' };
  }
  projectCanonicalCompatibility(store, board.audit_id);
}

export function bumpTreeRevision(store: AppDataStore, installationId: string): number {
  const installation = store.installations.find((item) => item.id === installationId);
  if (!installation) throw new Error('Installation not found');
  if (store.cloudSync.pending_complete_attempts?.[installationId]) {
    throw new Error(
      'Cloud backup confirmation is pending. Retry backup before changing this installation.',
    );
  }
  ensureInstallationMetadata(installation);
  installation.tree_revision = (installation.tree_revision ?? 0) + 1;
  installation.updated_at = new Date().toISOString();
  installation.record_version_number = installation.status === 'Completed'
    ? installation.record_version_number
    : undefined;
  // Derived residuals are an authoritative snapshot of one server revision.
  // Any local tree mutation makes that snapshot unsafe until reconciliation
  // returns a replacement for the newly accepted server revision.
  installation.server_derived = undefined;
  installation.backup_conflict = { kind: 'NONE' };
  return installation.tree_revision;
}

export function boardSourceCandidates(
  store: AppDataStore,
  installationId: string,
  boardId: string,
): ElectricalAsset[] {
  return cycleSafeBoardCandidates(
    store.electricalAssets.filter((item) => item.audit_id === installationId),
    boardId,
  );
}

/** Parent choices exclude the edited board and every descendant that it owns. */
export function cycleSafeBoardCandidates(
  boards: ElectricalAsset[],
  boardId?: string,
): ElectricalAsset[] {
  if (!boardId) return [...boards];
  const children = new Map<string, string[]>();
  for (const board of boards) {
    if (board.electrical_source?.kind !== 'BOARD') continue;
    const rows = children.get(board.electrical_source.boardId) ?? [];
    rows.push(board.id);
    children.set(board.electrical_source.boardId, rows);
  }
  const descendants = new Set<string>([boardId]);
  const queue = [boardId];
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of children.get(current) ?? []) {
      if (descendants.has(child)) continue;
      descendants.add(child);
      queue.push(child);
    }
  }
  return boards.filter((item) => !descendants.has(item.id));
}

export function boardIsOnAssetSupplyPath(
  store: AppDataStore,
  asset: SiteAsset,
  candidateBoardId: string,
): boolean {
  if (asset.electrical_source?.kind !== 'BOARD') return false;
  const boards = new Map(
    store.electricalAssets
      .filter((board) => board.audit_id === asset.audit_id)
      .map((board) => [board.id, board]),
  );
  const seen = new Set<string>();
  let currentId: string | undefined = asset.electrical_source.boardId;
  while (currentId && !seen.has(currentId)) {
    if (currentId === candidateBoardId) return true;
    seen.add(currentId);
    const board = boards.get(currentId);
    currentId = board?.electrical_source?.kind === 'BOARD'
      ? board.electrical_source.boardId
      : undefined;
  }
  return false;
}

function issue(
  issues: ReadinessIssue[],
  input: ReadinessIssue,
): void {
  issues.push(input);
}

function sourceIssueCandidates(
  store: AppDataStore,
  installationId: string,
  boardId?: string,
): string[] {
  const gridIds = store.gridSupplies
    .filter((item) => item.installationId === installationId)
    .map((item) => item.id);
  const boardIds = (boardId
    ? boardSourceCandidates(store, installationId, boardId)
    : store.electricalAssets.filter((item) => item.audit_id === installationId))
    .map((item) => item.id);
  // Candidate IDs are a bounded API hint. Clients with the loaded tree compute
  // and search the complete valid set instead of treating this as exhaustive.
  return [...gridIds, ...boardIds].slice(0, 25);
}

function boardIsOnBoardSupplyPath(
  boards: Map<string, ElectricalAsset>,
  targetBoardId: string,
  meterBoardId: string,
): boolean {
  const seen = new Set<string>();
  let currentId: string | undefined = targetBoardId;
  while (currentId && !seen.has(currentId)) {
    if (currentId === meterBoardId) return true;
    seen.add(currentId);
    const current = boards.get(currentId);
    currentId = current?.electrical_source?.kind === 'BOARD'
      ? current.electrical_source.boardId
      : undefined;
  }
  return false;
}

function meterBoardReachesGrid(
  boards: Map<string, ElectricalAsset>,
  meterBoardId: string,
  gridSupplyId: string,
): boolean {
  const seen = new Set<string>();
  let current = boards.get(meterBoardId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.electrical_source?.kind === 'GRID') {
      return current.electrical_source.gridSupplyId === gridSupplyId;
    }
    current = current.electrical_source?.kind === 'BOARD'
      ? boards.get(current.electrical_source.boardId)
      : undefined;
  }
  return false;
}

function addCycleIssues(
  boards: ElectricalAsset[],
  issues: ReadinessIssue[],
): void {
  const byId = new Map(boards.map((board) => [board.id, board]));
  const state = new Map<string, 0 | 1 | 2>();
  const inCycle = new Set<string>();
  for (const start of boards) {
    if (state.get(start.id) === 2) continue;
    const path: string[] = [];
    const indexById = new Map<string, number>();
    let current: ElectricalAsset | undefined = start;
    while (current) {
      if (state.get(current.id) === 2) break;
      const pathIndex = indexById.get(current.id);
      if (pathIndex !== undefined) {
        path.slice(pathIndex).forEach((id) => inCycle.add(id));
        break;
      }
      indexById.set(current.id, path.length);
      path.push(current.id);
      state.set(current.id, 1);
      current = current.electrical_source?.kind === 'BOARD'
        ? byId.get(current.electrical_source.boardId)
        : undefined;
    }
    path.forEach((id) => state.set(id, 2));
  }
  for (const id of [...inCycle].sort()) {
    issue(issues, {
      code: 'ELECTRICAL_CYCLE',
      severity: 'ERROR',
      entityType: 'board',
      entityId: id,
      field: 'electricalSource',
      message: 'This board is part of an electrical supply cycle.',
    });
  }
}

export function installationReadiness(
  store: AppDataStore,
  installationId: string,
): InstallationReadiness {
  const installation = store.installations.find((item) => item.id === installationId);
  if (!installation) throw new Error('Installation not found');
  const issues: ReadinessIssue[] = [];
  const grids = store.gridSupplies.filter((item) => item.installationId === installationId);
  const boards = store.electricalAssets.filter((item) => item.audit_id === installationId);
  const assets = store.siteAssets.filter((item) => item.audit_id === installationId);
  const meters = store.meterDevices.filter((item) => item.installationId === installationId);
  const assignments = store.measurementAssignments.filter(
    (item) => item.installationId === installationId,
  );
  const gridIds = new Set(grids.map((item) => item.id));
  const boardById = new Map(boards.map((item) => [item.id, item]));
  const assetById = new Map(assets.map((item) => [item.id, item]));
  const meterById = new Map(meters.map((item) => [item.id, item]));
  const timezoneValid = validIanaTimezone(installation.timezone ?? '');
  for (const error of validateInstallationIdentity(installation)) {
    issue(issues, {
      code: error.field === 'timezone'
        ? 'TIMEZONE_REQUIRED_FOR_EXPORT'
        : 'INSTALLATION_FIELD_REQUIRED',
      severity: 'ERROR',
      entityType: 'installation',
      entityId: installation.id,
      field: error.field,
      message: error.message,
    });
  }
  if (!installation.external_key?.trim()) {
    issue(issues, {
      code: 'EXTERNAL_KEY_REQUIRED', severity: 'ERROR', entityType: 'installation',
      entityId: installation.id, field: 'externalKey', message: 'The installation external key is missing.',
    });
  }
  if (!grids.length) {
    issue(issues, {
      code: 'GRID_SUPPLY_INVALID', severity: 'ERROR', entityType: 'installation',
      entityId: installation.id, field: 'gridSupplies', message: 'Add an explicit Grid supply.',
    });
  }
  if (grids.filter((item) => item.isDefault).length !== 1) {
    issue(issues, {
      code: 'GRID_SUPPLY_INVALID', severity: 'ERROR', entityType: 'installation',
      entityId: installation.id, field: 'gridSupplies', message: 'Exactly one Grid supply must be the default.',
      candidateIds: grids.map((item) => item.id),
    });
  }
  for (const grid of grids) {
    if (!grid.name.trim()) issue(issues, {
      code: 'GRID_SUPPLY_INVALID', severity: 'ERROR', entityType: 'grid_supply',
      entityId: grid.id, field: 'name', message: 'Grid supply name is required.',
    });
  }

  const codes = new Map<string, Array<{ entityType: 'board' | 'site_asset' | 'meter'; id: string }>>();
  const validDisplayName = (value: string) => {
    const trimmed = value.trim();
    return trimmed.length >= 1 && trimmed.length <= 64 && !/[\u0000-\u001F\u007F]/.test(trimmed);
  };
  for (const entity of [...boards, ...assets]) {
    const code = entity.display_code_meta?.value ?? entity.display_code ?? '';
    const key = displayCodeKey(code);
    const entityType = 'meters' in entity ? 'board' as const : 'site_asset' as const;
    if (!validDisplayName(code)) {
      issue(issues, {
        code: 'DISPLAY_CODE_INVALID', severity: 'ERROR', entityType,
        entityId: entity.id, field: 'displayCode',
        message: 'Name must contain 1–64 visible characters.',
      });
    }
    const entries = codes.get(key) ?? [];
    entries.push({ entityType, id: entity.id });
    codes.set(key, entries);
  }
  for (const meter of meters) {
    const label = meter.displayName.value;
    if (!validDisplayName(label)) {
      issue(issues, {
        code: 'DISPLAY_CODE_INVALID', severity: 'ERROR', entityType: 'meter',
        entityId: meter.id, field: 'displayName',
        message: 'Device name must contain 1–64 visible characters.',
      });
    }
    const key = displayCodeKey(label);
    const entries = codes.get(key) ?? [];
    entries.push({ entityType: 'meter', id: meter.id });
    codes.set(key, entries);
  }
  for (const entries of codes.values()) {
    if (entries.length < 2) continue;
    for (const entry of entries) issue(issues, {
      code: 'DISPLAY_CODE_DUPLICATE', severity: 'ERROR', entityType: entry.entityType,
      entityId: entry.id, field: 'displayCode', message: 'Name must be unique in this installation.',
    });
  }

  for (const board of boards) {
    const canonicalMeterPresent = meters.some((meter) => meter.installedOnBoardId === board.id);
    if (Boolean(board.meter_present) !== canonicalMeterPresent) issue(issues, {
      code: 'METER_PRESENT_MISMATCH', severity: 'ERROR', entityType: 'board', entityId: board.id,
      field: 'meterPresent', message: 'Legacy meter presence does not match installed meter devices.',
    });
    if ((board.type_code ?? boardTypeCode(board.asset_type)) === 'OTHER' && !board.custom_type_name?.trim()) {
      issue(issues, {
        code: 'CUSTOM_TYPE_REQUIRED', severity: 'ERROR', entityType: 'board', entityId: board.id,
        field: 'customTypeName', message: 'Enter a custom board type.',
      });
    }
    const source = board.electrical_source;
    if (!source || source.kind === 'TBC') issue(issues, {
      code: 'SUPPLY_TBC', severity: 'ERROR', entityType: 'board', entityId: board.id,
      field: 'electricalSource', message: 'Choose the board electrical source.',
      candidateIds: sourceIssueCandidates(store, installationId, board.id),
    });
    else if (source.kind === 'GRID' && !gridIds.has(source.gridSupplyId)) issue(issues, {
      code: 'SUPPLY_SOURCE_INVALID', severity: 'ERROR', entityType: 'board', entityId: board.id,
      field: 'electricalSource', message: 'The selected Grid supply is unavailable.',
      candidateIds: grids.map((item) => item.id),
    });
    else if (source.kind === 'BOARD' && (!boardById.has(source.boardId) || source.boardId === board.id)) issue(issues, {
      code: 'SUPPLY_SOURCE_INVALID', severity: 'ERROR', entityType: 'board', entityId: board.id,
      field: 'electricalSource', message: 'The selected source board is invalid.',
      candidateIds: sourceIssueCandidates(store, installationId, board.id),
    });
  }
  addCycleIssues(boards, issues);

  for (const meter of meters) {
    const isCustomMeter = meter.deviceFamily === 'OTHER' || meter.deviceModel === 'OTHER';
    if (!boardById.has(meter.installedOnBoardId)) issue(issues, {
      code: 'METER_BOARD_MISMATCH', severity: 'ERROR', entityType: 'meter', entityId: meter.id,
      field: 'installedOnBoardId', message: 'The meter installation board is unavailable.',
      candidateIds: boards.slice(0, 25).map((item) => item.id),
    });
    if (!meter.serialNumber.trim()) issue(issues, {
      code: 'METER_DEVICE_REQUIRED', severity: 'ERROR', entityType: 'meter', entityId: meter.id,
      field: 'serialNumber', message: 'Meter serial number is required.',
    });
    if (isCustomMeter && (!meter.customManufacturerName?.trim() || !meter.customModelName?.trim())) issue(issues, {
      code: 'CUSTOM_TYPE_REQUIRED', severity: 'ERROR', entityType: 'meter', entityId: meter.id,
      field: 'customModelName', message: 'Custom meters require manufacturer and model names.',
    });
    const expected = meter.deviceModel === 'A3RM' ? 3 : meter.deviceModel === 'A6M' ? 6 : undefined;
    if (expected !== undefined && meter.channels.length !== expected) {
      issue(issues, {
        code: 'CHANNEL_NOT_FOUND', severity: 'ERROR', entityType: 'meter', entityId: meter.id,
        field: 'channels', message: `${meter.deviceModel} requires exactly ${expected} channels.`,
      });
    }
    if (isCustomMeter && meter.channels.length < 1) {
      issue(issues, {
        code: 'METER_CAPABILITY_REQUIRED', severity: 'ERROR', entityType: 'meter', entityId: meter.id,
        field: 'channels', message: 'Declare at least one explicit channel for this custom meter.',
      });
    }
    const ordinals = new Set<number>();
    const channelIds = new Set<string>();
    for (const channel of meter.channels) {
      if (!Number.isSafeInteger(channel.ordinal) || channel.ordinal < 1) issue(issues, {
        code: 'CHANNEL_NOT_FOUND', severity: 'ERROR', entityType: 'channel', entityId: channel.id,
        field: 'ordinal', message: 'Channel ordinal must be a stable positive integer.',
      });
      if (ordinals.has(channel.ordinal) || channelIds.has(channel.id)) issue(issues, {
        code: 'CHANNEL_DUPLICATE_ASSIGNMENT', severity: 'ERROR', entityType: 'channel', entityId: channel.id,
        field: 'ordinal', message: 'Meter channel identity or ordinal is duplicated.',
      });
      ordinals.add(channel.ordinal);
      channelIds.add(channel.id);
      if (isCustomMeter && (
        !channel.capabilities || Object.keys(channel.capabilities).length === 0
      )) issue(issues, {
        code: 'METER_CAPABILITY_REQUIRED', severity: 'ERROR', entityType: 'channel', entityId: channel.id,
        field: 'capabilities', message: 'Declare explicit capabilities for this custom meter channel.',
      });
      if (channel.purpose === 'SPARE' && (
        channel.loadTypeCode || channel.customLoadTypeName?.trim() || channel.sensorRating?.trim() ||
        channel.description?.trim()
      )) issue(issues, {
        code: 'CHANNEL_PURPOSE_CONFLICT', severity: 'ERROR', entityType: 'channel', entityId: channel.id,
        field: 'purpose', message: 'Spare channels cannot carry load or sensor metadata.',
      });
      if (channel.loadTypeCode === 'OTHER' && !channel.customLoadTypeName?.trim()) issue(issues, {
        code: 'CUSTOM_TYPE_REQUIRED', severity: 'ERROR', entityType: 'channel', entityId: channel.id,
        field: 'customLoadTypeName', message: 'Enter a custom channel load type.',
      });
    }
    if (expected !== undefined) {
      const exactOrdinals = Array.from({ length: expected }, (_, index) => index + 1);
      if (exactOrdinals.some((ordinal) => !ordinals.has(ordinal))) issue(issues, {
        code: 'CHANNEL_NOT_FOUND', severity: 'ERROR', entityType: 'meter', entityId: meter.id,
        field: 'channels', message: `${meter.deviceModel} channel ordinals must be exactly 1–${expected}.`,
      });
    }
    const wwForms = store.formSubmissions.filter(
      (form) => form.installation_id === installationId && form.meter_id === meter.id &&
        form.form_type === 'ww-installation',
    );
    const requiresWattwatchersEvidence = meter.deviceFamily === 'WATTWATCHERS' &&
      (meter.deviceModel === 'A3RM' || meter.deviceModel === 'A6M');
    if (requiresWattwatchersEvidence && !wwForms.some((form) => form.status === 'Completed')) issue(issues, {
      code: 'METER_DEVICE_REQUIRED', severity: 'ERROR', entityType: 'meter', entityId: meter.id,
      field: 'formSubmissions', message: 'Complete the commissioning form for this meter.',
    });
    if (requiresWattwatchersEvidence && wwForms.some((form) => form.status === 'Draft')) issue(issues, {
      code: 'FORM_INCOMPLETE', severity: 'ERROR', entityType: 'meter', entityId: meter.id,
      field: 'formSubmissions', message: 'A Wattwatchers installation draft remains incomplete.',
    });
  }

  for (const form of store.formSubmissions.filter(
    (item) => item.installation_id === installationId && item.form_type === 'ww-installation')) {
    const meter = form.meter_id ? meterById.get(form.meter_id) : undefined;
    const retainedHistoricalContext = !meter && form.status === 'Completed' &&
      form.historical_meter_removed === true &&
      Boolean(form.completed_at && Number.isFinite(Date.parse(form.completed_at)));
    if (retainedHistoricalContext) continue;
    if (!meter || (form.board_id && form.board_id !== meter.installedOnBoardId)) issue(issues, {
      code: 'FORM_CONTEXT_REQUIRED', severity: 'ERROR', entityType: 'form', entityId: form.id,
      field: 'meterId', message: 'Wattwatchers installation form must reference its stable meter and board.',
    });
  }

  const assignedChannels = new Map<string, string>();
  const mainTotalsByBoundary = new Map<string, MeasurementAssignment[]>();
  for (const assignment of assignments) {
    const meter = meterById.get(assignment.meterId);
    if (!meter) {
      issue(issues, {
        code: 'METER_DEVICE_REQUIRED', severity: 'ERROR', entityType: 'measurement_assignment',
        entityId: assignment.id, field: 'meterId', message: 'Choose an installed meter device.',
        candidateIds: meters.map((item) => item.id),
      });
      continue;
    }
    const channelById = new Map(meter.channels.map((channel) => [channel.id, channel]));
    const localIds = new Set<string>();
    const purposes = new Set<MeterChannelPurpose>();
    for (const channelId of assignment.channelIds) {
      const channel = channelById.get(channelId);
      const duplicateInAssignment = localIds.has(channelId);
      if (!channel || duplicateInAssignment) issue(issues, {
        code: 'CHANNEL_NOT_FOUND', severity: 'ERROR', entityType: 'measurement_assignment',
        entityId: assignment.id, field: 'channelIds', message: 'An assigned channel is missing or duplicated.',
        candidateIds: meter.channels.map((item) => item.id),
      });
      localIds.add(channelId);
      if (!channel || duplicateInAssignment) continue;
      purposes.add(channel.purpose);
      const current = assignedChannels.get(channelId);
      if (current && current !== assignment.id) issue(issues, {
        code: 'CHANNEL_DUPLICATE_ASSIGNMENT', severity: 'ERROR', entityType: 'channel',
        entityId: channelId, field: 'measurementAssignments', message: 'This channel is assigned more than once.',
      });
      assignedChannels.set(channelId, assignment.id);
      if (channel?.purpose === 'SPARE') issue(issues, {
        code: 'CHANNEL_PURPOSE_CONFLICT', severity: 'ERROR', entityType: 'channel',
        entityId: channel.id, field: 'purpose', message: 'A spare channel cannot be assigned.',
      });
    }
    const phaseCountValid = assignment.phaseMode === 'SINGLE_PHASE'
      ? localIds.size === 1
      : assignment.phaseMode === 'THREE_PHASE'
        ? localIds.size === 3
        : localIds.size >= 1;
    if (!phaseCountValid) issue(issues, {
      code: 'PHASE_GROUP_INVALID', severity: 'ERROR', entityType: 'measurement_assignment',
      entityId: assignment.id, field: 'channelIds',
      message: 'Assignment channel count does not match its phase mode.',
    });
    if (purposes.size > 1) issue(issues, {
      code: 'CHANNEL_PURPOSE_CONFLICT', severity: 'ERROR', entityType: 'measurement_assignment',
      entityId: assignment.id, field: 'channelIds', message: 'One assignment cannot mix channel purposes.',
    });
    const allMain = localIds.size > 0 && purposes.size === 1 && purposes.has('MAIN_SUPPLY');
    if (allMain && !['BOARD', 'GRID_BOUNDARY', 'TBC'].includes(assignment.target.kind)) issue(issues, {
      code: 'CHANNEL_PURPOSE_CONFLICT', severity: 'ERROR', entityType: 'measurement_assignment',
      entityId: assignment.id, field: 'target',
      message: 'Main-supply channels can only measure a board, Grid boundary, or explicit TBC target.',
    });
    if (allMain && assignment.status === 'CONFIRMED') {
      const boundary = assignment.target.kind === 'BOARD'
        ? `BOARD:${assignment.target.boardId}`
        : assignment.target.kind === 'GRID_BOUNDARY'
          ? `GRID_BOUNDARY:${assignment.target.gridSupplyId}`
          : undefined;
      if (boundary) {
        const totals = mainTotalsByBoundary.get(boundary) ?? [];
        totals.push(assignment);
        mainTotalsByBoundary.set(boundary, totals);
      }
    }
    if ((assignment.status === 'TBC') !== (assignment.target.kind === 'TBC')) issue(issues, {
      code: 'MEASUREMENT_TARGET_TBC', severity: 'ERROR', entityType: 'measurement_assignment',
      entityId: assignment.id, field: 'target', message: 'Assignment status and target must use the same explicit TBC state.',
    });
    if (assignment.status === 'TBC' || assignment.target.kind === 'TBC') issue(issues, {
      code: 'MEASUREMENT_TARGET_TBC', severity: 'ERROR', entityType: 'measurement_assignment',
      entityId: assignment.id, field: 'targetConfirmation', message: 'Confirm the assignment measurement target.',
    });
    if (assignment.target.kind === 'BOARD' && !boardById.has(assignment.target.boardId)) issue(issues, {
      code: 'MEASUREMENT_TARGET_TBC', severity: 'ERROR', entityType: 'measurement_assignment',
      entityId: assignment.id, field: 'target', message: 'The assignment target board is unavailable.',
      candidateIds: boards.slice(0, 25).map((item) => item.id),
    });
    else if (
      assignment.target.kind === 'BOARD' &&
      allMain &&
      assignment.target.boardId !== meter.installedOnBoardId
    ) issue(issues, {
      code: 'METER_BOARD_MISMATCH', severity: 'ERROR', entityType: 'measurement_assignment',
      entityId: assignment.id, field: 'target',
      message: 'Main-supply channels may identify only the meter’s installed-on board.',
    });
    else if (
      assignment.target.kind === 'BOARD' &&
      !allMain && purposes.size === 1 && purposes.has('SUB_CIRCUIT') &&
      assignment.target.boardId === meter.installedOnBoardId
    ) issue(issues, {
      code: 'METER_BOARD_MISMATCH', severity: 'ERROR', entityType: 'measurement_assignment',
      entityId: assignment.id, field: 'target',
      message: 'Sub-circuit channels must target a downstream board or site asset.',
    });
    else if (
      assignment.target.kind === 'BOARD' &&
      !boardIsOnBoardSupplyPath(boardById, assignment.target.boardId, meter.installedOnBoardId)
    ) issue(issues, {
      code: 'METER_BOARD_MISMATCH', severity: 'ERROR', entityType: 'measurement_assignment',
      entityId: assignment.id, field: 'meterId',
      message: 'The meter board is not on the target board’s upstream supply path.',
    });
    if (assignment.target.kind === 'GRID_BOUNDARY' && !gridIds.has(assignment.target.gridSupplyId)) issue(issues, {
      code: 'MEASUREMENT_TARGET_TBC', severity: 'ERROR', entityType: 'measurement_assignment',
      entityId: assignment.id, field: 'target', message: 'The assignment Grid boundary is unavailable.',
      candidateIds: grids.map((item) => item.id),
    });
    else if (
      assignment.target.kind === 'GRID_BOUNDARY' &&
      !meterBoardReachesGrid(boardById, meter.installedOnBoardId, assignment.target.gridSupplyId)
    ) issue(issues, {
      code: 'METER_BOARD_MISMATCH', severity: 'ERROR', entityType: 'measurement_assignment',
      entityId: assignment.id, field: 'meterId',
      message: 'The meter board is not connected to this Grid boundary.',
    });
    if (assignment.target.kind === 'SITE_ASSET') {
      const asset = assetById.get(assignment.target.siteAssetId);
      if (!asset) issue(issues, {
        code: 'MEASUREMENT_TARGET_TBC', severity: 'ERROR', entityType: 'measurement_assignment',
        entityId: assignment.id, field: 'target', message: 'The assignment target asset is unavailable.',
        candidateIds: assets.map((item) => item.id),
      });
      else if (!boardIsOnAssetSupplyPath(store, asset, meter.installedOnBoardId)) issue(issues, {
        code: 'METER_BOARD_MISMATCH', severity: 'ERROR', entityType: 'measurement_assignment',
        entityId: assignment.id, field: 'meterId', message: 'The meter board is not on this asset’s electrical supply path.',
      });
    }
  }

  for (const meter of meters) {
    for (const channel of meter.channels) {
      if (channel.purpose === 'SPARE' || assignedChannels.has(channel.id)) continue;
      issue(issues, {
        code: 'CHANNEL_UNASSIGNED',
        severity: 'ERROR',
        entityType: 'channel',
        entityId: channel.id,
        field: 'measurementAssignments',
        message: 'Every non-spare meter channel must belong to exactly one measurement assignment.',
      });
    }
  }

  for (const totals of mainTotalsByBoundary.values()) {
    if (totals.length < 2) continue;
    for (const assignment of totals) issue(issues, {
      code: 'VIRTUAL_METER_SOURCE_INCOMPLETE', severity: 'ERROR',
      entityType: 'measurement_assignment', entityId: assignment.id,
      field: 'target', message: 'This boundary has more than one confirmed main-supply total.',
    });
  }

  for (const asset of assets) {
    if ((asset.type_code ?? siteAssetTypeCode(asset.asset_type)) === 'OTHER' && !asset.custom_type_name?.trim()) issue(issues, {
      code: 'CUSTOM_TYPE_REQUIRED', severity: 'ERROR', entityType: 'site_asset', entityId: asset.id,
      field: 'customTypeName', message: 'Enter a custom asset type.',
    });
    const source = asset.electrical_source;
    if (!source || source.kind === 'TBC') issue(issues, {
      code: 'SUPPLY_TBC', severity: 'ERROR', entityType: 'site_asset', entityId: asset.id,
      field: 'electricalSource', message: 'Choose the asset supply board.',
      candidateIds: sourceIssueCandidates(store, installationId),
    });
    else if (source.kind === 'BOARD' && !boardById.has(source.boardId)) issue(issues, {
      code: 'SUPPLY_SOURCE_INVALID', severity: 'ERROR', entityType: 'site_asset', entityId: asset.id,
      field: 'electricalSource', message: 'The selected asset supply is invalid.',
      candidateIds: sourceIssueCandidates(store, installationId),
    });
    else if (source.kind === 'GRID' && !gridIds.has(source.gridSupplyId)) issue(issues, {
      code: 'SUPPLY_SOURCE_INVALID', severity: 'ERROR', entityType: 'site_asset', entityId: asset.id,
      field: 'electricalSource', message: 'The selected asset Grid supply is unavailable.',
      candidateIds: grids.map((item) => item.id),
    });

    const state = asset.metering_state;
    const targetAssignments = assignments.filter(
      (assignment) => assignment.target.kind === 'SITE_ASSET' && assignment.target.siteAssetId === asset.id,
    );
    if (Boolean(asset.meter_present) !== (targetAssignments.length > 0)) issue(issues, {
      code: 'METER_PRESENT_MISMATCH', severity: 'ERROR', entityType: 'site_asset', entityId: asset.id,
      field: 'meterPresent', message: 'Legacy meter presence does not match canonical assignments.',
    });
    if (!state || state.kind === 'TBC') issue(issues, {
      code: 'METERING_STATE_INVALID', severity: 'ERROR', entityType: 'site_asset', entityId: asset.id,
      field: 'meteringState', message: 'Confirm whether this asset is metered.',
    });
    else if (state.kind === 'UNMETERED' && targetAssignments.length) issue(issues, {
      code: 'METERING_STATE_INVALID', severity: 'ERROR', entityType: 'site_asset', entityId: asset.id,
      field: 'meteringState.measurementAssignmentIds',
      message: 'This asset is marked unmetered but still has assignments.',
    });
    else if (state.kind === 'METERED') {
      const ids = new Set(state.measurementAssignmentIds);
      const directIds = new Set(targetAssignments.map((item) => item.id));
      const invalid = !ids.size || ids.size !== directIds.size ||
        [...ids].some((id) => !directIds.has(id)) || [...directIds].some((id) => !ids.has(id));
      if (invalid) issue(issues, {
        code: 'METERING_STATE_INVALID', severity: 'ERROR', entityType: 'site_asset', entityId: asset.id,
        field: 'meteringState', message: 'A metered asset requires valid exact measurement assignments.',
        candidateIds: targetAssignments.map((item) => item.id),
      });
    }
  }

  issues.sort((a, b) =>
    a.severity.localeCompare(b.severity) ||
    a.code.localeCompare(b.code) ||
    a.entityId.localeCompare(b.entityId));
  const readyToComplete = issues.every((item) => item.severity !== 'ERROR');
  const pinned = installation.status === 'Completed' && Boolean(installation.record_version_number);
  return {
    installationId,
    treeRevision: installation.tree_revision ?? 0,
    recordVersionNumber: installation.record_version_number,
    readyToComplete,
    eligibility: {
      draftDiagnosticReport: true,
      authoritativeReport: readyToComplete && pinned,
      mappingExport: readyToComplete && pinned && timezoneValid,
      // The accepted neutral export exists, but external DataDome transport is gated.
      dataDomeDelivery: false,
    },
    issues,
  };
}

export interface ElectricalTreeRow {
  id: string;
  kind: 'GRID' | 'BOARD' | 'SITE_ASSET' | 'UNRESOLVED';
  label: string;
  sourceId?: string;
  unresolved?: true;
  depth: number;
}

export function electricalTreeRows(store: AppDataStore, installationId: string): ElectricalTreeRow[] {
  const grids = store.gridSupplies.filter((item) => item.installationId === installationId);
  const boards = store.electricalAssets.filter((item) => item.audit_id === installationId);
  const assets = store.siteAssets.filter((item) => item.audit_id === installationId);
  const children = new Map<string, ElectricalTreeRow[]>();
  const unresolved: ElectricalTreeRow[] = [];
  const entityRows = new Map<string, ElectricalTreeRow>();
  const add = (sourceId: string, row: ElectricalTreeRow) => {
    const rows = children.get(sourceId) ?? [];
    rows.push(row);
    children.set(sourceId, rows);
  };
  for (const board of boards) {
    const row: ElectricalTreeRow = {
      id: board.id, kind: 'BOARD', label: board.display_code_meta?.value ?? board.display_code,
      sourceId: board.electrical_source?.kind === 'GRID'
        ? board.electrical_source.gridSupplyId
        : board.electrical_source?.kind === 'BOARD'
          ? board.electrical_source.boardId
          : undefined,
      unresolved: board.electrical_source?.kind === 'TBC' ? true : undefined,
      depth: 0,
    };
    entityRows.set(row.id, row);
    if (row.sourceId) add(row.sourceId, row); else unresolved.push(row);
  }
  for (const asset of assets) {
    const row: ElectricalTreeRow = {
      id: asset.id, kind: 'SITE_ASSET', label: asset.display_code_meta?.value ?? asset.display_code ?? asset.asset_name,
      sourceId: asset.electrical_source?.kind === 'BOARD'
        ? asset.electrical_source.boardId
        : asset.electrical_source?.kind === 'GRID'
          ? asset.electrical_source.gridSupplyId
          : undefined,
      unresolved: asset.electrical_source?.kind === 'TBC' ? true : undefined,
      depth: 0,
    };
    entityRows.set(row.id, row);
    if (row.sourceId) add(row.sourceId, row); else unresolved.push(row);
  }
  const rows: ElectricalTreeRow[] = [];
  const emitted = new Set<string>();
  const walk = (root: ElectricalTreeRow) => {
    const stack: ElectricalTreeRow[] = [root];
    const seen = new Set<string>();
    while (stack.length) {
      const current = stack.pop()!;
      if (seen.has(current.id)) continue;
      seen.add(current.id);
      emitted.add(current.id);
      rows.push(current);
      const nested = [...(children.get(current.id) ?? [])]
        .sort((a, b) => a.label.localeCompare(b.label));
      for (let index = nested.length - 1; index >= 0; index -= 1) {
        stack.push({ ...nested[index], depth: current.depth + 1 });
      }
    }
  };
  grids.sort((a, b) => a.name.localeCompare(b.name)).forEach((grid) => walk({
    id: grid.id, kind: 'GRID', label: grid.name, depth: 0,
  }));
  const unresolvedById = new Map(unresolved.map((row) => [row.id, row]));
  for (const [id, row] of entityRows) {
    if (!emitted.has(id)) unresolvedById.set(id, { ...row, unresolved: true });
  }
  if (unresolvedById.size) {
    rows.push({
      id: `unresolved:${installationId}`,
      kind: 'UNRESOLVED',
      label: 'Unresolved electrical relationships',
      unresolved: true,
      depth: 0,
    });
    [...unresolvedById.values()]
      .sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id))
      .forEach((row) => rows.push({ ...row, depth: 1, unresolved: true }));
  }
  return rows;
}

export interface AllAssetMeteringRow {
  id: string;
  displayCode: string;
  name: string;
  typeLabel: string;
  supplyLabel: string;
  state: 'DIRECT' | 'VIRTUAL' | 'UNMETERED' | 'TBC' | 'MAPPING_ISSUE';
  virtualMeterId?: string;
  virtualPreview?: boolean;
  meterLabels: string[];
  channelLabels: string[];
  meteringIssueCodes: string[];
}

export interface MeasurementSemanticsInput {
  boards: ElectricalAsset[];
  siteAssets: SiteAsset[];
  gridSupplies: GridSupply[];
  meterDevices: MeterDevice[];
  measurementAssignments: MeasurementAssignment[];
}

function measurementBoardHasUpstreamBoard(
  boardById: Map<string, ElectricalAsset>,
  boardId: string,
  upstreamBoardId: string,
): boolean {
  let current = boardById.get(boardId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.electrical_source?.kind !== 'BOARD') return false;
    if (current.electrical_source.boardId === upstreamBoardId) return true;
    current = boardById.get(current.electrical_source.boardId);
  }
  return false;
}

function measurementBoardReachesGridSupply(
  boardById: Map<string, ElectricalAsset>,
  boardId: string,
  gridSupplyId: string,
): boolean {
  let current = boardById.get(boardId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.electrical_source?.kind === 'GRID') {
      return current.electrical_source.gridSupplyId === gridSupplyId;
    }
    if (current.electrical_source?.kind !== 'BOARD') return false;
    current = boardById.get(current.electrical_source.boardId);
  }
  return false;
}

/** Shared physical/topology contract for map edges and residual derivation. */
export function isSemanticallyConfirmedMeasurementAssignment(
  input: MeasurementSemanticsInput,
  assignment: MeasurementAssignment,
): boolean {
  if (assignment.status !== 'CONFIRMED' || assignment.target.kind === 'TBC') {
    return false;
  }
  const boardById = new Map(input.boards.map((board) => [board.id, board]));
  const meter = input.meterDevices.find(
    (candidate) => candidate.id === assignment.meterId,
  );
  if (!meter || !boardById.has(meter.installedOnBoardId)) return false;

  const uniqueChannelIds = new Set(assignment.channelIds);
  const expectedCount =
    assignment.phaseMode === 'SINGLE_PHASE'
      ? 1
      : assignment.phaseMode === 'THREE_PHASE'
        ? 3
        : null;
  if (
    uniqueChannelIds.size === 0 ||
    uniqueChannelIds.size !== assignment.channelIds.length ||
    (expectedCount !== null && uniqueChannelIds.size !== expectedCount)
  ) {
    return false;
  }
  const channels = [...uniqueChannelIds].map((channelId) =>
    meter.channels.find((channel) => channel.id === channelId),
  );
  if (channels.some((channel) => !channel || channel.purpose === 'SPARE')) {
    return false;
  }
  const purposes = new Set(channels.map((channel) => channel?.purpose));
  if (purposes.size !== 1) return false;
  if (
    [...uniqueChannelIds].some((channelId) =>
      input.measurementAssignments.some(
        (candidate) =>
          candidate.id !== assignment.id &&
          candidate.channelIds.includes(channelId),
      ),
    )
  ) {
    return false;
  }

  const purpose = channels[0]?.purpose;
  if (assignment.target.kind === 'SITE_ASSET') {
    const siteAssetId = assignment.target.siteAssetId;
    const target = input.siteAssets.find(
      (asset) => asset.id === siteAssetId,
    );
    return (
      purpose === 'SUB_CIRCUIT' &&
      target?.electrical_source?.kind === 'BOARD' &&
      target.electrical_source.boardId === meter.installedOnBoardId
    );
  }
  if (assignment.target.kind === 'BOARD') {
    const target = boardById.get(assignment.target.boardId);
    if (!target) return false;
    if (purpose === 'MAIN_SUPPLY') {
      return target.id === meter.installedOnBoardId;
    }
    return (
      purpose === 'SUB_CIRCUIT' &&
      target.id !== meter.installedOnBoardId &&
      measurementBoardHasUpstreamBoard(
        boardById,
        target.id,
        meter.installedOnBoardId,
      )
    );
  }
  const gridSupplyId = assignment.target.gridSupplyId;
  return (
    purpose === 'MAIN_SUPPLY' &&
    input.gridSupplies.some(
      (supply) => supply.id === gridSupplyId,
    ) &&
    measurementBoardReachesGridSupply(
      boardById,
      meter.installedOnBoardId,
      gridSupplyId,
    )
  );
}

export function deriveVirtualMetersFromEntities(input: {
  boards: ElectricalAsset[];
  siteAssets: SiteAsset[];
  gridSupplies: GridSupply[];
  meterDevices: MeterDevice[];
  measurementAssignments: MeasurementAssignment[];
}): VirtualMeterDefinition[] {
  const boards = input.boards;
  const assets = input.siteAssets;
  const meters = new Map(input.meterDevices.map((item) => [item.id, item]));
  const assignments = input.measurementAssignments.filter((assignment) =>
    isSemanticallyConfirmedMeasurementAssignment(input, assignment),
  );
  const totalsByParent = new Map<string, MeasurementAssignment[]>();
  for (const assignment of assignments) {
    if (assignment.target.kind !== 'BOARD' && assignment.target.kind !== 'GRID_BOUNDARY') continue;
    const meter = meters.get(assignment.meterId);
    if (!meter || !assignment.channelIds.length) continue;
    const allMain = assignment.channelIds.every((id) =>
      meter.channels.find((channel) => channel.id === id)?.purpose === 'MAIN_SUPPLY');
    if (!allMain) continue;
    const parentNodeId = assignment.target.kind === 'BOARD'
      ? assignment.target.boardId
      : assignment.target.gridSupplyId;
    const totals = totalsByParent.get(parentNodeId) ?? [];
    totals.push(assignment);
    totalsByParent.set(parentNodeId, totals);
  }

  const result: VirtualMeterDefinition[] = [];
  for (const parentNodeId of [...totalsByParent.keys()].sort()) {
    const totals = totalsByParent.get(parentNodeId)!;
    if (totals.length !== 1) continue;
    const total = totals[0]!;
    const immediateBoardIds = new Set(boards.filter((board) =>
      (board.electrical_source?.kind === 'BOARD' && board.electrical_source.boardId === parentNodeId) ||
      (board.electrical_source?.kind === 'GRID' && board.electrical_source.gridSupplyId === parentNodeId))
      .map((board) => board.id));
    const immediateAssetIds = new Set(assets.filter((asset) =>
      (asset.electrical_source?.kind === 'BOARD' && asset.electrical_source.boardId === parentNodeId) ||
      (asset.electrical_source?.kind === 'GRID' && asset.electrical_source.gridSupplyId === parentNodeId))
      .map((asset) => asset.id));
    const subtractAssignments = assignments.filter((assignment) =>
        assignment.id !== total.id && (
          (assignment.target.kind === 'BOARD' && immediateBoardIds.has(assignment.target.boardId)) ||
          (assignment.target.kind === 'SITE_ASSET' && immediateAssetIds.has(assignment.target.siteAssetId))
        ));
    const measurementsPerChild = new Map<string, number>();
    for (const assignment of subtractAssignments) {
      const key = assignment.target.kind === 'BOARD'
        ? `BOARD:${assignment.target.boardId}`
        : assignment.target.kind === 'SITE_ASSET'
          ? `SITE_ASSET:${assignment.target.siteAssetId}`
          : '';
      if (key) measurementsPerChild.set(key, (measurementsPerChild.get(key) ?? 0) + 1);
    }
    // Multiple measurements for one immediate child are ambiguous; the
    // server remains authoritative and no client residual preview is emitted.
    if ([...measurementsPerChild.values()].some((count) => count > 1)) continue;
    const subtractAssignmentIds = subtractAssignments
      .map((assignment) => assignment.id)
      .sort();
    const digest = sha256([parentNodeId, total.id, ...subtractAssignmentIds].join('\u0000')).slice(0, 24);
    result.push({
      id: `virtual_${digest}`,
      parentNodeId,
      totalMeasurementAssignmentId: total.id,
      subtractAssignmentIds,
      formulaVersion: 1,
      allocation: 'UNALLOCATED_RESIDUAL',
    });
  }
  return result;
}

export function deriveVirtualMeters(
  store: AppDataStore,
  installationId: string,
): VirtualMeterDefinition[] {
  return deriveVirtualMetersFromEntities({
    boards: store.electricalAssets.filter(
      (item) => item.audit_id === installationId,
    ),
    siteAssets: store.siteAssets.filter(
      (item) => item.audit_id === installationId,
    ),
    gridSupplies: store.gridSupplies.filter(
      (item) => item.installationId === installationId,
    ),
    meterDevices: store.meterDevices.filter(
      (item) => item.installationId === installationId,
    ),
    measurementAssignments: store.measurementAssignments.filter(
      (item) => item.installationId === installationId,
    ),
  });
}

export function allAssetMeteringRows(store: AppDataStore, installationId: string): AllAssetMeteringRow[] {
  const installation = store.installations.find((item) => item.id === installationId);
  const boards = new Map(
    store.electricalAssets.filter((item) => item.audit_id === installationId).map((item) => [item.id, item]),
  );
  const meters = new Map(
    store.meterDevices.filter((item) => item.installationId === installationId).map((item) => [item.id, item]),
  );
  const assignments = new Map(
    store.measurementAssignments.filter((item) => item.installationId === installationId).map((item) => [item.id, item]),
  );
  const readinessIssues = installation
    ? installationReadiness(store, installationId).issues.filter((item) => item.severity === 'ERROR')
    : [];
  const serverDerived = installation?.server_derived;
  const serverVirtuals = serverDerived && serverDerived.treeRevision === installation?.server_tree_revision
    ? serverDerived.virtualMeterDefinitions
    : undefined;
  const virtuals = serverVirtuals ?? deriveVirtualMeters(store, installationId);
  const virtualsArePreview = !serverVirtuals;
  const virtualByParent = new Map(virtuals.map((item) => [item.parentNodeId, item]));
  const virtualForAsset = (asset: SiteAsset): VirtualMeterDefinition | undefined => {
    if (asset.electrical_source?.kind === 'GRID') {
      return virtualByParent.get(asset.electrical_source.gridSupplyId);
    }
    // Residuals describe only one electrical boundary. An asset under a child
    // board must never inherit a residual from an ancestor board or Grid.
    return asset.electrical_source?.kind === 'BOARD'
      ? virtualByParent.get(asset.electrical_source.boardId)
      : undefined;
  };
  return store.siteAssets
    .filter((item) => item.audit_id === installationId)
    .map((asset) => {
      const persistedState = asset.metering_state ?? { kind: 'TBC' as const };
      const linked = [...assignments.values()].filter((assignment) =>
        assignment.target.kind === 'SITE_ASSET' && assignment.target.siteAssetId === asset.id);
      const declaredIds = persistedState.kind === 'METERED'
        ? new Set(persistedState.measurementAssignmentIds)
        : new Set<string>();
      const actualIds = new Set(linked.map((assignment) => assignment.id));
      const assignmentIds = new Set(linked.map((assignment) => assignment.id));
      const meterIds = new Set(linked.map((assignment) => assignment.meterId));
      const channelIds = new Set(linked.flatMap((assignment) => assignment.channelIds));
      const meteringIssues = readinessIssues.filter((item) => {
        if (
          item.entityType === 'site_asset'
          && item.entityId === asset.id
          && persistedState.kind !== 'TBC'
          && (item.code === 'METERING_STATE_INVALID' || item.code === 'METER_PRESENT_MISMATCH')
        ) return true;
        if (item.entityType === 'measurement_assignment' && assignmentIds.has(item.entityId)) return true;
        if (
          item.entityType === 'channel'
          && channelIds.has(item.entityId)
          && ['CHANNEL_NOT_FOUND', 'CHANNEL_DUPLICATE_ASSIGNMENT', 'CHANNEL_PURPOSE_CONFLICT', 'METER_CAPABILITY_REQUIRED'].includes(item.code)
        ) return true;
        return item.entityType === 'meter'
          && meterIds.has(item.entityId)
          && ['METER_BOARD_MISMATCH', 'CHANNEL_NOT_FOUND', 'METER_CAPABILITY_REQUIRED'].includes(item.code);
      });
      const validDirect = persistedState.kind === 'METERED'
        && declaredIds.size === 1
        && actualIds.size === 1
        && [...declaredIds].every((id) => actualIds.has(id))
        && linked[0]?.status === 'CONFIRMED'
        && asset.meter_present;
      const invalidMapping = persistedState.kind === 'METERED'
        ? !validDirect || meteringIssues.length > 0
        : linked.length > 0 || asset.meter_present || meteringIssues.length > 0;
      const virtual = !invalidMapping && persistedState.kind === 'UNMETERED'
        ? virtualForAsset(asset)
        : undefined;
      const state: AllAssetMeteringRow['state'] = invalidMapping
        ? 'MAPPING_ISSUE'
        : validDirect
          ? 'DIRECT'
          : persistedState.kind === 'TBC'
            ? 'TBC'
            : virtual
              ? 'VIRTUAL'
              : 'UNMETERED';
      const linkedMeters = linked.map((item) => meters.get(item.meterId)).filter((item): item is MeterDevice => Boolean(item));
      const source = asset.electrical_source?.kind === 'BOARD'
        ? boards.get(asset.electrical_source.boardId)
        : undefined;
      return {
        id: asset.id,
        displayCode: asset.display_code_meta?.value ?? asset.display_code ?? '—',
        name: asset.asset_name,
        typeLabel: asset.type_code === 'OTHER'
          ? asset.custom_type_name || 'Other'
          : SITE_ASSET_TYPE_LABELS[asset.type_code ?? siteAssetTypeCode(asset.asset_type)],
        supplyLabel: source?.display_code_meta?.value ?? source?.display_code ?? 'TBC',
        state,
        virtualMeterId: virtual?.id,
        virtualPreview: Boolean(virtual) && virtualsArePreview,
        meterLabels: [...new Set(linkedMeters.map((meter) => meter.displayName.value))],
        channelLabels: linked.flatMap((assignment) => assignment.channelIds.map((id) => {
          const meter = meters.get(assignment.meterId);
          const channel = meter?.channels.find((item) => item.id === id);
          return `${meter?.displayName.value ?? assignment.meterId} · Ch ${channel?.ordinal ?? id}`;
        })),
        meteringIssueCodes: [...new Set(meteringIssues.map((item) => item.code))].sort(),
      };
    })
    .sort((a, b) => a.displayCode.localeCompare(b.displayCode));
}

export interface MeteringInventorySummary {
  assets: {
    total: number;
    directlyMetered: number;
    confirmedUnmetered: number;
    toBeConfirmed: number;
    brokenMappings: number;
  };
  meters: {
    total: number;
    withoutAssignments: number;
    allChannelsSpare: number;
    withUnassignedActiveChannels: number;
  };
  channels: {
    active: number;
    assignedActive: number;
    unassignedActive: number;
    spare: number;
  };
}

export function meteringInventorySummary(
  store: AppDataStore,
  installationId: string,
): MeteringInventorySummary {
  const rows = allAssetMeteringRows(store, installationId);
  const assignments = store.measurementAssignments.filter(
    (assignment) => assignment.installationId === installationId,
  );
  const meters = store.meterDevices.filter((meter) => meter.installationId === installationId);
  const meterById = new Map(meters.map((meter) => [meter.id, meter]));
  const assignedChannelIdsByMeter = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    const meter = meterById.get(assignment.meterId);
    if (!meter) continue;
    const validChannelIds = new Set(meter.channels.map((channel) => channel.id));
    const assigned = assignedChannelIdsByMeter.get(meter.id) ?? new Set<string>();
    assignment.channelIds.forEach((channelId) => {
      if (validChannelIds.has(channelId)) assigned.add(channelId);
    });
    assignedChannelIdsByMeter.set(meter.id, assigned);
  }
  const deviceStats = meters.map((meter) => {
    const assignedChannelIds = assignedChannelIdsByMeter.get(meter.id) ?? new Set<string>();
    const activeChannels = meter.channels.filter((channel) => channel.purpose !== 'SPARE');
    const assignedActive = activeChannels.filter((channel) => assignedChannelIds.has(channel.id)).length;
    const spare = meter.channels.filter((channel) => channel.purpose === 'SPARE').length;
    return {
      assignmentCount: assignments.filter((assignment) => assignment.meterId === meter.id).length,
      active: activeChannels.length,
      assignedActive,
      unassignedActive: activeChannels.length - assignedActive,
      spare,
      allChannelsSpare: meter.channels.length > 0 && spare === meter.channels.length,
    };
  });
  const active = deviceStats.reduce((total, meter) => total + meter.active, 0);
  const assignedActive = deviceStats.reduce((total, meter) => total + meter.assignedActive, 0);
  return {
    assets: {
      total: rows.length,
      directlyMetered: rows.filter((row) => row.state === 'DIRECT').length,
      confirmedUnmetered: rows.filter((row) => row.state === 'UNMETERED' || row.state === 'VIRTUAL').length,
      toBeConfirmed: rows.filter((row) => row.state === 'TBC').length,
      brokenMappings: rows.filter((row) => row.state === 'MAPPING_ISSUE').length,
    },
    meters: {
      total: meters.length,
      withoutAssignments: deviceStats.filter((meter) => meter.assignmentCount === 0).length,
      allChannelsSpare: deviceStats.filter((meter) => meter.allChannelsSpare).length,
      withUnassignedActiveChannels: deviceStats.filter((meter) => meter.unassignedActive > 0).length,
    },
    channels: {
      active,
      assignedActive,
      unassignedActive: active - assignedActive,
      spare: deviceStats.reduce((total, meter) => total + meter.spare, 0),
    },
  };
}

export interface InstallationMappingExportV1 {
  schema: 'installation-mapping/v1';
  installation: {
    id: string;
    externalKey: string;
    recordVersionNumber: number;
    canonicalizerVersion: number;
    validatorVersion: number;
    taxonomyCatalogVersion: number;
    siteName: string;
    timezone: string;
    completedAt?: string;
  };
  physicalLocations: Array<{ id: string; name: string; description?: string }>;
  electricalNodes: Array<Record<string, unknown>>;
  supplyEdges: Array<{ id: string; sourceNodeId: string; targetNodeId: string }>;
  unresolvedRelationships: Array<Record<string, unknown>>;
  meters: Array<{ id: string; installedOnBoardId: string; model: string; serialNumber: string }>;
  channels: Array<{ id: string; meterId: string; ordinal: number; purpose: string; sensorRating?: string }>;
  measurementAssignments: MeasurementAssignment[];
  assetCoverage: Array<Record<string, unknown>>;
  virtualMeters: VirtualMeterDefinition[];
  readiness: InstallationReadiness;
  contentHash: string;
}

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, nested]) => nested !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalJsonValue(nested)]),
  );
}

export function canonicalJsonStringify(value: unknown): string {
  return JSON.stringify(canonicalJsonValue(value));
}

export function buildInstallationMappingExport(
  store: AppDataStore,
  installationId: string,
): InstallationMappingExportV1 {
  void store;
  void installationId;
  throw new Error(
    'Canonical mapping export is server-owned. Fetch the exact pinned server mapping instead of promoting a client residual preview.',
  );
}

export function setAssetMeteringState(
  store: AppDataStore,
  assetId: string,
  state: MeteringState,
  assignments: MeasurementAssignment[] = [],
): void {
  const asset = store.siteAssets.find((item) => item.id === assetId);
  if (!asset) throw new Error('Site asset not found');
  const owned = store.measurementAssignments.filter(
    (assignment) => assignment.target.kind === 'SITE_ASSET' && assignment.target.siteAssetId === assetId,
  );
  let selected: MeasurementAssignment[] = [];
  if (state.kind === 'METERED') {
    const ids = new Set(state.measurementAssignmentIds);
    selected = assignments.filter((assignment) => ids.has(assignment.id));
    if (selected.length !== ids.size) {
      throw new Error('Metered assets require every selected assignment.');
    }
    if (selected.some((assignment) =>
      assignment.installationId !== asset.audit_id ||
      assignment.target.kind !== 'SITE_ASSET' ||
      assignment.target.siteAssetId !== asset.id)) {
      throw new Error('Every selected assignment must target this site asset.');
    }
  }
  let next = store.measurementAssignments.filter(
    (assignment) => !(assignment.target.kind === 'SITE_ASSET' && assignment.target.siteAssetId === assetId),
  );
  if (state.kind === 'METERED') {
    const selectedChannelIds = new Set(selected.flatMap((assignment) => assignment.channelIds));
    next = next.flatMap((assignment) => {
      const overlap = assignment.channelIds.filter((channelId) => selectedChannelIds.has(channelId));
      if (!overlap.length) return [assignment];
      if (assignment.target.kind !== 'TBC') {
        throw new Error('A selected channel is already assigned elsewhere.');
      }
      const remaining = assignment.channelIds.filter((channelId) => !selectedChannelIds.has(channelId));
      if (!remaining.length) return [];
      return [{
        ...assignment,
        channelIds: remaining,
        phaseMode: remaining.length === 1
          ? 'SINGLE_PHASE' as const
          : remaining.length === 3
            ? 'THREE_PHASE' as const
            : 'OTHER' as const,
      }];
    });
    const occupied = new Set(next.flatMap((assignment) => assignment.channelIds));
    for (const assignment of selected) {
      for (const channelId of assignment.channelIds) {
        if (occupied.has(channelId)) throw new Error('A selected channel is already assigned elsewhere.');
        occupied.add(channelId);
      }
    }
    next.push(...selected);
  } else {
    const occupied = new Set(next.flatMap((assignment) => assignment.channelIds));
    for (const assignment of owned) {
      const meter = store.meterDevices.find((item) => item.id === assignment.meterId);
      if (!meter) continue;
      for (const channelId of assignment.channelIds) {
        const channel = meter.channels.find((item) => item.id === channelId);
        if (!channel || channel.purpose === 'SPARE' || occupied.has(channelId)) continue;
        let assignmentId = `assignment_tbc_${sha256(`${meter.id}|${channel.id}`).slice(0, 16)}`;
        if (next.some((item) => item.id === assignmentId)) {
          assignmentId = `assignment_tbc_${sha256(`${meter.id}|${channel.id}|${asset.id}`).slice(0, 16)}`;
        }
        next.push({
          id: assignmentId,
          installationId: asset.audit_id,
          meterId: meter.id,
          channelIds: [channel.id],
          phaseMode: 'SINGLE_PHASE',
          target: { kind: 'TBC' },
          direction: assignment.direction,
          status: 'TBC',
        });
        occupied.add(channelId);
      }
    }
  }
  store.measurementAssignments = next;
  asset.metering_state = state;
  projectCanonicalCompatibility(store, asset.audit_id);
}

function assignmentBoundaryKey(assignment: MeasurementAssignment): string | null {
  if (assignment.target.kind === 'BOARD') return `BOARD:${assignment.target.boardId}`;
  if (assignment.target.kind === 'GRID_BOUNDARY') {
    return `GRID_BOUNDARY:${assignment.target.gridSupplyId}`;
  }
  return null;
}

/**
 * Replaces every mapping owned by one meter as a single validated operation.
 * This is the canonical write path used by the mobile assignment editor.
 */
export function replaceMeterMeasurementAssignments(
  store: AppDataStore,
  meterId: string,
  incoming: MeasurementAssignment[],
): void {
  const meter = store.meterDevices.find((item) => item.id === meterId);
  if (!meter) throw new Error('Meter device not found.');
  const installationId = meter.installationId;
  const channelById = new Map(meter.channels.map((channel) => [channel.id, channel]));
  const boardById = new Map(
    store.electricalAssets
      .filter((board) => board.audit_id === installationId)
      .map((board) => [board.id, board]),
  );
  const gridIds = new Set(
    store.gridSupplies
      .filter((grid) => grid.installationId === installationId)
      .map((grid) => grid.id),
  );
  const assetById = new Map(
    store.siteAssets
      .filter((asset) => asset.audit_id === installationId)
      .map((asset) => [asset.id, asset]),
  );
  const retained = store.measurementAssignments.filter((item) => item.meterId !== meterId);
  const retainedIds = new Set(retained.map((item) => item.id));
  const usedChannelIds = new Set(retained.flatMap((item) => item.channelIds));
  const incomingIds = new Set<string>();
  const selectedChannelIds = new Set<string>();
  const mainBoundaries = new Set<string>();
  const siteAssetTargets = new Set<string>();

  for (const existing of retained) {
    if (existing.target.kind === 'SITE_ASSET') {
      if (siteAssetTargets.has(existing.target.siteAssetId)) {
        throw new Error('A site asset can have only one direct measurement assignment.');
      }
      siteAssetTargets.add(existing.target.siteAssetId);
    }
    const existingMeter = store.meterDevices.find((item) => item.id === existing.meterId);
    const purposes = new Set(
      existing.channelIds
        .map((id) => existingMeter?.channels.find((channel) => channel.id === id)?.purpose)
        .filter(Boolean),
    );
    if (purposes.size === 1 && purposes.has('MAIN_SUPPLY')) {
      const key = assignmentBoundaryKey(existing);
      if (key && existing.status === 'CONFIRMED') mainBoundaries.add(key);
    }
  }

  for (const assignment of incoming) {
    if (!assignment.id.trim() || incomingIds.has(assignment.id) || retainedIds.has(assignment.id)) {
      throw new Error('Every assignment needs a unique stable ID.');
    }
    incomingIds.add(assignment.id);
    if (assignment.installationId !== installationId || assignment.meterId !== meterId) {
      throw new Error('Assignment installation and meter links are immutable.');
    }
    const channelIds = [...new Set(assignment.channelIds)];
    if (channelIds.length !== assignment.channelIds.length || !channelIds.length) {
      throw new Error('Choose one or more unique channels for every assignment.');
    }
    const channels = channelIds.map((id) => channelById.get(id));
    if (channels.some((channel) => !channel)) {
      throw new Error('Every assigned channel must exist on this meter.');
    }
    for (const channelId of channelIds) {
      if (usedChannelIds.has(channelId) || selectedChannelIds.has(channelId)) {
        throw new Error('A meter channel can belong to only one measurement assignment.');
      }
      selectedChannelIds.add(channelId);
    }
    const purposes = new Set(channels.map((channel) => channel!.purpose));
    if (purposes.size !== 1 || purposes.has('SPARE')) {
      throw new Error('An assignment needs channels with one shared, non-spare purpose.');
    }
    const expectedCount = assignment.phaseMode === 'SINGLE_PHASE'
      ? 1
      : assignment.phaseMode === 'THREE_PHASE'
        ? 3
        : null;
    if ((expectedCount !== null && channelIds.length !== expectedCount) ||
        (expectedCount === null && channelIds.length < 1)) {
      throw new Error('Assignment channel count must match its phase mode.');
    }
    const isMain = purposes.has('MAIN_SUPPLY');
    if (isMain && !['BOARD', 'GRID_BOUNDARY', 'TBC'].includes(assignment.target.kind)) {
      throw new Error('Main-supply channels can measure a board, Grid boundary, or explicit TBC target.');
    }
    if (!isMain && assignment.target.kind === 'GRID_BOUNDARY') {
      throw new Error('Only main-supply channels can measure a Grid boundary.');
    }
    if ((assignment.status === 'TBC') !== (assignment.target.kind === 'TBC')) {
      throw new Error('TBC status and TBC target must be selected together.');
    }
    if (assignment.target.kind === 'BOARD') {
      const target = boardById.get(assignment.target.boardId);
      if (!target) throw new Error('The selected target board is unavailable.');
      if (isMain && target.id !== meter.installedOnBoardId) {
        throw new Error('Main-supply channels may identify only their installed-on board; use sub-circuit channels for downstream boards.');
      }
      if (!isMain && target.id === meter.installedOnBoardId) {
        throw new Error('Sub-circuit channels must target a downstream board or site asset.');
      }
      if (!boardIsOnBoardSupplyPath(boardById, target.id, meter.installedOnBoardId)) {
        throw new Error('The meter board must be on the target board’s upstream supply path.');
      }
    } else if (assignment.target.kind === 'GRID_BOUNDARY') {
      if (!gridIds.has(assignment.target.gridSupplyId)) {
        throw new Error('The selected Grid boundary is unavailable.');
      }
      if (!meterBoardReachesGrid(boardById, meter.installedOnBoardId, assignment.target.gridSupplyId)) {
        throw new Error('The meter board is not connected to this Grid boundary.');
      }
    } else if (assignment.target.kind === 'SITE_ASSET') {
      const asset = assetById.get(assignment.target.siteAssetId);
      if (!asset) throw new Error('The selected site asset is unavailable.');
      if (siteAssetTargets.has(assignment.target.siteAssetId)) {
        throw new Error('A site asset can have only one direct measurement assignment.');
      }
      siteAssetTargets.add(assignment.target.siteAssetId);
      if (!boardIsOnAssetSupplyPath(store, asset, meter.installedOnBoardId)) {
        throw new Error('The meter board must be on the asset’s upstream supply path.');
      }
    }
    if (isMain && assignment.status === 'CONFIRMED') {
      const key = assignmentBoundaryKey(assignment);
      if (key && mainBoundaries.has(key)) {
        throw new Error('A board or Grid boundary can have only one confirmed main-supply total.');
      }
      if (key) mainBoundaries.add(key);
    }
  }

  for (const channel of meter.channels) {
    if (channel.purpose !== 'SPARE' && !selectedChannelIds.has(channel.id)) {
      throw new Error('Every non-spare meter channel must belong to exactly one measurement assignment.');
    }
  }

  store.measurementAssignments = [...retained, ...incoming.map((item) => ({
    ...item,
    channelIds: [...item.channelIds],
    target: { ...item.target },
  }))];
  for (const asset of assetById.values()) {
    const assignmentIds = store.measurementAssignments
      .filter((assignment) =>
        assignment.target.kind === 'SITE_ASSET' &&
        assignment.target.siteAssetId === asset.id)
      .map((assignment) => assignment.id)
      .sort();
    if (assignmentIds.length) {
      asset.metering_state = { kind: 'METERED', measurementAssignmentIds: assignmentIds };
    } else if (asset.metering_state?.kind === 'METERED') {
      asset.metering_state = { kind: 'TBC' };
    }
  }
  projectCanonicalCompatibility(store, installationId);
}

export function createMeasurementAssignment(input: {
  installationId: string;
  assetId: string;
  meter: MeterDevice;
  channelIds: string[];
  phaseMode: MeasurementAssignment['phaseMode'];
  direction: MeasurementDirection;
}): MeasurementAssignment {
  const normalizedIds = [...new Set(input.channelIds)];
  const selectedChannels = normalizedIds.map((id) =>
    input.meter.channels.find((channel) => channel.id === id));
  if (selectedChannels.some((channel) => !channel)) {
    throw new Error('Every selected channel must exist on the chosen meter.');
  }
  const selected = selectedChannels as MeterChannel[];
  const expectedCount = input.phaseMode === 'SINGLE_PHASE'
    ? 1
    : input.phaseMode === 'THREE_PHASE'
      ? 3
      : undefined;
  if ((expectedCount !== undefined && selected.length !== expectedCount) ||
      (expectedCount === undefined && selected.length < 1)) {
    throw new Error('Selected channel count does not match the explicit phase mode.');
  }
  const purposes = new Set(selected.map((channel) => channel.purpose));
  if (purposes.size !== 1 || purposes.has('SPARE') || purposes.has('MAIN_SUPPLY')) {
    throw new Error('A site-asset assignment requires channels with one non-spare sub-circuit purpose.');
  }
  const identityIds = [...normalizedIds].sort();
  return {
    id: `assignment_${input.assetId}_${sha256(`${input.meter.id}|${identityIds.join('|')}`).slice(0, 12)}`,
    installationId: input.installationId,
    meterId: input.meter.id,
    channelIds: normalizedIds,
    phaseMode: input.phaseMode,
    target: { kind: 'SITE_ASSET', siteAssetId: input.assetId },
    direction: input.direction,
    status: 'CONFIRMED',
  };
}

export function canonicalSourceToLegacy(source: ElectricalSource): Pick<
  ElectricalAsset,
  'electrical_parent_id' | 'electrical_parent_tbc'
> {
  return source.kind === 'BOARD'
    ? { electrical_parent_id: source.boardId, electrical_parent_tbc: false }
    : { electrical_parent_id: null, electrical_parent_tbc: source.kind === 'TBC' };
}

export function meteringStateForAssignments(ids: string[]): MeteringState {
  return ids.length ? { kind: 'METERED', measurementAssignmentIds: ids } : { kind: 'TBC' };
}

export function targetLabel(
  target: MeasurementTarget,
  store: AppDataStore,
): string {
  if (target.kind === 'TBC') return 'TBC';
  if (target.kind === 'GRID_BOUNDARY') return store.gridSupplies.find((item) => item.id === target.gridSupplyId)?.name ?? 'Missing Grid supply';
  if (target.kind === 'BOARD') {
    const board = store.electricalAssets.find((item) => item.id === target.boardId);
    return board?.display_code_meta?.value ?? board?.display_code ?? 'Missing board';
  }
  const asset = store.siteAssets.find((item) => item.id === target.siteAssetId);
  return asset?.display_code_meta?.value ?? asset?.display_code ?? asset?.asset_name ?? 'Missing asset';
}
