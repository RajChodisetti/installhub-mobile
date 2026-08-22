import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assignedWorkPrestartActionIsLocked,
  assignedWorkPrestartIsAcknowledged,
  createAssignedWorkJobSummarySnapshot,
  createAssignedWorkPrestartAcknowledgement,
  installationAllowsActiveWorkTracking,
  reconcileAssignedWorkPrestartAcknowledgement,
} from '../src/services/assignedWorkPrestart';
import type { AssignedWorkJobSummarySnapshot, Installation } from '../src/types';

const timestamp = '2026-08-21T09:00:00.000Z';

function summary(
  patch: Partial<AssignedWorkJobSummarySnapshot> = {},
): AssignedWorkJobSummarySnapshot {
  return createAssignedWorkJobSummarySnapshot({
    actor_user_id: 'technician-1',
    assigned_inspector_user_id: 'technician-1',
    client_name: 'Scheduler Client',
    site_name: 'Scheduler Site',
    site_address: 'Scheduler Address',
    audit_date: '2026-08-22',
    inspector_name: 'Technician One',
    ...patch,
  }, patch.pulled_at ?? timestamp);
}

function assignedDraft(patch: Partial<Installation> = {}): Installation {
  return {
    id: 'assigned-job',
    client_name: 'Locally edited Client',
    site_name: 'Locally edited Site',
    site_address: 'Locally edited Address',
    inspector_name: 'Local technician edit',
    audit_date: '2026-08-23',
    status: 'Draft',
    tree_revision: 7,
    server_tree_revision: 7,
    assigned_work_state: 'active',
    assigned_work_actor_user_id: 'technician-1',
    assigned_work_job_summary: summary(),
    cloud_backup_enabled: true,
    created_at: timestamp,
    updated_at: timestamp,
    ...patch,
  };
}

function acknowledgedDraft(): Installation {
  const installation = assignedDraft();
  installation.assigned_work_prestart_acknowledgement =
    createAssignedWorkPrestartAcknowledgement(
      installation,
      'technician-1',
      timestamp,
    );
  return installation;
}

test('routine tree/CAS revision and pull timestamps do not invalidate an acknowledged summary', () => {
  const previous = acknowledgedDraft();
  const next: Installation = {
    ...previous,
    tree_revision: 42,
    server_tree_revision: 41,
    assigned_work_job_summary: summary({
      pulled_at: '2026-08-21T10:00:00.000Z',
    }),
  };
  next.assigned_work_prestart_acknowledgement =
    reconcileAssignedWorkPrestartAcknowledgement(previous, next);

  assert.deepEqual(
    next.assigned_work_prestart_acknowledgement,
    previous.assigned_work_prestart_acknowledgement,
  );
  assert.equal(assignedWorkPrestartIsAcknowledged(next, 'technician-1'), true);
  assert.equal(assignedWorkPrestartActionIsLocked(next, 'technician-1'), false);
  assert.equal(installationAllowsActiveWorkTracking(next, 'technician-1'), true);
});

test('a changed pulled scheduler summary invalidates without overwriting offline tree edits', () => {
  const previous = acknowledgedDraft();
  const next: Installation = {
    ...previous,
    assigned_work_job_summary: summary({
      site_address: 'New scheduler address',
      pulled_at: '2026-08-21T10:00:00.000Z',
    }),
  };
  next.assigned_work_prestart_acknowledgement =
    reconcileAssignedWorkPrestartAcknowledgement(previous, next);

  assert.equal(next.site_address, 'Locally edited Address');
  assert.equal(next.assigned_work_job_summary?.site_address, 'New scheduler address');
  assert.equal(next.assigned_work_prestart_acknowledgement, undefined);
  assert.equal(assignedWorkPrestartIsAcknowledged(next, 'technician-1'), false);
  assert.equal(assignedWorkPrestartActionIsLocked(next, 'technician-1'), true);
});

test('changed contact, scope, or access instructions require a fresh pre-start acknowledgement', () => {
  const previous = acknowledgedDraft();
  const next: Installation = {
    ...previous,
    assigned_work_job_summary: summary({
      site_contact_name: 'Updated Site Contact',
      service_type: 'Meter replacement',
      access_information: 'Collect the restricted-key set from reception.',
      pulled_at: '2026-08-21T10:00:00.000Z',
    }),
  };
  next.assigned_work_prestart_acknowledgement =
    reconcileAssignedWorkPrestartAcknowledgement(previous, next);

  assert.equal(next.assigned_work_prestart_acknowledgement, undefined);
  assert.equal(assignedWorkPrestartActionIsLocked(next, 'technician-1'), true);
  assert.equal(next.access_information, undefined);
});

