import { apiClient } from '../api/apiClient';
import type { MeterHistoryRollbackInput, MeterHistoryRollbackResult } from '../api/meterHistoryTypes';
import { updateStore } from '../data/seed';
import { applyConfirmedMeterHistoryRollback, meterHistoryRollbackUnavailable } from '../domain/meterHistory';
import { captureAuthenticatedCloudActionLease, type AuthenticatedCloudActionLease } from '../services/authenticatedCloudAction';
import { runLeasedCloudActionStep } from '../services/cloudActionLease';
import { assertAssignedWorkMutationAllowed } from '../services/assignedWorkMutationGuard';
import { applyServerResultCommitFence } from '../services/serverResultCommitFence';
import {
  buildInstallationBackupTree, getInstallationBackupTree, getInstallationSyncMetadata,
  getPendingCompleteBackupAttempt, type InstallationBackupTree,
} from './cloudSyncRepository';

export interface MeterRestoreAttempt {
  installationId: string; meterId: string; input: MeterHistoryRollbackInput;
  baseline: InstallationBackupTree; lease: AuthenticatedCloudActionLease;
  confirmedResult?: MeterHistoryRollbackResult;
}

export async function prepareMeterRestoreAttempt(
  installationId: string, meterId: string,
  targetRecordVersionNumber: number, reason: string, idempotencyKey: string,
): Promise<MeterRestoreAttempt> {
  const lease = await captureAuthenticatedCloudActionLease();
  const baseline = await runLeasedCloudActionStep(lease, () => getInstallationBackupTree(installationId));
  if (!baseline) throw new Error('Installation no longer available.');
  assertAssignedWorkMutationAllowed(baseline.installation, lease.processAuthority);
  const metadata = await runLeasedCloudActionStep(lease, () => getInstallationSyncMetadata(installationId));
  const pending = await runLeasedCloudActionStep(lease, () => getPendingCompleteBackupAttempt(installationId));
  const unavailable = meterHistoryRollbackUnavailable(baseline, metadata, Boolean(pending));
  if (unavailable) throw new Error(unavailable);
  if (!baseline.meterDevices.some((meter) => meter.id === meterId)) throw new Error('Device not found.');
  if (!Number.isSafeInteger(targetRecordVersionNumber) || targetRecordVersionNumber < 1) throw new Error('Choose an immutable device version.');
  if (reason.trim().length < 3 || reason.trim().length > 1000) throw new Error('Enter a reason between 3 and 1,000 characters.');
  return { installationId, meterId, baseline, lease, input: {
    targetRecordVersionNumber, baseTreeRevision: baseline.installation.server_tree_revision!,
    reason: reason.trim(), idempotencyKey,
  } };
}

/** Reuses the exact request after ambiguous network failure. Once accepted,
 * retries only pull/apply the confirmed revision and never send another restore. */
export async function executeMeterRestoreAttempt(attempt: MeterRestoreAttempt): Promise<MeterHistoryRollbackResult> {
  const { lease, baseline, installationId, meterId } = attempt;
  const fence = {
    actorUserId: lease.actorUserId, assertCurrent: lease.assertCurrent,
    expectedLocalTreeRevision: baseline.installation.tree_revision ?? 0,
    expectedTreeWatermark: baseline.watermark,
    expectedServerTreeRevision: baseline.installation.server_tree_revision,
  };
  // Revalidate inside the serialized store queue immediately before dispatch.
  await runLeasedCloudActionStep(lease, () => updateStore((store) => {
    applyServerResultCommitFence(store, installationId, fence, (installation) => {
      if (store.cloudSync.pending_metadata_attempts?.[installationId] || store.cloudSync.conflicted_metadata_attempts?.[installationId]) {
        throw new Error('Resolve the metadata backup confirmation before restoring a meter.');
      }
      assertAssignedWorkMutationAllowed(installation, lease.processAuthority);
      const current = buildInstallationBackupTree(store, installation);
      if (JSON.stringify(current) !== JSON.stringify(baseline)) throw new Error('The local installation changed. Save and back up before restoring a device.');
    });
  }));
  if (!attempt.confirmedResult) {
    attempt.confirmedResult = await runLeasedCloudActionStep(lease, () => apiClient.rollbackMeterHistory(
      installationId, meterId, attempt.input, lease.cloudAuthority,
    ));
  }
  const result = attempt.confirmedResult;
  const response = await runLeasedCloudActionStep(lease, () => apiClient.pull(
    '1970-01-01T00:00:00.000Z', installationId, lease.cloudAuthority,
  ));
  const remote = response.installations.find((tree) => tree.installation.id === installationId);
  if (!remote) throw new Error('The restored cloud installation could not be reloaded. Retry to finish applying the confirmed restore.');
  await runLeasedCloudActionStep(lease, () => updateStore((store) => {
    applyServerResultCommitFence(store, installationId, fence, (installation) => {
      assertAssignedWorkMutationAllowed(installation, lease.processAuthority);
      if (result.meterHistory.meterId !== meterId || result.meterHistory.restoredFromRecordVersionNumber !== attempt.input.targetRecordVersionNumber) {
        throw new Error('The cloud returned a restore for another device or version.');
      }
      applyConfirmedMeterHistoryRollback(store, baseline, result, remote, buildInstallationBackupTree(store, installation));
    });
  }));
  return result;
}
