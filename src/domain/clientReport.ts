import type { InstallationBackupTree } from '../repositories/cloudSyncRepository';
import { FORM_DEFINITION_BY_TYPE } from '../forms/catalog';
import { photoNote } from './photoNotes';
import { photoIsLargeInPdf } from './photoMetadata';

export type ClientReportData = Pick<InstallationBackupTree,
  'installation' | 'zones' | 'electricalAssets' | 'siteAssets' | 'meterDevices' | 'formSubmissions'>;
export type ClientReportPhoto = {
  key: string;
  label: string;
  uri: string;
  largeInPdf: boolean;
};
/** Bind exclusion to the exact photo so a replacement in the same slot is not hidden. */
export type ClientReportPhotoExclusions = Record<string, string>;

export function parseClientReportPhotoExclusions(raw: string | null): ClientReportPhotoExclusions {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] =>
      typeof entry[1] === 'string' && Boolean(entry[1])));
  } catch { return {}; }
}

export function withClientReportPhotoIncluded(
  excluded: ClientReportPhotoExclusions, photo: ClientReportPhoto, included: boolean,
): ClientReportPhotoExclusions {
  const next = { ...excluded };
  if (included) delete next[photo.key];
  else next[photo.key] = photo.uri;
  return next;
}

export function collectClientReportPhotos(data: ClientReportData): ClientReportPhoto[] {
  const photos: ClientReportPhoto[] = [];
  const add = (
    key: string,
    label: string,
    uri?: string | null,
    largeInPdf = false,
  ) => {
    if (uri) photos.push({ key, label, uri, largeInPdf });
  };
  data.zones.forEach((zone) => {
    zone.photos.forEach((uri, index) => {
      add(
        `zone:${zone.id}:${index}`,
        photoNote(zone.photo_notes, `photos[${index}]`) || `${zone.zone_name} photo ${index + 1}`,
        uri,
        photoIsLargeInPdf(zone.photoMetadata, `photos[${index}]`),
      );
    });
  });
  const seenMeters = new Set<string>();
  for (const board of data.electricalAssets) {
    add(`board:${board.id}:main`, photoNote(board.photo_notes, 'photo') || `${board.asset_name} main photo`, board.photo, photoIsLargeInPdf(board.photoMetadata, 'photo'));
    board.extra_photos?.forEach((uri, index) => add(
      `board:${board.id}:extra:${index}`,
      photoNote(board.photo_notes, `extraPhotos[${index}]`) || `${board.asset_name} extra photo ${index + 1}`,
      uri,
      photoIsLargeInPdf(board.photoMetadata, `extraPhotos[${index}]`),
    ));
    for (const meter of board.meters) {
      const canonical = data.meterDevices.find((candidate) => candidate.id === meter.id);
      const name = canonical?.displayName.value || meter.device_name;
      const evidence = canonical?.wwPhotos ?? {
        deviceInstalled: meter.ww_photos?.device_installed,
        switchboardOverview: meter.ww_photos?.switchboard_overview,
        labeling: meter.ww_photos?.labeling, extra: meter.ww_photos?.extra,
      };
      const notes = canonical?.photoNotes ?? meter.photo_notes;
      const metadata = canonical?.photoMetadata ?? meter.photoMetadata;
      seenMeters.add(meter.id);
      add(`meter:${meter.id}:device installed`, photoNote(notes, 'wwPhotos.deviceInstalled') || `${name} device installed`, evidence.deviceInstalled, photoIsLargeInPdf(metadata, 'wwPhotos.deviceInstalled'));
      add(`meter:${meter.id}:switchboard overview`, photoNote(notes, 'wwPhotos.switchboardOverview') || `${name} switchboard overview`, evidence.switchboardOverview, photoIsLargeInPdf(metadata, 'wwPhotos.switchboardOverview'));
      add(`meter:${meter.id}:labeling`, photoNote(notes, 'wwPhotos.labeling') || `${name} labeling`, evidence.labeling, photoIsLargeInPdf(metadata, 'wwPhotos.labeling'));
      evidence.extra?.forEach((uri, index) => add(
        `meter:${meter.id}:extra:${index}`,
        photoNote(notes, `wwPhotos.extra[${index}]`) || `${name} extra photo ${index + 1}`,
        uri,
        photoIsLargeInPdf(metadata, `wwPhotos.extra[${index}]`),
      ));
    }
  }
  for (const meter of data.meterDevices.filter((candidate) => !seenMeters.has(candidate.id))) {
    const name = meter.displayName.value || meter.serialNumber;
    add(`meter:${meter.id}:device installed`, photoNote(meter.photoNotes, 'wwPhotos.deviceInstalled') || `${name} device installed`, meter.wwPhotos?.deviceInstalled, photoIsLargeInPdf(meter.photoMetadata, 'wwPhotos.deviceInstalled'));
    add(`meter:${meter.id}:switchboard overview`, photoNote(meter.photoNotes, 'wwPhotos.switchboardOverview') || `${name} switchboard overview`, meter.wwPhotos?.switchboardOverview, photoIsLargeInPdf(meter.photoMetadata, 'wwPhotos.switchboardOverview'));
    add(`meter:${meter.id}:labeling`, photoNote(meter.photoNotes, 'wwPhotos.labeling') || `${name} labeling`, meter.wwPhotos?.labeling, photoIsLargeInPdf(meter.photoMetadata, 'wwPhotos.labeling'));
    meter.wwPhotos?.extra?.forEach((uri, index) => add(
      `meter:${meter.id}:extra:${index}`,
      photoNote(meter.photoNotes, `wwPhotos.extra[${index}]`) || `${name} extra photo ${index + 1}`,
      uri,
      photoIsLargeInPdf(meter.photoMetadata, `wwPhotos.extra[${index}]`),
    ));
  }
  for (const asset of data.siteAssets) {
    add(`asset:${asset.id}:location`, photoNote(asset.photo_notes, 'locationPhoto') || `${asset.asset_name} location photo`, asset.location_photo, photoIsLargeInPdf(asset.photoMetadata, 'locationPhoto'));
    asset.extra_photos?.forEach((uri, index) => add(
      `asset:${asset.id}:extra:${index}`,
      photoNote(asset.photo_notes, `extraPhotos[${index}]`) || `${asset.asset_name} extra photo ${index + 1}`,
      uri,
      photoIsLargeInPdf(asset.photoMetadata, `extraPhotos[${index}]`),
    ));
  }
  for (const form of data.formSubmissions) {
    form.attachments.forEach((attachment) => add(`form:${form.id}:${attachment.id}`, attachment.caption || attachment.slot, attachment.uri, attachment.largeInPdf === true));
  }
  return photos;
}

