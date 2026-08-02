import { apiClient, type RemoteInstallationTree } from '../api/apiClient';
import { getStore, initStore, updateStore } from '../data/seed';
import type {
  DisplayCode,
  ElectricalAsset,
  ElectricalSource,
  FormAttachment,
  FormSubmission,
  GridSupply,
  Installation,
  MeasurementAssignment,
  MeasurementTarget,
  Meter,
  MeterChannel,
  MeterDevice,
  SiteAsset,
  Zone,
} from '../types';
import { createId, nowIso } from '../utils';
import { enqueueThumbnailDownloads } from './cloudSyncRepository';
import { runThumbnailDownloadWorker } from '../services/thumbnailCache';
import { remoteInstallationTreeRevision } from '../services/remoteInstallationRevision';
import { copyName, nextCopyIndex } from './copyNaming';
import {
  boardTypeCode,
  installationSiteCodeForNewCopy,
  siteAssetTypeCode,
} from '../domain/installationV2';
import { validRecordVersionNumber } from '../services/reportVersioning';
import {
  assertRemoteInstallationIdentity,
  remoteAttachmentCopyId,
  validateCanonicalRemoteTreeIds,
} from '../services/remoteInstallationValidation';

export {
  assertUniqueRemoteIds,
  assertRemoteInstallationIdentity,
  remoteAttachmentCopyId,
  validateCanonicalRemoteTreeIds,
} from '../services/remoteInstallationValidation';

export interface RemoteInstallationSummary {
  id: string;
  siteName: string;
  clientName: string;
  siteAddress: string;
  status: string;
  updatedAt: string;
  createdByUserId?: string;
  localCopyCount: number;
  thumbnailReady: number;
  thumbnailTotal: number;
}

const text = (record: Record<string, unknown>, camel: string, snake?: string): string =>
  String(record[camel] ?? (snake ? record[snake] : '') ?? '');
const optionalText = (
  record: Record<string, unknown>,
  camel: string,
  snake?: string,
): string | undefined => {
  const value = record[camel] ?? (snake ? record[snake] : undefined);
  return typeof value === 'string' && value ? value : undefined;
};
const bool = (record: Record<string, unknown>, camel: string, snake?: string): boolean =>
  Boolean(record[camel] ?? (snake ? record[snake] : false));
const array = <T>(record: Record<string, unknown>, camel: string, snake?: string): T[] => {
  const value = record[camel] ?? (snake ? record[snake] : undefined);
  return Array.isArray(value) ? value as T[] : [];
};

const objectRecord = (
  source: Record<string, unknown>,
  camel: string,
  snake?: string,
): Record<string, unknown> | undefined => {
  const value = source[camel] ?? (snake ? source[snake] : undefined);
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
};

function mapDisplayCode(
  source: Record<string, unknown>,
  camel: string,
  snake?: string,
  fallback = '',
  strictCanonical = false,
): DisplayCode {
  const value = source[camel] ?? (snake ? source[snake] : undefined);
  const metadata = objectRecord(
    source,
    `${camel}Meta`,
    snake ? `${snake}_meta` : undefined,
  );
  if ((value && typeof value === 'object' && !Array.isArray(value)) || metadata) {
    const display = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : metadata!;
    const resolvedValue = text(display, 'value') || fallback;
    return {
      value: resolvedValue,
      generatedValue: strictCanonical
        ? text(display, 'generatedValue', 'generated_value')
        : text(display, 'generatedValue', 'generated_value') || resolvedValue,
      isOverridden: bool(display, 'isOverridden', 'is_overridden'),
      ruleVersion: strictCanonical
        ? Number(display.ruleVersion ?? display.rule_version)
        : Number(display.ruleVersion ?? display.rule_version) || 1,
      overrideReason: optionalText(display, 'overrideReason', 'override_reason'),
      ...(typeof display.provisional === 'boolean'
        ? { provisional: display.provisional }
        : strictCanonical ? {} : { provisional: false }),
    };
  }
  if (strictCanonical) throw new Error('Canonical v2 display metadata is missing.');
  const resolvedValue = typeof value === 'string' ? value : fallback;
  return {
    value: resolvedValue,
    generatedValue: resolvedValue,
    isOverridden: false,
    ruleVersion: 1,
    provisional: true,
  };
}

function canonicalBoardType(
  typeCode: NonNullable<ElectricalAsset['type_code']>,
): ElectricalAsset['asset_type'] {
  return ({
    MSB: 'MSB', MSSB: 'MSSB', DB: 'DB', HVAC_DB: 'HVAC-DB', LX_DB: 'LX-DB',
    PV_DB: 'PV-DB', MCC: 'MCC', OTHER: 'Other',
  } as const)[typeCode];
}

