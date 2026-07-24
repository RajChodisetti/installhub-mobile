import type {
  CloudUploadQueueItem,
  ElectricalAsset,
  FormSubmission,
  Meter,
  SiteAsset,
  Zone,
} from '../types';
import type {
  BackupMediaReference,
  InstallationBackupTree,
} from '../repositories/cloudSyncRepository';

export type BackupSyncStage = 'metadata' | 'complete';

function isLocalMediaUri(uri: string | null | undefined): uri is string {
  return Boolean(uri && /^(file|content):\/\//i.test(uri));
}

function mimeTypeForUri(uri: string): string {
  const extension = uri.split('?')[0]?.split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'heic' || extension === 'heif') return 'image/heic';
  return 'image/jpeg';
}

function mediaReference(
  installationId: string,
  entityType: BackupMediaReference['entity_type'],
  entityId: string,
  fieldName: string,
  localUri: string | null | undefined,
  mimeType?: string,
): BackupMediaReference | null {
  if (!isLocalMediaUri(localUri)) return null;
  return {
    installation_id: installationId,
    entity_type: entityType,
    entity_id: entityId,
    field_name: fieldName,
    local_uri: localUri,
    mime_type: mimeType || mimeTypeForUri(localUri),
  };
}

function meterMedia(
  installationId: string,
  board: ElectricalAsset,
  meter: Meter,
  meterIndex: number,
): BackupMediaReference[] {
  const prefix = `meters[${meterIndex}].wwPhotos`;
  return [
    mediaReference(
      installationId,
      'electrical_asset',
      board.id,
      `${prefix}.deviceInstalled`,
      meter.ww_photos?.device_installed,
    ),
    mediaReference(
      installationId,
      'electrical_asset',
      board.id,
      `${prefix}.switchboardOverview`,
      meter.ww_photos?.switchboard_overview,
    ),
    mediaReference(
      installationId,
      'electrical_asset',
      board.id,
      `${prefix}.labeling`,
      meter.ww_photos?.labeling,
    ),
    ...(meter.ww_photos?.extra ?? []).map((uri, index) =>
      mediaReference(
        installationId,
        'electrical_asset',
        board.id,
        `${prefix}.extra[${index}]`,
        uri,
      )),
  ].filter((item): item is BackupMediaReference => Boolean(item));
}

export function discoverBackupMedia(tree: InstallationBackupTree): BackupMediaReference[] {
  const installationId = tree.installation.id;
  const references: Array<BackupMediaReference | null> = [];

  for (const zone of tree.zones) {
    zone.photos.forEach((uri, index) => {
      references.push(
        mediaReference(installationId, 'zone', zone.id, `photos[${index}]`, uri),
      );
    });
  }
  for (const board of tree.electricalAssets) {
    references.push(
      mediaReference(installationId, 'electrical_asset', board.id, 'photo', board.photo),
    );
    (board.extra_photos ?? []).forEach((uri, index) => {
      references.push(
        mediaReference(
          installationId,
          'electrical_asset',
          board.id,
          `extraPhotos[${index}]`,
          uri,
        ),
      );
    });
    board.meters.forEach((meter, index) => {
      references.push(...meterMedia(installationId, board, meter, index));
    });
  }
  for (const asset of tree.siteAssets) {
    references.push(
      mediaReference(
        installationId,
        'site_asset',
        asset.id,
        'locationPhoto',
        asset.location_photo,
      ),
    );
    (asset.extra_photos ?? []).forEach((uri, index) => {
      references.push(
        mediaReference(
          installationId,
          'site_asset',
          asset.id,
          `extraPhotos[${index}]`,
          uri,
        ),
      );
    });
  }
  for (const form of tree.formSubmissions) {
    form.attachments.forEach((attachment, index) => {
      references.push(
        mediaReference(
          installationId,
          'form_submission',
          form.id,
          `attachments[${index}].uri`,
          attachment.uri,
          attachment.mime_type,
        ),
      );
    });
  }
  return references.filter((item): item is BackupMediaReference => Boolean(item));
}

function queueKey(
  entityType: string,
  entityId: string,
  fieldName: string,
  localUri: string,
): string {
  return [entityType, entityId, fieldName, localUri].join('|');
}

