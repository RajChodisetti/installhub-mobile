import { sha256 } from 'js-sha256';
import type { RemoteInstallationTree } from '../api/apiClient';
import type { AppDataStore, PendingMetadataBackupAttempt } from '../types';
import { buildInstallationBackupTree, serverBaseTreeRevision } from '../repositories/cloudSyncRepository';
import { projectCanonicalCompatibility } from '../domain/installationV2';
import { applyServerResultCommitFence, type ServerResultCommitFence } from './serverResultCommitFence';
import { mergeResolvedDisplayCodes } from './displayCodeReconciliation';
import { assignedWorkServerMetadataFromInstallation, assignedWorkServerMetadataFromRemote } from './assignedWorkPolicy';
import { assignedWorkTreeReplacementHasNoRetainedScreen } from './assignedWorkNavigationFence';
import { assertInstallationNotRecovering } from './installationRecoveryFence';
import { remoteInstallationWorkTreeFingerprint } from './remoteInstallationRevision';
import { projectionIsScopedToInstallation } from './assignedWorkCleanRefresh';

export interface MetadataBackupRecoveryCommitFence extends ServerResultCommitFence {
  /** Hash of the fresh current tree, captured before entering the store queue. */
  expectedTreeSnapshotSha256: string;
}

type Row = Record<string, unknown>;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = (value: unknown): string => sha256(JSON.stringify(value));
const exact = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const fail = (detail: string): never => {
  throw new Error(`Metadata backup recovery could not verify ${detail}. The original request and local work were preserved.`);
};
const record = (value: unknown, label: string): Row => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail(label);
  return value as Row;
};
const rows = (value: unknown, installationId: string, label: string): Row[] => {
  if (!Array.isArray(value)) return fail(label);
  const ids = new Set<string>();
  return value.map((value) => {
    const row = record(value, label);
    if (typeof row.id !== 'string' || !row.id || ids.has(row.id)
      || row.installationId !== installationId || row.deletedAt != null) return fail(`${label} scope`);
    ids.add(row.id);
    return row;
  }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
};

/** Only the API's documented absent/null and bounded-text normalization. Answers
 * and attachment contents use the exact branch below, never text trimming. */
function normalized(value: unknown): unknown {
  if (value == null || value === '') return null;
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) return value.map(normalized);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Row)
    .filter(([, item]) => item != null && item !== '')
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalized(item)]));
  return value;
}
function canonicalExact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalExact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Row)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonicalExact(item)]));
  return value;
}
/** Same immutable-photo UUID equivalence used by the API's retained form
 * fingerprint. Applied only to known evidence URI fields, never user answers. */
