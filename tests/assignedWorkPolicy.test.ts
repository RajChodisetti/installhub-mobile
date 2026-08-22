import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { RemoteInstallationTree } from '../src/api/apiClient';
import {
  acceptAssignedWorkServerRefresh,
  activeAssignedWorkCheckoutIds,
  applyAssignedDraftLifecycleResolution,
  assignedWorkSuspensionReasonsResolvedAfterPull,
  assignedWorkCheckoutBelongsToDifferentActor,
  assignedWorkInstallationIsVisibleToActor,
  crossActorAssignedCheckoutConflictIds,
  CrossActorAssignedCheckoutConflictError,
  assignedWorkTrackingShouldResumeAfterPull,
  assignedWorkServerMetadataFromInstallation,
  importedCopiesForActor,
  materializedRecordId,
  mergeAssignedInstallationServerState,
  mergeAssignedInstallationStatus,
  planAssignedInstallationPull,
  remoteTreeIsAuthoritativeReopen,
} from '../src/services/assignedWorkPolicy';
import { nextCopyIndex } from '../src/repositories/copyNaming';
import { remoteInstallationWorkTreeFingerprint } from '../src/services/remoteInstallationRevision';
import type { Installation } from '../src/types';
import {
  auditWorkIsSuspendedForActor,
  registerAuditWorkSuspension,
  resumeAuditWorkSuspensionsByReasonForAuthority,
  type AuditWorkSuspensionRegistry,
} from '../src/services/auditWorkTrackingResume';

function tree(installation: Record<string, unknown>): RemoteInstallationTree {
  return {
    installation,
    zones: [],
    electricalAssets: [],
    siteAssets: [],
    formSubmissions: [],
  };
}

function localInstallation(patch: Partial<Installation> = {}): Installation {
  return {
    id: 'assigned',
    client_name: 'Client',
    site_name: 'Site',
    site_address: 'Address',
    inspector_name: 'Inspector',
    audit_date: '2026-08-15',
    status: 'Draft',
    cloud_backup_enabled: true,
    created_at: '2026-08-15T00:00:00.000Z',
    updated_at: '2026-08-15T00:00:00.000Z',
    ...patch,
  };
}

test('completion is terminal across assigned-work pull reconciliation', () => {
  assert.equal(mergeAssignedInstallationStatus('Draft', 'Completed'), 'Completed');
  assert.equal(mergeAssignedInstallationStatus('Completed', 'Draft'), 'Completed');
  assert.equal(mergeAssignedInstallationStatus('Draft', 'Draft'), 'Draft');
});

test('explicit newer server reopen returns a pinned completion to Draft', () => {
  const local = localInstallation({
    status: 'Completed',
    record_version_number: 3,
    server_tree_revision: 8,
    completion_notes: 'Old live note',
    legacy_completed_unpinned: false,
  });
  const reopened = {
    ...tree({
      id: 'assigned',
      status: 'Draft',
      reopenedAt: '2026-08-21T10:00:00.000Z',
      reopenReason: 'Scheduler correction',
      treeRevision: 9,
    }),
    treeRevision: 9,
  };

  assert.equal(remoteTreeIsAuthoritativeReopen(local, reopened), true);
  const reopenedState = mergeAssignedInstallationServerState(local, reopened);
  assert.deepEqual({
    status: reopenedState.status,
    assignedInspectorUserId: reopenedState.assignedInspectorUserId,
    recordVersionNumber: reopenedState.recordVersionNumber,
    completionNotes: reopenedState.completionNotes,
    authoritativeReopen: reopenedState.authoritativeReopen,
    reopenedAt: reopenedState.reopenedAt,
    reopenReason: reopenedState.reopenReason,
    serverTreeRevision: reopenedState.serverTreeRevision,
  }, {
    status: 'Draft',
    assignedInspectorUserId: null,
    recordVersionNumber: 3,
    completionNotes: null,
    authoritativeReopen: true,
    reopenedAt: '2026-08-21T10:00:00.000Z',
    reopenReason: 'Scheduler correction',
    serverTreeRevision: 9,
  });
  assert.equal(reopenedState.refreshConflict, null);
  assert.equal(reopenedState.serverMetadataBase?.site_name, 'Site');
  assert.equal(
    reopenedState.serverTreeFingerprint,
    remoteInstallationWorkTreeFingerprint(reopened),
  );

  assert.equal(remoteTreeIsAuthoritativeReopen({
    ...local,
    legacy_completed_unpinned: true,
  }, reopened), false);
  assert.equal(remoteTreeIsAuthoritativeReopen(local, {
    ...reopened,
    treeRevision: 8,
    installation: { ...reopened.installation, treeRevision: 8 },
  }), false);
});

