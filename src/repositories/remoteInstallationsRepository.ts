import { apiClient, type RemoteInstallationTree } from '../api/apiClient';
import { getStore, initStore, updateStore } from '../data/seed';
import type {
  ElectricalAsset,
  FormAttachment,
  FormSubmission,
  Installation,
  Meter,
  SiteAsset,
  Zone,
} from '../types';
import { createId, nowIso } from '../utils';
import { enqueueThumbnailDownloads } from './cloudSyncRepository';
import { runThumbnailDownloadWorker } from '../services/thumbnailCache';
import { remoteInstallationTreeRevision } from '../services/remoteInstallationRevision';
import { copyName, nextCopyIndex } from './copyNaming';

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
      purpose: optionalText(channel, 'purpose'),
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

function collectRemotePhotoUris(tree: RemoteInstallationTree): string[] {
  const uris = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) uris.add(value);
  };
  tree.zones.forEach((zone) => array<string>(zone, 'photos').forEach(add));
  tree.electricalAssets.forEach((board) => {
    add(board.photo);
    array<string>(board, 'extraPhotos', 'extra_photos').forEach(add);
    array<Record<string, unknown>>(board, 'meters').forEach((meter) => {
      const photos = (meter.wwPhotos ?? meter.ww_photos ?? {}) as Record<string, unknown>;
      add(photos.deviceInstalled ?? photos.device_installed);
      add(photos.switchboardOverview ?? photos.switchboard_overview);
      add(photos.labeling);
      array<string>(photos, 'extra').forEach(add);
    });
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

  const source = tree.installation;
  const existingCopies = getStore().installations.filter(
    (item) => item.import_source_server_id === serverInstallationId,
  );
  const copyIndex = nextCopyIndex(existingCopies);
  const installationId = createId('inst');
  const zoneIds = new Map<string, string>();
  const boardIds = new Map<string, string>();
  const siteAssetIds = new Map<string, string>();
  const meterIds = new Map<string, string>();
  const formIds = new Map<string, string>();
  tree.zones.forEach((zone) => zoneIds.set(text(zone, 'id'), createId('zone')));
  tree.electricalAssets.forEach((board) => boardIds.set(text(board, 'id'), createId('board')));
  tree.electricalAssets.forEach((board) => {
    array<Record<string, unknown>>(board, 'meters').forEach((meter) => {
      meterIds.set(text(meter, 'id'), createId('meter'));
    });
  });
  tree.siteAssets.forEach((asset) => siteAssetIds.set(text(asset, 'id'), createId('asset')));
  tree.formSubmissions.forEach((form) => formIds.set(text(form, 'id'), createId('form')));
  const photoUris = collectRemotePhotoUris(tree);
  const now = nowIso();

  const installation: Installation = {
    id: installationId,
    client_name: text(source, 'clientName', 'client_name'),
    site_name: copyName(text(source, 'siteName', 'site_name'), copyIndex),
    site_address: text(source, 'siteAddress', 'site_address'),
    inspector_name: text(source, 'inspectorName', 'inspector_name'),
    audit_date: text(source, 'auditDate', 'audit_date'),
    status: (text(source, 'status') || 'Draft') as Installation['status'],
    cloud_backup_enabled: false,
    is_imported_copy: true,
    import_source_server_id: serverInstallationId,
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
  const electricalAssets: ElectricalAsset[] = tree.electricalAssets.map((board) => ({
    id: boardIds.get(text(board, 'id'))!,
    audit_id: installationId,
    zone_id: zoneIds.get(text(board, 'zoneId', 'zone_id'))!,
    asset_name: text(board, 'assetName', 'asset_name'),
    display_code: text(board, 'displayCode', 'display_code'),
    asset_type: text(board, 'assetType', 'asset_type') as ElectricalAsset['asset_type'],
    electrical_parent_id: boardIds.get(text(board, 'electricalParentId', 'electrical_parent_id')) ?? null,
    electrical_parent_tbc: bool(board, 'electricalParentTbc', 'electrical_parent_tbc'),
    location_description: optionalText(board, 'locationDescription', 'location_description'),
    phase: optionalText(board, 'phase'),
    amperage_rating: optionalText(board, 'amperageRating', 'amperage_rating'),
    site_nmi: optionalText(board, 'siteNmi', 'site_nmi'),
    photo: optionalText(board, 'photo'),
    extra_photos: array<string>(board, 'extraPhotos', 'extra_photos'),
    meter_present: bool(board, 'meterPresent', 'meter_present'),
    meters: array<Record<string, unknown>>(board, 'meters').map(
      (meter) => mapMeter(meter, meterIds.get(text(meter, 'id')) ?? createId('meter')),
    ),
    sub_circuits_description: optionalText(board, 'subCircuitsDescription', 'sub_circuits_description'),
    comments: optionalText(board, 'comments'),
    created_at: now,
    updated_at: now,
  }));
  const siteAssets: SiteAsset[] = tree.siteAssets.map((asset) => ({
    id: siteAssetIds.get(text(asset, 'id'))!,
    audit_id: installationId,
    zone_id: zoneIds.get(text(asset, 'zoneId', 'zone_id'))!,
    asset_name: text(asset, 'assetName', 'asset_name'),
    asset_type: text(asset, 'assetType', 'asset_type') as SiteAsset['asset_type'],
    electrical_board_id: boardIds.get(text(asset, 'electricalBoardId', 'electrical_board_id')) ?? null,
    electrical_board_tbc: bool(asset, 'electricalBoardTbc', 'electrical_board_tbc'),
    location_description: optionalText(asset, 'locationDescription', 'location_description'),
    location_photo: optionalText(asset, 'locationPhoto', 'location_photo'),
    display_code: optionalText(asset, 'displayCode', 'display_code'),
    meter_present: bool(asset, 'meterPresent', 'meter_present'),
    meter_switchboard_id: boardIds.get(text(asset, 'meterSwitchboardId', 'meter_switchboard_id')) ?? null,
    meter_switchboard_tbc: bool(asset, 'meterSwitchboardTbc', 'meter_switchboard_tbc'),
    meter_channels: array(asset, 'meterChannels', 'meter_channels'),
    comments: optionalText(asset, 'comments'),
    extra_photos: array<string>(asset, 'extraPhotos', 'extra_photos'),
    created_at: now,
    updated_at: now,
  }));
  const formSubmissions: FormSubmission[] = tree.formSubmissions.map((form) => ({
    id: formIds.get(text(form, 'id')) ?? createId('form'),
    import_source_server_id: text(form, 'id'),
    form_type: text(form, 'formType', 'form_type') as FormSubmission['form_type'],
    schema_version: Number(form.schemaVersion ?? form.schema_version ?? 1),
    status: text(form, 'status') as FormSubmission['status'],
    installation_id: installationId,
    zone_id: zoneIds.get(text(form, 'zoneId', 'zone_id')),
    board_id: boardIds.get(text(form, 'boardId', 'board_id')),
    meter_id: meterIds.get(text(form, 'meterId', 'meter_id')),
    site_asset_id: siteAssetIds.get(text(form, 'siteAssetId', 'site_asset_id')),
    answers: (form.answers ?? {}) as FormSubmission['answers'],
    attachments: array<Record<string, unknown>>(form, 'attachments').map((attachment) => ({
      id: createId('attachment'),
      slot: text(attachment, 'slot'),
      uri: text(attachment, 'uri'),
      mime_type: text(attachment, 'mimeType', 'mime_type') || 'image/jpeg',
      caption: optionalText(attachment, 'caption'),
      captured_at: text(attachment, 'capturedAt', 'captured_at') || now,
    } satisfies FormAttachment)),
    created_at: now,
    updated_at: now,
    completed_at: optionalText(form, 'completedAt', 'completed_at'),
    supersedes_id: formIds.get(text(form, 'supersedesId', 'supersedes_id')),
  }));

  await updateStore((store) => {
    store.installations.unshift(installation);
    store.zones.push(...zones);
    store.electricalAssets.push(...electricalAssets);
    store.siteAssets.push(...siteAssets);
    store.formSubmissions.push(...formSubmissions);
  });
  await enqueueThumbnailDownloads(installationId, photoUris);
  void runThumbnailDownloadWorker();
  return installationId;
}
