import type {
  AppDataStore,
  CloudUploadQueueItem,
  ElectricalAsset,
  FormSubmission,
  GridSupply,
  Installation,
  MeasurementAssignment,
  MeterDevice,
  PendingCompleteBackupAttempt,
  SiteAsset,
  ThumbnailDownloadQueueItem,
  Zone,
} from '../types';
import { sha256 } from 'js-sha256';
import { getStore, initStore, updateStore } from '../data/seed';
import { createId, nowIso } from '../utils';
import { assignedWorkInstallationIsVisibleToActor } from '../services/assignedWorkPolicy';
import {
  assertCurrentAssignedWorkAuthority,
  captureAssignedWorkMutationAuthority,
  type AssignedWorkMutationAuthority,
} from '../services/assignedWorkMutationGuard';
import {
  nextThumbnailDownloadForActor,
  thumbnailDownloadsForActor,
  updateThumbnailDownloadForActor,
} from '../services/thumbnailWorkerPolicy';
import type { ServerResultCommitFence } from '../services/serverResultCommitFence';

export interface InstallationBackupTree {
  treeSchemaVersion: 2;
  baseTreeRevision?: number;
  installation: Installation;
  gridSupplies: GridSupply[];
  zones: Zone[];
  electricalAssets: ElectricalAsset[];
  siteAssets: SiteAsset[];
  meterDevices: MeterDevice[];
  measurementAssignments: MeasurementAssignment[];
  formSubmissions: FormSubmission[];
  watermark: string;
}

export interface BackupMediaReference {
  installation_id: string;
  entity_type: CloudUploadQueueItem['entity_type'];
  entity_id: string;
  field_name: string;
  local_uri: string;
  mime_type: string;
  /** Queue identities written by schema-v1 clients for this same evidence slot. */
  legacy_aliases?: Array<{
    entity_type: CloudUploadQueueItem['entity_type'];
    entity_id: string;
    field_name: string;
  }>;
}

function treeWatermark(store: AppDataStore, installationId: string): string {
  const timestamps = [
    store.installations.find((item) => item.id === installationId)?.updated_at,
    ...store.zones.filter((item) => item.audit_id === installationId).map((item) => item.updated_at),
    ...store.electricalAssets
      .filter((item) => item.audit_id === installationId)
      .map((item) => item.updated_at),
    ...store.siteAssets
      .filter((item) => item.audit_id === installationId)
      .map((item) => item.updated_at),
    ...store.formSubmissions
      .filter((item) => item.installation_id === installationId)
      .map((item) => item.updated_at),
  ].filter((value): value is string => Boolean(value));
  return timestamps.sort().at(-1) ?? new Date(0).toISOString();
}

function assertServerResultCommitAllowed(
  store: AppDataStore,
  installationId: string,
  fence: ServerResultCommitFence,
): Installation {
  fence.assertCurrent();
  const installation = store.installations.find((item) => item.id === installationId);
  if (
    !installation
    || installation.local_owner_user_id !== fence.actorUserId
    || (
      installation.assigned_work_state !== 'none'
      && installation.assigned_work_actor_user_id !== fence.actorUserId
    )
    || (installation.tree_revision ?? 0) !== fence.expectedLocalTreeRevision
    || treeWatermark(store, installationId) !== fence.expectedTreeWatermark
    || (
      fence.expectedServerTreeRevision !== undefined
      && installation.server_tree_revision !== fence.expectedServerTreeRevision
    )
  ) {
    throw new Error(
      'The server response no longer matches the initiating local installation snapshot.',
    );
  }
  return installation;
}

export function serverBaseTreeRevision(installation: Installation): number | undefined {
  const revision = installation.server_tree_revision;
  return Number.isSafeInteger(revision) && revision !== undefined && revision >= 0
    ? revision
    : undefined;
}

function completeAttemptMap(
  store: AppDataStore,
): Record<string, PendingCompleteBackupAttempt> {
  return store.cloudSync.pending_complete_attempts ??= {};
}

function exactCompletePayload(
  installationId: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  let exact: unknown;
  try {
    exact = JSON.parse(JSON.stringify(payload));
  } catch {
    throw new Error('Complete backup request could not be persisted exactly.');
  }
  if (!exact || typeof exact !== 'object' || Array.isArray(exact)) {
    throw new Error('Complete backup request is invalid.');
  }
  const record = exact as Record<string, unknown>;
  const installation = record.installation;
  if (
    record.treeSchemaVersion !== 2
    || record.syncStage !== 'complete'
    || !installation
    || typeof installation !== 'object'
    || Array.isArray(installation)
    || (installation as Record<string, unknown>).id !== installationId
  ) {
    throw new Error('Complete backup request identity is invalid.');
  }
  return record;
}