test('lost completion response followed by explicit server reopen adopts Draft and clears pending', () => {
  const local = localInstallation({
    status: 'Draft',
    record_version_number: 1,
    tree_revision: 7,
    server_tree_revision: 4,
    completion_notes: 'Pending sign-off',
    pending_completion: {
      baseTreeRevision: 4,
      localTreeRevision: 7,
      treeWatermark: 'local-watermark-7',
      idempotencyKey: 'lost-completion-response',
      createdAt: '2026-08-21T09:00:00.000Z',
    },
  });
  const reopened = {
    ...tree({
      id: 'assigned',
      status: 'Draft',
      reopenedAt: '2026-08-21T10:00:00.000Z',
      reopenReason: 'Scheduler correction',
      recordVersionNumber: 2,
      treeRevision: 6,
    }),
    treeRevision: 6,
    recordVersionNumber: 2,
  };

  assert.equal(remoteTreeIsAuthoritativeReopen(local, reopened), true);
  const state = mergeAssignedInstallationServerState(local, reopened);
  assert.equal(state.status, 'Draft');
  assert.equal(state.recordVersionNumber, 2);
  assert.equal(state.serverTreeRevision, 6);
  local.status = state.status;
  const remainsDirtyConflict = applyAssignedDraftLifecycleResolution(
    local,
    state,
    '2026-08-21T10:00:01.000Z',
  );
  assert.equal(remainsDirtyConflict, false);
  assert.equal(local.pending_completion, undefined);
  assert.equal(local.completion_notes, null);
  assert.equal(local.server_tree_revision, 6);
  assert.equal(local.site_name, 'Site');
});

test('newer canonical Draft resolves ambiguous pending completion as a dirty CAS conflict', () => {
  const local = localInstallation({
    status: 'Draft',
    site_name: 'Unsent local site edit',
    tree_revision: 7,
    server_tree_revision: 4,
    pending_completion: {
      baseTreeRevision: 4,
      localTreeRevision: 7,
      treeWatermark: 'local-watermark-7',
      idempotencyKey: 'ambiguous-409',
      createdAt: '2026-08-21T09:00:00.000Z',
    },
  });
  const newerDraft = {
    ...tree({ id: 'assigned', status: 'Draft', treeRevision: 5 }),
    treeRevision: 5,
  };

  assert.equal(remoteTreeIsAuthoritativeReopen(local, newerDraft), false);
  const state = mergeAssignedInstallationServerState(local, newerDraft);
  assert.equal(state.pendingCompletionResolvedAsDraft, true);
  assert.equal(applyAssignedDraftLifecycleResolution(
    local,
    state,
    '2026-08-21T10:00:00.000Z',
  ), true);
  assert.equal(local.pending_completion, undefined);
  assert.equal(local.site_name, 'Unsent local site edit');
  assert.equal(local.server_tree_revision, 4);
  assert.deepEqual(local.backup_conflict, {
    kind: 'CONFLICT',
    localBaseTreeRevision: 4,
    remoteTreeRevision: 5,
    detectedAt: '2026-08-21T10:00:00.000Z',
  });
});

test('newer Draft reconciliation releases an orphaned completion cutoff in provider state', async () => {
  const previous = localInstallation({
    local_owner_user_id: 'actor-a',
    assigned_work_state: 'active',
    assigned_work_actor_user_id: 'actor-a',
    tree_revision: 7,
    server_tree_revision: 4,
    pending_completion: {
      baseTreeRevision: 4,
      localTreeRevision: 7,
      treeWatermark: 'local-watermark-7',
      idempotencyKey: 'ambiguous-post',
      createdAt: '2026-08-21T09:00:00.000Z',
    },
  });
  const current = structuredClone(previous);
  const serverState = mergeAssignedInstallationServerState(current, {
    ...tree({ id: current.id, status: 'Draft', treeRevision: 5 }),
    treeRevision: 5,
  });
  current.status = serverState.status;
  applyAssignedDraftLifecycleResolution(
    current,
    serverState,
    '2026-08-21T10:00:00.000Z',
  );
  const reasons = new Set(assignedWorkSuspensionReasonsResolvedAfterPull(
    previous,
    current,
    serverState,
  ));
  const suspended: AuditWorkSuspensionRegistry = new Map();
  registerAuditWorkSuspension(
    suspended,
    current.id,
    'actor-a',
    'completion-token',
    'completion',
  );

  const removed = await resumeAuditWorkSuspensionsByReasonForAuthority(
    suspended,
    current.id,
    reasons,
    { actorUserId: 'actor-a', isCurrent: () => true },
    () => 'actor-a',
    async () => {},
  );
  assert.equal(removed, 1);
  assert.equal(auditWorkIsSuspendedForActor(suspended, current.id, 'actor-a'), false);
});

