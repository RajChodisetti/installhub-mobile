import type { AppDataStore, Installation } from '../types';
import { searchMatch } from '../utils';
import { assignedWorkInstallationIsVisibleToActor } from '../services/assignedWorkPolicy';

export type DashboardJobGroup = 'scheduled' | 'unscheduled' | 'completed';
export type DashboardStatusFilter = 'All' | Installation['status'];

export interface DashboardEntityCounts {
  zones: number;
  boards: number;
  siteAssets: number;
  forms: number;
}

/** One local snapshot, limited to the same actor-visible cohort as the job list. */
export function localDashboardSnapshot(store: AppDataStore, actorUserId: string | null | undefined) {
  const items = store.installations
    .filter((item) => assignedWorkInstallationIsVisibleToActor(item, actorUserId))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  const countsByInstallation: Record<string, DashboardEntityCounts> = Object.create(null);
  for (const item of items) countsByInstallation[item.id] = { zones: 0, boards: 0, siteAssets: 0, forms: 0 };
  for (const zone of store.zones) {
    const counts = countsByInstallation[zone.audit_id];
    if (counts) counts.zones += 1;
  }
  for (const board of store.electricalAssets) {
    const counts = countsByInstallation[board.audit_id];
    if (counts) counts.boards += 1;
  }
  for (const asset of store.siteAssets) {
    const counts = countsByInstallation[asset.audit_id];
    if (counts) counts.siteAssets += 1;
  }
  for (const form of store.formSubmissions) {
    const counts = countsByInstallation[form.installation_id];
    if (counts) counts.forms += 1;
  }
  return { items, countsByInstallation };
}

export function filterDashboardJobs(items: Installation[], query: string, status: DashboardStatusFilter): Installation[] {
  return sortDashboardJobs(items.filter((item) => !(item.is_imported_copy && item.thumbnail_status === 'pending')
    && (status === 'All' || item.status === status)
    && dashboardJobSearchMatch(item, query)));
}

/** The assignment summary's first-observed pull time is retained across
 * unchanged refreshes, so it is the closest durable device-side assignment
 * timestamp. Keep this view separate from the normal schedule-priority order. */
export function recentAssignedJobs(
  items: Installation[],
  limit = 4,
): Installation[] {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('Recent assigned job limit must be a positive integer.');
  }
  return items
    .filter((item) => item.assigned_work_state === 'active'
      && Boolean(item.assigned_work_job_summary))
    .sort((left, right) => {
      const leftAssignedAt = timestamp(left.assigned_work_job_summary?.pulled_at)
        ?? timestamp(left.created_at)
        ?? Number.NEGATIVE_INFINITY;
      const rightAssignedAt = timestamp(right.assigned_work_job_summary?.pulled_at)
        ?? timestamp(right.created_at)
        ?? Number.NEGATIVE_INFINITY;
      return rightAssignedAt - leftAssignedAt
        || right.updated_at.localeCompare(left.updated_at)
        || left.site_name.localeCompare(right.site_name);
    })
    .slice(0, limit);
}

/** Every typed fragment may partially match a different job field, in any order. */
export function dashboardJobSearchMatch(item: Installation, query: string): boolean {
  const summary = item.assigned_work_job_summary;
  const searchable = [
    summary?.schedule_title,
    item.site_name,
    item.client_name,
    item.customer_name,
    item.site_address,
    item.site_locality,
    item.site_state,
    item.site_postcode,
    item.inspector_name,
    item.custom_job_number,
    item.fergus_job_number,
    item.quote_number,
    item.existing_device_id,
    item.service_type,
    item.metering_solution_type,
    item.external_key,
    summary?.custom_job_number,
    summary?.fergus_job_number,
    summary?.quote_number,
    summary?.existing_device_id,
    summary?.service_type,
  ].filter((value): value is string => Boolean(value?.trim())).join(' ');
  return query.trim().split(/\s+/).every((fragment) => searchMatch(searchable, fragment));
}

export type DashboardJobTiming = {
  group: DashboardJobGroup;
  scheduledStartAt?: string;
  deadlineAt?: string;
  sortTimestamp: number;
};

function timestamp(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function dashboardJobTiming(item: Installation): DashboardJobTiming {
  if (item.status === 'Completed') {
    return {
      group: 'completed',
      sortTimestamp:
        timestamp(item.completed_at)
        ?? timestamp(item.updated_at)
        ?? Number.NEGATIVE_INFINITY,
    };
  }

  const scheduledStartAt = item.assigned_work_job_summary?.scheduled_start_at;
  const deadlineAt = item.assigned_work_job_summary?.deadline_at;
  const scheduledTimestamp = timestamp(scheduledStartAt);
  const deadlineTimestamp = timestamp(deadlineAt);
  if (scheduledTimestamp !== undefined || deadlineTimestamp !== undefined) {
    return {
      group: 'scheduled',
      ...(scheduledStartAt ? { scheduledStartAt } : {}),
      ...(deadlineAt ? { deadlineAt } : {}),
      sortTimestamp: Math.min(
        scheduledTimestamp ?? Number.POSITIVE_INFINITY,
        deadlineTimestamp ?? Number.POSITIVE_INFINITY,
      ),
    };
  }

  return {
    group: 'unscheduled',
    sortTimestamp: timestamp(item.updated_at) ?? Number.NEGATIVE_INFINITY,
  };
}

const groupOrder: Record<DashboardJobGroup, number> = {
  scheduled: 0,
  unscheduled: 1,
  completed: 2,
};

export function sortDashboardJobs(items: Installation[]): Installation[] {
  return [...items].sort((left, right) => {
    const leftTiming = dashboardJobTiming(left);
    const rightTiming = dashboardJobTiming(right);
    const groupDifference = groupOrder[leftTiming.group] - groupOrder[rightTiming.group];
    if (groupDifference) return groupDifference;
    const timestampDifference = leftTiming.group === 'scheduled'
      ? leftTiming.sortTimestamp - rightTiming.sortTimestamp
      : rightTiming.sortTimestamp - leftTiming.sortTimestamp;
    if (timestampDifference) return timestampDifference;
    return left.site_name.localeCompare(right.site_name);
  });
}

export function dashboardJobGroupLabel(group: DashboardJobGroup): string {
  if (group === 'scheduled') return 'Scheduled work';
  if (group === 'unscheduled') return 'Unscheduled & local work';
  return 'Completed work';
}
