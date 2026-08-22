import type {
  CloudUploadQueueItem,
  ElectricalAsset,
  FormSubmission,
  GridSupply,
  MeasurementAssignment,
  Meter,
  MeterDevice,
  SiteAsset,
  Zone,
} from '../types';
import type {
  BackupMediaReference,
  InstallationBackupTree,
} from '../repositories/cloudSyncRepository';
import { defaultMeterCustomName, resolvedZoneCodes } from '../domain/namingV2';

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

function meterDeviceMedia(
  installationId: string,
  meter: MeterDevice,
  board?: ElectricalAsset,
): BackupMediaReference[] {
  const meterIndex = board?.meters.findIndex((item) => item.id === meter.id) ?? -1;
  const legacyAlias = (fieldName: string) => meterIndex >= 0 && board
    ? [{
        entity_type: 'electrical_asset' as const,
        entity_id: board.id,
        field_name: `meters[${meterIndex}].wwPhotos.${fieldName}`,
      }]
    : undefined;
  const reference = (fieldName: string, uri: string | null | undefined) => {
    const item = mediaReference(
      installationId,
      'meter_device',
      meter.id,
      `wwPhotos.${fieldName}`,
      uri,
    );
    if (item) item.legacy_aliases = legacyAlias(fieldName);
    return item;
  };
  return [
    reference('deviceInstalled', meter.wwPhotos?.deviceInstalled),
    reference('switchboardOverview', meter.wwPhotos?.switchboardOverview),
    reference('labeling', meter.wwPhotos?.labeling),
    ...(meter.wwPhotos?.extra ?? []).map((uri, index) => reference(`extra[${index}]`, uri)),
  ].filter((item): item is BackupMediaReference => Boolean(item));
}

function legacyMeterMedia(
  installationId: string,
  board: ElectricalAsset,
  meter: Meter,
  meterIndex: number,
): BackupMediaReference[] {
  const prefix = `meters[${meterIndex}].wwPhotos`;
  return [
    mediaReference(installationId, 'electrical_asset', board.id, `${prefix}.deviceInstalled`, meter.ww_photos?.device_installed),
    mediaReference(installationId, 'electrical_asset', board.id, `${prefix}.switchboardOverview`, meter.ww_photos?.switchboard_overview),
    mediaReference(installationId, 'electrical_asset', board.id, `${prefix}.labeling`, meter.ww_photos?.labeling),
    ...(meter.ww_photos?.extra ?? []).map((uri, index) =>
      mediaReference(installationId, 'electrical_asset', board.id, `${prefix}.extra[${index}]`, uri)),
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
      if (!tree.meterDevices.some((item) => item.id === meter.id)) {
        references.push(...legacyMeterMedia(installationId, board, meter, index));
      }
    });
  }
  for (const meter of tree.meterDevices) {
    const board = tree.electricalAssets.find((item) => item.id === meter.installedOnBoardId);
    references.push(...meterDeviceMedia(installationId, meter, board));
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
  const legacyPrefix = `meters[${meterIndex}].wwPhotos`;
  const meterPhoto = (fieldName: string, uri: string | null | undefined) =>
    remote('meter_device', meter.id, `wwPhotos.${fieldName}`, uri)
    ?? remote('electrical_asset', board.id, `${legacyPrefix}.${fieldName}`, uri);
  const prestart = meter.ww_prestart;
  const switchboard = meter.ww_switchboard;
  const verification = meter.ww_verification;
  const commissioning = meter.ww_commissioning;
  return {
    id: meter.id,
    deviceName: meter.device_name,
    customName: meter.custom_name?.trim().slice(0, 64)
      || defaultMeterCustomName(
        meter.device_type,
        meter.custom_model_name,
        meter.custom_manufacturer_name,
      ),
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
      phaseLabel: channel.phase_label,
      capabilities: channel.capabilities ?? {},
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
          deviceInstalled: meterPhoto('deviceInstalled', meter.ww_photos.device_installed),
          switchboardOverview: meterPhoto('switchboardOverview', meter.ww_photos.switchboard_overview),
          labeling: meterPhoto('labeling', meter.ww_photos.labeling),
          extra: (meter.ww_photos.extra ?? [])
            .map((uri, index) => meterPhoto(`extra[${index}]`, uri))
            .filter((uri): uri is string => Boolean(uri)),
        }
      : {},
  };
}

