import { installationRecoveryIsActive } from './installationRecoveryFence';
import { sha256 } from 'js-sha256';
import type { AppDataStore, CloudUploadQueueItem, Installation } from '../types';
import { buildInstallationBackupTree, type InstallationBackupTree } from '../repositories/cloudSyncRepository';
import { canonicalJsonStringify, projectCanonicalCompatibility } from '../domain/installationV2';
import { discoverBackupMedia } from './backupMedia';
import { assignedWorkServerMetadataFromInstallation, ASSIGNED_WORK_SERVER_METADATA_FIELDS } from './assignedWorkPolicy';
import { assignedWorkScheduleChangedFields, reconcileAssignedWorkPrestartAcknowledgement } from './assignedWorkPrestart';
import { assignedWorkTreeReplacementHasNoRetainedScreen } from './assignedWorkNavigationFence';

export interface CleanAssignedRefreshBaseline {
  installationId: string;
  actorUserId: string;
  serverTreeRevision: number;
  snapshotSha256: string;
}

function sameMedia(reference: ReturnType<typeof discoverBackupMedia>[number], row: CloudUploadQueueItem): boolean {
  return reference.local_uri === row.local_uri
    && ((reference.entity_type === row.entity_type && reference.entity_id === row.entity_id
      && reference.field_name === row.field_name)
      || Boolean(reference.legacy_aliases?.some((alias) => alias.entity_type === row.entity_type
        && alias.entity_id === row.entity_id && alias.field_name === row.field_name)));
}

/** Timestamp watermarks alone cannot prove an old checkout is clean. */
export function captureConfirmedAssignedTreeBaseline(
  store: AppDataStore, installationId: string, actorUserId: string,
): CleanAssignedRefreshBaseline | null {
  const installation = store.installations.find((item) => item.id === installationId);
  if (!installation || installation.status !== 'Draft' || !installation.cloud_backup_enabled
    || installation.is_imported_copy || installation.import_source_server_id
    || installation.local_owner_user_id !== actorUserId
    || installation.assigned_work_state === 'inactive'
    || (installation.assigned_work_state === 'active' && installation.assigned_work_actor_user_id !== actorUserId)
    || !Number.isSafeInteger(installation.server_tree_revision) || installation.server_tree_revision! < 0
    || !Number.isSafeInteger(installation.last_synced_local_tree_revision)
    || installation.tree_revision !== installation.last_synced_local_tree_revision
    || installation.server_tree_revision !== installation.last_synced_server_tree_revision
    || installation.pending_completion || store.cloudSync.pending_complete_attempts?.[installationId]
    || store.cloudSync.pending_metadata_attempts?.[installationId] || store.cloudSync.conflicted_metadata_attempts?.[installationId]
    || (installation.backup_conflict?.kind ?? 'NONE') !== 'NONE'
    || store.cloudSync.force_dirty_installation_ids.includes(installationId)) return null;
  const tree = buildInstallationBackupTree(store, installation);
  const syncedAt = store.cloudSync.synced_at_by_installation[installationId];
  if (!syncedAt || !Number.isFinite(Date.parse(syncedAt)) || tree.watermark > syncedAt) return null;
  const queue = store.cloudSync.upload_queue.filter((row) => row.installation_id === installationId);
  if (queue.some((row) => row.status !== 'cleared' || !row.remote_url)) return null;
  const media = discoverBackupMedia(tree);
  if (media.some((reference) => !queue.some((row) => sameMedia(reference, row)))) return null;
  return {
    installationId, actorUserId, serverTreeRevision: installation.server_tree_revision!,
    snapshotSha256: sha256(canonicalJsonStringify({ tree, queue, syncedAt })),
  };
}

export function captureCleanAssignedRefreshBaseline(
  store: AppDataStore, installationId: string, actorUserId: string,
): CleanAssignedRefreshBaseline | null {
  if (installationRecoveryIsActive(installationId) || !assignedWorkTreeReplacementHasNoRetainedScreen(installationId)
    || store.siteAssetEditorDrafts?.some((draft) => draft.installationId === installationId)) return null;
  return captureConfirmedAssignedTreeBaseline(store, installationId, actorUserId);
}

