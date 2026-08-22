import type { RemoteInstallationTree } from '../api/apiClient';
import type {
  AssignedWorkRefreshConflict,
  AssignedWorkServerMetadataSnapshot,
  Installation,
} from '../types';
import type { AuditWorkSuspensionReason } from './auditWorkTrackingResume';
import { remoteInstallationWorkTreeFingerprint } from './remoteInstallationRevision';

function text(record: Record<string, unknown>, camel: string, snake: string): string | null {
  const value = record[camel] ?? record[snake];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeInteger(value: unknown, minimum: number): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= minimum ? number : undefined;
}

const has = (record: Record<string, unknown>, camel: string, snake?: string): boolean => (
  Object.prototype.hasOwnProperty.call(record, camel)
  || Boolean(snake && Object.prototype.hasOwnProperty.call(record, snake))
);

const remoteValue = (
  record: Record<string, unknown>,
  camel: string,
  snake?: string,
): unknown => (
  Object.prototype.hasOwnProperty.call(record, camel)
    ? record[camel]
    : snake
      ? record[snake]
      : undefined
);

function requiredText(
  record: Record<string, unknown>,
  camel: string,
  snake: string,
  fallback: string,
): string {
  if (!has(record, camel, snake)) return fallback;
  const value = remoteValue(record, camel, snake);
  return typeof value === 'string' ? value : fallback;
}

function nullableText(
  record: Record<string, unknown>,
  camel: string,
  snake: string,
  fallback: string | null,
): string | null {
  if (!has(record, camel, snake)) return fallback;
  const value = remoteValue(record, camel, snake);
  if (value === null) return null;
  return typeof value === 'string' ? value : fallback;
}

function nullableBoolean(
  record: Record<string, unknown>,
  camel: string,
  snake: string,
  fallback: boolean | null,
): boolean | null {
  if (!has(record, camel, snake)) return fallback;
  const value = remoteValue(record, camel, snake);
  if (value === null) return null;
  return typeof value === 'boolean' ? value : fallback;
}

