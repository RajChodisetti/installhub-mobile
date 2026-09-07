import type { MeterHistoryRollbackResult } from '../api/meterHistoryTypes';
import type { RemoteInstallationTree } from '../api/apiClient';
import type { AppDataStore, MeterDevice } from '../types';
import { canonicalJsonStringify, projectCanonicalCompatibility } from './installationV2';
import type { InstallationBackupTree } from '../repositories/cloudSyncRepository';
import { assignedWorkServerMetadataFromInstallation } from '../services/assignedWorkPolicy';
import { remoteInstallationWorkTreeFingerprint } from '../services/remoteInstallationRevision';

export function meterHistoryRollbackUnavailable(
  tree: InstallationBackupTree,
  metadata: { forceDirty: boolean; syncedWatermark?: string },
  pendingBackup: boolean,
): string | null {
  if (tree.installation.status === 'Completed') return 'Reopen this installation before restoring a device.';
  if (!tree.installation.cloud_backup_enabled || tree.installation.server_tree_revision === undefined) {
    return 'Enable Cloud Backup and finish a backup before restoring a device.';
  }
  if (pendingBackup || tree.installation.pending_completion) return 'Finish the pending cloud confirmation before restoring a device.';
  if (metadata.forceDirty || !metadata.syncedWatermark || tree.watermark > metadata.syncedWatermark) {
    return 'Save and back up current installation changes before restoring a device.';
  }
  if ((tree.installation.backup_conflict?.kind ?? 'NONE') !== 'NONE') return 'Resolve the cloud conflict before restoring a device.';
  return null;
}

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** The API restores one device, retaining its current board, display ID and
 * assignments. Check those exact invariants before a local projection. */
export function confirmedHistoryMeter(
  raw: Record<string, unknown>, current: MeterDevice,
): MeterDevice {
  const lifecycleState = raw.lifecycleState ?? raw.lifecycle_state;
  if (raw.id !== current.id || raw.installationId !== current.installationId
    || raw.installedOnBoardId !== current.installedOnBoardId
    || !['A3RM', 'A6M', 'OTHER'].includes(String(raw.deviceModel))
    || !['WATTWATCHERS', 'OTHER'].includes(String(raw.deviceFamily))
    || typeof raw.serialNumber !== 'string' || !Array.isArray(raw.channels)
    || (lifecycleState !== undefined && lifecycleState !== null
      && !['PLANNED', 'ACTIVE', 'INACTIVE'].includes(String(lifecycleState)))
    || !object(raw.displayName)
    || canonicalJsonStringify(raw.displayName) !== canonicalJsonStringify(current.displayName)) {
    throw new Error('The confirmed restored device has an unexpected identity or switchboard context.');
  }
  const ids = new Set<string>();
  const ordinals = new Set<number>();
  for (const channel of raw.channels) {
    if (!object(channel) || typeof channel.id !== 'string' || !channel.id.trim()
      || ids.has(channel.id) || !Number.isSafeInteger(channel.ordinal) || Number(channel.ordinal) < 1
      || ordinals.has(Number(channel.ordinal))
      || !['SPARE', 'MAIN_SUPPLY', 'SUB_CIRCUIT'].includes(String(channel.purpose))) {
      throw new Error('The restored channel identities are invalid.');
    }
    ids.add(channel.id);
    ordinals.add(Number(channel.ordinal));
  }
  const restored = structuredClone(raw) as unknown as MeterDevice;
  if (restored.lifecycleState === undefined
    && (lifecycleState === 'PLANNED' || lifecycleState === 'ACTIVE' || lifecycleState === 'INACTIVE')) {
    restored.lifecycleState = lifecycleState;
  }
  return restored;
}

export function applyConfirmedMeterHistoryRollback(
  store: AppDataStore, baseline: InstallationBackupTree,
  response: MeterHistoryRollbackResult, remote: RemoteInstallationTree, currentTree: InstallationBackupTree,
): void {
  const installationId = baseline.installation.id;
  const operation = response.meterHistory;
  const installation = store.installations.find((item) => item.id === installationId);
  if (!installation || canonicalJsonStringify(currentTree) !== canonicalJsonStringify(baseline)) {
    throw new Error('The local installation changed while the device restore was in progress.');
  }
  if (response.installationId !== installationId || remote.installation.id !== installationId
    || operation.operation !== 'ROLLBACK'
    || (remote.treeRevision ?? remote.installation.treeRevision) !== operation.treeRevision
    || operation.treeRevision <= (baseline.installation.server_tree_revision ?? -1)
    || !Number.isSafeInteger(operation.recordVersionNumber)) {
    throw new Error('The cloud restore result could not be matched to its exact confirmed revision. Refresh the cloud record before retrying.');
  }
  const index = store.meterDevices.findIndex((item) => item.id === operation.meterId && item.installationId === installationId);
  const raw = remote.meterDevices?.find((item) => item.id === operation.meterId);
  if (index < 0 || !raw) throw new Error('The restored device is no longer present in this installation.');
  const meter = confirmedHistoryMeter(raw, store.meterDevices[index]!);
  const assignmentSignature = (assignments: unknown[]) => canonicalJsonStringify([...assignments].sort((a, b) => String((a as { id: string }).id).localeCompare(String((b as { id: string }).id))));
  const localAssignments = store.measurementAssignments.filter((item) => item.meterId === meter.id);
  const remoteAssignments = (remote.measurementAssignments ?? []).filter((item) => item.meterId === meter.id);
  if (assignmentSignature(localAssignments) !== assignmentSignature(remoteAssignments)) {
    throw new Error('Current channel assignments changed during restore; the local mapping was preserved.');
  }
  const channelIds = new Set(meter.channels.map((channel) => channel.id));
  if (localAssignments.some((assignment) => assignment.channelIds.some((id) => !channelIds.has(id)))) {
    throw new Error('The restored channels are incompatible with the current exact assignments.');
  }
  store.meterDevices[index] = meter;
  installation.server_tree_revision = operation.treeRevision;
  installation.record_version_number = operation.recordVersionNumber;
  installation.server_derived = undefined;
  installation.backup_conflict = { kind: 'NONE' };
  // This accepted server mutation is the new assigned-work baseline. Advance
  // its fingerprint atomically with the revision so the next pull can verify it.
  installation.assigned_work_server_metadata_base = assignedWorkServerMetadataFromInstallation(installation);
  installation.assigned_work_server_tree_fingerprint = remoteInstallationWorkTreeFingerprint(remote);
  installation.assigned_work_refresh_conflict = undefined;
  projectCanonicalCompatibility(store, installationId);
  store.cloudSync.synced_at_by_installation[installationId] = baseline.watermark;
  store.cloudSync.force_dirty_installation_ids = store.cloudSync.force_dirty_installation_ids.filter((id) => id !== installationId);
}
