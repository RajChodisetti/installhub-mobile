import {
  apiClient,
  assertCurrentCloudSessionAuthority,
  captureCloudSessionAuthority,
  type CloudSessionAuthority,
  type RemoteInstallationTree,
} from '../api/apiClient';
import { getStore, initStore, updateStore } from '../data/seed';
import type {
  AddressGeocodingStatus,
  AddressProvider,
  AddressSource,
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
import { bindAuthenticatedCloudActionLease } from '../services/authenticatedCloudAction';
import {
  resumeAuditWorkSuspensionsForInstallationReasons,
  resumeAuditWorkForInstallation,
  suspendAuditWorkForInstallation,
} from '../services/auditWorkTrackingBridge';
import type { AuditWorkSuspensionReason } from '../services/auditWorkTrackingResume';
import {
  remoteInstallationTreeRevision,
  remoteInstallationWorkTreeFingerprint,
} from '../services/remoteInstallationRevision';
import { copyName, nextCopyIndex } from './copyNaming';
import {
  boardTypeCode,
  installationSiteCodeForNewCopy,
  siteAssetTypeCode,
} from '../domain/installationV2';
import { defaultMeterCustomName } from '../domain/namingV2';
import {
  installationAddressFields,
  normalizeAustralianAddress,
} from '../domain/australianAddress';
import { validRecordVersionNumber } from '../services/reportVersioning';
import {
  assertRemoteInstallationIdentity,
  remoteAttachmentCopyId,
  validateCanonicalRemoteTreeIds,
} from '../services/remoteInstallationValidation';
import {
  activeAssignedWorkCheckoutIds,
  acceptAssignedWorkServerRefresh,
  applyAssignedDraftLifecycleResolution,
  assignedWorkServerMetadataFromInstallation,
  assignedWorkSuspensionReasonsResolvedAfterPull,
  assignedWorkCheckoutBelongsToDifferentActor,
  assignedWorkTrackingShouldResumeAfterPull,
  importedCopiesForActor,
  materializedRecordId,
  mergeAssignedInstallationServerState,
  planAssignedInstallationPull,
  crossActorAssignedCheckoutConflictIds,
} from '../services/assignedWorkPolicy';
import { quarantineAssignedWorkCheckout } from '../services/assignedWorkRecovery';
import {
  createAssignedWorkJobSummarySnapshot,
  reconcileAssignedWorkPrestartAcknowledgement,
} from '../services/assignedWorkPrestart';
import {
  actorForCurrentAssignedWorkAuthority,
  assertCurrentAssignedWorkAuthority,
  captureAssignedWorkMutationAuthority,
  type AssignedWorkMutationAuthority,
} from '../services/assignedWorkMutationGuard';

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
const nullableBool = (
  record: Record<string, unknown>,
  camel: string,
  snake?: string,
): boolean | null | undefined => {
  const hasCamel = Object.prototype.hasOwnProperty.call(record, camel);
  const hasSnake = Boolean(snake && Object.prototype.hasOwnProperty.call(record, snake));
  if (!hasCamel && !hasSnake) return undefined;
  const value = hasCamel ? record[camel] : record[snake!];
  return value === null ? null : typeof value === 'boolean' ? value : undefined;
};
const nullableNumber = (
  record: Record<string, unknown>,
  camel: string,
  snake?: string,
): number | null | undefined => {
  const hasCamel = Object.prototype.hasOwnProperty.call(record, camel);
  const hasSnake = Boolean(snake && Object.prototype.hasOwnProperty.call(record, snake));
  if (!hasCamel && !hasSnake) return undefined;
  const value = hasCamel ? record[camel] : record[snake!];
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};
const nullableCoordinate = (
  record: Record<string, unknown>,
  camel: string,
  snake?: string,
): number | null | undefined => {
  const hasCamel = Object.prototype.hasOwnProperty.call(record, camel);
  const hasSnake = Boolean(snake && Object.prototype.hasOwnProperty.call(record, snake));
  if (!hasCamel && !hasSnake) return undefined;
  const value = hasCamel ? record[camel] : record[snake!];
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const normalizedAddressProvider = (value: unknown): AddressProvider | null =>
  value === 'geoapify' || value === 'photon' ? value : null;
const normalizedAddressSource = (value: unknown): AddressSource =>
  value === 'suggested' || value === 'client_saved' ? value : 'manual';
const normalizedGeocodingStatus = (value: unknown): AddressGeocodingStatus =>
  value === 'resolved' || value === 'manual' || value === 'failed'
    ? value
    : 'unresolved';
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

function assignedWorkJobSummaryFromPull(
  source: Record<string, unknown>,
  actorUserId: string,
  pulledAt: string,
) {
  const assignedInspectorUserId = optionalText(
    source,
    'assignedInspectorUserId',
    'assigned_inspector_user_id',
  );
  if (!assignedInspectorUserId) {
    throw new Error('Assigned installation is missing its assignee identity.');
  }
  return createAssignedWorkJobSummarySnapshot({
    actor_user_id: actorUserId,
    assigned_inspector_user_id: assignedInspectorUserId,
    client_name: text(source, 'clientName', 'client_name'),
    customer_name: text(source, 'customerName', 'customer_name'),
    site_name: text(source, 'siteName', 'site_name'),
    site_address: text(source, 'siteAddress', 'site_address'),
    site_locality: text(source, 'siteLocality', 'site_locality'),
    site_state: text(source, 'siteState', 'site_state'),
    site_postcode: text(source, 'sitePostcode', 'site_postcode'),
    audit_date: text(source, 'auditDate', 'audit_date'),
    inspector_name: text(source, 'inspectorName', 'inspector_name'),
    maas: nullableBool(source, 'maas') ?? null,
    service_type: text(source, 'serviceType', 'service_type'),
    metering_solution_type: text(source, 'meteringSolutionType', 'metering_solution_type'),
    planned_meter_type: text(source, 'plannedMeterType', 'planned_meter_type'),
    custom_job_number: text(source, 'customJobNumber', 'custom_job_number'),
    site_contact_name: text(source, 'siteContactName', 'site_contact_name'),
    site_contact_phone: text(source, 'siteContactPhone', 'site_contact_phone'),
    site_contact_email: text(source, 'siteContactEmail', 'site_contact_email'),
    fergus_job_number: text(source, 'fergusJobNumber', 'fergus_job_number'),
    quote_number: text(source, 'quoteNumber', 'quote_number'),
    job_comments: text(source, 'jobComments', 'job_comments'),
    access_information: text(source, 'accessInformation', 'access_information'),
  }, pulledAt);
}

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
    POWER_OUTLET: 'Power Outlet', HEATER_GEYSER: 'Hot Water',
    REFRIGERATION: 'Refrigeration', COMPRESSED_AIR: 'Compressed Air', OTHER: 'Other',
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
    custom_name: optionalText(record, 'customName', 'custom_name'),
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
  const authority = captureAssignedWorkMutationAuthority();
  const actorUserId = actorForCurrentAssignedWorkAuthority(authority);
  if (!actorUserId) {
    throw new Error('Sign in again before browsing cloud installations.');
  }
  const cloudAuthority = await captureCloudSessionAuthority();
  if (!cloudAuthority) {
    throw new Error('Cloud Backup is not connected.');
  }
  const assertCurrentSession = () => {
    assertCurrentAssignedWorkAuthority(authority, actorUserId);
    assertCurrentCloudSessionAuthority(cloudAuthority, actorUserId);
  };
  assertCurrentSession();
  await initStore();
  assertCurrentSession();
  const localInstallations = getStore().installations.filter(
    (item) => item.local_owner_user_id === actorUserId,
  );
  const result = await apiClient.pull(
    '1970-01-01T00:00:00.000Z',
    undefined,
    cloudAuthority,
  );
  assertCurrentSession();
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

type MaterializeOptions = {
  tree?: RemoteInstallationTree;
  assignedActorUserId?: string;
  assignedWorkAuthority?: AssignedWorkMutationAuthority;
  cloudAuthority?: CloudSessionAuthority;
  pulledAt?: string;
};

export async function importRemoteInstallationAsCopy(
  serverInstallationId: string,
  options: MaterializeOptions = {},
): Promise<string> {
  const materializationAuthority = options.assignedWorkAuthority
    ?? captureAssignedWorkMutationAuthority();
  const materializationActorUserId = options.assignedActorUserId
    ?? actorForCurrentAssignedWorkAuthority(materializationAuthority);
  const materializationCloudAuthority = options.cloudAuthority
    ?? await captureCloudSessionAuthority();
  const assertAssignedMaterializationSession = () => {
    if (!materializationActorUserId) {
      throw new Error('Cloud materialization requires an authenticated local owner.');
    }
    if (!materializationCloudAuthority) {
      throw new Error('Cloud materialization requires an authenticated cloud session.');
    }
    assertCurrentAssignedWorkAuthority(
      materializationAuthority,
      materializationActorUserId,
    );
    assertCurrentCloudSessionAuthority(
      materializationCloudAuthority,
      materializationActorUserId,
    );
  };
  await initStore();
  assertAssignedMaterializationSession();
  const response = options.tree
    ? { installations: [options.tree], pulledAt: options.pulledAt ?? nowIso() }
    : await apiClient.pull(
        '1970-01-01T00:00:00.000Z',
        serverInstallationId,
        materializationCloudAuthority!,
      );
  assertAssignedMaterializationSession();
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
  const completedFromRevisionValue =
    source.completedFromRevision ?? source.completed_from_revision;
  const sourceCompletionNotes = optionalText(
    source,
    'completionNotes',
    'completion_notes',
  );
  assertRemoteInstallationIdentity(tree, serverInstallationId);
  const isAssignedMaterialization = Boolean(options.assignedActorUserId);
  const existingCopies = importedCopiesForActor(
    getStore().installations,
    serverInstallationId,
    materializationActorUserId!,
  );
  const copyIndex = isAssignedMaterialization ? undefined : nextCopyIndex(existingCopies);
  const installationId = isAssignedMaterialization ? serverInstallationId : createId('inst');
  const mappedId = (prefix: string, remoteId: string): string => materializedRecordId(
    isAssignedMaterialization,
    remoteId,
    () => createId(prefix),
  );
  const zoneIds = new Map<string, string>();
  const boardIds = new Map<string, string>();
  const siteAssetIds = new Map<string, string>();
  const gridIds = new Map<string, string>();
  const meterIds = new Map<string, string>();
  const channelIds = new Map<string, string>();
  const assignmentIds = new Map<string, string>();
  const formIds = new Map<string, string>();
  (tree.gridSupplies ?? []).forEach((grid) => {
    const id = text(grid, 'id');
    gridIds.set(id, mappedId('grid', id));
  });
  tree.zones.forEach((zone) => {
    const id = text(zone, 'id');
    zoneIds.set(id, mappedId('zone', id));
  });
  tree.electricalAssets.forEach((board) => {
    const id = text(board, 'id');
    boardIds.set(id, mappedId('board', id));
  });
  if (!canonicalV2) {
    tree.electricalAssets.forEach((board) => {
      array<Record<string, unknown>>(board, 'meters').forEach((meter) => {
        const remoteId = text(meter, 'id');
        if (!meterIds.has(remoteId)) meterIds.set(remoteId, mappedId('meter', remoteId));
      });
    });
  }
  (tree.meterDevices ?? []).forEach((meter) => {
    const remoteMeterId = text(meter, 'id');
    if (!meterIds.has(remoteMeterId)) meterIds.set(remoteMeterId, mappedId('meter', remoteMeterId));
    array<Record<string, unknown>>(meter, 'channels').forEach((channel) => {
      const id = text(channel, 'id');
      channelIds.set(id, mappedId('channel', id));
    });
  });
  (tree.measurementAssignments ?? []).forEach((assignment) => {
    const id = text(assignment, 'id');
    assignmentIds.set(id, mappedId('assignment', id));
  });
  tree.siteAssets.forEach((asset) => {
    const id = text(asset, 'id');
    siteAssetIds.set(id, mappedId('asset', id));
  });
  tree.formSubmissions.forEach((form) => {
    const id = text(form, 'id');
    formIds.set(id, mappedId('form', id));
  });
  const photoUris = collectRemotePhotoUris(tree, canonicalV2);
  const now = isAssignedMaterialization ? response.pulledAt : nowIso();

  const sourceSiteName = text(source, 'siteName', 'site_name');
  const copiedSiteName = isAssignedMaterialization
    ? sourceSiteName
    : copyName(sourceSiteName, copyIndex!);
  const importedAddress = normalizeAustralianAddress({
    display_address: text(source, 'siteAddress', 'site_address'),
    locality: optionalText(source, 'siteLocality', 'site_locality'),
    state: optionalText(source, 'siteState', 'site_state'),
    postcode: optionalText(source, 'sitePostcode', 'site_postcode'),
    country_code: 'AU',
    latitude: nullableCoordinate(source, 'siteLatitude', 'site_latitude'),
    longitude: nullableCoordinate(source, 'siteLongitude', 'site_longitude'),
    provider: normalizedAddressProvider(
      source.siteGeocodeProvider ?? source.site_geocode_provider,
    ),
    place_id: optionalText(source, 'siteGeocodePlaceId', 'site_geocode_place_id'),
    source: normalizedAddressSource(
      source.siteAddressSource ?? source.site_address_source,
    ),
    geocoding_status: normalizedGeocodingStatus(
      source.siteGeocodeStatus ?? source.site_geocode_status,
    ),
    fingerprint: optionalText(
      source,
      'siteAddressFingerprint',
      'site_address_fingerprint',
    ) ?? '',
  });
  const sourceSiteCode = optionalText(source, 'siteCode', 'site_code');
  const serverTreeRevision = Number(tree.treeRevision ?? source.treeRevision ?? source.tree_revision);
  const assignedActorUserId = options.assignedActorUserId;
  const createdByUserId = optionalText(source, 'createdByUserId', 'created_by_user_id');
  const assignedInspectorUserId = optionalText(
    source,
    'assignedInspectorUserId',
    'assigned_inspector_user_id',
  );
  const isExternalAssignment = Boolean(
    assignedActorUserId
    && assignedInspectorUserId === assignedActorUserId
    && createdByUserId !== assignedActorUserId,
  );
  const installation: Installation = {
    id: installationId,
    local_owner_user_id: materializationActorUserId ?? undefined,
    created_by_user_id: createdByUserId,
    assigned_inspector_user_id: assignedInspectorUserId,
    assigned_work_state: isExternalAssignment ? 'active' : 'none',
    assigned_work_actor_user_id: isExternalAssignment ? assignedActorUserId : undefined,
    ...(isExternalAssignment
      ? {
          assigned_work_job_summary: assignedWorkJobSummaryFromPull(
            source,
            assignedActorUserId!,
            response.pulledAt,
          ),
        }
      : {}),
    client_id: optionalText(source, 'clientId', 'client_id') ?? null,
    client_site_id: optionalText(source, 'clientSiteId', 'client_site_id') ?? null,
    client_name: text(source, 'clientName', 'client_name'),
    customer_name: optionalText(source, 'customerName', 'customer_name'),
    site_name: copiedSiteName,
    ...installationAddressFields(importedAddress),
    inspector_name: text(source, 'inspectorName', 'inspector_name'),
    audit_date: text(source, 'auditDate', 'audit_date'),
    maas: nullableBool(source, 'maas'),
    service_type: optionalText(source, 'serviceType', 'service_type'),
    metering_solution_type: optionalText(
      source,
      'meteringSolutionType',
      'metering_solution_type',
    ),
    planned_meter_type: optionalText(source, 'plannedMeterType', 'planned_meter_type'),
    custom_job_number: optionalText(source, 'customJobNumber', 'custom_job_number'),
    site_contact_name: optionalText(source, 'siteContactName', 'site_contact_name'),
    site_contact_phone: optionalText(source, 'siteContactPhone', 'site_contact_phone'),
    site_contact_email: optionalText(source, 'siteContactEmail', 'site_contact_email'),
    fergus_job_number: optionalText(source, 'fergusJobNumber', 'fergus_job_number'),
    quote_number: optionalText(source, 'quoteNumber', 'quote_number'),
    job_comments: optionalText(source, 'jobComments', 'job_comments'),
    access_information: optionalText(source, 'accessInformation', 'access_information'),
    warranty_device: nullableBool(source, 'warrantyDevice', 'warranty_device'),
    monitoring_installed: nullableBool(source, 'monitoringInstalled', 'monitoring_installed'),
    hardware_installed: nullableBool(source, 'hardwareInstalled', 'hardware_installed'),
    solar_capacity_kw: nullableNumber(source, 'solarCapacityKw', 'solar_capacity_kw'),
    additional_monitoring_required: nullableBool(
      source,
      'additionalMonitoringRequired',
      'additional_monitoring_required',
    ),
    additional_monitoring_hardware: optionalText(
      source,
      'additionalMonitoringHardware',
      'additional_monitoring_hardware',
    ),
    // Assigned work keeps the canonical server identity. Explicit cloud-copy
    // imports remain fresh local Draft records.
    status: isAssignedMaterialization
      ? text(source, 'status') as Installation['status']
      : 'Draft',
    tree_schema_version: 2,
    tree_revision: isAssignedMaterialization && Number.isSafeInteger(serverTreeRevision)
      ? serverTreeRevision
      : 0,
    ...(isAssignedMaterialization && Number.isSafeInteger(serverTreeRevision)
      ? { server_tree_revision: serverTreeRevision }
      : {}),
    ...(isAssignedMaterialization && importSourceRecordVersionNumber !== undefined
      ? { record_version_number: importSourceRecordVersionNumber }
      : {}),
    ...(isAssignedMaterialization && optionalText(source, 'completedAt', 'completed_at')
      ? { completed_at: optionalText(source, 'completedAt', 'completed_at') }
      : {}),
    ...(isAssignedMaterialization && optionalText(source, 'completedByUserId', 'completed_by_user_id')
      ? { completed_by_user_id: optionalText(source, 'completedByUserId', 'completed_by_user_id') }
      : {}),
    ...(isAssignedMaterialization && sourceCompletionNotes
      ? { completion_notes: sourceCompletionNotes }
      : {}),
    ...(isAssignedMaterialization
      && completedFromRevisionValue !== null
      && completedFromRevisionValue !== undefined
      && completedFromRevisionValue !== ''
      && Number.isSafeInteger(
        Number(completedFromRevisionValue),
      )
      && Number(completedFromRevisionValue) >= 0
      ? {
          completed_from_revision: Number(completedFromRevisionValue),
        }
      : {}),
    external_key: isAssignedMaterialization
      ? optionalText(source, 'externalKey', 'external_key') ?? `server:${installationId}`
      : `local:${installationId}`,
    site_code: isAssignedMaterialization
      ? sourceSiteCode
      : installationSiteCodeForNewCopy(sourceSiteCode, copiedSiteName),
    timezone: optionalText(source, 'timezone'),
    ...(isAssignedMaterialization
      ? {}
      : { legacy_completed_unpinned: text(source, 'status') === 'Completed' }),
    cloud_backup_enabled: isAssignedMaterialization,
    is_imported_copy: !isAssignedMaterialization,
    ...(!isAssignedMaterialization ? { import_source_server_id: serverInstallationId } : {}),
    ...(!isAssignedMaterialization && importSourceRecordVersionNumber !== undefined
      ? { import_source_record_version_number: importSourceRecordVersionNumber }
      : {}),
    ...(!isAssignedMaterialization
      ? {
          import_provenance_watermark: now,
          import_source_tree_revision: remoteInstallationTreeRevision(tree),
          copy_index: copyIndex,
        }
      : {}),
    thumbnail_status: !isAssignedMaterialization && photoUris.length ? 'pending' : 'ready',
    thumbnail_total: isAssignedMaterialization ? 0 : photoUris.length,
    thumbnail_ready: 0,
    created_at: isAssignedMaterialization
      ? optionalText(source, 'createdAt', 'created_at') ?? now
      : now,
    updated_at: isAssignedMaterialization
      ? optionalText(source, 'updatedAt', 'updated_at') ?? now
      : now,
  };
  if (isAssignedMaterialization) {
    installation.assigned_work_server_metadata_base =
      assignedWorkServerMetadataFromInstallation(installation);
    installation.assigned_work_server_tree_fingerprint =
      remoteInstallationWorkTreeFingerprint(tree);
  }
  const zones: Zone[] = tree.zones.map((zone) => ({
    id: zoneIds.get(text(zone, 'id'))!,
    audit_id: installationId,
    zone_code: optionalText(zone, 'zoneCode', 'zone_code'),
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
          (meter) => {
            const remoteId = text(meter, 'id');
            return mapMeter(meter, meterIds.get(remoteId) ?? mappedId('meter', remoteId));
          },
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
      customName: optionalText(meter, 'customName', 'custom_name')
        ?? defaultMeterCustomName(
          deviceModel,
          optionalText(meter, 'customModelName', 'custom_model_name'),
          optionalText(meter, 'customManufacturerName', 'custom_manufacturer_name'),
        ),
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
            : channelIds.get(text(channel, 'id')) ?? mappedId('channel', text(channel, 'id')),
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
    id: canonicalV2
      ? formIds.get(text(form, 'id'))!
      : formIds.get(text(form, 'id')) ?? mappedId('form', text(form, 'id')),
    ...(!isAssignedMaterialization ? { import_source_server_id: text(form, 'id') } : {}),
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
      id: isAssignedMaterialization && text(attachment, 'id')
        ? text(attachment, 'id')
        : remoteAttachmentCopyId(
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
    created_at: isAssignedMaterialization
      ? optionalText(form, 'createdAt', 'created_at') ?? now
      : now,
    updated_at: isAssignedMaterialization
      ? optionalText(form, 'updatedAt', 'updated_at') ?? now
      : now,
    completed_at: optionalText(form, 'completedAt', 'completed_at'),
    supersedes_id: formIds.get(text(form, 'supersedesId', 'supersedes_id')),
    historical_meter_removed: (form.historicalMeterRemoved ?? form.historical_meter_removed) as boolean,
  }));

  await updateStore((store) => {
    assertAssignedMaterializationSession();
    const existing = store.installations.find((item) => item.id === installationId);
    if (existing) {
      if (
        !assignedActorUserId
        || !assignedWorkCheckoutBelongsToDifferentActor(
          existing,
          assignedActorUserId,
        )
      ) return;
      quarantineAssignedWorkCheckout(
        store,
        installationId,
        assignedActorUserId,
        { quarantinedAt: response.pulledAt },
      );
    }
    store.installations.unshift(installation);
    store.gridSupplies.push(...gridSupplies);
    store.zones.push(...zones);
    store.electricalAssets.push(...electricalAssets);
    store.siteAssets.push(...siteAssets);
    store.meterDevices.push(...meterDevices);
    store.measurementAssignments.push(...measurementAssignments);
    store.formSubmissions.push(...formSubmissions);
    if (isAssignedMaterialization) {
      store.cloudSync.synced_at_by_installation[installationId] = response.pulledAt;
      store.cloudSync.force_dirty_installation_ids = store.cloudSync.force_dirty_installation_ids
        .filter((id) => id !== installationId);
    }
  });
  if (!isAssignedMaterialization) {
    assertAssignedMaterializationSession();
    const thumbnailWorkerLease = bindAuthenticatedCloudActionLease(
      materializationActorUserId!,
      materializationAuthority,
      materializationCloudAuthority!,
    );
    await enqueueThumbnailDownloads(
      installationId,
      photoUris,
      thumbnailWorkerLease.actorUserId,
      thumbnailWorkerLease.processAuthority,
    );
    thumbnailWorkerLease.assertCurrent();
    void runThumbnailDownloadWorker(thumbnailWorkerLease).catch(() => {});
  }
  return installationId;
}

/**
 * Pulls the caller's complete accessible inventory and checks out owned or
 * assigned Draft or Completed installations using their canonical server IDs.
 * Losing a Draft assignment hides its local checkout but never deletes pending
 * offline work; completed work remains visible as read-only history.
 */
export async function syncAssignedInstallations(
  actorUserId: string,
  cloudAuthority: CloudSessionAuthority,
): Promise<{ hydrated: number; activeAssigned: number; hidden: number }> {
  const authority = captureAssignedWorkMutationAuthority();
  const assertCurrentSession = () => {
    assertCurrentAssignedWorkAuthority(authority, actorUserId);
    assertCurrentCloudSessionAuthority(cloudAuthority, actorUserId);
  };
  const trackerResumeAuthority = {
    actorUserId,
    isCurrent: () => {
      try {
        assertCurrentSession();
        return true;
      } catch {
        return false;
      }
    },
  };
  assertCurrentSession();
  await initStore();
  assertCurrentSession();
  const response = await apiClient.pull(
    '1970-01-01T00:00:00.000Z',
    undefined,
    cloudAuthority,
  );
  assertCurrentSession();
  const previouslyActiveIds = activeAssignedWorkCheckoutIds(
    getStore().installations,
    actorUserId,
  );
  const plan = planAssignedInstallationPull(
    actorUserId,
    response.installations,
    previouslyActiveIds,
  );
  plan.trees.forEach((tree) => validateCanonicalRemoteTreeIds(tree));
  const activeIds = new Set(plan.activeAssignedIds);
  const crossActorConflictIds = crossActorAssignedCheckoutConflictIds(
    getStore().installations,
    actorUserId,
    plan.trees.map((tree) => text(tree.installation, 'id')),
  );

  const localBefore = new Map(getStore().installations.map((installation) => [
    installation.id,
    {
      status: installation.status,
      assignedWorkState: installation.assigned_work_state,
    },
  ]));
  const suspendIds = new Set(plan.inactiveAssignedIds);
  crossActorConflictIds.forEach((id) => suspendIds.add(id));
  plan.trees.forEach((tree) => {
    const id = text(tree.installation, 'id');
    if (text(tree.installation, 'status') === 'Completed' && localBefore.has(id)) {
      suspendIds.add(id);
    }
  });
  const attemptedSuspensions = new Map<string, NonNullable<Awaited<
    ReturnType<typeof suspendAuditWorkForInstallation>
  >>>();
  const resolvedSuspensionReasons = new Map<
    string,
    Set<AuditWorkSuspensionReason>
  >();
  const resolveSuspensionReason = (
    installationId: string,
    ...reasons: AuditWorkSuspensionReason[]
  ) => {
    const resolved = resolvedSuspensionReasons.get(installationId) ?? new Set();
    reasons.forEach((reason) => resolved.add(reason));
    resolvedSuspensionReasons.set(installationId, resolved);
  };

  try {
    for (const id of suspendIds) {
      // The bridge installs its in-memory gate before awaiting persistence, so
      // record each attempt first and unwind it if either suspension or the
      // following durable store mutation fails.
      const suspension = await suspendAuditWorkForInstallation(
        id,
        trackerResumeAuthority,
        'assignment-sync',
      );
      if (suspension) attemptedSuspensions.set(id, suspension);
      assertCurrentSession();
    }

    await updateStore((store) => {
      assertCurrentSession();
      plan.inactiveAssignedIds.forEach((id) => {
        const installation = store.installations.find((item) => item.id === id);
        if (
          installation?.assigned_work_state === 'active'
          && installation.status === 'Draft'
        ) {
          const previous = { ...installation };
          installation.assigned_work_state = 'inactive';
          installation.assigned_work_prestart_acknowledgement =
            reconcileAssignedWorkPrestartAcknowledgement(previous, installation);
        }
      });
      plan.trees.forEach((tree) => {
        const remote = tree.installation;
        const id = text(remote, 'id');
        const local = store.installations.find((item) => item.id === id);
        if (!local) return;
        const previous = { ...local };
        if (assignedWorkCheckoutBelongsToDifferentActor(local, actorUserId)) {
          // The materialization transaction below snapshots and removes this
          // exact checkout before inserting a clean canonical tree for the
          // replacement actor. Do not merge B's server state into A's tree.
          return;
        }
        const serverState = mergeAssignedInstallationServerState(local, tree);
        const isAssigned = activeIds.has(id);
        local.status = serverState.status;
        local.created_by_user_id = optionalText(
          remote,
          'createdByUserId',
          'created_by_user_id',
        ) ?? local.created_by_user_id;
        local.assigned_inspector_user_id = serverState.assignedInspectorUserId ?? undefined;
        local.assigned_work_state = isAssigned ? 'active' : 'none';
        local.assigned_work_actor_user_id = isAssigned ? actorUserId : undefined;
        local.assigned_work_job_summary = isAssigned
          ? assignedWorkJobSummaryFromPull(remote, actorUserId, response.pulledAt)
          : undefined;
        local.cloud_backup_enabled = true;
        const hasPendingCompletion = Boolean(
          local.pending_completion
          || store.cloudSync.pending_complete_attempts?.[id],
        );
        if (!hasPendingCompletion) {
          if (serverState.metadataPatch) Object.assign(local, serverState.metadataPatch);
          if (serverState.serverMetadataBase) {
            local.assigned_work_server_metadata_base = serverState.serverMetadataBase;
          }
          if (serverState.serverTreeRevision !== undefined) {
            if (
              local.server_tree_revision !== undefined
              && serverState.serverTreeRevision < local.server_tree_revision
            ) {
              throw new Error('Assigned-work server tree revision regressed during persistence.');
            }
            if (serverState.serverTreeRevision !== local.server_tree_revision) {
              local.server_derived = undefined;
            }
            local.server_tree_revision = serverState.serverTreeRevision;
          }
          if (serverState.serverTreeFingerprint) {
            local.assigned_work_server_tree_fingerprint = serverState.serverTreeFingerprint;
          }
          if (serverState.refreshConflict !== undefined) {
            local.assigned_work_refresh_conflict =
              serverState.refreshConflict ?? undefined;
          }
        }
        if (serverState.recordVersionNumber !== undefined) {
          local.record_version_number = serverState.recordVersionNumber;
        }
        if (serverState.completedAt !== undefined) {
          local.completed_at = serverState.completedAt;
        }
        if (serverState.completedByUserId !== undefined) {
          local.completed_by_user_id = serverState.completedByUserId;
        }
        if (serverState.completedFromRevision !== undefined) {
          local.completed_from_revision = serverState.completedFromRevision;
        }
        if (serverState.completionNotes !== undefined) {
          local.completion_notes = serverState.completionNotes;
        }
        if (applyAssignedDraftLifecycleResolution(
          local,
          serverState,
          response.pulledAt,
        )) {
          if (!store.cloudSync.force_dirty_installation_ids.includes(id)) {
            store.cloudSync.force_dirty_installation_ids.push(id);
          }
        }
        if (serverState.status === 'Completed') {
          local.pending_completion = undefined;
          local.legacy_completed_unpinned = false;
        }
        local.assigned_work_prestart_acknowledgement =
          reconcileAssignedWorkPrestartAcknowledgement(previous, local);
        const resolvedReasons = assignedWorkSuspensionReasonsResolvedAfterPull(
          previous,
          local,
          serverState,
        );
        if (resolvedReasons.length) {
          // A definitive Draft pull retires an orphaned lifecycle cutoff and
          // an exact assignment cutoff. Delete/logout locks are different
          // reasons and remain installed.
          resolveSuspensionReason(id, ...resolvedReasons);
        }
      });
    });
  } catch (error) {
    for (const [id, suspension] of attemptedSuspensions) {
      const local = localBefore.get(id);
      if (local?.status === 'Draft' && local.assignedWorkState !== 'inactive') {
        await resumeAuditWorkForInstallation(suspension, trackerResumeAuthority)
          .catch(() => undefined);
      }
    }
    throw error;
  }

  let hydrated = 0;
  for (const tree of plan.trees) {
    assertCurrentSession();
    const installationId = text(tree.installation, 'id');
    const existing = getStore().installations.find(
      (item) => item.id === installationId,
    );
    if (
      existing
      && !assignedWorkCheckoutBelongsToDifferentActor(existing, actorUserId)
    ) continue;
    await importRemoteInstallationAsCopy(installationId, {
      tree,
      assignedActorUserId: actorUserId,
      assignedWorkAuthority: authority,
      cloudAuthority,
      pulledAt: response.pulledAt,
    });
    assertCurrentSession();
    hydrated += 1;
  }

  // Release only reason-labelled process tokens after the final canonical
  // checkout exists. With no process token (for example after restart), the
  // store subscription alone recomputes eligibility and nothing is guessed by
  // installation ID.
  attemptedSuspensions.forEach((_suspension, id) => {
    resolveSuspensionReason(id, 'assignment-sync');
  });
  for (const [id, reasons] of resolvedSuspensionReasons) {
    assertCurrentSession();
    const current = getStore().installations.find((item) => item.id === id);
    if (assignedWorkTrackingShouldResumeAfterPull(current)) {
      await resumeAuditWorkSuspensionsForInstallationReasons(
        id,
        reasons,
        trackerResumeAuthority,
      );
      assertCurrentSession();
    }
  }

  assertCurrentSession();

  return {
    hydrated,
    activeAssigned: plan.activeAssignedIds.length,
    hidden: plan.inactiveAssignedIds.length,
  };
}

/**
 * Accepts only server-changed installation metadata from a previously detected
 * metadata-only conflict. Child/form records and local tree edits are retained.
 */
export async function acceptAssignedWorkServerChanges(
  installationId: string,
): Promise<Installation> {
  const authority = captureAssignedWorkMutationAuthority();
  const actorUserId = actorForCurrentAssignedWorkAuthority(authority);
  if (!actorUserId) {
    throw new Error('Sign in again before accepting assigned job changes.');
  }
  let accepted: Installation | null = null;
  await updateStore((store) => {
    assertCurrentAssignedWorkAuthority(authority, actorUserId);
    if (
      store.cloudSync.pending_complete_attempts?.[installationId]
      || store.installations.find((item) => item.id === installationId)?.pending_completion
    ) {
      throw new Error('Finish the pending Cloud Backup confirmation first.');
    }
    const installation = store.installations.find((item) => item.id === installationId);
    if (!installation) throw new Error('Installation not found.');
    if (
      installation.local_owner_user_id !== actorUserId
      || installation.assigned_work_state !== 'active'
      || installation.assigned_work_actor_user_id !== actorUserId
    ) {
      throw new Error('This assigned job is no longer active for the signed-in account.');
    }
    acceptAssignedWorkServerRefresh(installation);
    accepted = { ...installation };
  });
  return accepted!;
}