export function projectionIsScopedToInstallation(store: AppDataStore, tree: InstallationBackupTree): boolean {
  const id = tree.installation.id;
  const groups = [
    [tree.zones, store.zones, 'audit_id'],
    [tree.electricalAssets, store.electricalAssets, 'audit_id'],
    [tree.siteAssets, store.siteAssets, 'audit_id'],
    [tree.gridSupplies, store.gridSupplies, 'installationId'],
    [tree.meterDevices, store.meterDevices, 'installationId'],
    [tree.measurementAssignments, store.measurementAssignments, 'installationId'],
    [tree.formSubmissions, store.formSubmissions, 'installation_id'],
  ] as const;
  const channels = tree.meterDevices.flatMap((meter) => meter.channels.map((channel) => channel.id));
  const foreignChannels = new Set(store.meterDevices.filter((meter) => meter.installationId !== id)
    .flatMap((meter) => meter.channels.map((channel) => channel.id)));
  if (new Set(channels).size !== channels.length || channels.some((channelId) => foreignChannels.has(channelId))) return false;
  return groups.every(([incoming, existing, scope]) => {
    const foreignIds = new Set(existing.filter((row) => (row as unknown as Record<string, unknown>)[scope] !== id).map((row) => row.id));
    return new Set(incoming.map((row) => row.id)).size === incoming.length
      && incoming.every((row) => (row as unknown as Record<string, unknown>)[scope] === id && !foreignIds.has(row.id));
  });
}

function preserveConfirmedLocalMedia(
  projected: InstallationBackupTree, current: InstallationBackupTree, queue: CloudUploadQueueItem[],
): CloudUploadQueueItem[] {
  const retained = new Map<string, CloudUploadQueueItem>();
  for (const reference of discoverBackupMedia(current)) {
    const row = queue.find((candidate) => candidate.status === 'cleared' && candidate.remote_url && sameMedia(reference, candidate));
    if (row?.remote_url) retained.set(`${reference.entity_type}|${reference.entity_id}|${row.remote_url}`, row);
  }
  const rebound: CloudUploadQueueItem[] = [];
  const uri = (kind: CloudUploadQueueItem['entity_type'], id: string, field: string, value: string | undefined): string | undefined => {
    const row = value ? retained.get(`${kind}|${id}|${value}`) : undefined;
    if (!row) return value;
    // The same server object may occupy several slots. Give every new queue
    // identity its own deterministic ID, including after a remote reordering.
    rebound.push({
      ...row, id: `refresh-${sha256(`${row.installation_id}|${kind}|${id}|${field}|${row.remote_url}`)}`,
      entity_type: kind, entity_id: id, field_name: field,
    });
    return row.local_uri;
  };
  for (const zone of projected.zones) zone.photos = zone.photos.map((value, index) => uri('zone', zone.id, `photos[${index}]`, value)!);
  for (const board of projected.electricalAssets) {
    board.photo = uri('electrical_asset', board.id, 'photo', board.photo);
    board.extra_photos = board.extra_photos?.map((value, index) => uri('electrical_asset', board.id, `extraPhotos[${index}]`, value)!);
  }
  for (const asset of projected.siteAssets) {
    asset.location_photo = uri('site_asset', asset.id, 'locationPhoto', asset.location_photo);
    asset.extra_photos = asset.extra_photos?.map((value, index) => uri('site_asset', asset.id, `extraPhotos[${index}]`, value)!);
  }
  for (const meter of projected.meterDevices) {
    if (!meter.wwPhotos) continue;
    meter.wwPhotos.deviceInstalled = uri('meter_device', meter.id, 'wwPhotos.deviceInstalled', meter.wwPhotos.deviceInstalled);
    meter.wwPhotos.switchboardOverview = uri('meter_device', meter.id, 'wwPhotos.switchboardOverview', meter.wwPhotos.switchboardOverview);
    meter.wwPhotos.labeling = uri('meter_device', meter.id, 'wwPhotos.labeling', meter.wwPhotos.labeling);
    meter.wwPhotos.extra = meter.wwPhotos.extra?.map((value, index) => uri('meter_device', meter.id, `wwPhotos.extra[${index}]`, value)!);
  }
  for (const form of projected.formSubmissions) {
    form.attachments = form.attachments.map((attachment, index) => ({
      ...attachment, uri: uri('form_submission', form.id, `attachments[${index}].uri`, attachment.uri)!,
    }));
  }
  return rebound;
}