function assertPendingCompleteAttempt(
  installationId: string,
  attempt: PendingCompleteBackupAttempt,
): PendingCompleteBackupAttempt {
  if (
    !attempt
    || attempt.version !== 1
    || typeof attempt.id !== 'string'
    || !attempt.id
    || attempt.installation_id !== installationId
    || typeof attempt.tree_watermark !== 'string'
    || !attempt.tree_watermark
    || !Number.isSafeInteger(attempt.local_tree_revision)
    || attempt.local_tree_revision < 0
    || !['Draft', 'Completed'].includes(attempt.installation_status)
    || typeof attempt.prepared_at !== 'string'
    || !attempt.prepared_at
  ) {
    throw new Error('Pending complete backup record is invalid.');
  }
  const exactPayload = exactCompletePayload(installationId, attempt.payload);
  const payloadJson = JSON.stringify(exactPayload);
  if (
    typeof attempt.payload_sha256 !== 'string'
    || attempt.payload_sha256 !== sha256(payloadJson)
    || attempt.id !== `complete-backup:${attempt.payload_sha256}`
  ) {
    throw new Error('Pending complete backup payload integrity check failed.');
  }
  const payloadBase = exactPayload.baseTreeRevision;
  if (
    (payloadBase !== undefined
      && (!Number.isSafeInteger(payloadBase) || Number(payloadBase) < 0))
    || attempt.base_tree_revision !== (
      payloadBase === undefined ? undefined : Number(payloadBase)
    )
  ) {
    throw new Error('Pending complete backup base revision is invalid.');
  }
  if (
    attempt.accepted_tree_revision !== undefined
    && (!Number.isSafeInteger(attempt.accepted_tree_revision)
      || attempt.accepted_tree_revision < 0)
  ) {
    throw new Error('Pending complete backup revision is invalid.');
  }
  if (
    attempt.accepted_record_version_number !== undefined
    && attempt.accepted_record_version_number !== null
    && (!Number.isSafeInteger(attempt.accepted_record_version_number)
      || attempt.accepted_record_version_number < 0)
  ) {
    throw new Error('Pending complete backup record version is invalid.');
  }
  return attempt;
}

export function applyPreparedCompleteBackupAttempt(
  store: AppDataStore,
  installationId: string,
  payload: Record<string, unknown>,
  expectedTreeWatermark: string,
  installationStatus: Installation['status'],
  expectedLocalTreeRevision: number,
  attemptId?: string,
  preparedAt = nowIso(),
): PendingCompleteBackupAttempt {
  const installation = store.installations.find((item) => item.id === installationId);
  if (!installation) throw new Error('Installation not found.');
  if (!installation.cloud_backup_enabled) {
    throw new Error('Cloud backup was turned off before the final request was persisted.');
  }
  if (!expectedTreeWatermark) throw new Error('Complete backup watermark is required.');
  if (
    !Number.isSafeInteger(expectedLocalTreeRevision)
    || expectedLocalTreeRevision < 0
    || (installation.tree_revision ?? 0) !== expectedLocalTreeRevision
    || treeWatermark(store, installationId) !== expectedTreeWatermark
    || installation.status !== installationStatus
  ) {
    throw new Error('Installation changed before the complete backup attempt was persisted.');
  }
  const exactPayload = exactCompletePayload(installationId, payload);
  const payloadJson = JSON.stringify(exactPayload);
  const payloadSha256 = sha256(payloadJson);
  const exactAttemptId = `complete-backup:${payloadSha256}`;
  if (attemptId !== undefined && attemptId !== exactAttemptId) {
    throw new Error('Complete backup attempt identity does not match its exact payload.');
  }
  const attempts = completeAttemptMap(store);
  const existing = attempts[installationId];
  if (existing) {
    assertPendingCompleteAttempt(installationId, existing);
    if (
      existing.tree_watermark === expectedTreeWatermark
      && existing.installation_status === installationStatus
      && existing.local_tree_revision === expectedLocalTreeRevision
      && JSON.stringify(existing.payload) === JSON.stringify(exactPayload)
    ) {
      return existing;
    }
    throw new Error('A different complete backup confirmation is still pending.');
  }
  const attempt: PendingCompleteBackupAttempt = {
    version: 1,
    id: exactAttemptId,
    installation_id: installationId,
    payload: exactPayload,
    payload_sha256: payloadSha256,
    ...(exactPayload.baseTreeRevision === undefined
      ? {}
      : { base_tree_revision: Number(exactPayload.baseTreeRevision) }),
    local_tree_revision: expectedLocalTreeRevision,
    tree_watermark: expectedTreeWatermark,
    installation_status: installationStatus,
    prepared_at: preparedAt,
  };
  attempts[installationId] = attempt;
  return attempt;
}