function canonicalSiteAssetType(
  typeCode: NonNullable<SiteAsset['type_code']>,
): SiteAsset['asset_type'] {
  return ({
    PV: 'Solar / PV', HVAC: 'HVAC', LIGHTING: 'Lighting', EV_CHARGER: 'EV Charger',
    VEHICLE_HOIST: 'Other', FORKLIFT: 'Other', EXHAUST_FAN_SYSTEM: 'Exhaust / Fan System',
    POWER_OUTLET: 'Power Outlet', HEATER_GEYSER: 'Hot Water', OTHER: 'Other',
  } as const)[typeCode];
}

function mapElectricalSource(
  value: unknown,
  boardIds: Map<string, string>,
  gridIds: Map<string, string>,
  strictCanonical = false,
): ElectricalSource | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (strictCanonical) throw new Error('Canonical v2 electrical source is missing.');
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const kind = strictCanonical ? text(source, 'kind') : text(source, 'kind').toUpperCase();
  if (kind === 'TBC') return { kind: 'TBC' };
  if (kind === 'BOARD') {
    const boardId = boardIds.get(text(source, 'boardId', 'board_id'));
    if (boardId) return { kind: 'BOARD', boardId };
    if (strictCanonical) throw new Error('Canonical v2 electrical source board is unavailable.');
    return { kind: 'TBC' };
  }
  if (kind === 'GRID') {
    const gridSupplyId = gridIds.get(text(source, 'gridSupplyId', 'grid_supply_id'));
    if (gridSupplyId) return { kind: 'GRID', gridSupplyId };
    if (strictCanonical) throw new Error('Canonical v2 Grid source is unavailable.');
    return { kind: 'TBC' };
  }
  if (strictCanonical) throw new Error(`Canonical v2 electrical source kind ${kind || '(missing)'} is invalid.`);
  return undefined;
}

function mapMeasurementTarget(
  value: unknown,
  boardIds: Map<string, string>,
  siteAssetIds: Map<string, string>,
  gridIds: Map<string, string>,
  strictCanonical = false,
): MeasurementTarget {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (strictCanonical) throw new Error('Canonical v2 measurement target is missing.');
    return { kind: 'TBC' };
  }
  const target = value as Record<string, unknown>;
  const kind = strictCanonical ? text(target, 'kind') : text(target, 'kind').toUpperCase();
  if (kind === 'BOARD') {
    const boardId = boardIds.get(text(target, 'boardId', 'board_id'));
    if (boardId) return { kind: 'BOARD', boardId };
    if (strictCanonical) throw new Error('Canonical v2 target board is unavailable.');
    return { kind: 'TBC' };
  }
  if (kind === 'SITE_ASSET') {
    const siteAssetId = siteAssetIds.get(text(target, 'siteAssetId', 'site_asset_id'));
    if (siteAssetId) return { kind: 'SITE_ASSET', siteAssetId };
    if (strictCanonical) throw new Error('Canonical v2 target site asset is unavailable.');
    return { kind: 'TBC' };
  }
  if (kind === 'GRID_BOUNDARY') {
    const gridSupplyId = gridIds.get(text(target, 'gridSupplyId', 'grid_supply_id'));
    if (gridSupplyId) return { kind: 'GRID_BOUNDARY', gridSupplyId };
    if (strictCanonical) throw new Error('Canonical v2 Grid boundary is unavailable.');
    return { kind: 'TBC' };
  }
  if (kind === 'TBC') return { kind: 'TBC' };
  if (strictCanonical) throw new Error(`Canonical v2 measurement target kind ${kind || '(missing)'} is invalid.`);
  return { kind: 'TBC' };
}