test('actor reassignment, inactivity, and reopen each invalidate the acknowledgement', () => {
  const previous = acknowledgedDraft();

  const reassigned: Installation = {
    ...previous,
    assigned_inspector_user_id: 'technician-2',
    assigned_work_actor_user_id: 'technician-2',
    assigned_work_job_summary: summary({
      actor_user_id: 'technician-2',
      assigned_inspector_user_id: 'technician-2',
    }),
  };
  reassigned.assigned_work_prestart_acknowledgement =
    reconcileAssignedWorkPrestartAcknowledgement(previous, reassigned);
  assert.equal(reassigned.assigned_work_prestart_acknowledgement, undefined);
  assert.equal(assignedWorkPrestartActionIsLocked(reassigned, 'technician-2'), true);

  const inactive: Installation = {
    ...previous,
    assigned_work_state: 'inactive',
  };
  inactive.assigned_work_prestart_acknowledgement =
    reconcileAssignedWorkPrestartAcknowledgement(previous, inactive);
  assert.equal(inactive.assigned_work_prestart_acknowledgement, undefined);
  assert.equal(assignedWorkPrestartIsAcknowledged(inactive, 'technician-1'), false);
  assert.equal(installationAllowsActiveWorkTracking(inactive, 'technician-1'), false);

  const completed: Installation = { ...previous, status: 'Completed' };
  const reopened: Installation = { ...completed, status: 'Draft' };
  reopened.assigned_work_prestart_acknowledgement =
    reconcileAssignedWorkPrestartAcknowledgement(completed, reopened);
  assert.equal(reopened.assigned_work_prestart_acknowledgement, undefined);
  assert.equal(assignedWorkPrestartActionIsLocked(reopened, 'technician-1'), true);

  const explicitlyReopenedDraft: Installation = {
    ...previous,
    reopened_at: '2026-08-21T11:00:00.000Z',
    reopen_reason: 'Scheduler correction',
  };
  explicitlyReopenedDraft.assigned_work_prestart_acknowledgement =
    reconcileAssignedWorkPrestartAcknowledgement(previous, explicitlyReopenedDraft);
  assert.equal(
    explicitlyReopenedDraft.assigned_work_prestart_acknowledgement,
    undefined,
  );
  assert.equal(
    assignedWorkPrestartActionIsLocked(explicitlyReopenedDraft, 'technician-1'),
    true,
  );
});

test('action lock blocks unacknowledged or wrong-actor assigned work only', () => {
  const assigned = assignedDraft();
  assert.equal(assignedWorkPrestartActionIsLocked(assigned, 'technician-1'), true);
  assert.equal(assignedWorkPrestartActionIsLocked(assigned, 'technician-2'), true);
  assert.equal(installationAllowsActiveWorkTracking(assigned, 'technician-1'), false);

  const acknowledged = acknowledgedDraft();
  assert.equal(assignedWorkPrestartActionIsLocked(acknowledged, 'technician-1'), false);

  const local = assignedDraft({
    assigned_work_state: 'none',
    assigned_work_actor_user_id: undefined,
    assigned_work_job_summary: undefined,
    server_tree_revision: undefined,
  });
  assert.equal(assignedWorkPrestartActionIsLocked(local, 'technician-1'), false);
  assert.equal(installationAllowsActiveWorkTracking(local, 'technician-1'), true);
});

test('durable pending completion remains tracking-ineligible after process restart', () => {
  const pending = assignedDraft({
    assigned_work_state: 'none',
    assigned_work_actor_user_id: undefined,
    assigned_work_job_summary: undefined,
    pending_completion: {
      baseTreeRevision: 7,
      localTreeRevision: 7,
      treeWatermark: 'exact-tree',
      idempotencyKey: 'complete-attempt',
      createdAt: '2026-08-21T00:00:00.000Z',
    },
  });
  const reloaded = structuredClone(pending);
  assert.equal(
    installationAllowsActiveWorkTracking(reloaded, 'technician-1'),
    false,
  );
  assert.equal(
    installationAllowsActiveWorkTracking(
      { ...reloaded, pending_completion: undefined },
      'technician-1',
    ),
    true,
  );
});