export function applyAcceptedCompleteBackupAttempt(
  store: AppDataStore,
  installationId: string,
  attemptId: string,
  treeRevision: number,
  recordVersionNumber: number | null,
): void {
  if (!Number.isSafeInteger(treeRevision) || treeRevision < 0) {
    throw new Error('Server returned an invalid complete backup revision.');
  }
  if (
    recordVersionNumber !== null
    && (!Number.isSafeInteger(recordVersionNumber) || recordVersionNumber < 0)
  ) {
    throw new Error('Server returned an invalid complete backup record version.');
  }
  const attempt = completeAttemptMap(store)[installationId];
  if (!attempt || assertPendingCompleteAttempt(installationId, attempt).id !== attemptId) {
    throw new Error('Complete backup attempt changed before acceptance was recorded.');
  }
  attempt.accepted_tree_revision = treeRevision;
  attempt.accepted_record_version_number = recordVersionNumber;
}

export function buildInstallationBackupTree(
  store: AppDataStore,
  installation: Installation,
): InstallationBackupTree {
  const baseTreeRevision = serverBaseTreeRevision(installation);
  return structuredClone({
    treeSchemaVersion: 2,
    ...(baseTreeRevision !== undefined ? { baseTreeRevision } : {}),
    installation,
    gridSupplies: store.gridSupplies.filter((item) => item.installationId === installation.id),
    zones: store.zones.filter((item) => item.audit_id === installation.id),
    electricalAssets: store.electricalAssets.filter((item) => item.audit_id === installation.id),
    siteAssets: store.siteAssets.filter((item) => item.audit_id === installation.id),
    meterDevices: store.meterDevices.filter((item) => item.installationId === installation.id),
    measurementAssignments: store.measurementAssignments.filter(
      (item) => item.installationId === installation.id,
    ),
    formSubmissions: store.formSubmissions.filter(
      (item) => item.installation_id === installation.id,
    ),
    watermark: treeWatermark(store, installation.id),
  });
}

export function applyServerTreeRevision(
  store: AppDataStore,
  installationId: string,
  treeRevision: number,
): void {
  if (!Number.isSafeInteger(treeRevision) || treeRevision < 0) {
    throw new Error('Server returned an invalid tree revision.');
  }
  const installation = store.installations.find((item) => item.id === installationId);
  if (!installation) throw new Error('Installation not found.');
  const current = serverBaseTreeRevision(installation);
  if (current !== undefined && treeRevision < current) {
    throw new Error(
      `Server tree revision regressed from ${current} to ${treeRevision}.`,
    );
  }
  if (current !== treeRevision) {
    // Upload confirmation advances the server tree without returning that
    // tree. Force the next canonical pull to reseed its child/form fingerprint
    // instead of comparing the new revision against an older projection.
    installation.assigned_work_server_tree_fingerprint = undefined;
  }
  installation.server_tree_revision = treeRevision;
}

export async function recordInstallationServerTreeRevision(
  installationId: string,
  treeRevision: number,
  commitFence?: ServerResultCommitFence,
): Promise<void> {
  commitFence?.assertCurrent();
  await updateStore((store) => {
    if (commitFence) {
      assertServerResultCommitAllowed(store, installationId, commitFence);
    }
    applyServerTreeRevision(store, installationId, treeRevision);
  });
}

