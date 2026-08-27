import { sha256 } from 'js-sha256';
import type {
  AssignedWorkJobSummarySnapshot,
  AssignedWorkPrestartAcknowledgement,
  Installation,
} from '../types';

export type AssignedWorkJobSummaryInput = Omit<
  AssignedWorkJobSummarySnapshot,
  'pulled_at'
>;

export function createAssignedWorkJobSummarySnapshot(
  input: AssignedWorkJobSummaryInput,
  pulledAt: string,
): AssignedWorkJobSummarySnapshot {
  if (!input.actor_user_id || !input.assigned_inspector_user_id) {
    throw new Error('Assigned job summary actor and assignee are required.');
  }
  return { ...input, pulled_at: pulledAt };
}

export function assignedWorkSummarySha256(
  summary: AssignedWorkJobSummarySnapshot,
): string {
  return sha256(JSON.stringify({
    actorUserId: summary.actor_user_id,
    assignedInspectorUserId: summary.assigned_inspector_user_id,
    clientName: summary.client_name,
    customerName: summary.customer_name ?? '',
    siteName: summary.site_name,
    siteAddress: summary.site_address,
    siteLocality: summary.site_locality ?? '',
    siteState: summary.site_state ?? '',
    sitePostcode: summary.site_postcode ?? '',
    auditDate: summary.audit_date,
    technicianName: summary.inspector_name,
    maas: summary.maas ?? null,
    serviceType: summary.service_type ?? '',
    meteringSolutionType: summary.metering_solution_type ?? '',
    plannedMeterType: summary.planned_meter_type ?? '',
    customJobNumber: summary.custom_job_number ?? '',
    siteContactName: summary.site_contact_name ?? '',
    siteContactPhone: summary.site_contact_phone ?? '',
    siteContactEmail: summary.site_contact_email ?? '',
    fergusJobNumber: summary.fergus_job_number ?? '',
    quoteNumber: summary.quote_number ?? '',
    jobComments: summary.job_comments ?? '',
    accessInformation: summary.access_information ?? '',
  }));
}

export function isAssignedDraftForActor(
  installation: Installation,
  actorUserId: string | null | undefined,
): boolean {
  return Boolean(
    actorUserId
    && installation.status === 'Draft'
    && installation.assigned_work_state === 'active'
    && installation.assigned_work_actor_user_id === actorUserId,
  );
}

export function assignedWorkPrestartIsRequired(
  installation: Installation,
): boolean {
  return installation.status === 'Draft'
    && installation.assigned_work_state === 'active';
}

export function assignedWorkPrestartIsAcknowledged(
  installation: Installation,
  actorUserId: string | null | undefined,
): boolean {
  if (!isAssignedDraftForActor(installation, actorUserId)) return false;
  const summary = installation.assigned_work_job_summary;
  const acknowledgement = installation.assigned_work_prestart_acknowledgement;
  return Boolean(
    summary
    && acknowledgement
    && summary.actor_user_id === actorUserId
    && summary.assigned_inspector_user_id === actorUserId
    && acknowledgement.actor_user_id === actorUserId
    && acknowledgement.assigned_job_summary_sha256
      === assignedWorkSummarySha256(summary),
  );
}

export function assignedWorkPrestartActionIsLocked(
  installation: Installation,
  actorUserId: string | null | undefined,
): boolean {
  return assignedWorkPrestartIsRequired(installation)
    && !assignedWorkPrestartIsAcknowledged(installation, actorUserId);
}

export function createAssignedWorkPrestartAcknowledgement(
  installation: Installation,
  actorUserId: string,
  acknowledgedAt: string,
): AssignedWorkPrestartAcknowledgement {
  if (!isAssignedDraftForActor(installation, actorUserId)) {
    throw new Error('Only the currently assigned technician can acknowledge this Draft job.');
  }
  const summary = installation.assigned_work_job_summary;
  if (
    !summary
    || summary.actor_user_id !== actorUserId
    || summary.assigned_inspector_user_id !== actorUserId
  ) {
    throw new Error('Refresh assigned work before acknowledging its job summary.');
  }
  return {
    actor_user_id: actorUserId,
    assigned_job_summary_sha256: assignedWorkSummarySha256(summary),
    acknowledged_at: acknowledgedAt,
  };
}

/**
 * Keeps an acknowledgement only while the assigned Draft lifecycle and pulled
 * scheduler summary remain the same. Canonical tree/CAS revisions are ignored.
 */
export function reconcileAssignedWorkPrestartAcknowledgement(
  previous: Installation,
  next: Installation,
): AssignedWorkPrestartAcknowledgement | undefined {
  const acknowledgement = previous.assigned_work_prestart_acknowledgement;
  if (!acknowledgement) return undefined;
  if (previous.status === 'Completed' && next.status === 'Draft') return undefined;
  if (next.reopened_at && next.reopened_at !== previous.reopened_at) return undefined;
  const candidate = {
    ...next,
    assigned_work_prestart_acknowledgement: acknowledgement,
  };
  return assignedWorkPrestartIsAcknowledged(
    candidate,
    candidate.assigned_work_actor_user_id,
  )
    ? acknowledgement
    : undefined;
}

export function installationAllowsActiveWorkTracking(
  installation: Installation,
  actorUserId: string | null | undefined,
): boolean {
  if (
    installation.status !== 'Draft'
    || installation.assigned_work_state === 'inactive'
    || installation.pending_completion
  ) {
    return false;
  }
  if (installation.assigned_work_state === 'active') {
    return assignedWorkPrestartIsAcknowledged(installation, actorUserId);
  }
  return true;
}
