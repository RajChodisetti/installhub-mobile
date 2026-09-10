import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dashboardJobTiming,
  filterDashboardJobs,
  localDashboardSnapshot,
  recentAssignedJobs,
  sortDashboardJobs,
} from '../src/domain/jobDashboard';
import type { AppDataStore, Installation } from '../src/types';

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

test('status and installer search combine while only pending local copies remain hidden', () => {
  const draft = installation('draft', { inspector_name: 'Casey Installer' });
  const completed = installation('completed', { status: 'Completed', inspector_name: 'Casey Installer' });
  const other = installation('other', { inspector_name: 'Someone Else' });
  const pendingCopy = installation('pending-copy', {
    inspector_name: 'Casey Installer',
    thumbnail_status: 'pending',
    is_imported_copy: true,
  });
  const pendingAssigned = installation('pending-assigned', {
    inspector_name: 'Casey Installer',
    thumbnail_status: 'pending',
    assigned_work_state: 'active',
  });
  const items = [draft, completed, other, pendingCopy, pendingAssigned];
  assert.deepEqual(filterDashboardJobs(items, '  CASEY ', 'All').map((item) => item.id), ['draft', 'pending-assigned', 'completed']);
  assert.deepEqual(filterDashboardJobs(items, 'Casey', 'Draft').map((item) => item.id), ['draft', 'pending-assigned']);
  assert.deepEqual(filterDashboardJobs(items, 'Casey', 'Completed').map((item) => item.id), ['completed']);
  assert.deepEqual(filterDashboardJobs(items, 'not found', 'Completed'), []);
  assert.equal(items.length, 5);
});

test('recent jobs returns only the four newest active assignments', () => {
  const assigned = Array.from({ length: 6 }, (_, index) => installation(`assigned-${index}`, {
    assigned_work_state: 'active',
    assigned_work_job_summary: {
      actor_user_id: 'actor', assigned_inspector_user_id: 'actor',
      client_name: 'Client', site_name: `Assigned ${index}`, site_address: 'Address',
      audit_date: '2026-09-10', inspector_name: 'Technician',
      pulled_at: `2026-09-0${index + 1}T10:00:00.000Z`,
    },
  }));
  const inactive = installation('inactive', {
    assigned_work_state: 'inactive',
    assigned_work_job_summary: assigned[0]!.assigned_work_job_summary,
  });
  const local = installation('local', { assigned_work_state: 'none' });

  assert.deepEqual(
    recentAssignedJobs([...assigned, inactive, local]).map((item) => item.id),
    ['assigned-5', 'assigned-4', 'assigned-3', 'assigned-2'],
  );
  assert.throws(() => recentAssignedJobs(assigned, 0), /positive integer/);
});

test('job search matches partial tokens across titles, references, clients and addresses', () => {
  const referenced = installation('referenced', {
    client_name: 'AutoNexus Australia',
    site_name: 'Essendon workshop',
    site_address: '12 Industrial Avenue',
    custom_job_number: 'IH-70418',
    fergus_job_number: 'FER-8129',
    quote_number: 'Q-5591',
    assigned_work_job_summary: {
      actor_user_id: 'actor', assigned_inspector_user_id: 'actor',
      client_name: 'AutoNexus Australia', site_name: 'Essendon workshop',
      site_address: '12 Industrial Avenue', audit_date: '2026-08-20',
      inspector_name: 'Technician', schedule_title: 'Replace metering hardware',
      pulled_at: '2026-08-01T00:00:00.000Z',
    },
  });
  const other = installation('other', { site_name: 'Altona warehouse' });

  assert.deepEqual(filterDashboardJobs([other, referenced], 'ess 812', 'All').map((item) => item.id), ['referenced']);
  assert.deepEqual(filterDashboardJobs([other, referenced], 'rep hard', 'All').map((item) => item.id), ['referenced']);
  assert.deepEqual(filterDashboardJobs([other, referenced], '704 559', 'All').map((item) => item.id), ['referenced']);
  assert.deepEqual(filterDashboardJobs([other, referenced], 'auto ave', 'All').map((item) => item.id), ['referenced']);
  assert.deepEqual(filterDashboardJobs([other, referenced], 'ess missing', 'All'), []);
});

test('dashboard entity counts share the actor-visible local cohort and exclude hidden or foreign work', () => {
  const mine = installation('mine', { local_owner_user_id: 'actor', assigned_work_state: 'none' });
  const foreign = installation('foreign', { local_owner_user_id: 'other', assigned_work_state: 'none' });
  const revoked = installation('revoked', { local_owner_user_id: 'actor', assigned_work_state: 'inactive', assigned_work_actor_user_id: 'actor' });
  const store: AppDataStore = {
    schemaVersion: 3,
    user: { id: 'actor', email: 'actor@example.test', full_name: 'Actor', role: 'admin' },
    installations: [mine, foreign, revoked], gridSupplies: [], meterDevices: [], measurementAssignments: [],
    zones: [mine, foreign, revoked].map((item) => ({
      id: `zone-${item.id}`, audit_id: item.id, zone_name: 'Zone', zone_description: '', photos: [],
      created_at: item.created_at, updated_at: item.updated_at,
    })),
    electricalAssets: [mine, foreign, revoked].map((item) => ({
      id: `board-${item.id}`, audit_id: item.id, zone_id: `zone-${item.id}`, asset_name: 'Board',
      asset_type: 'MSB', display_code: 'MSB-1', meter_present: false, meters: [], created_at: item.created_at, updated_at: item.updated_at,
    })),
    siteAssets: [mine, foreign, revoked].map((item) => ({
      id: `asset-${item.id}`, audit_id: item.id, zone_id: `zone-${item.id}`, asset_name: 'Load',
      asset_type: 'HVAC', meter_present: false, created_at: item.created_at, updated_at: item.updated_at,
    })),
    formSubmissions: [mine, mine, foreign, revoked, installation('orphan')].map((item, index) => ({
      id: `form-${index}`, installation_id: item.id, form_type: 'a3rm-installation', schema_version: 2,
      status: index === 0 ? 'Completed' : 'Draft', answers: {}, attachments: [],
      created_at: item.created_at, updated_at: item.updated_at,
    })),
    cloudSync: { synced_at_by_installation: {}, force_dirty_installation_ids: [], upload_queue: [], thumbnail_queue: [] },
  };
  const mineSnapshot = localDashboardSnapshot(store, 'actor');
  assert.deepEqual(mineSnapshot.items.map((item) => item.id), ['mine']);
  assert.deepEqual(Object.keys(mineSnapshot.countsByInstallation), ['mine']);
  assert.deepEqual(mineSnapshot.countsByInstallation.mine, { zones: 1, boards: 1, siteAssets: 1, forms: 2 });
  const otherSnapshot = localDashboardSnapshot(store, 'other');
  assert.deepEqual(Object.keys(otherSnapshot.countsByInstallation), ['foreign']);
  assert.equal(otherSnapshot.countsByInstallation.foreign!.forms, 1);
  assert.deepEqual(localDashboardSnapshot(store, null).items, []);
  store.formSubmissions = store.formSubmissions.filter((form) => form.id !== 'form-1');
  assert.equal(localDashboardSnapshot(store, 'actor').countsByInstallation.mine!.forms, 1);
  assert.equal(mineSnapshot.countsByInstallation.mine!.forms, 2);
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