export async function listInstallationsNeedingBackup(
  actorUserId: string,
): Promise<InstallationBackupTree[]> {
  await initStore();
  const store = getStore();
  const forced = new Set(store.cloudSync.force_dirty_installation_ids);
  const pendingComplete = new Set(Object.keys(store.cloudSync.pending_complete_attempts ?? {}));
  return store.installations
    .filter((installation) => (
      installationAllowsNewBackupDispatch(installation, actorUserId)
    ))
    .map((installation) => buildInstallationBackupTree(store, installation))
    .filter((tree) => {
      const syncedAt = store.cloudSync.synced_at_by_installation[tree.installation.id];
      return pendingComplete.has(tree.installation.id)
        || forced.has(tree.installation.id)
        || !syncedAt
        || tree.watermark > syncedAt;
    });
}

export class InstallationBackupDispatchBlockedError extends Error {
  readonly code = 'INSTALLATION_BACKUP_DISPATCH_BLOCKED';
}

export function installationAllowsNewBackupDispatch(
  installation: Pick<
    Installation,
    | 'cloud_backup_enabled'
    | 'assigned_work_state'
    | 'assigned_work_actor_user_id'
    | 'local_owner_user_id'
    | 'assigned_work_refresh_conflict'
  >,
  actorUserId: string,
): boolean {
  return installation.cloud_backup_enabled
    && !installation.assigned_work_refresh_conflict
    && assignedWorkInstallationIsVisibleToActor(installation, actorUserId);
}

export function installationAllowsBackupRecovery(
  installation: Pick<
    Installation,
    'assigned_work_state' | 'assigned_work_actor_user_id' | 'local_owner_user_id'
  >,
  actorUserId: string,
): boolean {
  return installation.local_owner_user_id === actorUserId
    && (
      installation.assigned_work_state === 'none'
      || installation.assigned_work_actor_user_id === actorUserId
    );
}

export function assertInstallationAllowsNewBackupDispatch(
  installationId: string,
  actorUserId: string,
): void {
  const installation = getStore().installations.find(
    (item) => item.id === installationId,
  );
  if (
    !installation
    || !installationAllowsNewBackupDispatch(installation, actorUserId)
  ) {
    throw new InstallationBackupDispatchBlockedError(
      'Cloud Backup dispatch stopped because this installation is no longer active.',
    );
  }
}

export function assertInstallationAllowsBackupRecovery(
  installationId: string,
  actorUserId: string,
): void {
  const installation = getStore().installations.find(
    (item) => item.id === installationId,
  );
  if (
    !installation
    || !installationAllowsBackupRecovery(installation, actorUserId)
  ) {
    throw new InstallationBackupDispatchBlockedError(
      'Cloud Backup recovery stopped because this installation belongs to another actor.',
    );
  }
}

export async function getPendingCompleteBackupAttempt(
  installationId: string,
): Promise<PendingCompleteBackupAttempt | null> {
  await initStore();
  const attempt = getStore().cloudSync.pending_complete_attempts?.[installationId];
  return attempt ? assertPendingCompleteAttempt(installationId, attempt) : null;
}

export async function listPendingCompleteBackupAttempts(): Promise<PendingCompleteBackupAttempt[]> {
  await initStore();
  return Object.entries(getStore().cloudSync.pending_complete_attempts ?? {})
    .map(([installationId, attempt]) => assertPendingCompleteAttempt(installationId, attempt))
    .sort((left, right) => left.prepared_at.localeCompare(right.prepared_at));
}

export async function prepareCompleteBackupAttempt(
  installationId: string,
  actorUserId: string,
  payload: Record<string, unknown>,
  expectedTreeWatermark: string,
  installationStatus: Installation['status'],
  expectedLocalTreeRevision: number,
  commitFence: ServerResultCommitFence,
): Promise<PendingCompleteBackupAttempt> {
  let result: PendingCompleteBackupAttempt | null = null;
  commitFence.assertCurrent();
  await updateStore((store) => {
    result = applyPreparedCompleteBackupAttemptForSnapshot(
      store,
      installationId,
      actorUserId,
      payload,
      expectedTreeWatermark,
      installationStatus,
      expectedLocalTreeRevision,
      commitFence,
    );
  });
  return result!;
}