test('assignment return and later lifecycle resolution release only their exact tokens', async () => {
  const suspended: AuditWorkSuspensionRegistry = new Map();
  const installationId = 'assigned';
  registerAuditWorkSuspension(
    suspended,
    installationId,
    'actor-a',
    'completion-first',
    'completion',
  );
  registerAuditWorkSuspension(
    suspended,
    installationId,
    'actor-a',
    'revocation-second',
    'assignment-sync',
  );
  registerAuditWorkSuspension(
    suspended,
    installationId,
    'actor-a',
    'unrelated-delete',
    'delete',
  );
  const authority = { actorUserId: 'actor-a', isCurrent: () => true };
  const previousInactive = localInstallation({
    id: installationId,
    local_owner_user_id: 'actor-a',
    assigned_work_state: 'inactive',
    assigned_work_actor_user_id: 'actor-a',
    pending_completion: {
      baseTreeRevision: 4,
      localTreeRevision: 7,
      treeWatermark: 'local-watermark-7',
      idempotencyKey: 'ambiguous-post',
      createdAt: '2026-08-21T09:00:00.000Z',
    },
  });
  const returned = {
    ...previousInactive,
    assigned_work_state: 'active' as const,
  };
  const ordinaryDraftState = mergeAssignedInstallationServerState(
    returned,
    tree({ id: installationId, status: 'Draft', treeRevision: 4 }),
  );
  const returnReasons = new Set(assignedWorkSuspensionReasonsResolvedAfterPull(
    previousInactive,
    returned,
    ordinaryDraftState,
  ));
  assert.deepEqual([...returnReasons], ['assignment-sync']);
  assert.equal(await resumeAuditWorkSuspensionsByReasonForAuthority(
    suspended,
    installationId,
    returnReasons,
    authority,
    () => 'actor-a',
    async () => {},
  ), 1);
  assert.deepEqual(
    [...suspended.values()].map((token) => token.tokenId).sort(),
    ['completion-first', 'unrelated-delete'],
  );

  const beforeResolvedDraft = structuredClone(returned);
  const resolvedDraft = structuredClone(returned);
  const newerDraftState = mergeAssignedInstallationServerState(resolvedDraft, {
    ...tree({ id: installationId, status: 'Draft', treeRevision: 5 }),
    treeRevision: 5,
  });
  applyAssignedDraftLifecycleResolution(
    resolvedDraft,
    newerDraftState,
    '2026-08-21T10:00:00.000Z',
  );
  const lifecycleReasons = new Set(assignedWorkSuspensionReasonsResolvedAfterPull(
    beforeResolvedDraft,
    resolvedDraft,
    newerDraftState,
  ));
  assert.deepEqual([...lifecycleReasons].sort(), ['assignment-sync', 'completion']);
  assert.equal(await resumeAuditWorkSuspensionsByReasonForAuthority(
    suspended,
    installationId,
    lifecycleReasons,
    authority,
    () => 'actor-a',
    async () => {},
  ), 1);
  assert.deepEqual(
    [...suspended.values()].map((token) => token.tokenId),
    ['unrelated-delete'],
  );
});