function nullableNonNegativeNumber(
  record: Record<string, unknown>,
  camel: string,
  snake: string,
  fallback: number | null,
): number | null {
  if (!has(record, camel, snake)) return fallback;
  const value = remoteValue(record, camel, snake);
  if (value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}

export const ASSIGNED_WORK_SERVER_METADATA_FIELDS = [
  'client_name',
  'customer_name',
  'site_name',
  'site_address',
  'site_locality',
  'site_state',
  'site_postcode',
  'site_country_code',
  'inspector_name',
  'audit_date',
  'timezone',
  'maas',
  'service_type',
  'metering_solution_type',
  'planned_meter_type',
  'site_contact_name',
  'site_contact_phone',
  'site_contact_email',
  'fergus_job_number',
  'quote_number',
  'job_comments',
  'access_information',
  'warranty_device',
  'monitoring_installed',
  'hardware_installed',
  'solar_capacity_kw',
  'additional_monitoring_required',
  'additional_monitoring_hardware',
] as const satisfies ReadonlyArray<keyof AssignedWorkServerMetadataSnapshot>;

export function assignedWorkServerMetadataFromInstallation(
  installation: Installation,
): AssignedWorkServerMetadataSnapshot {
  return {
    client_name: installation.client_name,
    customer_name: installation.customer_name ?? null,
    site_name: installation.site_name,
    site_address: installation.site_address,
    site_locality: installation.site_locality ?? null,
    site_state: installation.site_state ?? null,
    site_postcode: installation.site_postcode ?? null,
    site_country_code: installation.site_country_code ?? null,
    inspector_name: installation.inspector_name,
    audit_date: installation.audit_date,
    timezone: installation.timezone ?? null,
    maas: installation.maas ?? null,
    service_type: installation.service_type ?? null,
    metering_solution_type: installation.metering_solution_type ?? null,
    planned_meter_type: installation.planned_meter_type ?? null,
    site_contact_name: installation.site_contact_name ?? null,
    site_contact_phone: installation.site_contact_phone ?? null,
    site_contact_email: installation.site_contact_email ?? null,
    fergus_job_number: installation.fergus_job_number ?? null,
    quote_number: installation.quote_number ?? null,
    job_comments: installation.job_comments ?? null,
    access_information: installation.access_information ?? null,
    warranty_device: installation.warranty_device ?? null,
    monitoring_installed: installation.monitoring_installed ?? null,
    hardware_installed: installation.hardware_installed ?? null,
    solar_capacity_kw: installation.solar_capacity_kw ?? null,
    additional_monitoring_required: installation.additional_monitoring_required ?? null,
    additional_monitoring_hardware: installation.additional_monitoring_hardware ?? null,
  };
}

function assignedWorkServerMetadataFromRemote(
  remote: Record<string, unknown>,
  fallback: AssignedWorkServerMetadataSnapshot,
): AssignedWorkServerMetadataSnapshot {
  return {
    client_name: requiredText(remote, 'clientName', 'client_name', fallback.client_name),
    customer_name: nullableText(remote, 'customerName', 'customer_name', fallback.customer_name),
    site_name: requiredText(remote, 'siteName', 'site_name', fallback.site_name),
    site_address: requiredText(remote, 'siteAddress', 'site_address', fallback.site_address),
    site_locality: nullableText(remote, 'siteLocality', 'site_locality', fallback.site_locality),
    site_state: nullableText(remote, 'siteState', 'site_state', fallback.site_state),
    site_postcode: nullableText(remote, 'sitePostcode', 'site_postcode', fallback.site_postcode),
    site_country_code: nullableText(
      remote,
      'siteCountryCode',
      'site_country_code',
      fallback.site_country_code,
    ),
    inspector_name: requiredText(
      remote,
      'inspectorName',
      'inspector_name',
      fallback.inspector_name,
    ),
    audit_date: requiredText(remote, 'auditDate', 'audit_date', fallback.audit_date),
    timezone: nullableText(remote, 'timezone', 'timezone', fallback.timezone),
    maas: nullableBoolean(remote, 'maas', 'maas', fallback.maas),
    service_type: nullableText(remote, 'serviceType', 'service_type', fallback.service_type),
    metering_solution_type: nullableText(
      remote,
      'meteringSolutionType',
      'metering_solution_type',
      fallback.metering_solution_type,
    ),
    planned_meter_type: nullableText(
      remote,
      'plannedMeterType',
      'planned_meter_type',
      fallback.planned_meter_type,
    ),
    site_contact_name: nullableText(
      remote,
      'siteContactName',
      'site_contact_name',
      fallback.site_contact_name,
    ),
    site_contact_phone: nullableText(
      remote,
      'siteContactPhone',
      'site_contact_phone',
      fallback.site_contact_phone,
    ),
    site_contact_email: nullableText(
      remote,
      'siteContactEmail',
      'site_contact_email',
      fallback.site_contact_email,
    ),
    fergus_job_number: nullableText(
      remote,
      'fergusJobNumber',
      'fergus_job_number',
      fallback.fergus_job_number,
    ),
    quote_number: nullableText(remote, 'quoteNumber', 'quote_number', fallback.quote_number),
    job_comments: nullableText(remote, 'jobComments', 'job_comments', fallback.job_comments),
    access_information: nullableText(
      remote,
      'accessInformation',
      'access_information',
      fallback.access_information,
    ),
    warranty_device: nullableBoolean(
      remote,
      'warrantyDevice',
      'warranty_device',
      fallback.warranty_device,
    ),
    monitoring_installed: nullableBoolean(
      remote,
      'monitoringInstalled',
      'monitoring_installed',
      fallback.monitoring_installed,
    ),
    hardware_installed: nullableBoolean(
      remote,
      'hardwareInstalled',
      'hardware_installed',
      fallback.hardware_installed,
    ),
    solar_capacity_kw: nullableNonNegativeNumber(
      remote,
      'solarCapacityKw',
      'solar_capacity_kw',
      fallback.solar_capacity_kw,
    ),
    additional_monitoring_required: nullableBoolean(
      remote,
      'additionalMonitoringRequired',
      'additional_monitoring_required',
      fallback.additional_monitoring_required,
    ),
    additional_monitoring_hardware: nullableText(
      remote,
      'additionalMonitoringHardware',
      'additional_monitoring_hardware',
      fallback.additional_monitoring_hardware,
    ),
  };
}

function sameMetadataValue(
  left: AssignedWorkServerMetadataSnapshot[keyof AssignedWorkServerMetadataSnapshot],
  right: AssignedWorkServerMetadataSnapshot[keyof AssignedWorkServerMetadataSnapshot],
): boolean {
  return Object.is(left, right);
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
  completedByUserId?: string;
  completedFromRevision?: number;
  completionNotes?: string | null;
  authoritativeReopen?: boolean;
  reopenedAt?: string;
  reopenReason?: string;
  serverTreeRevision?: number;
  pendingCompletionResolvedAsDraft?: boolean;
  metadataPatch?: Partial<AssignedWorkServerMetadataSnapshot>;
  serverMetadataBase?: AssignedWorkServerMetadataSnapshot;
  serverTreeFingerprint?: string;
  refreshConflict?: AssignedWorkRefreshConflict | null;
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
 * Reconciles server-owned lifecycle and assignment fields plus installation-root
 * metadata. Metadata uses a three-way base/local/incoming comparison; child and
 * form changes remain fenced by the canonical work-tree fingerprint.
 */
export function mergeAssignedInstallationServerState(
  local: Installation,
  tree: RemoteInstallationTree,
  detectedAt = new Date().toISOString(),
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
  const completedByUserId = remoteStatus === 'Completed'
    ? text(remote, 'completedByUserId', 'completed_by_user_id') ?? local.completed_by_user_id
    : local.completed_by_user_id;
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
  const localBaseTreeRevision = safeInteger(local.server_tree_revision, 0);
  const incomingTreeRevision = remoteTreeRevision(tree);
  const incomingTreeFingerprint = remoteInstallationWorkTreeFingerprint(tree);
  let metadataState: Pick<
    AssignedInstallationServerState,
    | 'metadataPatch'
    | 'serverMetadataBase'
    | 'serverTreeRevision'
    | 'serverTreeFingerprint'
    | 'refreshConflict'
  > = {};

  if (incomingTreeRevision !== undefined) {
    if (
      localBaseTreeRevision !== undefined
      && incomingTreeRevision < localBaseTreeRevision
    ) {
      throw new Error(
        `Assigned-work server tree revision regressed from ${localBaseTreeRevision} to ${incomingTreeRevision}.`,
      );
    }

    const current = assignedWorkServerMetadataFromInstallation(local);
    const storedBase = local.assigned_work_server_metadata_base;
    const storedTreeFingerprint = local.assigned_work_server_tree_fingerprint;

    if (localBaseTreeRevision === incomingTreeRevision) {
      const incoming = assignedWorkServerMetadataFromRemote(
        remote,
        storedBase ?? current,
      );
      if (
        storedTreeFingerprint
        && storedTreeFingerprint !== incomingTreeFingerprint
      ) {
        throw new Error('Assigned-work server tree changed without advancing its revision.');
      }
      if (
        storedBase
        && ASSIGNED_WORK_SERVER_METADATA_FIELDS.some(
          (field) => !sameMetadataValue(storedBase[field], incoming[field]),
        )
      ) {
        throw new Error('Assigned-work server metadata changed without advancing its revision.');
      }
      metadataState = {
        serverMetadataBase: storedBase ?? incoming,
        serverTreeRevision: incomingTreeRevision,
        serverTreeFingerprint: storedTreeFingerprint ?? incomingTreeFingerprint,
        refreshConflict: null,
      };
    } else if (
      localBaseTreeRevision === undefined
      || !storedBase
      || !storedTreeFingerprint
    ) {
      const base = storedBase ?? current;
      const incoming = assignedWorkServerMetadataFromRemote(remote, base);
      metadataState = {
        refreshConflict: {
          base,
          incoming,
          local_base_tree_revision: localBaseTreeRevision ?? 0,
          remote_tree_revision: incomingTreeRevision,
          conflicting_fields: [],
          remote_tree_changed: true,
          incoming_tree_fingerprint: incomingTreeFingerprint,
          detected_at: detectedAt,
        },
      };
    } else {
      const incoming = assignedWorkServerMetadataFromRemote(remote, storedBase);
      const remoteTreeChanged = storedTreeFingerprint !== incomingTreeFingerprint;
      const remoteChangedFields = ASSIGNED_WORK_SERVER_METADATA_FIELDS.filter(
        (field) => !sameMetadataValue(storedBase[field], incoming[field]),
      );
      const conflictingFields = remoteChangedFields.filter(
        (field) => (
          !sameMetadataValue(current[field], storedBase[field])
          && !sameMetadataValue(current[field], incoming[field])
        ),
      );

      if (remoteTreeChanged || conflictingFields.length) {
        metadataState = {
          refreshConflict: {
            base: storedBase,
            incoming,
            local_base_tree_revision: localBaseTreeRevision,
            remote_tree_revision: incomingTreeRevision,
            conflicting_fields: conflictingFields,
            remote_tree_changed: remoteTreeChanged,
            incoming_tree_fingerprint: incomingTreeFingerprint,
            detected_at: detectedAt,
          },
        };
      } else {
        const metadataPatch: Partial<AssignedWorkServerMetadataSnapshot> = {};
        for (const field of remoteChangedFields) {
          if (!sameMetadataValue(current[field], incoming[field])) {
            Object.assign(metadataPatch, { [field]: incoming[field] });
          }
        }
        metadataState = {
          ...(Object.keys(metadataPatch).length ? { metadataPatch } : {}),
          serverMetadataBase: incoming,
          serverTreeRevision: incomingTreeRevision,
          serverTreeFingerprint: incomingTreeFingerprint,
          refreshConflict: null,
        };
      }
    }
  }

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
    ...(completedByUserId ? { completedByUserId } : {}),
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
    ...metadataState,
  };
}

/** Applies the server side of a metadata-only conflict after explicit user acceptance. */
export function acceptAssignedWorkServerRefresh(
  installation: Installation,
): void {
  const conflict = installation.assigned_work_refresh_conflict;
  if (!conflict) throw new Error('There are no server job changes to accept.');
  if (conflict.remote_tree_changed) {
    throw new Error(
      'The server installation tree changed or cannot be proven unchanged. Keep this copy local-only or reconcile it with support.',
    );
  }
  if (installation.server_tree_revision !== conflict.local_base_tree_revision) {
    throw new Error('The local server revision changed before job details were accepted.');
  }
  for (const field of ASSIGNED_WORK_SERVER_METADATA_FIELDS) {
    if (!sameMetadataValue(conflict.base[field], conflict.incoming[field])) {
      Object.assign(installation, { [field]: conflict.incoming[field] });
    }
  }
  installation.assigned_work_server_metadata_base = conflict.incoming;
  installation.assigned_work_server_tree_fingerprint = conflict.incoming_tree_fingerprint;
  installation.server_tree_revision = conflict.remote_tree_revision;
  installation.server_derived = undefined;
  installation.assigned_work_refresh_conflict = undefined;
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