/** Run inside the actor-fenced store transaction after canonical remote validation. */
export function applyCleanAssignedRefresh(
  store: AppDataStore, incoming: InstallationBackupTree,
  baseline: CleanAssignedRefreshBaseline, pulledAt: string,
): boolean {
  const fresh = captureCleanAssignedRefreshBaseline(store, baseline.installationId, baseline.actorUserId);
  const remote = incoming.installation;
  if (!fresh || canonicalJsonStringify(fresh) !== canonicalJsonStringify(baseline)
    || remote.id !== baseline.installationId || remote.status !== 'Draft'
    || remote.local_owner_user_id !== baseline.actorUserId || remote.is_imported_copy || remote.import_source_server_id
    || incoming.treeSchemaVersion !== 2 || !projectionIsScopedToInstallation(store, incoming)
    || discoverBackupMedia(incoming).length > 0
    || !Number.isSafeInteger(remote.server_tree_revision)
    || remote.server_tree_revision! <= baseline.serverTreeRevision) return false;
  const previous = store.installations.find((item) => item.id === baseline.installationId)!;
  const current = buildInstallationBackupTree(store, previous);
  const projected = structuredClone(incoming);
  const reboundQueue = preserveConfirmedLocalMedia(projected, current, store.cloudSync.upload_queue);
  const localRevision = Math.max(previous.tree_revision ?? 0, projected.installation.tree_revision ?? 0) + 1;
  const replacement: Installation = {
    ...previous, ...projected.installation,
    tree_revision: localRevision, last_synced_local_tree_revision: localRevision,
    last_synced_server_tree_revision: remote.server_tree_revision,
    display_code_sequences: previous.display_code_sequences,
    display_code_zone_sequences: previous.display_code_zone_sequences,
    assigned_work_job_summary: projected.installation.assigned_work_job_summary,
    assigned_work_refresh_conflict: undefined,
    assigned_work_change_notice: undefined,
    server_derived: undefined,
  };
  const beforeMetadata = assignedWorkServerMetadataFromInstallation(previous);
  const nextMetadata = assignedWorkServerMetadataFromInstallation(replacement);
  const changed = [...new Set([
    ...ASSIGNED_WORK_SERVER_METADATA_FIELDS.filter((field) =>
      canonicalJsonStringify(beforeMetadata[field]) !== canonicalJsonStringify(nextMetadata[field])),
    ...assignedWorkScheduleChangedFields(previous.assigned_work_job_summary, replacement.assigned_work_job_summary),
  ])];
  if (replacement.assigned_work_state === 'active' && changed.length) {
    replacement.assigned_work_change_notice = {
      changed_fields: changed, server_tree_revision: remote.server_tree_revision!, pulled_at: pulledAt,
    };
  }
  replacement.assigned_work_prestart_acknowledgement = reconcileAssignedWorkPrestartAcknowledgement(previous, replacement);
  store.installations = store.installations.map((item) => item.id === replacement.id ? replacement : item);
  const id = replacement.id;
  store.zones = [...store.zones.filter((item) => item.audit_id !== id), ...projected.zones];
  store.electricalAssets = [...store.electricalAssets.filter((item) => item.audit_id !== id), ...projected.electricalAssets];
  store.siteAssets = [...store.siteAssets.filter((item) => item.audit_id !== id), ...projected.siteAssets];
  store.gridSupplies = [...store.gridSupplies.filter((item) => item.installationId !== id), ...projected.gridSupplies];
  store.meterDevices = [...store.meterDevices.filter((item) => item.installationId !== id), ...projected.meterDevices];
  store.measurementAssignments = [...store.measurementAssignments.filter((item) => item.installationId !== id), ...projected.measurementAssignments];
  store.formSubmissions = [...store.formSubmissions.filter((item) => item.installation_id !== id), ...projected.formSubmissions];
  projectCanonicalCompatibility(store, id);
  store.cloudSync.upload_queue = [...store.cloudSync.upload_queue.filter((row) => row.installation_id !== id), ...reboundQueue];
  store.cloudSync.synced_at_by_installation[id] = buildInstallationBackupTree(store, replacement).watermark;
  return true;
}