export function applyPreparedCompleteBackupAttemptForSnapshot(
  store: AppDataStore,
  installationId: string,
  actorUserId: string,
  payload: Record<string, unknown>,
  expectedTreeWatermark: string,
  installationStatus: Installation['status'],
  expectedLocalTreeRevision: number,
  commitFence: ServerResultCommitFence,
): PendingCompleteBackupAttempt {
  const installation = assertServerResultCommitAllowed(
    store,
    installationId,
    commitFence,
  );
  if (
    commitFence.actorUserId !== actorUserId
    || !installationAllowsNewBackupDispatch(installation, actorUserId)
  ) {
    throw new InstallationBackupDispatchBlockedError(
      'Cloud Backup dispatch stopped because this installation is no longer active.',
    );
  }
  return applyPreparedCompleteBackupAttempt(
    store,
    installationId,
    payload,
    expectedTreeWatermark,
    installationStatus,
    expectedLocalTreeRevision,
  );
}

export async function recordAcceptedCompleteBackupAttempt(
  installationId: string,
  attemptId: string,
  treeRevision: number,
  recordVersionNumber: number | null,
  assertCurrent?: () => void,
): Promise<void> {
  assertCurrent?.();
  await updateStore((store) => {
    assertCurrent?.();
    applyAcceptedCompleteBackupAttempt(
      store,
      installationId,
      attemptId,
      treeRevision,
      recordVersionNumber,
    );
  });
}

export async function getInstallationBackupTree(
  installationId: string,
): Promise<InstallationBackupTree | null> {
  await initStore();
  const store = getStore();
  const installation = store.installations.find((item) => item.id === installationId);
  return installation ? buildInstallationBackupTree(store, installation) : null;
}

export async function markInstallationDirty(installationId: string): Promise<void> {
  await updateStore((store) => {
    if (!store.cloudSync.force_dirty_installation_ids.includes(installationId)) {
      store.cloudSync.force_dirty_installation_ids.push(installationId);
    }
  });
}

export async function markInstallationBackedUp(
  installationId: string,
  watermark: string,
): Promise<void> {
  await updateStore((store) => {
    const hasProvisionalCode = [
      ...store.electricalAssets
        .filter((item) => item.audit_id === installationId)
        .map((item) => item.display_code_meta),
      ...store.siteAssets
        .filter((item) => item.audit_id === installationId)
        .map((item) => item.display_code_meta),
      ...store.meterDevices
        .filter((item) => item.installationId === installationId)
        .map((item) => item.displayName),
    ].some((display) => display?.provisional);
    if (hasProvisionalCode) {
      throw new Error('Canonical display-code reconciliation is required before backup can finish.');
    }
    store.cloudSync.synced_at_by_installation[installationId] = watermark;
    store.cloudSync.force_dirty_installation_ids =
      store.cloudSync.force_dirty_installation_ids.filter((id) => id !== installationId);
    const installation = store.installations.find((item) => item.id === installationId);
    if (installation) installation.backup_conflict = { kind: 'NONE' };
  });
}

export async function finishCompleteBackupAttempt(
  installationId: string,
  attemptId: string,
  assertCurrent?: () => void,
): Promise<void> {
  assertCurrent?.();
  await updateStore((store) => {
    assertCurrent?.();
    const attempt = completeAttemptMap(store)[installationId];
    if (!attempt || assertPendingCompleteAttempt(installationId, attempt).id !== attemptId) {
      throw new Error('Complete backup attempt changed before confirmation finished.');
    }
    const installation = store.installations.find((item) => item.id === installationId);
    if (
      !installation
      || (installation.tree_revision ?? 0) !== attempt.local_tree_revision
      || treeWatermark(store, installationId) !== attempt.tree_watermark
      || installation.status !== attempt.installation_status
    ) {
      throw new Error('Installation changed before complete backup confirmation finished.');
    }
    const hasProvisionalCode = [
      ...store.electricalAssets
        .filter((item) => item.audit_id === installationId)
        .map((item) => item.display_code_meta),
      ...store.siteAssets
        .filter((item) => item.audit_id === installationId)
        .map((item) => item.display_code_meta),
      ...store.meterDevices
        .filter((item) => item.installationId === installationId)
        .map((item) => item.displayName),
    ].some((display) => display?.provisional);
    if (hasProvisionalCode) {
      throw new Error('Canonical display-code reconciliation is required before backup can finish.');
    }
    store.cloudSync.synced_at_by_installation[installationId] = attempt.tree_watermark;
    store.cloudSync.force_dirty_installation_ids =
      store.cloudSync.force_dirty_installation_ids.filter((id) => id !== installationId);
    if (installation) installation.backup_conflict = { kind: 'NONE' };
    delete completeAttemptMap(store)[installationId];
  });
}