test('explicit reopen releases completion and assignment cutoffs but retains unrelated locks', async () => {
  const previous = localInstallation({
    status: 'Completed',
    local_owner_user_id: 'actor-a',
    assigned_work_state: 'active',
    assigned_work_actor_user_id: 'actor-a',
    record_version_number: 2,
    server_tree_revision: 8,
  });
  const current = structuredClone(previous);
  const state = mergeAssignedInstallationServerState(current, {
    ...tree({
      id: current.id,
      status: 'Draft',
      reopenedAt: '2026-08-21T11:00:00.000Z',
      reopenReason: 'Scheduler correction',
      treeRevision: 9,
    }),
    treeRevision: 9,
  });
  current.status = state.status;
  applyAssignedDraftLifecycleResolution(current, state, '2026-08-21T11:00:01.000Z');
  const reasons = new Set(assignedWorkSuspensionReasonsResolvedAfterPull(
    previous,
    current,
    state,
  ));
  const suspended: AuditWorkSuspensionRegistry = new Map();
  registerAuditWorkSuspension(suspended, current.id, 'actor-a', 'completion', 'completion');
  registerAuditWorkSuspension(suspended, current.id, 'actor-a', 'assignment', 'assignment-sync');
  registerAuditWorkSuspension(suspended, current.id, 'actor-a', 'logout', 'logout');

  assert.equal(await resumeAuditWorkSuspensionsByReasonForAuthority(
    suspended,
    current.id,
    reasons,
    { actorUserId: 'actor-a', isCurrent: () => true },
    () => 'actor-a',
    async () => {},
  ), 2);
  assert.deepEqual(
    [...suspended.values()].map((token) => token.tokenId),
    ['logout'],
  );
});

test('missing completion metadata is not coerced into revision zero', () => {
  const result = mergeAssignedInstallationServerState(localInstallation(), tree({
    id: 'assigned',
    status: 'Completed',
    completedFromRevision: null,
  }));
  assert.equal(result.completedFromRevision, undefined);
});

test('assigned completion notes map only when the server explicitly supplies the field', () => {
  const note = mergeAssignedInstallationServerState(localInstallation(), tree({
    id: 'assigned',
    status: 'Completed',
    completionNotes: '  Safe shutdown confirmed  ',
  }));
  assert.equal(note.completionNotes, 'Safe shutdown confirmed');

  const cleared = mergeAssignedInstallationServerState(localInstallation(), tree({
    id: 'assigned',
    status: 'Completed',
    completionNotes: null,
  }));
  assert.equal(cleared.completionNotes, null);

  const legacy = mergeAssignedInstallationServerState(localInstallation(), tree({
    id: 'assigned',
    status: 'Completed',
  }));
  assert.equal('completionNotes' in legacy, false);
});

test('metadata-only assigned pull advances CAS without replacing local-only metadata edits', () => {
  const baseTree = tree({ id: 'assigned', status: 'Draft' });
  const original = localInstallation({
    customer_name: 'Old customer',
    site_locality: 'Old locality',
    site_state: 'NSW',
    site_postcode: '2000',
    warranty_device: null,
    server_tree_revision: 4,
    tree_revision: 11,
  });
  const local = localInstallation({
    ...original,
    // Field App-only edit after the accepted server base.
    warranty_device: true,
    assigned_work_server_metadata_base:
      assignedWorkServerMetadataFromInstallation(original),
    assigned_work_server_tree_fingerprint:
      remoteInstallationWorkTreeFingerprint(baseTree),
  });
  const result = mergeAssignedInstallationServerState(local, {
    ...tree({
      id: 'assigned',
      status: 'Draft',
      customerName: 'Updated customer',
      siteLocality: 'Sydney',
      siteState: 'NSW',
      sitePostcode: '2001',
      warrantyDevice: null,
    }),
    treeRevision: 5,
  }, '2026-08-15T01:00:00.000Z');

  assert.deepEqual(result.metadataPatch, {
    customer_name: 'Updated customer',
    site_locality: 'Sydney',
    site_postcode: '2001',
  });
  assert.equal(result.serverTreeRevision, 5);
  assert.equal(result.refreshConflict, null);
  assert.equal('warranty_device' in (result.metadataPatch ?? {}), false);
  assert.equal(local.tree_revision, 11);
  assert.equal(local.warranty_device, true);
});