function mapMeter(record: Record<string, unknown>, id: string): Meter {
  const prestart = (record.wwPrestart ?? record.ww_prestart ?? {}) as Record<string, unknown>;
  const switchboard = (record.wwSwitchboard ?? record.ww_switchboard ?? {}) as Record<string, unknown>;
  const verification = (record.wwVerification ?? record.ww_verification ?? {}) as Record<string, unknown>;
  const commissioning = (record.wwCommissioning ?? record.ww_commissioning ?? {}) as Record<string, unknown>;
  const photos = (record.wwPhotos ?? record.ww_photos ?? {}) as Record<string, unknown>;
  return {
    id,
    device_name: text(record, 'deviceName', 'device_name'),
    device_type: (text(record, 'deviceType', 'device_type') || 'Other') as Meter['device_type'],
    device_id: text(record, 'deviceId', 'device_id'),
    device_number: optionalText(record, 'deviceNumber', 'device_number'),
    custom_manufacturer_name: optionalText(record, 'customManufacturerName', 'custom_manufacturer_name'),
    custom_model_name: optionalText(record, 'customModelName', 'custom_model_name'),
    classification: optionalText(record, 'classification'),
    coverage: optionalText(record, 'coverage'),
    ww_prestart: {
      site_induction: bool(prestart, 'siteInduction', 'site_induction'),
      safe_access: bool(prestart, 'safeAccess', 'safe_access'),
      correct_ppe: bool(prestart, 'correctPpe', 'correct_ppe'),
      live_points_aware: bool(prestart, 'livePointsAware', 'live_points_aware'),
      can_isolate: bool(prestart, 'canIsolate', 'can_isolate'),
      additional_hazards: bool(prestart, 'additionalHazards', 'additional_hazards'),
      safe_to_proceed: bool(prestart, 'safeToProceed', 'safe_to_proceed'),
    },
    ww_switchboard: {
      sb_name: optionalText(switchboard, 'name', 'sb_name'),
      sb_location: optionalText(switchboard, 'location', 'sb_location'),
      device_serial: optionalText(switchboard, 'deviceSerial', 'device_serial'),
      firmware: optionalText(switchboard, 'firmware'),
      antenna_type: optionalText(switchboard, 'antennaType', 'antenna_type'),
      signal_strength: optionalText(switchboard, 'signalStrength', 'signal_strength'),
      notes: optionalText(switchboard, 'notes'),
    },
    ww_channels: array<Record<string, unknown>>(record, 'wwChannels', 'ww_channels').map((channel) => ({
      id: optionalText(channel, 'id'),
      ordinal: Number(channel.ordinal) || undefined,
      purpose: optionalText(channel, 'purpose'),
      phase_label: optionalText(channel, 'phaseLabel', 'phase_label'),
      capabilities: objectRecord(channel, 'capabilities'),
      load_type: optionalText(channel, 'loadType', 'load_type'),
      rogowski_size: optionalText(channel, 'rogowskiSize', 'rogowski_size'),
      description: optionalText(channel, 'description'),
      ct_ratio: optionalText(channel, 'ctRatio', 'ct_ratio'),
    })),
    ww_verification: {
      voltage_checked: bool(verification, 'voltageChecked', 'voltage_checked'),
      polarity_checked: bool(verification, 'polarityChecked', 'polarity_checked'),
      communications_ok: bool(verification, 'communicationsOk', 'communications_ok'),
      notes: optionalText(verification, 'notes'),
    },
    ww_commissioning: {
      device_online: bool(commissioning, 'deviceOnline', 'device_online'),
      channels_reporting: bool(commissioning, 'channelsReporting', 'channels_reporting'),
      labeled: bool(commissioning, 'labeled'),
      photos_taken: bool(commissioning, 'photosTaken', 'photos_taken'),
      notes: optionalText(commissioning, 'notes'),
    },
    ww_photos: {
      device_installed: optionalText(photos, 'deviceInstalled', 'device_installed'),
      switchboard_overview: optionalText(photos, 'switchboardOverview', 'switchboard_overview'),
      labeling: optionalText(photos, 'labeling'),
      extra: array<string>(photos, 'extra'),
    },
  };
}

function collectRemotePhotoUris(
  tree: RemoteInstallationTree,
  canonicalV2 = false,
): string[] {
  const uris = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) uris.add(value);
  };
  tree.zones.forEach((zone) => array<string>(zone, 'photos').forEach(add));
  tree.electricalAssets.forEach((board) => {
    add(board.photo);
    array<string>(board, 'extraPhotos', 'extra_photos').forEach(add);
    if (!canonicalV2) {
      array<Record<string, unknown>>(board, 'meters').forEach((meter) => {
        const photos = (meter.wwPhotos ?? meter.ww_photos ?? {}) as Record<string, unknown>;
        add(photos.deviceInstalled ?? photos.device_installed);
        add(photos.switchboardOverview ?? photos.switchboard_overview);
        add(photos.labeling);
        array<string>(photos, 'extra').forEach(add);
      });
    }
  });
  (tree.meterDevices ?? []).forEach((meter) => {
    const photos = (meter.wwPhotos ?? meter.ww_photos ?? {}) as Record<string, unknown>;
    add(photos.deviceInstalled ?? photos.device_installed);
    add(photos.switchboardOverview ?? photos.switchboard_overview);
    add(photos.labeling);
    array<string>(photos, 'extra').forEach(add);
  });
  tree.siteAssets.forEach((asset) => {
    add(asset.locationPhoto ?? asset.location_photo);
    array<string>(asset, 'extraPhotos', 'extra_photos').forEach(add);
  });
  tree.formSubmissions.forEach((form) => {
    array<Record<string, unknown>>(form, 'attachments').forEach((attachment) => add(attachment.uri));
  });
  return [...uris];
}