function photoIdentity(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const ids = new Set([...value.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)].map((match) => match[0].toLowerCase()));
  return ids.size === 1 ? `urn:installhub:photo:${[...ids][0]}` : value;
}
function attachments(value: unknown): unknown {
  if (!Array.isArray(value)) return fail('form attachments');
  return canonicalExact(value.map((item): Row => {
    const row = record(item, 'form attachment');
    return { ...row, uri: photoIdentity(row.uri) };
  }).sort((a, b) => String(a.id).localeCompare(String(b.id))));
}
function meterPhotos(value: unknown): unknown {
  const photos = record(value ?? {}, 'meter photos');
  return normalized(Object.fromEntries(Object.entries(photos).map(([key, item]) => [key,
    key === 'extra' && Array.isArray(item) ? item.map(photoIdentity).sort() : photoIdentity(item),
  ])));
}
function assertFields(sent: Row, remote: Row, fields: readonly string[], label: string) {
  for (const key of fields) {
    const value = (row: Row) => normalized(['photo', 'locationPhoto'].includes(key) ? photoIdentity(row[key]) : row[key]);
    if (!exact(value(sent), value(remote))) fail(`${label}.${key}`);
  }
}
const rootCaptureFields = [
  'customerName', 'maas', 'serviceType', 'meteringSolutionType', 'plannedMeterType', 'customJobNumber',
  'siteContactName', 'siteContactPhone', 'siteContactEmail', 'fergusJobNumber', 'quoteNumber',
  'jobComments', 'accessInformation', 'warrantyDevice', 'monitoringInstalled', 'hardwareInstalled',
  'solarCapacityKw', 'additionalMonitoringRequired', 'additionalMonitoringHardware', 'inspectorName', 'auditDate', 'jobEndDate', 'jobEndTime', 'siteCode',
] as const;
const entityFields = {
  gridSupplies: ['id', 'installationId', 'name', 'isDefault', 'nmi', 'externalKey'],
  zones: ['id', 'installationId', 'zoneId', 'zoneName', 'zoneCode', 'zoneDescription', 'photoNotes', 'photoMetadata'],
  electricalAssets: ['id', 'installationId', 'zoneId', 'assetName', 'typeCode', 'customTypeName', 'electricalSource',
    'locationDescription', 'phase', 'amperageRating', 'siteNmi', 'photo', 'photoNotes', 'photoMetadata', 'meterPresent', 'subCircuitsDescription', 'comments'],
  siteAssets: ['id', 'installationId', 'zoneId', 'assetName', 'typeCode', 'customTypeName', 'electricalSource', 'meteringState',
    'locationDescription', 'locationPhoto', 'photoNotes', 'photoMetadata', 'meterPresent', 'comments'],
  meterDevices: ['id', 'installationId', 'installedOnBoardId', 'customName', 'deviceFamily', 'deviceModel',
    'customManufacturerName', 'customModelName', 'deviceNumber', 'serialNumber', 'lifecycleState', 'commissioningData', 'photoNotes', 'photoMetadata', 'notes'],
  measurementAssignments: ['id', 'installationId', 'meterId', 'phaseMode', 'target', 'direction', 'status'],
  formSubmissions: ['id', 'installationId', 'formType', 'schemaVersion', 'zoneId', 'boardId', 'meterId', 'siteAssetId',
    'supersedesId', 'historicalMeterRemoved'],
} as const;

const retainedMeterFields = ['id', 'installationId', 'installedOnBoardId', 'customName', 'deviceFamily',
  'deviceModel', 'customManufacturerName', 'customModelName', 'deviceNumber', 'serialNumber', 'lifecycleState', 'displayName', 'channels'] as const;

function restoredFormMatches(sent: Row, previous: Row): boolean {
  if (previous.status !== 'Completed' || sent.status !== 'Draft') return false;
  return entityFields.formSubmissions.filter((field) => field !== 'historicalMeterRemoved').every((field) => exact(normalized(sent[field]), normalized(previous[field])))
    && exact(canonicalExact(sent.answers), canonicalExact(previous.answers))
    && exact(attachments(sent.attachments), attachments(previous.attachments));
}

