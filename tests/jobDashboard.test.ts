import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dashboardJobTiming,
  sortDashboardJobs,
} from '../src/domain/jobDashboard';
import type { Installation } from '../src/types';

function installation(
  id: string,
  patch: Partial<Installation> = {},
): Installation {
  return {
    id,
    client_name: 'Client',
    site_name: id,
    site_address: 'Address',
    inspector_name: 'Technician',
    audit_date: '2026-08-20',
    status: 'Draft',
    cloud_backup_enabled: false,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...patch,
  };
}

test('scheduled jobs sort by the nearest scheduled or deadline date', () => {
  const laterStartEarlyDeadline = installation('deadline-first', {
    assigned_work_job_summary: {
      actor_user_id: 'actor',
      assigned_inspector_user_id: 'actor',
      client_name: 'Client',
      site_name: 'Deadline first',
      site_address: 'Address',
      audit_date: '2026-08-20',
      inspector_name: 'Technician',
      scheduled_start_at: '2026-08-22T09:00:00.000Z',
      deadline_at: '2026-08-20T17:00:00.000Z',
      pulled_at: '2026-08-01T00:00:00.000Z',
    },
  });
  const earlierStart = installation('scheduled-first', {
    assigned_work_job_summary: {
      actor_user_id: 'actor',
      assigned_inspector_user_id: 'actor',
      client_name: 'Client',
      site_name: 'Scheduled first',
      site_address: 'Address',
      audit_date: '2026-08-21',
      inspector_name: 'Technician',
      scheduled_start_at: '2026-08-21T09:00:00.000Z',
      deadline_at: '2026-08-23T17:00:00.000Z',
      pulled_at: '2026-08-01T00:00:00.000Z',
    },
  });

  assert.deepEqual(
    sortDashboardJobs([earlierStart, laterStartEarlyDeadline]).map((item) => item.id),
    ['deadline-first', 'scheduled-first'],
  );
});

test('unscheduled work is below scheduled work and completed work is last', () => {
  const scheduled = installation('scheduled', {
    assigned_work_job_summary: {
      actor_user_id: 'actor',
      assigned_inspector_user_id: 'actor',
      client_name: 'Client',
      site_name: 'Scheduled',
      site_address: 'Address',
      audit_date: '2026-08-20',
      inspector_name: 'Technician',
      scheduled_start_at: '2026-08-20T09:00:00.000Z',
      pulled_at: '2026-08-01T00:00:00.000Z',
    },
  });
  const unscheduled = installation('unscheduled');
  const completed = installation('completed', { status: 'Completed' });

  assert.deepEqual(
    sortDashboardJobs([completed, unscheduled, scheduled]).map((item) => item.id),
    ['scheduled', 'unscheduled', 'completed'],
  );
  assert.equal(dashboardJobTiming(unscheduled).group, 'unscheduled');
});