export function clientReportModel(data: ClientReportData, excluded: ClientReportPhotoExclusions = {}) {
  const photos = collectClientReportPhotos(data);
  const includedPhotos = photos.filter((photo) => excluded[photo.key] !== photo.uri);
  const completedForms = data.formSubmissions.filter((form) => form.status === 'Completed');
  const missingEvidence = [
    ...data.zones.filter((zone) => !zone.photos.length).map((zone) => `Zone · ${zone.zone_name}`),
    ...data.electricalAssets.filter((board) => !photos.some((photo) =>
      photo.key.startsWith(`board:${board.id}:`) ||
      board.meters.some((meter) => photo.key.startsWith(`meter:${meter.id}:`)) ||
      data.meterDevices.some((meter) => meter.installedOnBoardId === board.id && photo.key.startsWith(`meter:${meter.id}:`))))
      .map((board) => `Switchboard · ${board.asset_name}`),
    ...data.siteAssets.filter((asset) => !asset.location_photo && !asset.extra_photos?.length)
      .map((asset) => `Site asset · ${asset.asset_name}`),
  ];
  return {
    photos, includedPhotos, missingEvidence,
    meterCount: data.meterDevices.length || data.electricalAssets.reduce((total, board) => total + board.meters.length, 0),
    completedFormCount: completedForms.length,
    completedFormNames: [...new Set(completedForms.map((form) => FORM_DEFINITION_BY_TYPE[form.form_type]?.shortTitle ?? form.form_type))],
    meteredAssetCount: data.siteAssets.filter((asset) => asset.metering_state?.kind === 'METERED').length,
    openTbcCount: data.electricalAssets.filter((board) => board.electrical_source?.kind === 'TBC' || board.electrical_parent_tbc).length
      + data.siteAssets.filter((asset) => asset.electrical_source?.kind === 'TBC' || asset.electrical_board_tbc || asset.metering_state?.kind === 'TBC').length,
    zones: data.zones.map((zone) => ({
      id: zone.id, name: zone.zone_name,
      boards: data.electricalAssets.filter((board) => board.zone_id === zone.id).length,
      assets: data.siteAssets.filter((asset) => asset.zone_id === zone.id).length,
    })),
  };
}