export async function discardCompleteBackupAttempt(
  installationId: string,
  attemptId: string,
  assertCurrent?: () => void,
): Promise<void> {
  assertCurrent?.();
  await updateStore((store) => {
    assertCurrent?.();
    applyDiscardCompleteBackupAttempt(store, installationId, attemptId);
  });
}

export function applyDiscardCompleteBackupAttempt(
  store: AppDataStore,
  installationId: string,
  attemptId: string,
): boolean {
  const attempt = completeAttemptMap(store)[installationId];
  if (attempt?.id !== attemptId) return false;
  store.cloudSync.conflicted_complete_attempts ??= {};
  store.cloudSync.conflicted_complete_attempts[installationId] = {
    ...attempt,
    conflicted_at: nowIso(),
  };
  delete completeAttemptMap(store)[installationId];
  return true;
}

export async function markInstallationBackupConflict(
  installationId: string,
  remoteTreeRevision?: number,
  assertCurrent?: () => void,
): Promise<void> {
  assertCurrent?.();
  await updateStore((store) => {
    assertCurrent?.();
    applyInstallationBackupConflict(store, installationId, remoteTreeRevision, nowIso());
  });
}

export function applyInstallationBackupConflict(
  store: AppDataStore,
  installationId: string,
  remoteTreeRevision?: number,
  detectedAt = nowIso(),
): void {
  const installation = store.installations.find((item) => item.id === installationId);
  if (!installation) return;
  installation.backup_conflict = {
    kind: 'CONFLICT',
    localBaseTreeRevision: serverBaseTreeRevision(installation) ?? 0,
    remoteTreeRevision,
    detectedAt,
  };
  if (!store.cloudSync.force_dirty_installation_ids.includes(installationId)) {
    store.cloudSync.force_dirty_installation_ids.push(installationId);
  }
}

export async function getInstallationSyncMetadata(
  installationId: string,
): Promise<{ forceDirty: boolean; syncedWatermark?: string; serverTreeRevision?: number }> {
  await initStore();
  const sync = getStore().cloudSync;
  const installation = getStore().installations.find((item) => item.id === installationId);
  return {
    forceDirty: sync.force_dirty_installation_ids.includes(installationId),
    syncedWatermark: sync.synced_at_by_installation[installationId],
    ...(installation && serverBaseTreeRevision(installation) !== undefined
      ? { serverTreeRevision: serverBaseTreeRevision(installation) }
      : {}),
  };
}

function queueIdentity(reference: BackupMediaReference): string {
  return [
    reference.installation_id,
    reference.entity_type,
    reference.entity_id,
    reference.field_name,
    reference.local_uri,
  ].join('|');
}

function queueStatusRank(status: CloudUploadQueueItem['status']): number {
  if (status === 'cleared') return 4;
  if (status === 'uploading') return 3;
  if (status === 'pending') return 2;
  return 1;
}

/**
 * Rebuilds one installation's queue from the media identities that are still
 * referenced by its current local tree. Exact matches keep their upload state;
 * removed/replaced files (including failed and cleared rows) are discarded.
 */
export function reconciledBackupMediaQueue(
  queue: CloudUploadQueueItem[],
  installationId: string,
  references: BackupMediaReference[],
  createQueueId: () => string = () => createId('upload'),
  updatedAt: string = nowIso(),
): CloudUploadQueueItem[] {
  if (references.some((reference) => reference.installation_id !== installationId)) {
    throw new Error('Backup media reference belongs to another installation.');
  }

  const desired = new Map<string, BackupMediaReference>();
  const desiredIdentityByAlias = new Map<string, string>();
  for (const reference of references) {
    const identity = queueIdentity(reference);
    desired.set(identity, reference);
    for (const alias of reference.legacy_aliases ?? []) {
      desiredIdentityByAlias.set(queueIdentity({
        ...reference,
        ...alias,
      }), identity);
    }
  }

  const bestCurrent = new Map<string, CloudUploadQueueItem>();
  for (const item of queue) {
    if (item.installation_id !== installationId) continue;
    const rawIdentity = queueIdentity(item);
    const identity = desired.has(rawIdentity)
      ? rawIdentity
      : desiredIdentityByAlias.get(rawIdentity);
    if (!identity) continue;
    const current = bestCurrent.get(identity);
    if (!current || queueStatusRank(item.status) > queueStatusRank(current.status)) {
      bestCurrent.set(identity, item);
    }
  }

  const reconciled = queue.filter((item) => item.installation_id !== installationId);
  for (const [identity, reference] of desired) {
    const { legacy_aliases: _legacyAliases, ...persistedReference } = reference;
    const current = bestCurrent.get(identity);
    reconciled.push(
      current ? {
        ...current,
        ...persistedReference,
      } : {
        ...persistedReference,
        id: createQueueId(),
        status: 'pending',
        attempts: 0,
        updated_at: updatedAt,
      },
    );
  }
  return reconciled;
}

