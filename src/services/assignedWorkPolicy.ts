import type { RemoteInstallationTree } from '../api/apiClient';
import type { Installation } from '../types';
import type { AuditWorkSuspensionReason } from './auditWorkTrackingResume';

function text(record: Record<string, unknown>, camel: string, snake: string): string | null {
  const value = record[camel] ?? record[snake];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeInteger(value: unknown, minimum: number): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : undefined;
}

function remoteTreeRevision(tree: RemoteInstallationTree): number | undefined {
  return safeInteger(
    tree.treeRevision
      ?? tree.installation.treeRevision
      ?? tree.installation.tree_revision,
    0,
  );
}

function remoteDraftSupersedesPendingCompletion(
  local: Installation,
  tree: RemoteInstallationTree,
): boolean {
  const pending = local.pending_completion;
  const revision = remoteTreeRevision(tree);
  return local.status === 'Draft'
    && Boolean(pending)
    && text(tree.installation, 'status', 'status') === 'Draft'
    && revision !== undefined
    && revision > Math.max(
      pending?.baseTreeRevision ?? -1,
      local.server_tree_revision ?? -1,
    );
}

export function mergeAssignedInstallationStatus(
  localStatus: unknown,
  remoteStatus: unknown,
  authoritativeReopen = false,
): Installation['status'] {
  if (authoritativeReopen && remoteStatus === 'Draft') return 'Draft';
  if (localStatus === 'Completed' || remoteStatus === 'Completed') return 'Completed';
  return 'Draft';
}

export function remoteTreeIsAuthoritativeReopen(
  local: Installation,
  tree: RemoteInstallationTree,
): boolean {
  const remote = tree.installation;
  const remoteStatus = text(remote, 'status', 'status');
  const reopenedAt = text(remote, 'reopenedAt', 'reopened_at');
  const reopenReason = text(remote, 'reopenReason', 'reopen_reason');
  const remoteRevision = remoteTreeRevision(tree);
  const remoteRecordVersion = safeInteger(
    tree.recordVersionNumber
      ?? remote.recordVersionNumber
      ?? remote.record_version_number,
    1,
  );
  if (
    remoteStatus !== 'Draft'
    || !reopenedAt
    || !reopenReason
    || remoteRevision === undefined
  ) return false;
  if (local.status === 'Completed') {
    return local.legacy_completed_unpinned !== true
      && Number.isSafeInteger(local.record_version_number)
      && remoteRevision > (local.server_tree_revision ?? -1);
  }
  return remoteRecordVersion !== undefined
    && remoteDraftSupersedesPendingCompletion(local, tree);
}

export function assignedWorkTrackingShouldResumeAfterPull(
  installation: Pick<Installation, 'status' | 'assigned_work_state'> | undefined,
): boolean {
  return installation?.status === 'Draft'
    && installation.assigned_work_state !== 'inactive';
}

export function assignedWorkInstallationIsVisibleToActor(
  installation: Pick<
    Installation,
    'assigned_work_state' | 'assigned_work_actor_user_id' | 'local_owner_user_id'
  >,
  actorUserId: string | null | undefined,
): boolean {
  if (
    !actorUserId
    || !installation.local_owner_user_id
    || installation.local_owner_user_id !== actorUserId
  ) return false;
  if (installation.assigned_work_state === 'inactive') return false;
  if (installation.assigned_work_state === 'none') return true;
  return installation.assigned_work_actor_user_id === actorUserId;
}

export function activeAssignedWorkCheckoutIds(
  installations: Array<Pick<
    Installation,
    'id' | 'status' | 'assigned_work_state' | 'assigned_work_actor_user_id' | 'local_owner_user_id'
  >>,
  actorUserId?: string,
): string[] {
  return installations.flatMap((installation) => (
    installation.status === 'Draft'
      && installation.assigned_work_state === 'active'
      && (
        actorUserId === undefined
        || (
          installation.local_owner_user_id === actorUserId
          && installation.assigned_work_actor_user_id === actorUserId
        )
      )
      ? [installation.id]
      : []
  ));
}

export function assignedWorkCheckoutBelongsToDifferentActor(
  installation: Pick<
    Installation,
    'assigned_work_state' | 'assigned_work_actor_user_id' | 'local_owner_user_id'
  >,
  actorUserId: string,
): boolean {
  const localOwner = installation.local_owner_user_id
    ?? installation.assigned_work_actor_user_id;
  return Boolean(localOwner && localOwner !== actorUserId)
    || (
      installation.assigned_work_state === 'active'
      && installation.assigned_work_actor_user_id !== actorUserId
    );
}

