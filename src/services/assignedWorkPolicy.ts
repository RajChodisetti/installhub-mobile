import type { RemoteInstallationTree } from '../api/apiClient';
import type { Installation } from '../types';

function text(record: Record<string, unknown>, camel: string, snake: string): string | null {
  const value = record[camel] ?? record[snake];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeInteger(value: unknown, minimum: number): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : undefined;
}

export function mergeAssignedInstallationStatus(
  localStatus: unknown,
  remoteStatus: unknown,
): Installation['status'] {
  if (localStatus === 'Completed' || remoteStatus === 'Completed') return 'Completed';
  return 'Draft';
}

export type AssignedInstallationServerState = {
  status: Installation['status'];
  assignedInspectorUserId: string | null;
  recordVersionNumber?: number;
  completedAt?: string;
  completedFromRevision?: number;
};

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
  const status = mergeAssignedInstallationStatus(
    local.status,
    text(remote, 'status', 'status'),
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

  return {
    status,
    assignedInspectorUserId: text(
      remote,
      'assignedInspectorUserId',
      'assigned_inspector_user_id',
    ),
    ...(
      remoteStatus === 'Completed'
        && local.status === 'Draft'
        && remoteRecordVersion !== undefined
        ? { recordVersionNumber: remoteRecordVersion }
        : local.record_version_number !== undefined
          ? { recordVersionNumber: local.record_version_number }
          : {}
    ),
    ...(completedAt ? { completedAt } : {}),
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
