import type { Installation } from '../types';

export type DashboardJobGroup = 'scheduled' | 'unscheduled' | 'completed';

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
