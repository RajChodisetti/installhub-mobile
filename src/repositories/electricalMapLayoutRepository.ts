import { apiClient, type RemoteInstallationTree } from '../api/apiClient';
import { updateStore } from '../data/seed';
import { electricalMapNodeIds, validateElectricalMapLayout, type ElectricalMapLayoutDocument, type SavedElectricalMapLayout, type SaveElectricalMapLayoutResult } from '../domain/electricalMapLayout';
import { captureAuthenticatedCloudActionLease, type AuthenticatedCloudActionLease } from '../services/authenticatedCloudAction';
import { runLeasedCloudActionStep } from '../services/cloudActionLease';
import { assertAssignedWorkMutationAllowed } from '../services/assignedWorkMutationGuard';
import { applyServerResultCommitFence } from '../services/serverResultCommitFence';
import { assignedWorkServerMetadataFromInstallation } from '../services/assignedWorkPolicy';
import { remoteInstallationWorkTreeFingerprint } from '../services/remoteInstallationRevision';
import { pinnedMappingCanonicalJson } from '../services/pinnedInstallationMapping';
import { validRecordVersionNumber } from '../services/reportVersioning';
import { isInstallationTreeBackedUpCurrent } from '../services/installationPackTarget';
import { buildInstallationBackupTree, getInstallationBackupTree, getInstallationSyncMetadata, getPendingCompleteBackupAttempt, type InstallationBackupTree } from './cloudSyncRepository';

export interface ElectricalMapLayoutSession {
  baseline: InstallationBackupTree;
  lease: AuthenticatedCloudActionLease;
  assertViewCurrent: () => void;
  nodeIds: string[];
  baseTreeRevision: number;
  baseLayoutRevision: number;
  savedLayout?: SavedElectricalMapLayout;
}
export interface ElectricalMapLayoutAttempt {
  session: ElectricalMapLayoutSession;
  layout: ElectricalMapLayoutDocument;
  dispatched: boolean;
  confirmedResult?: SaveElectricalMapLayoutResult;
}

function assertCurrent(session: ElectricalMapLayoutSession): void { session.lease.assertCurrent(); session.assertViewCurrent(); }
function exactLayout(left: unknown, right: ElectricalMapLayoutDocument): boolean {
  try { return pinnedMappingCanonicalJson(validateElectricalMapLayout(left)) === pinnedMappingCanonicalJson(right); } catch { return false; }
}

export async function loadElectricalMapLayout(installationId: string, nodeIds: string[], assertViewCurrent: () => void): Promise<ElectricalMapLayoutSession> {
  const lease = await captureAuthenticatedCloudActionLease();
  const local = await runLeasedCloudActionStep(lease, () => getInstallationBackupTree(installationId));
  assertViewCurrent();
  if (!local || local.installation.is_imported_copy || local.installation.server_tree_revision === undefined) throw new Error('A saved cloud installation is required to load or save its electrical arrangement.');
  assertAssignedWorkMutationAllowed(local.installation, lease.processAuthority);
  const baseline = structuredClone(local);
  const pin = baseline.installation.status === 'Completed' ? validRecordVersionNumber(baseline.installation.record_version_number) : undefined;
  if (baseline.installation.status === 'Completed' && pin === undefined) throw new Error('The completed electrical map has no pinned cloud version.');
  const view = await runLeasedCloudActionStep(lease, () => apiClient.getInstallationElectricalMap(installationId, pin, lease.cloudAuthority));
  assertViewCurrent();
  if (view.installationId !== installationId || view.treeRevision !== baseline.installation.server_tree_revision
    || (pin !== undefined && view.recordVersionNumber !== pin)) throw new Error('The saved electrical map belongs to a different cloud revision. Refresh the installation first.');
  const cloudNodeIds = electricalMapNodeIds(view);
  if (cloudNodeIds.size !== nodeIds.length || nodeIds.some((id) => !cloudNodeIds.has(id))) throw new Error('The local and cloud electrical symbols differ. Save and back up the installation, then reload its arrangement.');
  let baseLayoutRevision = view.mapLayout?.layoutRevision ?? 0;
  if (baseline.installation.status === 'Draft') {
    // GET omits mapLayout when an older saved layout no longer matches the node set.
    // Pull still carries its revision, which must be used instead of resetting CAS to 0.
    const pull = await runLeasedCloudActionStep(lease, () => apiClient.pull('1970-01-01T00:00:00.000Z', installationId, lease.cloudAuthority));
    const remote = pull.installations.find((tree) => tree.installation.id === installationId);
    if (!remote || (remote.treeRevision ?? remote.installation.treeRevision) !== view.treeRevision || remote.installation.status !== 'Draft') throw new Error('The installation changed while loading its saved arrangement. Retry after refreshing.');
    baseLayoutRevision = Number(remote.installation.electricalMapLayoutRevision ?? 0);
  }
  if (!Number.isSafeInteger(baseLayoutRevision) || baseLayoutRevision < 0 || (view.mapLayout && view.mapLayout.layoutRevision !== baseLayoutRevision)) throw new Error('The saved layout revision could not be verified.');
  const savedLayout = view.mapLayout ? { ...validateElectricalMapLayout(view.mapLayout, nodeIds), layoutRevision: baseLayoutRevision, updatedAt: view.mapLayout.updatedAt } : undefined;
  lease.assertCurrent(); assertViewCurrent();
  return { baseline, lease, assertViewCurrent, nodeIds: [...nodeIds], baseTreeRevision: view.treeRevision, baseLayoutRevision, savedLayout };
}