function remoteResolver(queue: CloudUploadQueueItem[]) {
  const remoteByKey = new Map(
    queue
      .filter((item) => item.status === 'cleared' && item.remote_url)
      .map((item) => [
        queueKey(item.entity_type, item.entity_id, item.field_name, item.local_uri),
        item.remote_url!,
      ]),
  );
  return (
    entityType: string,
    entityId: string,
    fieldName: string,
    uri: string | null | undefined,
  ): string | null => {
    if (!uri) return null;
    if (!isLocalMediaUri(uri)) return uri;
    return remoteByKey.get(queueKey(entityType, entityId, fieldName, uri)) ?? null;
  };
}

function wireMeter(
  board: ElectricalAsset,
  meter: Meter,
  meterIndex: number,
  remote: ReturnType<typeof remoteResolver>,
) {
  const prefix = `meters[${meterIndex}].wwPhotos`;
  const prestart = meter.ww_prestart;
  const switchboard = meter.ww_switchboard;
  const verification = meter.ww_verification;
  const commissioning = meter.ww_commissioning;
  return {
    id: meter.id,
    deviceName: meter.device_name,
    deviceType: meter.device_type,
    deviceId: meter.device_id,
    deviceNumber: meter.device_number ?? null,
    classification: meter.classification ?? null,
    coverage: meter.coverage ?? null,
    wwPrestart: prestart
      ? {
          siteInduction: prestart.site_induction,
          safeAccess: prestart.safe_access,
          correctPpe: prestart.correct_ppe,
          livePointsAware: prestart.live_points_aware,
          canIsolate: prestart.can_isolate,
          additionalHazards: prestart.additional_hazards,
          safeToProceed: prestart.safe_to_proceed,
        }
      : {},
    wwSwitchboard: switchboard
      ? {
          name: switchboard.sb_name,
          location: switchboard.sb_location,
          deviceSerial: switchboard.device_serial,
          firmware: switchboard.firmware,
          antennaType: switchboard.antenna_type,
          signalStrength: switchboard.signal_strength,
          notes: switchboard.notes,
        }
      : {},
    wwChannels: (meter.ww_channels ?? []).map((channel) => ({
      purpose: channel.purpose,
      loadType: channel.load_type,
      rogowskiSize: channel.rogowski_size,
      description: channel.description,
      ctRatio: channel.ct_ratio,
    })),
    wwVerification: verification
      ? {
          voltageChecked: verification.voltage_checked,
          polarityChecked: verification.polarity_checked,
          communicationsOk: verification.communications_ok,
          notes: verification.notes,
        }
      : {},
    wwCommissioning: commissioning
      ? {
          deviceOnline: commissioning.device_online,
          channelsReporting: commissioning.channels_reporting,
          labeled: commissioning.labeled,
          photosTaken: commissioning.photos_taken,
          notes: commissioning.notes,
        }
      : {},
    wwPhotos: meter.ww_photos
      ? {
          deviceInstalled: remote(
            'electrical_asset',
            board.id,
            `${prefix}.deviceInstalled`,
            meter.ww_photos.device_installed,
          ),
          switchboardOverview: remote(
            'electrical_asset',
            board.id,
            `${prefix}.switchboardOverview`,
            meter.ww_photos.switchboard_overview,
          ),
          labeling: remote(
            'electrical_asset',
            board.id,
            `${prefix}.labeling`,
            meter.ww_photos.labeling,
          ),
          extra: (meter.ww_photos.extra ?? [])
            .map((uri, index) =>
              remote('electrical_asset', board.id, `${prefix}.extra[${index}]`, uri))
            .filter((uri): uri is string => Boolean(uri)),
        }
      : {},
  };
}

function wireZone(
  installationId: string,
  zone: Zone,
  remote: ReturnType<typeof remoteResolver>,
) {
  return {
    id: zone.id,
    installationId,
    zoneName: zone.zone_name,
    zoneDescription: zone.zone_description,
    photos: zone.photos
      .map((uri, index) => remote('zone', zone.id, `photos[${index}]`, uri))
      .filter((uri): uri is string => Boolean(uri)),
    createdAt: zone.created_at,
    updatedAt: zone.updated_at,
  };
}