function expectedMetadataRows(attempt: PendingMetadataBackupAttempt): Record<keyof typeof entityFields, Row[]> {
  const id = attempt.installation_id;
  const prior = attempt.base_remote_tree;
  if (attempt.base_tree_revision !== undefined) {
    if (!prior || !attempt.base_remote_tree_sha256 || hash(prior) !== attempt.base_remote_tree_sha256
      || prior.treeSchemaVersion !== 2 || prior.installation.id !== id
      || (prior.treeRevision ?? prior.installation.treeRevision ?? prior.installation.tree_revision) !== attempt.base_tree_revision
      || prior.installation.status !== attempt.installation_status) fail('saved canonical preimage');
  } else if (prior || attempt.base_remote_tree_sha256) fail('unexpected canonical preimage');
  const expected = {} as Record<keyof typeof entityFields, Row[]>;
  for (const key of Object.keys(entityFields) as Array<keyof typeof entityFields>) {
    expected[key] = copy(rows(attempt.payload[key], id, `saved ${key}`));
    if (prior) rows(prior[key], id, `preimage ${key}`);
  }
  // treeService.retainCompletedFormsDuringMetadata restores only identical
  // immutable forms. No additional server form may enter the submitted set.
  expected.formSubmissions = expected.formSubmissions.map((sent) => {
    const previous = prior?.formSubmissions.find((form) => form.id === sent.id);
    return previous && restoredFormMatches(sent, previous) ? copy(previous) : sent;
  });
  const replacementIds = new Set(expected.formSubmissions.filter((form) => form.formType === 'comms-fault'
    && form.status === 'Draft' && record(form.answers, 'Comms answers')['works.replace_device'] === 'yes'
    && typeof form.meterId === 'string').map((form) => form.meterId));
  // meterHistory.retainPendingCommsReplacementMeterState retains exactly these
  // operational fields, while notes/photos/commissioning remain submitted.
  for (const meter of expected.meterDevices) {
    if (!replacementIds.has(meter.id)) continue;
    const previous = prior?.meterDevices?.find((item) => item.id === meter.id);
    if (!previous) {
      // The API applies retention only when the installation already exists.
      if (!prior) continue;
      // A newly captured original meter has no server operational preimage.
      // The API stages it unchanged; replacement answers never supply fields.
      const pending = expected.formSubmissions.filter((form) => form.meterId === meter.id
        && form.formType === 'comms-fault' && form.status === 'Draft'
        && record(form.answers, 'Comms answers')['works.replace_device'] === 'yes');
      const board = expected.electricalAssets.find((item) => item.id === meter.installedOnBoardId);
      const text = (value: unknown) => typeof value === 'string' ? value.trim() || null : null;
      if (prior?.formSubmissions.some((form) => form.meterId === meter.id)
        || meter.deviceFamily !== 'WATTWATCHERS' || !['A3RM', 'A6M'].includes(String(meter.deviceModel))
        || !board || pending.some((form) => (form.boardId && form.boardId !== board.id)
          || (form.zoneId && form.zoneId !== board.zoneId)
          || prior?.formSubmissions.some((old) => old.id === form.id)
          || Object.entries({ 'existing.device_type': meter.deviceModel, 'existing.device_id': meter.serialNumber,
            'existing.device_number': meter.deviceNumber }).some(([key, value]) => {
            const captured = text(record(form.answers, 'Comms answers')[key]);
            return captured !== null && captured !== text(value);
          }))) fail('the original newly captured Comms meter');
      continue;
    }
    for (const field of retainedMeterFields) meter[field] = copy(previous[field] ?? null);
  }
  return expected;
}

/** Revision equality alone does not prove that the pulled contents are the saved
 * request. Compare every captured canonical field; legacy duplicated projections,
 * timestamps, generated codes, directory/address resolution and derived values
 * are the only exclusions. Retention requires an exact durable prior revision. */