function wireZone(
  installationId: string,
  zone: Zone,
  zoneCode: string,
  remote: ReturnType<typeof remoteResolver>,
) {
  return {
    id: zone.id,
    installationId,
    zoneCode,
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
    displayCode: board.display_code_meta ?? {
      value: board.display_code,
      generatedValue: board.display_code,
      isOverridden: false,
      ruleVersion: 1,
      provisional: true,
    },
    typeCode: board.type_code,
    customTypeName: board.custom_type_name ?? null,
    electricalSource: board.electrical_source ?? (
      board.electrical_parent_tbc
        ? { kind: 'TBC' }
        : board.electrical_parent_id
          ? { kind: 'BOARD', boardId: board.electrical_parent_id }
          : { kind: 'TBC' }
    ),
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
    displayCode: asset.display_code_meta ?? {
      value: asset.display_code ?? '',
      generatedValue: asset.display_code ?? '',
      isOverridden: false,
      ruleVersion: 1,
      provisional: true,
    },
    typeCode: asset.type_code,
    customTypeName: asset.custom_type_name ?? null,
    electricalSource: asset.electrical_source ?? (
      asset.electrical_board_tbc || !asset.electrical_board_id
        ? { kind: 'TBC' }
        : { kind: 'BOARD', boardId: asset.electrical_board_id }
    ),
    meteringState: asset.metering_state ?? (asset.meter_present ? { kind: 'TBC' } : { kind: 'UNMETERED' }),
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

function wireGridSupply(grid: GridSupply) {
  return {
    id: grid.id,
    installationId: grid.installationId,
    name: grid.name,
    isDefault: grid.isDefault,
    nmi: grid.nmi ?? null,
    externalKey: grid.externalKey ?? null,
  };
}

function wireMeterDevice(
  meter: MeterDevice,
  remote: ReturnType<typeof remoteResolver>,
) {
  const commissioningData = meter.commissioningData;
  const booleanSections = [
    ['prestart', commissioningData?.prestart, [
      'siteInduction', 'safeAccess', 'correctPpe', 'livePointsAware',
      'canIsolate', 'additionalHazards', 'safeToProceed',
    ]],
    ['verification', commissioningData?.verification, [
      'voltageChecked', 'polarityChecked', 'communicationsOk',
    ]],
    ['commissioning', commissioningData?.commissioning, [
      'deviceOnline', 'channelsReporting', 'labeled', 'photosTaken',
    ]],
  ] as const;
  for (const [sectionName, section, fields] of booleanSections) {
    if (!section) continue;
    for (const field of fields) {
      const value = (section as Record<string, unknown>)[field];
      if (value !== undefined && value !== null && typeof value !== 'boolean') {
        throw new Error(
          `Cannot sync meter ${meter.id}: commissioningData.${sectionName}.${field} must be a boolean.`,
        );
      }
    }
  }
  return {
    id: meter.id,
    installationId: meter.installationId,
    installedOnBoardId: meter.installedOnBoardId,
    deviceFamily: meter.deviceFamily,
    deviceModel: meter.deviceModel,
    customManufacturerName: meter.customManufacturerName ?? null,
    customModelName: meter.customModelName ?? null,
    customName: meter.customName?.trim().slice(0, 64)
      || defaultMeterCustomName(
        meter.deviceModel,
        meter.customModelName,
        meter.customManufacturerName,
      ),
    deviceNumber: meter.deviceNumber ?? null,
    serialNumber: meter.serialNumber,
    displayName: meter.displayName,
    channels: [...meter.channels]
      .sort((a, b) => a.ordinal - b.ordinal || a.id.localeCompare(b.id))
      .map((channel) => ({
        id: channel.id,
        ordinal: channel.ordinal,
        purpose: channel.purpose,
        phaseLabel: channel.phaseLabel ?? null,
        capabilities: channel.capabilities ?? {},
        loadTypeCode: channel.loadTypeCode ?? null,
        customLoadTypeName: channel.customLoadTypeName ?? null,
        sensorRating: channel.sensorRating ?? null,
        description: channel.description ?? null,
        target: channel.target ?? null,
        direction: channel.direction ?? null,
      })),
    commissioningData,
    wwPhotos: meter.wwPhotos
      ? {
          deviceInstalled: remote(
            'meter_device', meter.id, 'wwPhotos.deviceInstalled', meter.wwPhotos.deviceInstalled,
          ),
          switchboardOverview: remote(
            'meter_device', meter.id, 'wwPhotos.switchboardOverview', meter.wwPhotos.switchboardOverview,
          ),
          labeling: remote(
            'meter_device', meter.id, 'wwPhotos.labeling', meter.wwPhotos.labeling,
          ),
          extra: (meter.wwPhotos.extra ?? [])
            .map((uri, index) => remote('meter_device', meter.id, `wwPhotos.extra[${index}]`, uri))
            .filter((uri): uri is string => Boolean(uri)),
        }
      : {},
    notes: meter.notes ?? null,
  };
}

function wireMeasurementAssignment(assignment: MeasurementAssignment) {
  return {
    id: assignment.id,
    installationId: assignment.installationId,
    meterId: assignment.meterId,
    channelIds: [...assignment.channelIds],
    phaseMode: assignment.phaseMode,
    target: assignment.target,
    direction: assignment.direction,
    status: assignment.status,
  };
}

function wireForm(
  installationId: string,
  form: FormSubmission,
  remote: ReturnType<typeof remoteResolver>,
  syncStage?: BackupSyncStage,
) {
  const attachments = form.attachments
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
    .filter((attachment): attachment is NonNullable<typeof attachment> => Boolean(attachment));
  // Metadata is always a non-commissioning representation, even when a form
  // has no evidence or every evidence URI is already remote. Fail closed for
  // legacy callers too: only the explicit post-confirmation complete pass may
  // transmit the immutable Completed transition. The local form is untouched.
  const stagedAsDraft = form.status === 'Completed' && syncStage !== 'complete';
  return {
    id: form.id,
    installationId,
    formType: form.form_type,
    schemaVersion: form.schema_version,
    status: stagedAsDraft ? 'Draft' as const : form.status,
    zoneId: form.zone_id ?? null,
    boardId: form.board_id ?? null,
    meterId: form.meter_id ?? null,
    siteAssetId: form.site_asset_id ?? null,
    answers: form.answers,
    attachments,
    completedAt: stagedAsDraft ? null : form.completed_at ?? null,
    supersedesId: form.supersedes_id ?? null,
    historicalMeterRemoved: Boolean(form.historical_meter_removed),
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
  const zoneCodes = resolvedZoneCodes(tree.zones);
  return {
    treeSchemaVersion: tree.treeSchemaVersion,
    ...(tree.baseTreeRevision !== undefined
      ? { baseTreeRevision: tree.baseTreeRevision }
      : {}),
    ...(syncStage ? { syncStage } : {}),
    installation: {
      id: installationId,
      ...(tree.installation.customer_name !== undefined
        ? { customerName: tree.installation.customer_name }
        : {}),
      clientName: tree.installation.client_name,
      ...(tree.installation.maas !== undefined ? { maas: tree.installation.maas } : {}),
      ...(tree.installation.service_type !== undefined
        ? { serviceType: tree.installation.service_type }
        : {}),
      ...(tree.installation.metering_solution_type !== undefined
        ? { meteringSolutionType: tree.installation.metering_solution_type }
        : {}),
      ...(tree.installation.planned_meter_type !== undefined
        ? { plannedMeterType: tree.installation.planned_meter_type }
        : {}),
      siteName: tree.installation.site_name,
      siteAddress: tree.installation.site_address,
      ...(tree.installation.site_locality !== undefined
        ? { siteLocality: tree.installation.site_locality }
        : {}),
      ...(tree.installation.site_state !== undefined
        ? { siteState: tree.installation.site_state }
        : {}),
      ...(tree.installation.site_postcode !== undefined
        ? { sitePostcode: tree.installation.site_postcode }
        : {}),
      ...(tree.installation.site_country_code !== undefined
        ? { siteCountryCode: tree.installation.site_country_code }
        : {}),
      ...(tree.installation.site_contact_name !== undefined
        ? { siteContactName: tree.installation.site_contact_name }
        : {}),
      ...(tree.installation.site_contact_phone !== undefined
        ? { siteContactPhone: tree.installation.site_contact_phone }
        : {}),
      ...(tree.installation.site_contact_email !== undefined
        ? { siteContactEmail: tree.installation.site_contact_email }
        : {}),
      ...(tree.installation.fergus_job_number !== undefined
        ? { fergusJobNumber: tree.installation.fergus_job_number }
        : {}),
      ...(tree.installation.quote_number !== undefined
        ? { quoteNumber: tree.installation.quote_number }
        : {}),
      ...(tree.installation.job_comments !== undefined
        ? { jobComments: tree.installation.job_comments }
        : {}),
      ...(tree.installation.access_information !== undefined
        ? { accessInformation: tree.installation.access_information }
        : {}),
      ...(tree.installation.warranty_device !== undefined
        ? { warrantyDevice: tree.installation.warranty_device }
        : {}),
      ...(tree.installation.monitoring_installed !== undefined
        ? { monitoringInstalled: tree.installation.monitoring_installed }
        : {}),
      ...(tree.installation.hardware_installed !== undefined
        ? { hardwareInstalled: tree.installation.hardware_installed }
        : {}),
      ...(tree.installation.solar_capacity_kw !== undefined
        ? { solarCapacityKw: tree.installation.solar_capacity_kw }
        : {}),
      ...(tree.installation.additional_monitoring_required !== undefined
        ? { additionalMonitoringRequired: tree.installation.additional_monitoring_required }
        : {}),
      ...(tree.installation.additional_monitoring_hardware !== undefined
        ? { additionalMonitoringHardware: tree.installation.additional_monitoring_hardware }
        : {}),
      inspectorName: tree.installation.inspector_name,
      auditDate: tree.installation.audit_date,
      status: tree.installation.status,
      externalKey: tree.installation.external_key,
      siteCode: tree.installation.site_code,
      timezone: tree.installation.timezone,
      treeSchemaVersion: tree.installation.tree_schema_version ?? 2,
      recordVersionNumber: tree.installation.record_version_number ?? null,
      completedAt: tree.installation.completed_at ?? null,
      ...(tree.installation.completed_by_user_id !== undefined
        ? { completedByUserId: tree.installation.completed_by_user_id }
        : {}),
      completedFromRevision: tree.installation.completed_from_revision ?? null,
      ...(tree.installation.completion_notes !== undefined
        ? { completionNotes: tree.installation.completion_notes }
        : {}),
      createdAt: tree.installation.created_at,
      updatedAt: tree.installation.updated_at,
    },
    gridSupplies: tree.gridSupplies.map(wireGridSupply),
    zones: tree.zones.map((zone) => wireZone(
      installationId,
      zone,
      zoneCodes.get(zone.id) ?? 'ZONE',
      remote,
    )),
    electricalAssets: tree.electricalAssets.map((board) =>
      wireElectricalAsset(installationId, board, remote)),
    siteAssets: tree.siteAssets.map((asset) =>
      wireSiteAsset(installationId, asset, remote)),
    meterDevices: tree.meterDevices.map((meter) => wireMeterDevice(meter, remote)),
    measurementAssignments: tree.measurementAssignments.map(wireMeasurementAssignment),
    formSubmissions: tree.formSubmissions.map((form) =>
      wireForm(installationId, form, remote, syncStage)),
  };
}
