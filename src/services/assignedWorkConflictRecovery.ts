import type { RemoteInstallationTree } from '../api/apiClient';
import type { AuthenticatedCloudActionLease } from './authenticatedCloudAction';
import { captureConflictRecoveryBaseline, assertConflictRecoveryBaseline, conflictRecoveryHash, conflictRecoverySnapshot, type ConflictRecoveryBaseline } from './assignedWorkConflictRecoveryState';
import { acquireInstallationRecovery } from './installationRecoveryFence';
import { createId } from '../utils';

export interface ConflictRecoveryReview {
  operationId: string;
  baseline: ConflictRecoveryBaseline;
  lease: AuthenticatedCloudActionLease;
  serverTreeSha256: string;
  serverTreeRevision: number;
  localLabel: string;
  serverLabel: string;
  localCounts: string;
  serverCounts: string;
}

function reviewedServerTree(tree: RemoteInstallationTree | undefined, id: string, actor: string) {
  if (!tree || tree.installation.id !== id || tree.treeSchemaVersion !== 2) {
    throw new Error('A canonical server installation is required for recovery.');
  }
  const item = tree.installation;
  const creator = item.createdByUserId ?? item.created_by_user_id;
  const assignee = item.assignedInspectorUserId ?? item.assigned_inspector_user_id;
  if (creator !== actor && assignee !== actor) throw new Error('This server job is no longer owned by or assigned to this account.');
  if (item.status !== 'Draft') throw new Error('The server record is no longer Draft. Review its completion or assignment first.');
  const revision = Number(tree.treeRevision ?? item.treeRevision ?? item.tree_revision);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('The server revision is unavailable.');
  return { tree, revision, hash: conflictRecoveryHash(tree) };
}

export async function prepareAssignedWorkConflictRecovery(id: string): Promise<ConflictRecoveryReview> {
  const [{ initStore, getStore }, { apiClient }, { captureAuthenticatedCloudActionLease }] = await Promise.all([
    import('../data/seed'), import('../api/apiClient'), import('./authenticatedCloudAction'),
  ]);
  const lease = await captureAuthenticatedCloudActionLease();
  await initStore(); lease.assertCurrent();
  const baseline = captureConflictRecoveryBaseline(getStore(), id, lease.actorUserId);
  const response = await apiClient.pull('1970-01-01T00:00:00.000Z', id, lease.cloudAuthority);
  lease.assertCurrent(); assertConflictRecoveryBaseline(getStore(), baseline);
  const server = reviewedServerTree(response.installations[0], id, lease.actorUserId);
  const { validateCanonicalRemoteTreeIds } = await import('./remoteInstallationValidation');
  validateCanonicalRemoteTreeIds(server.tree); lease.assertCurrent();
  const local = conflictRecoverySnapshot(getStore(), id);
  return {
    operationId: createId('conflict_recovery'), baseline, lease,
    serverTreeSha256: server.hash, serverTreeRevision: server.revision,
    localLabel: local.installation!.site_name,
    serverLabel: String(server.tree.installation.siteName ?? server.tree.installation.site_name ?? ''),
    localCounts: `${local.zones.length} zones, ${local.electricalAssets.length} boards, ${local.siteAssets.length} assets, ${local.meterDevices.length} meters, ${local.formSubmissions.length} forms; ${local.cloudSync.upload_queue.filter((row) => row.status !== 'cleared').length} unsent evidence items`,
    serverCounts: `${server.tree.zones.length} zones, ${server.tree.electricalAssets.length} boards, ${server.tree.siteAssets.length} assets, ${(server.tree.meterDevices ?? []).length} meters, ${server.tree.formSubmissions.length} forms`,
  };
}

/** Explicit confirmation only. No server write, merge, file deletion or time replay occurs here. */
export async function confirmAssignedWorkConflictRecovery(review: ConflictRecoveryReview): Promise<string> {
  const [{ getStore }, { apiClient }, { cloudBackupIsRunning }, tracking, { getActiveTimeOutboxStore }, { importRemoteInstallationAsCopy }] = await Promise.all([
    import('../data/seed'), import('../api/apiClient'), import('./syncService'),
    import('./auditWorkTrackingBridge'), import('./activeTimeOutbox'), import('../repositories/remoteInstallationsRepository'),
  ]);
  review.lease.assertCurrent();
  const id = review.baseline.installationId;
  if (review.baseline.actorUserId !== review.lease.actorUserId) throw new Error('Recovery account changed.');
  const done = (getStore().assignedWorkRecoveryCheckouts ?? []).find((item) => (
    item.id === review.operationId && item.actor_user_id === review.lease.actorUserId
    && item.reconciliation?.localSnapshotSha256 === review.baseline.snapshotSha256
    && item.reconciliation.serverTreeSha256 === review.serverTreeSha256
  ));
  if (done) return done.id;
  const lock = acquireInstallationRecovery(id);
  const resumeAuthority = { actorUserId: review.lease.actorUserId, isCurrent: () => {
    try { review.lease.assertCurrent(); return true; } catch { return false; }
  } };
  let suspension: Awaited<ReturnType<typeof tracking.suspendAuditWorkForInstallation>> = null;
  try {
    if (cloudBackupIsRunning()) throw new Error('Wait for Cloud Backup to finish, then review recovery again.');
    assertConflictRecoveryBaseline(getStore(), review.baseline);
    suspension = await tracking.suspendAuditWorkForInstallation(id, resumeAuthority, 'other');
    if (!suspension) throw new Error('Work tracking is unavailable. Reopen the app before recovering.');
    review.lease.assertCurrent(); lock.assertCurrent();
    const response = await apiClient.pull('1970-01-01T00:00:00.000Z', id, review.lease.cloudAuthority);
    review.lease.assertCurrent(); lock.assertCurrent();
    const server = reviewedServerTree(response.installations[0], id, review.lease.actorUserId);
    if (server.hash !== review.serverTreeSha256 || server.revision !== review.serverTreeRevision) {
      throw new Error('The server version changed after review. Review both versions and confirm again.');
    }
    const outbox = await getActiveTimeOutboxStore();
    const time = await outbox.read();
    review.lease.assertCurrent(); lock.assertCurrent();
    const proof = {
      operationId: review.operationId, localSnapshotSha256: review.baseline.snapshotSha256,
      serverTreeSha256: review.serverTreeSha256, serverTreeRevision: review.serverTreeRevision,
      activeTimeSessions: time.sessions.filter((session) => session.actorUserId === review.lease.actorUserId && session.installationId === id).map((session) => ({ ...session })),
    };
    await importRemoteInstallationAsCopy(id, {
      tree: server.tree, assignedActorUserId: review.lease.actorUserId,
      assignedWorkAuthority: review.lease.processAuthority,
      cloudAuthority: review.lease.cloudAuthority, pulledAt: response.pulledAt,
      conflictRecovery: { baseline: review.baseline, proof, assertLease: () => { review.lease.assertCurrent(); lock.assertCurrent(); } },
    });
    review.lease.assertCurrent();
    return review.operationId;
  } finally {
    lock.release();
    if (suspension) await tracking.resumeAuditWorkForInstallation(suspension, resumeAuthority).catch(() => false);
  }
}
