import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { RemoteInstallationTree } from '../src/api/apiClient';
import {
  materializedRecordId,
  mergeAssignedInstallationServerState,
  mergeAssignedInstallationStatus,
  planAssignedInstallationPull,
} from '../src/services/assignedWorkPolicy';
import type { Installation } from '../src/types';

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

test('missing completion metadata is not coerced into revision zero', () => {
  const result = mergeAssignedInstallationServerState(localInstallation(), tree({
    id: 'assigned',
    status: 'Completed',
    completedFromRevision: null,
  }));
  assert.equal(result.completedFromRevision, undefined);
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

  assert.deepEqual(result, {
    status: 'Completed',
    assignedInspectorUserId: 'field-1',
    recordVersionNumber: 8,
    completedAt: '2026-08-15T01:00:00.000Z',
    completedFromRevision: 6,
  });
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
  assert.ok(sync.indexOf('attemptedSuspendIds.push(id)') >= 0);
  assert.ok(
    sync.indexOf('await suspendAuditWorkForInstallation(id)')
      < sync.indexOf('await updateStore((store) =>'),
  );
  assert.ok(sync.indexOf('await resumeAuditWorkForInstallation(id).catch') >= 0);
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

test('returned completed assignment is not classified as revoked Draft work', () => {
  const plan = planAssignedInstallationPull('field-1', [
    tree({ id: 'complete', status: 'Completed', createdByUserId: 'admin', assignedInspectorUserId: 'field-1' }),
  ], ['complete', 'revoked-draft']);

  assert.deepEqual(plan.trees.map((item) => item.installation.id), ['complete']);
  assert.deepEqual(plan.inactiveAssignedIds, ['revoked-draft']);
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