export async function reconcileBackupMediaQueue(
  installationId: string,
  references: BackupMediaReference[],
  commitFence: ServerResultCommitFence,
): Promise<void> {
  commitFence.assertCurrent();
  await initStore();
  await updateStore((store) => {
    applyReconciledBackupMediaQueueForSnapshot(
      store,
      installationId,
      references,
      commitFence,
    );
  });
}

export function applyReconciledBackupMediaQueueForSnapshot(
  store: AppDataStore,
  installationId: string,
  references: BackupMediaReference[],
  commitFence: ServerResultCommitFence,
): void {
  assertServerResultCommitAllowed(store, installationId, commitFence);
  store.cloudSync.upload_queue = reconciledBackupMediaQueue(
    store.cloudSync.upload_queue,
    installationId,
    references,
  );
}

export async function enqueueBackupMedia(references: BackupMediaReference[]): Promise<void> {
  if (!references.length) return;
  await initStore();
  const queued = new Set(getStore().cloudSync.upload_queue.map((item) => queueIdentity(item)));
  if (references.every((reference) => queued.has(queueIdentity(reference)))) return;
  await updateStore((store) => {
    const existing = new Set(store.cloudSync.upload_queue.map((item) => queueIdentity(item)));
    for (const reference of references) {
      const identity = queueIdentity(reference);
      if (existing.has(identity)) continue;
      store.cloudSync.upload_queue.push({
        ...reference,
        id: createId('upload'),
        status: 'pending',
        attempts: 0,
        updated_at: nowIso(),
      });
      existing.add(identity);
    }
  });
}

export async function listUploadQueue(
  installationId?: string,
  actorUserId?: string,
): Promise<CloudUploadQueueItem[]> {
  await initStore();
  const ownedInstallationIds = actorUserId
    ? new Set(getStore().installations
        .filter((item) => item.local_owner_user_id === actorUserId)
        .map((item) => item.id))
    : null;
  return getStore().cloudSync.upload_queue.filter(
    (item) => (
      (!installationId || item.installation_id === installationId)
      && (!ownedInstallationIds || ownedInstallationIds.has(item.installation_id))
    ),
  );
}

export async function getNextUpload(
  installationId: string,
): Promise<CloudUploadQueueItem | null> {
  await initStore();
  return getStore().cloudSync.upload_queue.find(
    (item) =>
      item.installation_id === installationId &&
      (item.status === 'pending' || (item.status === 'failed' && item.attempts < 5)),
  ) ?? null;
}

export async function updateUploadQueueItem(
  id: string,
  patch: Partial<CloudUploadQueueItem>,
  assertCurrent?: () => void,
): Promise<void> {
  assertCurrent?.();
  await updateStore((store) => {
    assertCurrent?.();
    const index = store.cloudSync.upload_queue.findIndex((item) => item.id === id);
    if (index < 0) return;
    store.cloudSync.upload_queue[index] = {
      ...store.cloudSync.upload_queue[index],
      ...patch,
      id,
      updated_at: nowIso(),
    };
  });
}

export async function resetInterruptedUploads(actorUserId: string): Promise<void> {
  const authority = captureAssignedWorkMutationAuthority();
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  await initStore();
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  const ownedIds = new Set(getStore().installations
    .filter((item) => item.local_owner_user_id === actorUserId)
    .map((item) => item.id));
  if (!getStore().cloudSync.upload_queue.some(
    (item) => ownedIds.has(item.installation_id) && item.status === 'uploading',
  )) return;
  await updateStore((store) => {
    assertCurrentAssignedWorkAuthority(authority, actorUserId);
    const currentOwnedIds = new Set(store.installations
      .filter((item) => item.local_owner_user_id === actorUserId)
      .map((item) => item.id));
    for (const item of store.cloudSync.upload_queue) {
      if (currentOwnedIds.has(item.installation_id) && item.status === 'uploading') {
        item.status = 'pending';
        item.updated_at = nowIso();
      }
    }
  });
}