export function importedCopiesForActor<
  T extends Pick<
    Installation,
    'import_source_server_id' | 'local_owner_user_id'
  >,
>(installations: T[], serverInstallationId: string, actorUserId: string): T[] {
  return installations.filter((installation) => (
    installation.import_source_server_id === serverInstallationId
    && installation.local_owner_user_id === actorUserId
  ));
}

export function crossActorAssignedCheckoutConflictIds(
  installations: Array<Pick<
    Installation,
    'id' | 'assigned_work_state' | 'assigned_work_actor_user_id' | 'local_owner_user_id'
  >>,
  actorUserId: string,
  candidateServerIds: Iterable<string>,
): string[] {
  const candidates = new Set(candidateServerIds);
  return installations.flatMap((installation) => (
    candidates.has(installation.id)
    && assignedWorkCheckoutBelongsToDifferentActor(installation, actorUserId)
      ? [installation.id]
      : []
  ));
}

export class CrossActorAssignedCheckoutConflictError extends Error {
  readonly code = 'CROSS_ACTOR_ASSIGNED_CHECKOUT_CONFLICT';

  constructor(readonly installationIds: string[]) {
    super(
      'Assigned work is blocked because this device retains unsent work for another account. '
      + 'That account must reconcile or remove its local checkout before this assignment can be opened.',
    );
    this.name = 'CrossActorAssignedCheckoutConflictError';
  }
}

export type AssignedInstallationServerState = {
  status: Installation['status'];
  assignedInspectorUserId: string | null;
  recordVersionNumber?: number;
  completedAt?: string;
  completedFromRevision?: number;
  completionNotes?: string | null;
  authoritativeReopen?: boolean;
  reopenedAt?: string;
  reopenReason?: string;
  serverTreeRevision?: number;
  pendingCompletionResolvedAsDraft?: boolean;
};

export function assignedWorkSuspensionReasonsResolvedAfterPull(
  previous: Installation,
  current: Installation,
  serverState: AssignedInstallationServerState,
): AuditWorkSuspensionReason[] {
  if (
    current.status !== 'Draft'
    || current.assigned_work_state === 'inactive'
  ) return [];
  const reasons = new Set<AuditWorkSuspensionReason>();
  if (previous.assigned_work_state === 'inactive') {
    reasons.add('assignment-sync');
  }
  if (
    serverState.authoritativeReopen
    || serverState.pendingCompletionResolvedAsDraft
  ) {
    reasons.add('completion');
    reasons.add('assignment-sync');
  }
  return [...reasons];
}

/**
 * Applies only the local completion-attempt disposition proven by an assigned
 * pull. Returns true when a newer plain Draft must remain dirty and surface a
 * CAS conflict instead of adopting the remote tree as a clean base.
 */
export function applyAssignedDraftLifecycleResolution(
  local: Installation,
  serverState: AssignedInstallationServerState,
  detectedAt: string,
): boolean {
  if (serverState.authoritativeReopen) {
    local.reopened_at = serverState.reopenedAt;
    local.reopen_reason = serverState.reopenReason;
    local.pending_completion = undefined;
    local.completion_notes = null;
    local.server_tree_revision = serverState.serverTreeRevision;
    return false;
  }
  if (!serverState.pendingCompletionResolvedAsDraft) return false;
  const pendingCompletion = local.pending_completion;
  local.pending_completion = undefined;
  local.backup_conflict = {
    kind: 'CONFLICT',
    localBaseTreeRevision:
      pendingCompletion?.baseTreeRevision
      ?? local.server_tree_revision
      ?? 0,
    remoteTreeRevision: serverState.serverTreeRevision,
    detectedAt,
  };
  return true;
}

/**
 * Selects only lifecycle and assignment fields owned by the server. Editable
 * installation/tree fields and local dirty markers are intentionally absent,
 * so a pull can lock a completed record without erasing offline work.
 */