test('authoritative completion can advance a proven metadata-only assigned CAS base', () => {
  const baseTree = tree({ id: 'assigned', status: 'Draft' });
  const original = localInstallation({
    server_tree_revision: 4,
    tree_revision: 12,
  });
  const local = localInstallation({
    ...original,
    assigned_work_server_metadata_base:
      assignedWorkServerMetadataFromInstallation(original),
    assigned_work_server_tree_fingerprint:
      remoteInstallationWorkTreeFingerprint(baseTree),
    pending_completion: {
      baseTreeRevision: 4,
      idempotencyKey: 'completion-key',
      createdAt: '2026-08-15T00:00:00.000Z',
    },
  });
  const result = mergeAssignedInstallationServerState(local, {
    ...tree({
      id: 'assigned',
      status: 'Completed',
      assignedInspectorUserId: 'field-1',
      recordVersionNumber: 8,
      completedAt: '2026-08-15T01:00:00.000Z',
      completedFromRevision: 6,
    }),
    treeRevision: 7,
    recordVersionNumber: 8,
  });

  assert.equal(result.status, 'Completed');
  assert.equal(result.serverTreeRevision, 7);
  assert.equal(result.recordVersionNumber, 8);
  assert.equal(result.completedFromRevision, 6);
  assert.equal(result.refreshConflict, null);
  assert.equal(local.tree_revision, 12);
});

test('same-field local and server metadata edits pause CAS until explicit acceptance', () => {
  const baseTree = tree({ id: 'assigned', status: 'Draft' });
  const original = localInstallation({
    quote_number: 'Q-1',
    warranty_device: null,
    server_tree_revision: 4,
    tree_revision: 8,
  });
  const local = localInstallation({
    ...original,
    quote_number: 'Q-LOCAL',
    warranty_device: true,
    assigned_work_server_metadata_base:
      assignedWorkServerMetadataFromInstallation(original),
    assigned_work_server_tree_fingerprint:
      remoteInstallationWorkTreeFingerprint(baseTree),
  });
  const result = mergeAssignedInstallationServerState(local, {
    ...tree({
      id: 'assigned',
      status: 'Draft',
      quoteNumber: 'Q-SERVER',
      warrantyDevice: null,
    }),
    treeRevision: 5,
  }, '2026-08-15T01:00:00.000Z');

  assert.equal(result.serverTreeRevision, undefined);
  assert.equal(result.metadataPatch, undefined);
  assert.deepEqual(result.refreshConflict?.conflicting_fields, ['quote_number']);
  assert.equal(result.refreshConflict?.remote_tree_changed, false);

  local.assigned_work_refresh_conflict = result.refreshConflict ?? undefined;
  acceptAssignedWorkServerRefresh(local);
  assert.equal(local.quote_number, 'Q-SERVER');
  assert.equal(local.warranty_device, true);
  assert.equal(local.server_tree_revision, 5);
  assert.equal(local.tree_revision, 8);
  assert.equal(local.assigned_work_refresh_conflict, undefined);
});

test('remote child/form changes never advance assigned checkout CAS implicitly', () => {
  const baseTree = tree({ id: 'assigned', status: 'Draft' });
  const original = localInstallation({ server_tree_revision: 4, tree_revision: 9 });
  const local = localInstallation({
    ...original,
    assigned_work_server_metadata_base:
      assignedWorkServerMetadataFromInstallation(original),
    assigned_work_server_tree_fingerprint:
      remoteInstallationWorkTreeFingerprint(baseTree),
  });
  const result = mergeAssignedInstallationServerState(local, {
    ...tree({ id: 'assigned', status: 'Draft', customerName: 'Updated customer' }),
    treeRevision: 5,
    zones: [{ id: 'server-zone', zoneName: 'Concurrent server zone' }],
  }, '2026-08-15T01:00:00.000Z');

  assert.equal(result.serverTreeRevision, undefined);
  assert.equal(result.refreshConflict?.remote_tree_changed, true);
  local.assigned_work_refresh_conflict = result.refreshConflict ?? undefined;
  assert.throws(
    () => acceptAssignedWorkServerRefresh(local),
    /changed or cannot be proven unchanged/i,
  );
  assert.equal(local.server_tree_revision, 4);
  assert.equal(local.tree_revision, 9);
});

test('an unanchored older checkout does not advance across an unknown server revision', () => {
  const local = localInstallation({
    server_tree_revision: 4,
    tree_revision: 10,
  });
  const result = mergeAssignedInstallationServerState(local, {
    ...tree({ id: 'assigned', status: 'Draft', customerName: 'Server customer' }),
    treeRevision: 5,
  }, '2026-08-15T01:00:00.000Z');

  assert.equal(result.serverTreeRevision, undefined);
  assert.equal(result.refreshConflict?.remote_tree_changed, true);
  assert.equal(result.refreshConflict?.local_base_tree_revision, 4);
  assert.equal(local.server_tree_revision, 4);
});