function assertAcceptedRepresentation(attempt: PendingMetadataBackupAttempt, remote: RemoteInstallationTree, revision: number) {
  const id = attempt.installation_id;
  const sentRoot = record(attempt.payload.installation, 'saved installation');
  if (remote.treeSchemaVersion !== 2 || remote.installation.id !== id
    || (remote.treeRevision ?? remote.installation.treeRevision ?? remote.installation.tree_revision) !== revision
    || remote.installation.status !== attempt.installation_status || remote.installation.deletedAt != null) fail('canonical identity, revision or lifecycle');
  const retainedRoot = { ...sentRoot };
  // Additive business fields omitted by older snapshots retain locked server
  // values; an explicit null remains a clear (canonical.ts optional writes).
  for (const field of rootCaptureFields) {
    if (!['inspectorName', 'auditDate', 'siteCode'].includes(field)
      && !Object.prototype.hasOwnProperty.call(sentRoot, field)) {
      retainedRoot[field] = attempt.base_remote_tree?.installation[field] ?? null;
    }
  }
  assertFields(retainedRoot, remote.installation, rootCaptureFields, 'installation');
  if ((sentRoot.timezone ?? 'Australia/Sydney') !== remote.installation.timezone) fail('installation.timezone');
  const expected = expectedMetadataRows(attempt);
  if (attempt.base_remote_tree) {
    assertFields(attempt.base_remote_tree.installation, remote.installation, [
      'createdByUserId', 'assignedInspectorUserId', 'completedAt', 'completedByUserId', 'completedFromRevision',
      'completionNotes', 'reopenedAt', 'reopenedByUserId', 'reopenedFromVersionNumber', 'reopenReason',
    ], 'server lifecycle or ownership');
  } else if (remote.installation.createdByUserId !== attempt.actor_user_id
    || (remote.installation.assignedInspectorUserId != null
      && remote.installation.assignedInspectorUserId !== attempt.actor_user_id)) {
    fail('new installation owner');
  }
  const recordVersion = remote.recordVersionNumber ?? remote.installation.recordVersionNumber;
  if (attempt.accepted_record_version_number != null && recordVersion !== attempt.accepted_record_version_number) fail('record version acknowledgement');
  for (const key of Object.keys(entityFields) as Array<keyof typeof entityFields>) {
    const sentRows = expected[key];
    const remoteRows = rows(remote[key], id, `canonical ${key}`);
    if (!exact(sentRows.map((row) => row.id), remoteRows.map((row) => row.id))) fail(`${key} membership`);
    for (let index = 0; index < sentRows.length; index += 1) {
      const sent = sentRows[index]!; const received = remoteRows[index]!;
      const label = `${key}:${sent.id}`;
      assertFields(sent, received, entityFields[key], label);
      for (const field of key === 'zones' ? ['photos'] : ['electricalAssets', 'siteAssets'].includes(key) ? ['extraPhotos'] : key === 'measurementAssignments' ? ['channelIds'] : []) {
        if (!Array.isArray(sent[field]) || !Array.isArray(received[field])
          || !exact((sent[field] as string[]).map((value) => field === 'channelIds' ? value : photoIdentity(value)).sort(),
            (received[field] as string[]).map((value) => field === 'channelIds' ? value : photoIdentity(value)).sort())) fail(`${label}.${field}`);
      }
      if (key === 'meterDevices') {
        if (!exact(meterPhotos(sent.wwPhotos), meterPhotos(received.wwPhotos))) fail(`${label}.wwPhotos`);
        if (!Array.isArray(sent.channels) || !Array.isArray(received.channels)) fail(`${label}.channels`);
        const sentChannels = [...sent.channels as Row[]].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        const remoteChannels = [...received.channels as Row[]].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        if (new Set(remoteChannels.map((channel) => channel.id)).size !== remoteChannels.length
          || !exact(sentChannels.map((channel) => channel.id), remoteChannels.map((channel) => channel.id))) fail(`${label}.channel identity`);
        sentChannels.forEach((channel, channelIndex) => {
          const receivedChannel = remoteChannels[channelIndex]!;
          assertFields(channel, receivedChannel, [
            'id', 'ordinal', 'purpose', 'phaseLabel', 'loadTypeCode', 'customLoadTypeName', 'sensorRating', 'description',
          ], `${label}.channels`);
          const capabilities = (value: unknown) => canonicalExact(Object.fromEntries(Object.entries(record(value ?? {}, 'channel capabilities'))
            .map(([key, item]) => [key.trim(), item])));
          if (!exact(capabilities(channel.capabilities), capabilities(receivedChannel.capabilities))) fail(`${label}.channel capabilities`);
        });
      }
      if (key === 'formSubmissions') {
        if (!exact(canonicalExact(sent.answers), canonicalExact(received.answers))) fail(`${label}.answers`);
        if (!Array.isArray(sent.attachments) || !Array.isArray(received.attachments)) fail(`${label}.attachments`);
        if (!exact(attachments(sent.attachments), attachments(received.attachments))) fail(`${label}.attachments`);
        if (received.status !== sent.status || (received.completedAt ?? null) !== (sent.completedAt ?? null)) fail(`${label}.status`);
      }
    }
  }
}

const directoryFields = [
  'client_name', 'site_name', 'client_id', 'client_site_id', 'site_address', 'site_locality', 'site_state', 'site_postcode',
  'site_country_code', 'site_latitude', 'site_longitude', 'site_geocode_provider', 'site_geocode_place_id',
  'site_address_source', 'site_geocoding_status', 'site_address_fingerprint',
] as const;