function wireElectricalAsset(
  installationId: string,
  board: ElectricalAsset,
  remote: ReturnType<typeof remoteResolver>,
) {
  return {
    id: board.id,
    installationId,
    zoneId: board.zone_id,
    assetName: board.asset_name,
    displayCode: board.display_code,
    assetType: board.asset_type,
    electricalParentId: board.electrical_parent_id ?? null,
    electricalParentTbc: Boolean(board.electrical_parent_tbc),
    locationDescription: board.location_description ?? null,
    phase: board.phase ?? null,
    amperageRating: board.amperage_rating ?? null,
    siteNmi: board.site_nmi ?? null,
    photo: remote('electrical_asset', board.id, 'photo', board.photo),
    extraPhotos: (board.extra_photos ?? [])
      .map((uri, index) =>
        remote('electrical_asset', board.id, `extraPhotos[${index}]`, uri))
      .filter((uri): uri is string => Boolean(uri)),
    meterPresent: board.meter_present,
    meters: board.meters.map((meter, index) => wireMeter(board, meter, index, remote)),
    subCircuitsDescription: board.sub_circuits_description ?? null,
    comments: board.comments ?? null,
    createdAt: board.created_at,
    updatedAt: board.updated_at,
  };
}

function wireSiteAsset(
  installationId: string,
  asset: SiteAsset,
  remote: ReturnType<typeof remoteResolver>,
) {
  return {
    id: asset.id,
    installationId,
    zoneId: asset.zone_id,
    assetName: asset.asset_name,
    assetType: asset.asset_type,
    electricalBoardId: asset.electrical_board_id ?? null,
    electricalBoardTbc: Boolean(asset.electrical_board_tbc),
    locationDescription: asset.location_description ?? null,
    locationPhoto: remote('site_asset', asset.id, 'locationPhoto', asset.location_photo),
    displayCode: asset.display_code ?? null,
    meterPresent: asset.meter_present,
    meterSwitchboardId: asset.meter_switchboard_id ?? null,
    meterSwitchboardTbc: Boolean(asset.meter_switchboard_tbc),
    meterChannels: asset.meter_channels ?? [],
    comments: asset.comments ?? null,
    extraPhotos: (asset.extra_photos ?? [])
      .map((uri, index) => remote('site_asset', asset.id, `extraPhotos[${index}]`, uri))
      .filter((uri): uri is string => Boolean(uri)),
    createdAt: asset.created_at,
    updatedAt: asset.updated_at,
  };
}

function wireForm(
  installationId: string,
  form: FormSubmission,
  remote: ReturnType<typeof remoteResolver>,
) {
  return {
    id: form.id,
    installationId,
    formType: form.form_type,
    schemaVersion: form.schema_version,
    status: form.status,
    zoneId: form.zone_id ?? null,
    boardId: form.board_id ?? null,
    meterId: form.meter_id ?? null,
    siteAssetId: form.site_asset_id ?? null,
    answers: form.answers,
    attachments: form.attachments
      .map((attachment, index) => {
        const uri = remote(
          'form_submission',
          form.id,
          `attachments[${index}].uri`,
          attachment.uri,
        );
        return uri
          ? {
              id: attachment.id,
              slot: attachment.slot,
              uri,
              mimeType: attachment.mime_type,
              caption: attachment.caption ?? null,
              capturedAt: attachment.captured_at,
            }
          : null;
      })
      .filter((attachment): attachment is NonNullable<typeof attachment> => Boolean(attachment)),
    completedAt: form.completed_at ?? null,
    supersedesId: form.supersedes_id ?? null,
    createdAt: form.created_at,
    updatedAt: form.updated_at,
  };
}

export function buildBackupPayload(
  tree: InstallationBackupTree,
  queue: CloudUploadQueueItem[],
  syncStage?: BackupSyncStage,
) {
  const installationId = tree.installation.id;
  const remote = remoteResolver(queue);
  return {
    ...(syncStage ? { syncStage } : {}),
    installation: {
      id: installationId,
      clientName: tree.installation.client_name,
      siteName: tree.installation.site_name,
      siteAddress: tree.installation.site_address,
      inspectorName: tree.installation.inspector_name,
      auditDate: tree.installation.audit_date,
      status: tree.installation.status,
      createdAt: tree.installation.created_at,
      updatedAt: tree.installation.updated_at,
    },
    zones: tree.zones.map((zone) => wireZone(installationId, zone, remote)),
    electricalAssets: tree.electricalAssets.map((board) =>
      wireElectricalAsset(installationId, board, remote)),
    siteAssets: tree.siteAssets.map((asset) =>
      wireSiteAsset(installationId, asset, remote)),
    formSubmissions: tree.formSubmissions.map((form) =>
      wireForm(installationId, form, remote)),
  };
}