test('remote completion metadata cannot advance the existing checkout CAS base', () => {
  const local = localInstallation({
    site_name: 'Unsynced local site edit',
    server_tree_revision: 4,
    pending_completion: {
      baseTreeRevision: 4,
      idempotencyKey: 'completion-key',
      createdAt: '2026-08-15T00:00:00.000Z',
    },
  });
  const result = mergeAssignedInstallationServerState(local, {
    ...tree({
      id: 'assigned',
      status: 'Completed',
      assignedInspectorUserId: 'field-1',
      recordVersionNumber: 8,
      completedAt: '2026-08-15T01:00:00.000Z',
      completedFromRevision: 6,
      treeRevision: 7,
      siteName: 'Remote site name',
    }),
    treeRevision: 7,
    recordVersionNumber: 8,
  });

  assert.equal(result.status, 'Completed');
  assert.equal(result.assignedInspectorUserId, 'field-1');
  assert.equal(result.recordVersionNumber, 8);
  assert.equal(result.completedAt, '2026-08-15T01:00:00.000Z');
  assert.equal(result.completedFromRevision, 6);
  assert.equal(result.refreshConflict?.remote_tree_changed, true);
  assert.equal(result.refreshConflict?.remote_tree_revision, 7);
  assert.equal('siteName' in result, false);
  assert.equal('serverTreeRevision' in result, false);
  assert.equal(local.server_tree_revision, 4);
});

test('assigned reconciliation captures the tracker cutoff before store mutation', () => {
  const source = readFileSync(
    new URL('../src/repositories/remoteInstallationsRepository.ts', import.meta.url),
    'utf8',
  );
  const sync = source.slice(source.indexOf('export async function syncAssignedInstallations'));
  assert.ok(sync.indexOf('attemptedSuspensions.set(id, suspension)') >= 0);
  assert.ok(
    sync.indexOf('await suspendAuditWorkForInstallation(')
      < sync.indexOf('await updateStore((store) =>'),
  );
  assert.match(sync, /await resumeAuditWorkForInstallation\(suspension, trackerResumeAuthority\)/);
});

test('filters elevated pulls to actor-owned or assigned work and retains completed history', () => {
  const plan = planAssignedInstallationPull('field-1', [
    tree({ id: 'assigned', status: 'Draft', createdByUserId: 'admin', assignedInspectorUserId: 'field-1' }),
    tree({ id: 'owned', status: 'Draft', created_by_user_id: 'field-1' }),
    tree({ id: 'other', status: 'Draft', createdByUserId: 'admin', assignedInspectorUserId: 'field-2' }),
    tree({ id: 'complete', status: 'Completed', createdByUserId: 'admin', assignedInspectorUserId: 'field-1' }),
  ], ['assigned', 'revoked']);

  assert.deepEqual(plan.trees.map((item) => item.installation.id), ['assigned', 'owned', 'complete']);
  assert.deepEqual(plan.activeAssignedIds, ['assigned', 'complete']);
  assert.deepEqual(plan.inactiveAssignedIds, ['revoked']);
});