export async function prepareElectricalMapLayoutAttempt(session: ElectricalMapLayoutSession, layout: ElectricalMapLayoutDocument): Promise<ElectricalMapLayoutAttempt> {
  assertCurrent(session);
  const metadata = await runLeasedCloudActionStep(session.lease, () => getInstallationSyncMetadata(session.baseline.installation.id));
  const pending = await runLeasedCloudActionStep(session.lease, () => getPendingCompleteBackupAttempt(session.baseline.installation.id));
  const installation = session.baseline.installation;
  if (installation.status !== 'Draft' || !isInstallationTreeBackedUpCurrent(session.baseline, metadata)
    || pending || installation.pending_completion || installation.backup_conflict?.kind === 'CONFLICT'
    || installation.assigned_work_refresh_conflict) throw new Error('Save and back up current work, or resolve its cloud conflict, before saving the arrangement.');
  assertCurrent(session);
  return { session, layout: validateElectricalMapLayout(layout, session.nodeIds), dispatched: false };
}

function recoveredLayoutResult(attempt: ElectricalMapLayoutAttempt, remote: RemoteInstallationTree): SaveElectricalMapLayoutResult | null {
  const { session, layout } = attempt;
  const revision = remote.treeRevision ?? remote.installation.treeRevision;
  const layoutRevision = remote.installation.electricalMapLayoutRevision;
  if (remote.installation.id !== session.baseline.installation.id || remote.installation.status !== 'Draft'
    || revision !== session.baseTreeRevision + 1 || layoutRevision !== session.baseLayoutRevision + 1
    || !exactLayout(remote.installation.electricalMapLayout, layout)) return null;
  return { installationId: session.baseline.installation.id, treeRevision: Number(revision), mapLayout: {
    ...layout, layoutRevision: Number(layoutRevision),
    ...(typeof remote.installation.electricalMapLayoutUpdatedAt === 'string' ? { updatedAt: remote.installation.electricalMapLayoutUpdatedAt } : {}),
  } };
}

/** The original payload/CAS survives retries. An accepted or equivalently recovered
 * result only finishes its local receipt; it never sends another layout mutation. */