/** Called only inside the serialized store transaction. Plans on copies, then
 * commits server-owned acknowledgement fields without replacing captured work. */
export function applyMetadataBackupRecovery(
  store: AppDataStore, attempt: PendingMetadataBackupAttempt, remote: RemoteInstallationTree,
  fence: MetadataBackupRecoveryCommitFence, expectedTreeRevision: number,
): void {
  const id = attempt.installation_id;
  applyServerResultCommitFence(store, id, fence, (installation) => {
    assertInstallationNotRecovering(id);
    const durable = store.cloudSync.pending_metadata_attempts?.[id];
    if (!durable || !exact(durable, attempt) || attempt.version !== 1 || attempt.actor_user_id !== fence.actorUserId
      || attempt.payload_sha256 !== hash(attempt.payload) || attempt.sent_tree_sha256 !== hash(attempt.sent_tree)
      || attempt.id !== `metadata-backup:${sha256(`${attempt.actor_user_id}\n${attempt.payload_sha256}\n${attempt.sent_tree_sha256}\n${attempt.base_remote_tree_sha256 ?? ''}`)}`
      || attempt.accepted_tree_revision !== expectedTreeRevision
      || !Number.isSafeInteger(expectedTreeRevision) || expectedTreeRevision < (attempt.base_tree_revision ?? 0)
      || attempt.payload.syncStage !== 'metadata' || attempt.payload.treeSchemaVersion !== 2
      || attempt.payload.baseTreeRevision !== attempt.base_tree_revision
      || attempt.sent_tree.installation.id !== id || attempt.sent_tree.installation.local_owner_user_id !== fence.actorUserId
      || attempt.sent_tree.installation.status !== attempt.installation_status
      || (attempt.sent_tree.installation.tree_revision ?? 0) !== attempt.local_tree_revision
      || attempt.sent_tree.watermark !== attempt.tree_watermark
      || serverBaseTreeRevision(attempt.sent_tree.installation) !== attempt.base_tree_revision) fail('durable request integrity');
    if (installation.assigned_work_state === 'inactive' || installation.status !== attempt.installation_status
      || installation.pending_completion || store.cloudSync.pending_complete_attempts?.[id]
      || store.cloudSync.conflicted_metadata_attempts?.[id]
      || (serverBaseTreeRevision(installation) !== attempt.base_tree_revision
        && serverBaseTreeRevision(installation) !== expectedTreeRevision)) fail('current ownership, lifecycle or server base');
    const currentTree = buildInstallationBackupTree(store, installation);
    if (hash(currentTree) !== fence.expectedTreeSnapshotSha256) fail('current local snapshot');
    if (!projectionIsScopedToInstallation(store, currentTree) || !projectionIsScopedToInstallation(store, attempt.sent_tree)) fail('local entity scope');
    const unchanged = hash(currentTree) === attempt.sent_tree_sha256;
    if (!unchanged && (!assignedWorkTreeReplacementHasNoRetainedScreen(id)
      || store.siteAssetEditorDrafts?.some((draft) => draft.installationId === id))) {
      throw new Error('Close this installation and return Home, then retry Cloud Backup to recover its saved metadata acknowledgement. Your newer local work is preserved.');
    }
    assertAcceptedRepresentation(attempt, remote, expectedTreeRevision);
    const fingerprint = remoteInstallationWorkTreeFingerprint(remote);
    const conflict = installation.assigned_work_refresh_conflict;
    if (conflict && (conflict.local_base_tree_revision !== attempt.base_tree_revision
      || conflict.remote_tree_revision !== expectedTreeRevision || conflict.incoming_tree_fingerprint !== fingerprint)) fail('the recorded refresh conflict');
    if (installation.backup_conflict && installation.backup_conflict.kind !== 'NONE' && (installation.backup_conflict.kind !== 'CONFLICT'
      || installation.backup_conflict.localBaseTreeRevision !== (attempt.base_tree_revision ?? 0)
      || installation.backup_conflict.remoteTreeRevision !== expectedTreeRevision)) fail('the recorded backup conflict');

    // Resolve against the exact sent entities, never the later local membership.
    const sent = copy(attempt.sent_tree);
    const shadow: AppDataStore = { ...store, installations: [sent.installation], gridSupplies: sent.gridSupplies,
      zones: sent.zones, electricalAssets: sent.electricalAssets, siteAssets: sent.siteAssets, meterDevices: sent.meterDevices,
      measurementAssignments: sent.measurementAssignments, formSubmissions: sent.formSubmissions };
    mergeResolvedDisplayCodes(shadow, id, remote, expectedTreeRevision);
    const canonical = shadow.installations[0]!;
    const next = copy(store);
    const target = next.installations.find((item) => item.id === id)!;
    const original = attempt.sent_tree.installation;
    if (target.external_key !== original.external_key && target.external_key !== canonical.external_key) fail('local external identity');
    target.external_key = canonical.external_key;
    if (directoryFields.every((field) => exact(target[field], original[field]))) {
      for (const field of directoryFields) Object.assign(target, { [field]: canonical[field] });
    }
    const applied = new Set<string>();
    for (const [collection, type] of [['electricalAssets', 'board'], ['siteAssets', 'site_asset']] as const) {
      for (const old of attempt.sent_tree[collection]) {
        const current = next[collection].find((item) => item.id === old.id && item.audit_id === id);
        const resolved = shadow[collection].find((item) => item.id === old.id)!;
        if (current && exact(current.display_code_meta, old.display_code_meta) && current.display_code === old.display_code) {
          current.display_code_meta = copy(resolved.display_code_meta!); current.display_code = resolved.display_code;
          applied.add(`${type}:${old.id}`);
        }
      }
    }
    for (const old of attempt.sent_tree.meterDevices) {
      const current = next.meterDevices.find((item) => item.id === old.id && item.installationId === id);
      if (current && exact(current.displayName, old.displayName)) {
        current.displayName = copy(shadow.meterDevices.find((item) => item.id === old.id)!.displayName);
        applied.add(`meter:${old.id}`);
      }
    }
    target.server_tree_revision = expectedTreeRevision;
    target.assigned_work_server_metadata_base = assignedWorkServerMetadataFromRemote(
      remote.installation, assignedWorkServerMetadataFromInstallation(original),
    );
    target.assigned_work_server_tree_fingerprint = fingerprint;
    target.assigned_work_refresh_conflict = undefined;
    target.backup_conflict = undefined;
    target.server_derived = unchanged ? canonical.server_derived : undefined;
    target.resolved_display_code_changes = [
      ...(target.resolved_display_code_changes ?? []),
      ...(canonical.resolved_display_code_changes ?? []).filter((change) => applied.has(`${change.entityType}:${change.entityId}`)
        && !(target.resolved_display_code_changes ?? []).some((previous) => previous.entityType === change.entityType
          && previous.entityId === change.entityId && previous.resolvedValue === change.resolvedValue)),
    ];
    projectCanonicalCompatibility(next, id);
    // Preserve the exact accepted address digest after compatibility normalization.
    if (directoryFields.every((field) => exact(installation[field], original[field]))) {
      target.site_address_fingerprint = canonical.site_address_fingerprint;
    }
    fence.assertCurrent(); assertInstallationNotRecovering(id);
    if (!unchanged && (!assignedWorkTreeReplacementHasNoRetainedScreen(id)
      || store.siteAssetEditorDrafts?.some((draft) => draft.installationId === id))) fail('the current editor state');
    if (hash(buildInstallationBackupTree(store, installation)) !== fence.expectedTreeSnapshotSha256) fail('the final local snapshot');
    // No queue, form, answer, media, local revision or full-backup watermark is
    // taken from the sent/server tree. The caller clears the receipt atomically.
    store.installations = next.installations;
    store.electricalAssets = next.electricalAssets;
    store.siteAssets = next.siteAssets;
    store.meterDevices = next.meterDevices;
  });
}