test('actor switch hides another actor checkout without treating it as B revocation work', () => {
  const actorACheckout = localInstallation({
    id: 'actor-a-job',
    local_owner_user_id: 'actor-a',
    assigned_work_state: 'active',
    assigned_work_actor_user_id: 'actor-a',
  });
  assert.equal(assignedWorkInstallationIsVisibleToActor(actorACheckout, 'actor-a'), true);
  assert.equal(assignedWorkInstallationIsVisibleToActor(actorACheckout, 'actor-b'), false);
  assert.deepEqual(activeAssignedWorkCheckoutIds([actorACheckout]), ['actor-a-job']);
  assert.deepEqual(
    planAssignedInstallationPull(
      'actor-b',
      [],
      activeAssignedWorkCheckoutIds([actorACheckout], 'actor-b'),
    ).inactiveAssignedIds,
    [],
  );
  assert.equal(
    assignedWorkCheckoutBelongsToDifferentActor(actorACheckout, 'actor-b'),
    true,
  );
  const conflicts = crossActorAssignedCheckoutConflictIds(
    [actorACheckout],
    'actor-b',
    ['actor-a-job'],
  );
  assert.deepEqual(conflicts, ['actor-a-job']);
  const surfaced = new CrossActorAssignedCheckoutConflictError(conflicts);
  assert.deepEqual(surfaced.installationIds, ['actor-a-job']);
  assert.match(surfaced.message, /blocked[\s\S]*another account/);

  const repository = readFileSync(
    new URL('../src/repositories/index.ts', import.meta.url),
    'utf8',
  );
  assert.match(repository, /assignedWorkInstallationIsVisibleToActor\(installation, actorUserId\)/);
  const remote = readFileSync(
    new URL('../src/repositories/remoteInstallationsRepository.ts', import.meta.url),
    'utf8',
  );
  assert.match(remote, /activeAssignedWorkCheckoutIds\([\s\S]*assignedWorkCheckoutBelongsToDifferentActor/);
  assert.match(
    remote,
    /assignedWorkCheckoutBelongsToDifferentActor[\s\S]*quarantineAssignedWorkCheckout[\s\S]*store\.installations\.unshift\(installation\)/,
  );
  assert.doesNotMatch(
    remote,
    /throw new CrossActorAssignedCheckoutConflictError\(crossActorConflictIds\)/,
  );
});

test('returned completed assignment is not classified as revoked Draft work', () => {
  const plan = planAssignedInstallationPull('field-1', [
    tree({ id: 'complete', status: 'Completed', createdByUserId: 'admin', assignedInspectorUserId: 'field-1' }),
  ], ['complete', 'revoked-draft']);

  assert.deepEqual(plan.trees.map((item) => item.installation.id), ['complete']);
  assert.deepEqual(plan.inactiveAssignedIds, ['revoked-draft']);
});

test('active assignment becoming actor-owned resumes tracking after reconciliation to none', () => {
  const plan = planAssignedInstallationPull('field-1', [
    tree({ id: 'owned-now', status: 'Draft', createdByUserId: 'field-1' }),
  ], ['owned-now']);

  assert.deepEqual(plan.activeAssignedIds, []);
  assert.deepEqual(plan.inactiveAssignedIds, ['owned-now']);
  assert.equal(assignedWorkTrackingShouldResumeAfterPull(localInstallation({
    id: 'owned-now',
    assigned_work_state: 'none',
  })), true);
  assert.equal(assignedWorkTrackingShouldResumeAfterPull(localInstallation({
    id: 'revoked',
    assigned_work_state: 'inactive',
  })), false);

  const source = readFileSync(
    new URL('../src/repositories/remoteInstallationsRepository.ts', import.meta.url),
    'utf8',
  );
  const sync = source.slice(source.indexOf('export async function syncAssignedInstallations'));
  assert.match(sync, /assignedWorkSuspensionReasonsResolvedAfterPull\(/);
  assert.match(sync, /attemptedSuspensions\.forEach[\s\S]*'assignment-sync'/);
  assert.match(sync, /resumeAuditWorkSuspensionsForInstallationReasons\(/);
  assert.match(sync, /assignedWorkTrackingShouldResumeAfterPull\(current\)/);
  assert.doesNotMatch(sync, /suspension \?\? id/);
});

test('assigned checkouts preserve every canonical server identity', () => {
  let generated = 0;
  assert.equal(materializedRecordId(true, 'server-zone-1', () => {
    generated += 1;
    return 'local-zone-1';
  }), 'server-zone-1');
  assert.equal(generated, 0);
  assert.equal(materializedRecordId(false, 'server-zone-1', () => 'local-zone-1'), 'local-zone-1');
});

test('ordinary imported copy numbering is isolated by exact local owner', () => {
  const actorACopy = localInstallation({
    id: 'actor-a-cp1',
    local_owner_user_id: 'actor-a',
    assigned_work_state: 'none',
    is_imported_copy: true,
    import_source_server_id: 'server-installation',
    copy_index: 1,
  });
  assert.equal(
    nextCopyIndex(importedCopiesForActor(
      [actorACopy],
      'server-installation',
      'actor-b',
    )),
    1,
  );
  assert.equal(
    nextCopyIndex(importedCopiesForActor(
      [actorACopy],
      'server-installation',
      'actor-a',
    )),
    2,
  );
  const source = readFileSync(
    new URL('../src/repositories/remoteInstallationsRepository.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /importedCopiesForActor\([\s\S]*materializationActorUserId/);
});