export function mergeAssignedInstallationServerState(
  local: Installation,
  tree: RemoteInstallationTree,
): AssignedInstallationServerState {
  const remote = tree.installation;
  const authoritativeReopen = remoteTreeIsAuthoritativeReopen(local, tree);
  const pendingCompletionResolvedAsDraft =
    remoteDraftSupersedesPendingCompletion(local, tree);
  const status = mergeAssignedInstallationStatus(
    local.status,
    text(remote, 'status', 'status'),
    authoritativeReopen,
  );
  const remoteStatus = text(remote, 'status', 'status');
  const remoteRecordVersion = safeInteger(
    tree.recordVersionNumber
      ?? remote.recordVersionNumber
      ?? remote.record_version_number,
    1,
  );
  const completedAt = remoteStatus === 'Completed'
    ? text(remote, 'completedAt', 'completed_at') ?? local.completed_at
    : local.completed_at;
  const remoteCompletedFromRevision = remoteStatus === 'Completed'
    ? safeInteger(
        remote.completedFromRevision ?? remote.completed_from_revision,
        0,
      )
    : undefined;
  const remoteHasCompletionNotes = remoteStatus === 'Completed' && (
    Object.prototype.hasOwnProperty.call(remote, 'completionNotes')
    || Object.prototype.hasOwnProperty.call(remote, 'completion_notes')
  );
  const reopenedAt = authoritativeReopen
    ? text(remote, 'reopenedAt', 'reopened_at')
    : null;
  const reopenReason = authoritativeReopen
    ? text(remote, 'reopenReason', 'reopen_reason')
    : null;
  const resolvedDraftTreeRevision = (
    authoritativeReopen || pendingCompletionResolvedAsDraft
  )
    ? remoteTreeRevision(tree)
    : undefined;

  return {
    status,
    assignedInspectorUserId: text(
      remote,
      'assignedInspectorUserId',
      'assigned_inspector_user_id',
    ),
    ...(
      authoritativeReopen && remoteRecordVersion !== undefined
        ? { recordVersionNumber: remoteRecordVersion }
        : remoteStatus === 'Completed'
        && local.status === 'Draft'
        && remoteRecordVersion !== undefined
        ? { recordVersionNumber: remoteRecordVersion }
        : local.record_version_number !== undefined
          ? { recordVersionNumber: local.record_version_number }
          : {}
    ),
    ...(completedAt ? { completedAt } : {}),
    ...(remoteHasCompletionNotes
      ? { completionNotes: text(remote, 'completionNotes', 'completion_notes') }
      : authoritativeReopen
        ? { completionNotes: null }
      : {}),
    ...(authoritativeReopen && reopenedAt && reopenReason
      ? {
          authoritativeReopen: true,
          reopenedAt,
          reopenReason,
          ...(resolvedDraftTreeRevision !== undefined
            ? { serverTreeRevision: resolvedDraftTreeRevision }
            : {}),
        }
      : {}),
    ...(pendingCompletionResolvedAsDraft
      ? {
          pendingCompletionResolvedAsDraft: true,
          ...(resolvedDraftTreeRevision !== undefined
            ? { serverTreeRevision: resolvedDraftTreeRevision }
            : {}),
        }
      : {}),
    ...(
      (remoteCompletedFromRevision ?? local.completed_from_revision) !== undefined
        ? {
            completedFromRevision:
              remoteCompletedFromRevision ?? local.completed_from_revision,
          }
        : {}
    ),
  };
}

export type AssignedInstallationPullPlan = {
  trees: RemoteInstallationTree[];
  activeAssignedIds: string[];
  inactiveAssignedIds: string[];
};

export function materializedRecordId(
  preserveServerIdentity: boolean,
  remoteId: string,
  createLocalId: () => string,
): string {
  if (!remoteId.trim()) throw new Error('Remote record identity is required.');
  return preserveServerIdentity ? remoteId : createLocalId();
}

export function planAssignedInstallationPull(
  actorUserId: string,
  trees: RemoteInstallationTree[],
  previouslyActiveIds: string[],
): AssignedInstallationPullPlan {
  const eligible = trees.filter(({ installation }) => {
    const id = text(installation, 'id', 'id');
    const status = text(installation, 'status', 'status');
    const owner = text(installation, 'createdByUserId', 'created_by_user_id');
    const assignee = text(
      installation,
      'assignedInspectorUserId',
      'assigned_inspector_user_id',
    );
    return id !== null
      && (status === 'Draft' || status === 'Completed')
      && (owner === actorUserId || assignee === actorUserId);
  });
  const activeAssignedIds = eligible.flatMap(({ installation }) => {
    const id = text(installation, 'id', 'id');
    const owner = text(installation, 'createdByUserId', 'created_by_user_id');
    const assignee = text(
      installation,
      'assignedInspectorUserId',
      'assigned_inspector_user_id',
    );
    return id && assignee === actorUserId && owner !== actorUserId ? [id] : [];
  });
  const active = new Set(activeAssignedIds);
  return {
    trees: eligible,
    activeAssignedIds,
    inactiveAssignedIds: previouslyActiveIds.filter((id) => !active.has(id)),
  };
}