export async function executeElectricalMapLayoutAttempt(attempt: ElectricalMapLayoutAttempt): Promise<SaveElectricalMapLayoutResult> {
  const { session } = attempt;
  const { baseline, lease } = session;
  const id = baseline.installation.id;
  const fence = { actorUserId: lease.actorUserId, assertCurrent: () => assertCurrent(session),
    expectedLocalTreeRevision: baseline.installation.tree_revision ?? 0, expectedTreeWatermark: baseline.watermark, expectedServerTreeRevision: session.baseTreeRevision };
  const checkLocal = async () => runLeasedCloudActionStep(lease, () => updateStore((store) => applyServerResultCommitFence(store, id, fence, (installation) => {
    assertAssignedWorkMutationAllowed(installation, lease.processAuthority);
    if (pinnedMappingCanonicalJson(buildInstallationBackupTree(store, installation)) !== pinnedMappingCanonicalJson(baseline)
      || store.cloudSync.force_dirty_installation_ids.includes(id) || store.cloudSync.synced_at_by_installation[id] !== baseline.watermark || store.cloudSync.pending_complete_attempts?.[id]
      || store.cloudSync.pending_metadata_attempts?.[id] || store.cloudSync.conflicted_metadata_attempts?.[id]) throw new Error('The local installation changed. Its saved work was preserved; discard this arrangement and reload before trying again.');
  })));
  const pullRemote = async () => {
    const result = await runLeasedCloudActionStep(lease, () => apiClient.pull('1970-01-01T00:00:00.000Z', id, lease.cloudAuthority));
    assertCurrent(session);
    const remote = result.installations.find((tree) => tree.installation.id === id);
    if (!remote) throw new Error('The saved cloud arrangement could not be reloaded. Retry to finish confirmation.');
    return remote;
  };
  await checkLocal();
  if (attempt.dispatched && !attempt.confirmedResult) {
    const remote = await pullRemote();
    attempt.confirmedResult = recoveredLayoutResult(attempt, remote) ?? undefined;
    if (!attempt.confirmedResult && (remote.treeRevision ?? remote.installation.treeRevision) !== session.baseTreeRevision) throw new Error('The cloud installation changed after the save attempt. The pending arrangement is retained; discard and reload to resolve the revision conflict.');
  }
  if (!attempt.confirmedResult) {
    attempt.dispatched = true;
    attempt.confirmedResult = await runLeasedCloudActionStep(lease, () => apiClient.saveInstallationElectricalMapLayout(id, {
      baseTreeRevision: session.baseTreeRevision, baseLayoutRevision: session.baseLayoutRevision, layout: attempt.layout,
    }, lease.cloudAuthority));
  }
  const result = attempt.confirmedResult;
  if (result.installationId !== id || !exactLayout(result.mapLayout, attempt.layout)
    || ![session.baseTreeRevision, session.baseTreeRevision + 1].includes(result.treeRevision)
    || result.mapLayout.layoutRevision !== session.baseLayoutRevision + (result.treeRevision - session.baseTreeRevision)) throw new Error('The save response did not match the requested layout and revisions.');
  const remote = await pullRemote();
  if (remote.installation.status !== 'Draft' || (remote.treeRevision ?? remote.installation.treeRevision) !== result.treeRevision
    || remote.installation.electricalMapLayoutRevision !== result.mapLayout.layoutRevision || !exactLayout(remote.installation.electricalMapLayout, attempt.layout)) throw new Error('The confirmed saved arrangement changed before it could be applied. Local work and pending positions were preserved.');
  await runLeasedCloudActionStep(lease, () => updateStore((store) => applyServerResultCommitFence(store, id, fence, (installation) => {
    assertAssignedWorkMutationAllowed(installation, lease.processAuthority);
    if (pinnedMappingCanonicalJson(buildInstallationBackupTree(store, installation)) !== pinnedMappingCanonicalJson(baseline)
      || store.cloudSync.force_dirty_installation_ids.includes(id) || store.cloudSync.synced_at_by_installation[id] !== baseline.watermark || store.cloudSync.pending_complete_attempts?.[id]
      || store.cloudSync.pending_metadata_attempts?.[id] || store.cloudSync.conflicted_metadata_attempts?.[id]) throw new Error('Local work changed while saving the arrangement; it was preserved.');
    const hadConfirmedPair = installation.last_synced_local_tree_revision === installation.tree_revision
      && installation.last_synced_server_tree_revision === installation.server_tree_revision;
    installation.server_tree_revision = result.treeRevision;
    installation.tree_revision = Math.max(installation.tree_revision ?? 0, result.treeRevision) + 1;
    if (hadConfirmedPair) {
      installation.last_synced_local_tree_revision = installation.tree_revision;
      installation.last_synced_server_tree_revision = result.treeRevision;
    }
    installation.server_derived = remote.serverDerived ? { treeRevision: result.treeRevision,
      recordVersionNumber: installation.record_version_number, virtualMeterDefinitions: remote.serverDerived.virtualMeterDefinitions } : installation.server_derived
      ? { ...installation.server_derived, treeRevision: result.treeRevision } : undefined;
    installation.assigned_work_server_metadata_base = assignedWorkServerMetadataFromInstallation(installation);
    installation.assigned_work_server_tree_fingerprint = remoteInstallationWorkTreeFingerprint(remote);
    store.cloudSync.synced_at_by_installation[id] = buildInstallationBackupTree(store, installation).watermark;
  })));
  return result;
}