export async function resetFailedUploadsForRetry(actorUserId: string): Promise<void> {
  const authority = captureAssignedWorkMutationAuthority();
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  await initStore();
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  const ownedIds = new Set(getStore().installations
    .filter((item) => item.local_owner_user_id === actorUserId)
    .map((item) => item.id));
  if (!getStore().cloudSync.upload_queue.some(
    (item) => ownedIds.has(item.installation_id) && item.status === 'failed',
  )) return;
  await updateStore((store) => {
    assertCurrentAssignedWorkAuthority(authority, actorUserId);
    const currentOwnedIds = new Set(store.installations
      .filter((item) => item.local_owner_user_id === actorUserId)
      .map((item) => item.id));
    for (const item of store.cloudSync.upload_queue) {
      if (currentOwnedIds.has(item.installation_id) && item.status === 'failed') {
        item.status = 'pending';
        item.attempts = 0;
        item.last_error = undefined;
        item.updated_at = nowIso();
      }
    }
  });
}

export async function getCloudBackupStats(actorUserId: string): Promise<{
  pending: number;
  uploading: number;
  failed: number;
  backedUp: number;
}> {
  const authority = captureAssignedWorkMutationAuthority();
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  await initStore();
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  const store = getStore();
  const ownedIds = new Set(store.installations
    .filter((item) => item.local_owner_user_id === actorUserId)
    .map((item) => item.id));
  const items = store.cloudSync.upload_queue.filter(
    (item) => ownedIds.has(item.installation_id),
  );
  return {
    pending: items.filter((item) => item.status === 'pending').length,
    uploading: items.filter((item) => item.status === 'uploading').length,
    failed: items.filter((item) => item.status === 'failed').length,
    backedUp: items.filter((item) => item.status === 'cleared').length,
  };
}

export async function enqueueThumbnailDownloads(
  installationId: string,
  remoteUris: string[],
  actorUserId: string,
  authority: AssignedWorkMutationAuthority,
): Promise<void> {
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  const unique = [...new Set(remoteUris)];
  if (!unique.length) return;
  await updateStore((store) => {
    assertCurrentAssignedWorkAuthority(authority, actorUserId);
    const installation = store.installations.find(
      (item) => item.id === installationId
        && assignedWorkInstallationIsVisibleToActor(item, actorUserId),
    );
    if (!installation) {
      throw new Error('The imported installation is no longer owned by this account.');
    }
    const existing = new Set(store.cloudSync.thumbnail_queue.map(
      (item) => `${item.installation_id}|${item.remote_uri}`,
    ));
    for (const remoteUri of unique) {
      if (existing.has(`${installationId}|${remoteUri}`)) continue;
      store.cloudSync.thumbnail_queue.push({
        id: createId('thumb'),
        installation_id: installationId,
        remote_uri: remoteUri,
        status: 'pending',
        attempts: 0,
        updated_at: nowIso(),
      });
    }
  });
}

export async function getNextThumbnailDownload(
  actorUserId: string,
  authority: AssignedWorkMutationAuthority,
): Promise<ThumbnailDownloadQueueItem | null> {
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  await initStore();
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  const job = nextThumbnailDownloadForActor(getStore(), actorUserId);
  return job ? { ...job } : null;
}

export async function updateThumbnailDownload(
  id: string,
  patch: Partial<ThumbnailDownloadQueueItem>,
  actorUserId: string,
  authority: AssignedWorkMutationAuthority,
): Promise<boolean> {
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  let updated = false;
  await updateStore((store) => {
    assertCurrentAssignedWorkAuthority(authority, actorUserId);
    updated = updateThumbnailDownloadForActor(
      store,
      id,
      actorUserId,
      patch,
      nowIso(),
    );
  });
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  return updated;
}

export function cachedThumbnailUri(remoteUri: string): string | undefined {
  const item = getStore().cloudSync.thumbnail_queue.find(
    (job) => job.remote_uri === remoteUri && job.status === 'ready',
  );
  return item?.local_uri;
}

export async function listThumbnailDownloads(
  actorUserId: string,
  authority: AssignedWorkMutationAuthority,
): Promise<ThumbnailDownloadQueueItem[]> {
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  await initStore();
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  return thumbnailDownloadsForActor(getStore(), actorUserId).map((job) => ({ ...job }));
}