export async function listRemoteInstallations(): Promise<RemoteInstallationSummary[]> {
  await initStore();
  const localInstallations = getStore().installations;
  const result = await apiClient.pull('1970-01-01T00:00:00.000Z');
  return result.installations.map(({ installation }) => {
    const id = text(installation, 'id');
    const copies = localInstallations.filter(
      (item) => item.import_source_server_id === id,
    );
    return {
      id,
      siteName: text(installation, 'siteName', 'site_name'),
      clientName: text(installation, 'clientName', 'client_name'),
      siteAddress: text(installation, 'siteAddress', 'site_address'),
      status: text(installation, 'status') || 'Draft',
      updatedAt: text(installation, 'updatedAt', 'updated_at'),
      createdByUserId: optionalText(installation, 'createdByUserId', 'created_by_user_id'),
      localCopyCount: copies.length,
      thumbnailReady: copies.reduce(
        (total, copy) => total + (copy.thumbnail_ready ?? 0),
        0,
      ),
      thumbnailTotal: copies.reduce(
        (total, copy) => total + (copy.thumbnail_total ?? 0),
        0,
      ),
    };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function importRemoteInstallationAsCopy(
  serverInstallationId: string,
): Promise<string> {
  await initStore();
  const response = await apiClient.pull('1970-01-01T00:00:00.000Z', serverInstallationId);
  const tree = response.installations[0];
  if (!tree) throw new Error('Installation is no longer available.');
  validateCanonicalRemoteTreeIds(tree);
  const canonicalV2 = tree.treeSchemaVersion === 2 &&
    (tree.installation.treeSchemaVersion ?? tree.installation.tree_schema_version) === 2;
  const importSourceRecordVersionNumber = validRecordVersionNumber(
    tree.recordVersionNumber ??
    tree.installation.recordVersionNumber ??
    tree.installation.record_version_number,
  );

  const source = tree.installation;
  assertRemoteInstallationIdentity(tree, serverInstallationId);
  const existingCopies = getStore().installations.filter(
    (item) => item.import_source_server_id === serverInstallationId,
  );
  const copyIndex = nextCopyIndex(existingCopies);
  const installationId = createId('inst');
  const zoneIds = new Map<string, string>();
  const boardIds = new Map<string, string>();
  const siteAssetIds = new Map<string, string>();
  const gridIds = new Map<string, string>();
  const meterIds = new Map<string, string>();
  const channelIds = new Map<string, string>();
  const assignmentIds = new Map<string, string>();
  const formIds = new Map<string, string>();
  (tree.gridSupplies ?? []).forEach((grid) => gridIds.set(text(grid, 'id'), createId('grid')));
  tree.zones.forEach((zone) => zoneIds.set(text(zone, 'id'), createId('zone')));
  tree.electricalAssets.forEach((board) => boardIds.set(text(board, 'id'), createId('board')));
  if (!canonicalV2) {
    tree.electricalAssets.forEach((board) => {
      array<Record<string, unknown>>(board, 'meters').forEach((meter) => {
        const remoteId = text(meter, 'id');
        if (!meterIds.has(remoteId)) meterIds.set(remoteId, createId('meter'));
      });
    });
  }
  (tree.meterDevices ?? []).forEach((meter) => {
    const remoteMeterId = text(meter, 'id');
    if (!meterIds.has(remoteMeterId)) meterIds.set(remoteMeterId, createId('meter'));
    array<Record<string, unknown>>(meter, 'channels').forEach((channel) => {
      channelIds.set(text(channel, 'id'), createId('channel'));
    });
  });
  (tree.measurementAssignments ?? []).forEach((assignment) => {
    assignmentIds.set(text(assignment, 'id'), createId('assignment'));
  });
  tree.siteAssets.forEach((asset) => siteAssetIds.set(text(asset, 'id'), createId('asset')));
  tree.formSubmissions.forEach((form) => formIds.set(text(form, 'id'), createId('form')));
  const photoUris = collectRemotePhotoUris(tree, canonicalV2);
  const now = nowIso();

  const copiedSiteName = copyName(text(source, 'siteName', 'site_name'), copyIndex);
  const sourceSiteCode = optionalText(source, 'siteCode', 'site_code');
  const installation: Installation = {
    id: installationId,
    client_name: text(source, 'clientName', 'client_name'),
    site_name: copiedSiteName,
    site_address: text(source, 'siteAddress', 'site_address'),
    inspector_name: text(source, 'inspectorName', 'inspector_name'),
    audit_date: text(source, 'auditDate', 'audit_date'),
    // A copied record has fresh local identity and no authoritative server pin.
    status: text(source, 'status') === 'Completed' ? 'Draft' : 'Draft',
    tree_schema_version: 2,
    tree_revision: 0,
    external_key: `local:${installationId}`,
    site_code: installationSiteCodeForNewCopy(sourceSiteCode, copiedSiteName),
    timezone: optionalText(source, 'timezone'),
    legacy_completed_unpinned: text(source, 'status') === 'Completed',
    cloud_backup_enabled: false,
    is_imported_copy: true,
    import_source_server_id: serverInstallationId,
    ...(importSourceRecordVersionNumber !== undefined
      ? { import_source_record_version_number: importSourceRecordVersionNumber }
      : {}),
    import_provenance_watermark: now,
    import_source_tree_revision: remoteInstallationTreeRevision(tree),
    copy_index: copyIndex,
    thumbnail_status: photoUris.length ? 'pending' : 'ready',
    thumbnail_total: photoUris.length,
    thumbnail_ready: 0,
    created_at: now,
    updated_at: now,
  };
  const zones: Zone[] = tree.zones.map((zone) => ({
    id: zoneIds.get(text(zone, 'id'))!,
    audit_id: installationId,
    zone_name: text(zone, 'zoneName', 'zone_name'),
    zone_description: text(zone, 'zoneDescription', 'zone_description'),
    photos: array<string>(zone, 'photos'),
    created_at: now,
    updated_at: now,
  }));
  const gridSupplies: GridSupply[] = (tree.gridSupplies ?? []).map((grid) => ({
    id: gridIds.get(text(grid, 'id'))!,
    installationId,
    name: canonicalV2 ? text(grid, 'name') : text(grid, 'name') || 'Grid supply',
    isDefault: bool(grid, 'isDefault', 'is_default'),
    nmi: optionalText(grid, 'nmi'),
    externalKey: optionalText(grid, 'externalKey', 'external_key'),
  }));
  const electricalAssets: ElectricalAsset[] = tree.electricalAssets.map((board) => {
    const fallbackDisplayCode = typeof board.displayCode === 'string'
      ? board.displayCode
      : text(board, 'display_code');
    const displayCode = mapDisplayCode(
      board, 'displayCode', 'display_code', fallbackDisplayCode, canonicalV2,
    );
    const typeCode = (canonicalV2
      ? text(board, 'typeCode', 'type_code')
      : text(board, 'typeCode', 'type_code') ||
        boardTypeCode(text(board, 'assetType', 'asset_type'))) as NonNullable<ElectricalAsset['type_code']>;
    const canonicalSource = mapElectricalSource(
      board.electricalSource ?? board.electrical_source,
      boardIds,
      gridIds,
      canonicalV2,
    );
    return {
    id: boardIds.get(text(board, 'id'))!,
    audit_id: installationId,
    zone_id: zoneIds.get(text(board, 'zoneId', 'zone_id'))!,
    asset_name: text(board, 'assetName', 'asset_name'),
    display_code: displayCode.value,
    display_code_meta: displayCode,
    asset_type: canonicalV2
      ? canonicalBoardType(typeCode)
      : text(board, 'assetType', 'asset_type') as ElectricalAsset['asset_type'],
    type_code: typeCode,
    custom_type_name: optionalText(board, 'customTypeName', 'custom_type_name'),
    electrical_source: canonicalSource,
    electrical_parent_id: canonicalV2
      ? canonicalSource?.kind === 'BOARD' ? canonicalSource.boardId : null
      : boardIds.get(text(board, 'electricalParentId', 'electrical_parent_id')) ?? null,
    electrical_parent_tbc: canonicalV2
      ? canonicalSource?.kind === 'TBC'
      : bool(board, 'electricalParentTbc', 'electrical_parent_tbc'),
    location_description: optionalText(board, 'locationDescription', 'location_description'),
    phase: optionalText(board, 'phase'),
    amperage_rating: optionalText(board, 'amperageRating', 'amperage_rating'),
    site_nmi: optionalText(board, 'siteNmi', 'site_nmi'),
    photo: optionalText(board, 'photo'),
    extra_photos: array<string>(board, 'extraPhotos', 'extra_photos'),
    meter_present: canonicalV2
      ? (tree.meterDevices ?? []).some(
          (meter) => text(meter, 'installedOnBoardId', 'installed_on_board_id') === text(board, 'id'),
        )
      : bool(board, 'meterPresent', 'meter_present'),
    // Canonical top-level meterDevices are authoritative. The normalizer
    // rebuilds this legacy projection after those devices are mapped.
    meters: canonicalV2
      ? []
      : array<Record<string, unknown>>(board, 'meters').map(
          (meter) => mapMeter(meter, meterIds.get(text(meter, 'id')) ?? createId('meter')),
        ),
    sub_circuits_description: optionalText(board, 'subCircuitsDescription', 'sub_circuits_description'),
    comments: optionalText(board, 'comments'),
    created_at: now,
    updated_at: now,
    };
  });
  const siteAssets: SiteAsset[] = tree.siteAssets.map((asset) => {
    const fallbackDisplayCode = typeof asset.displayCode === 'string'
      ? asset.displayCode
      : text(asset, 'display_code');
    const displayCode = mapDisplayCode(
      asset, 'displayCode', 'display_code', fallbackDisplayCode, canonicalV2,
    );
    const typeCode = (canonicalV2
      ? text(asset, 'typeCode', 'type_code')
      : text(asset, 'typeCode', 'type_code') ||
        siteAssetTypeCode(text(asset, 'assetType', 'asset_type'))) as NonNullable<SiteAsset['type_code']>;
    const canonicalSource = mapElectricalSource(
      asset.electricalSource ?? asset.electrical_source,
      boardIds,
      gridIds,
      canonicalV2,
    );
    const remoteMeteringState = objectRecord(asset, 'meteringState', 'metering_state');
    const remoteMeteringKind = text(remoteMeteringState ?? {}, 'kind');
    const meteringState = remoteMeteringKind === 'UNMETERED'
      ? { kind: 'UNMETERED' as const }
      : remoteMeteringKind === 'METERED'
        ? {
            kind: 'METERED' as const,
            measurementAssignmentIds: array<string>(
              remoteMeteringState!,
              'measurementAssignmentIds',
              'measurement_assignment_ids',
            ).map((id) => assignmentIds.get(id)!),
          }
        : remoteMeteringKind === 'TBC'
          ? { kind: 'TBC' as const }
          : canonicalV2
            ? (() => { throw new Error('Canonical v2 metering state is invalid.'); })()
            : undefined;
    return {
    id: siteAssetIds.get(text(asset, 'id'))!,
    audit_id: installationId,
    zone_id: zoneIds.get(text(asset, 'zoneId', 'zone_id'))!,
    asset_name: text(asset, 'assetName', 'asset_name'),
    asset_type: canonicalV2
      ? canonicalSiteAssetType(typeCode)
      : text(asset, 'assetType', 'asset_type') as SiteAsset['asset_type'],
    type_code: typeCode,
    custom_type_name: optionalText(asset, 'customTypeName', 'custom_type_name'),
    electrical_source: canonicalSource,
    electrical_board_id: canonicalV2
      ? canonicalSource?.kind === 'BOARD' ? canonicalSource.boardId : null
      : boardIds.get(text(asset, 'electricalBoardId', 'electrical_board_id')) ?? null,
    electrical_board_tbc: canonicalV2
      ? canonicalSource?.kind === 'TBC'
      : bool(asset, 'electricalBoardTbc', 'electrical_board_tbc'),
    location_description: optionalText(asset, 'locationDescription', 'location_description'),
    location_photo: optionalText(asset, 'locationPhoto', 'location_photo'),
    display_code: displayCode.value,
    display_code_meta: displayCode,
    metering_state: meteringState,
    meter_present: canonicalV2
      ? meteringState?.kind === 'METERED'
      : bool(asset, 'meterPresent', 'meter_present'),
    meter_switchboard_id: canonicalV2
      ? null
      : boardIds.get(text(asset, 'meterSwitchboardId', 'meter_switchboard_id')) ?? null,
    meter_switchboard_tbc: canonicalV2
      ? meteringState?.kind === 'TBC'
      : bool(asset, 'meterSwitchboardTbc', 'meter_switchboard_tbc'),
    meter_channels: canonicalV2 ? [] : array(asset, 'meterChannels', 'meter_channels'),
    comments: optionalText(asset, 'comments'),
    extra_photos: array<string>(asset, 'extraPhotos', 'extra_photos'),
    created_at: now,
    updated_at: now,
    };
  });
  const meterDevices: MeterDevice[] = (tree.meterDevices ?? []).map((meter) => {
    const remoteMeterId = text(meter, 'id');
    const displayName = mapDisplayCode(
      meter,
      'displayName',
      'display_name',
      text(meter, 'deviceNumber', 'device_number') || text(meter, 'serialNumber', 'serial_number'),
      canonicalV2,
    );
    const rawModelText = text(meter, 'deviceModel', 'device_model');
    const modelText = canonicalV2 ? rawModelText : rawModelText.toUpperCase();
    const deviceModel: MeterDevice['deviceModel'] = canonicalV2
      ? modelText as MeterDevice['deviceModel']
      : modelText === 'A3RM' || modelText === 'A6M'
        ? modelText
        : 'OTHER';
    const rawFamilyText = text(meter, 'deviceFamily', 'device_family');
    const photos = objectRecord(meter, 'wwPhotos', 'ww_photos');
    const commissioningData = objectRecord(meter, 'commissioningData', 'commissioning_data');
    const prestart = commissioningData
      ? objectRecord(commissioningData, 'prestart')
      : undefined;
    const switchboard = commissioningData
      ? objectRecord(commissioningData, 'switchboard')
      : undefined;
    const verification = commissioningData
      ? objectRecord(commissioningData, 'verification')
      : undefined;
    const commissioning = commissioningData
      ? objectRecord(commissioningData, 'commissioning')
      : undefined;
    return {
      id: meterIds.get(remoteMeterId)!,
      installationId,
      installedOnBoardId: boardIds.get(text(meter, 'installedOnBoardId', 'installed_on_board_id')) ?? '',
      deviceFamily: canonicalV2
        ? rawFamilyText as MeterDevice['deviceFamily']
        : rawFamilyText.toUpperCase() === 'WATTWATCHERS'
          ? 'WATTWATCHERS'
          : 'OTHER',
      deviceModel,
      customManufacturerName: optionalText(meter, 'customManufacturerName', 'custom_manufacturer_name'),
      customModelName: optionalText(meter, 'customModelName', 'custom_model_name'),
      deviceNumber: optionalText(meter, 'deviceNumber', 'device_number'),
      serialNumber: text(meter, 'serialNumber', 'serial_number'),
      displayName,
      commissioningData: commissioningData ? {
        classification: optionalText(commissioningData, 'classification') ?? null,
        coverage: optionalText(commissioningData, 'coverage') ?? null,
        prestart: prestart ? {
          siteInduction: bool(prestart, 'siteInduction'),
          safeAccess: bool(prestart, 'safeAccess'),
          correctPpe: bool(prestart, 'correctPpe'),
          livePointsAware: bool(prestart, 'livePointsAware'),
          canIsolate: bool(prestart, 'canIsolate'),
          additionalHazards: bool(prestart, 'additionalHazards'),
          safeToProceed: bool(prestart, 'safeToProceed'),
        } : undefined,
        switchboard: switchboard ? {
          name: optionalText(switchboard, 'name') ?? null,
          location: optionalText(switchboard, 'location') ?? null,
          deviceSerial: optionalText(switchboard, 'deviceSerial') ?? null,
          firmware: optionalText(switchboard, 'firmware') ?? null,
          antennaType: optionalText(switchboard, 'antennaType') ?? null,
          signalStrength: optionalText(switchboard, 'signalStrength') ?? null,
          notes: optionalText(switchboard, 'notes') ?? null,
        } : undefined,
        verification: verification ? {
          voltageChecked: bool(verification, 'voltageChecked'),
          polarityChecked: bool(verification, 'polarityChecked'),
          communicationsOk: bool(verification, 'communicationsOk'),
          notes: optionalText(verification, 'notes') ?? null,
        } : undefined,
        commissioning: commissioning ? {
          deviceOnline: bool(commissioning, 'deviceOnline'),
          channelsReporting: bool(commissioning, 'channelsReporting'),
          labeled: bool(commissioning, 'labeled'),
          photosTaken: bool(commissioning, 'photosTaken'),
          notes: optionalText(commissioning, 'notes') ?? null,
        } : undefined,
      } : undefined,
      channels: array<Record<string, unknown>>(meter, 'channels').map((channel, index) => {
        const rawPurposeText = text(channel, 'purpose');
        const purposeText = canonicalV2 ? rawPurposeText : rawPurposeText.toUpperCase();
        const purpose: MeterChannel['purpose'] = canonicalV2
          ? purposeText as MeterChannel['purpose']
          : purposeText === 'MAIN_SUPPLY' || purposeText === 'SPARE'
            ? purposeText
            : 'SUB_CIRCUIT';
        return {
          id: canonicalV2
            ? channelIds.get(text(channel, 'id'))!
            : channelIds.get(text(channel, 'id')) ?? createId('channel'),
          ordinal: canonicalV2
            ? channel.ordinal as number
            : Number(channel.ordinal ?? index + 1),
          purpose,
          phaseLabel: optionalText(channel, 'phaseLabel', 'phase_label'),
          capabilities: objectRecord(channel, 'capabilities'),
          loadTypeCode: optionalText(channel, 'loadTypeCode', 'load_type_code') as MeterChannel['loadTypeCode'],
          customLoadTypeName: optionalText(channel, 'customLoadTypeName', 'custom_load_type_name'),
          sensorRating: optionalText(channel, 'sensorRating', 'sensor_rating'),
          description: optionalText(channel, 'description'),
          target: channel.target
            ? mapMeasurementTarget(channel.target, boardIds, siteAssetIds, gridIds, canonicalV2)
            : undefined,
          direction: optionalText(channel, 'direction') as MeterChannel['direction'],
        };
      }),
      wwPhotos: photos
        ? {
            deviceInstalled: optionalText(photos, 'deviceInstalled', 'device_installed'),
            switchboardOverview: optionalText(photos, 'switchboardOverview', 'switchboard_overview'),
            labeling: optionalText(photos, 'labeling'),
            extra: array<string>(photos, 'extra'),
          }
        : undefined,
      notes: optionalText(meter, 'notes'),
    };
  });
  const measurementAssignments: MeasurementAssignment[] = (tree.measurementAssignments ?? []).map(
    (assignment) => {
      const rawStatus = text(assignment, 'status');
      const status: MeasurementAssignment['status'] = canonicalV2
        ? rawStatus as MeasurementAssignment['status']
        : rawStatus.toUpperCase() === 'CONFIRMED' ? 'CONFIRMED' : 'TBC';
      const target = mapMeasurementTarget(
        assignment.target,
        boardIds,
        siteAssetIds,
        gridIds,
        canonicalV2,
      );
      return {
        id: assignmentIds.get(text(assignment, 'id'))!,
        installationId,
        meterId: meterIds.get(text(assignment, 'meterId', 'meter_id')) ?? '',
        channelIds: array<string>(assignment, 'channelIds', 'channel_ids')
          .map((id) => canonicalV2 ? channelIds.get(id)! : channelIds.get(id))
          .filter((id): id is string => Boolean(id)),
        phaseMode: (canonicalV2
          ? text(assignment, 'phaseMode', 'phase_mode')
          : text(assignment, 'phaseMode', 'phase_mode') || 'OTHER') as MeasurementAssignment['phaseMode'],
        target,
        direction: (canonicalV2
          ? text(assignment, 'direction')
          : text(assignment, 'direction') || 'CONSUMPTION') as MeasurementAssignment['direction'],
        status: canonicalV2 ? status : target.kind === 'TBC' ? 'TBC' : status,
      };
    },
  );
  const formSubmissions: FormSubmission[] = tree.formSubmissions.map((form) => ({
    id: canonicalV2 ? formIds.get(text(form, 'id'))! : formIds.get(text(form, 'id')) ?? createId('form'),
    import_source_server_id: text(form, 'id'),
    form_type: text(form, 'formType', 'form_type') as FormSubmission['form_type'],
    schema_version: Number(canonicalV2
      ? form.schemaVersion ?? form.schema_version
      : form.schemaVersion ?? form.schema_version ?? 1),
    status: text(form, 'status') as FormSubmission['status'],
    installation_id: installationId,
    zone_id: zoneIds.get(text(form, 'zoneId', 'zone_id')),
    board_id: boardIds.get(text(form, 'boardId', 'board_id')),
    // Completed immutable history may retain the exact context ID of a
    // soft-deleted meter that is intentionally absent from the active tree.
    meter_id: meterIds.get(text(form, 'meterId', 'meter_id')) ??
      optionalText(form, 'meterId', 'meter_id'),
    site_asset_id: siteAssetIds.get(text(form, 'siteAssetId', 'site_asset_id')),
    answers: (canonicalV2 ? form.answers : form.answers ?? {}) as FormSubmission['answers'],
    attachments: array<Record<string, unknown>>(form, 'attachments').map((attachment, index) => ({
      id: remoteAttachmentCopyId(
        installationId,
        text(form, 'id'),
        text(attachment, 'id'),
        index,
      ),
      slot: text(attachment, 'slot'),
      uri: text(attachment, 'uri'),
      mime_type: canonicalV2
        ? text(attachment, 'mimeType', 'mime_type')
        : text(attachment, 'mimeType', 'mime_type') || 'image/jpeg',
      caption: optionalText(attachment, 'caption'),
      captured_at: canonicalV2
        ? text(attachment, 'capturedAt', 'captured_at')
        : text(attachment, 'capturedAt', 'captured_at') || now,
    } satisfies FormAttachment)),
    created_at: now,
    updated_at: now,
    completed_at: optionalText(form, 'completedAt', 'completed_at'),
    supersedes_id: formIds.get(text(form, 'supersedesId', 'supersedes_id')),
    historical_meter_removed: (form.historicalMeterRemoved ?? form.historical_meter_removed) as boolean,
  }));

  await updateStore((store) => {
    store.installations.unshift(installation);
    store.gridSupplies.push(...gridSupplies);
    store.zones.push(...zones);
    store.electricalAssets.push(...electricalAssets);
    store.siteAssets.push(...siteAssets);
    store.meterDevices.push(...meterDevices);
    store.measurementAssignments.push(...measurementAssignments);
    store.formSubmissions.push(...formSubmissions);
  });
  await enqueueThumbnailDownloads(installationId, photoUris);
  void runThumbnailDownloadWorker();
  return installationId;
}
