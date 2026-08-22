import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assertCompletionAttemptInstallationState,
  captureCompletionTreeSnapshot,
  COMPLETION_NOTES_MAX_LENGTH,
  completionFailureIsDefinitiveRejection,
  completionFailureAllowsTrackingResume,
  completionIdempotencyKey,
  normalizeCompletionNotes,
  pendingCompletionNotesRequestField,
} from '../src/services/installationCompletion';
import type { Installation } from '../src/types';

test('completion notes trim blanks to null and enforce the public limit', () => {
  assert.equal(normalizeCompletionNotes('  sign-off complete  '), 'sign-off complete');
  assert.equal(normalizeCompletionNotes(' \n '), null);
  assert.equal(normalizeCompletionNotes(null), null);
  assert.equal(
    normalizeCompletionNotes('x'.repeat(COMPLETION_NOTES_MAX_LENGTH)),
    'x'.repeat(COMPLETION_NOTES_MAX_LENGTH),
  );
  assert.throws(
    () => normalizeCompletionNotes('x'.repeat(COMPLETION_NOTES_MAX_LENGTH + 1)),
    /2,000 characters or fewer/,
  );
});

test('tracking resumes only for definitive lifecycle rejection, not ambiguous dispatch loss', () => {
  assert.equal(completionFailureIsDefinitiveRejection({ status: 422 }), false);
  assert.equal(completionFailureIsDefinitiveRejection({
    status: 422,
    code: 'installation_not_ready',
  }), true);
  assert.equal(completionFailureIsDefinitiveRejection({ status: 403 }), false);
  assert.equal(completionFailureIsDefinitiveRejection({ status: 404 }), false);
  assert.equal(completionFailureIsDefinitiveRejection({ status: 409 }), false);
  assert.equal(completionFailureIsDefinitiveRejection({ status: 408 }), false);
  assert.equal(completionFailureIsDefinitiveRejection({ status: 429 }), false);
  assert.equal(completionFailureIsDefinitiveRejection({ status: 500 }), false);
  assert.equal(completionFailureIsDefinitiveRejection(new Error('lost response')), false);
  assert.equal(completionFailureAllowsTrackingResume(false, new Error('pre-dispatch')), true);
  assert.equal(completionFailureAllowsTrackingResume(true, { status: 422 }), false);
  assert.equal(completionFailureAllowsTrackingResume(true, {
    status: 422,
    code: 'installation_not_ready',
  }), true);
  assert.equal(completionFailureAllowsTrackingResume(true, new Error('committed; response lost')), false);

  const screen = readFileSync(
    new URL('../src/screens/InstallationDetailScreen.tsx', import.meta.url),
    'utf8',
  );
  const completion = screen.slice(
    screen.indexOf('  async function completeInstallation()'),
    screen.indexOf('\n  async function reopenInstallation()'),
  );
  assert.match(completion, /completionDispatchStarted = true;[\s\S]*apiClient\.completeInstallation/);
  assert.match(
    completion,
    /completionFailureAllowsTrackingResume\(completionDispatchStarted, error\)/,
  );
  assert.match(
    completion,
    /completionWasDefinitivelyRejected[\s\S]*preparedCompletionAttempt[\s\S]*discardPreparedCompletionAttempt[\s\S]*pendingCompletionClearedForResume[\s\S]*resumeAuditWorkForInstallation/,
  );
});

test('pending completion retries reuse the exact persisted note and preserve legacy omission', () => {
  const base = {
    baseTreeRevision: 4,
    idempotencyKey: 'complete-key',
    createdAt: '2026-08-21T09:00:00.000Z',
  };
  assert.deepEqual(pendingCompletionNotesRequestField(base), {});
  assert.deepEqual(
    pendingCompletionNotesRequestField({ ...base, completionNotes: null }),
    { completionNotes: null },
  );
  assert.deepEqual(
    pendingCompletionNotesRequestField({ ...base, completionNotes: 'exact persisted value' }),
    { completionNotes: 'exact persisted value' },
  );

  const first = completionIdempotencyKey('installation-1', 4, 'first note');
  assert.equal(first, completionIdempotencyKey('installation-1', 4, 'first note'));
  assert.notEqual(first, completionIdempotencyKey('installation-1', 4, 'edited note'));
});

test('queued completion rejects a current-store lifecycle or pending-attempt race', () => {
  const pending = {
    baseTreeRevision: 4,
    localTreeRevision: 7,
    treeWatermark: 'watermark-7',
    idempotencyKey: 'complete-key',
    createdAt: '2026-08-21T09:00:00.000Z',
    completionNotes: 'Exact note',
  };
  const installation: Installation = {
    id: 'installation-1',
    client_name: 'Client',
    site_name: 'Site',
    site_address: 'Address',
    inspector_name: 'Technician',
    audit_date: '2026-08-21',
    status: 'Draft',
    tree_revision: 7,
    server_tree_revision: 4,
    pending_completion: pending,
    cloud_backup_enabled: true,
    created_at: '2026-08-21T08:00:00.000Z',
    updated_at: '2026-08-21T08:00:00.000Z',
  };

  assert.doesNotThrow(() => {
    assertCompletionAttemptInstallationState(installation, pending, true, 'watermark-7');
  });
  assert.throws(
    () => assertCompletionAttemptInstallationState(
      { ...installation, status: 'Completed' },
      pending,
      true,
      'watermark-7',
    ),
    /Only a Draft installation/,
  );
  assert.throws(
    () => assertCompletionAttemptInstallationState(
      { ...installation, server_tree_revision: 5 },
      pending,
      true,
      'watermark-7',
    ),
    /changed after completion validation/,
  );
  assert.throws(
    () => assertCompletionAttemptInstallationState({
      ...installation,
      pending_completion: { ...pending, idempotencyKey: 'different-key' },
    }, pending, true, 'watermark-7'),
    /pending completion attempt changed/,
  );
  assert.doesNotThrow(() => {
    assertCompletionAttemptInstallationState({
      ...installation,
      server_tree_revision: 5,
      pending_completion: pending,
    }, {
      ...pending,
      baseTreeRevision: 5,
      idempotencyKey: 'new-revision-key',
    }, false, 'watermark-7');
  });
  assert.throws(
    () => assertCompletionAttemptInstallationState(
      { ...installation, tree_revision: 8 },
      pending,
      true,
      'watermark-7',
    ),
    /Local installation work changed/,
  );
  assert.throws(
    () => assertCompletionAttemptInstallationState(
      installation,
      pending,
      true,
      'watermark-after-child-edit',
    ),
    /Local installation work changed/,
  );
});

test('a local edit queued while server readiness is held invalidates the post-sync snapshot', async () => {
  const current = {
    id: 'installation-1',
    client_name: 'Client',
    site_name: 'Site',
    site_address: 'Address',
    inspector_name: 'Technician',
    audit_date: '2026-08-21',
    status: 'Draft' as const,
    tree_revision: 7,
    server_tree_revision: 4,
    cloud_backup_enabled: true,
    created_at: '2026-08-21T08:00:00.000Z',
    updated_at: '2026-08-21T08:00:00.000Z',
  };
  const snapshot = captureCompletionTreeSnapshot({
    installation: current,
    watermark: 'post-sync-watermark',
  });
  const pending = {
    baseTreeRevision: snapshot.baseTreeRevision!,
    localTreeRevision: snapshot.localTreeRevision,
    treeWatermark: snapshot.treeWatermark,
    idempotencyKey: 'complete-key',
    createdAt: '2026-08-21T09:00:00.000Z',
  };
  let releaseReadiness!: () => void;
  const readinessHeld = new Promise<void>((resolve) => { releaseReadiness = resolve; });
  const prepareAfterReadiness = (async () => {
    await readinessHeld;
    assertCompletionAttemptInstallationState(
      current,
      pending,
      false,
      snapshot.treeWatermark,
    );
  })();

  // The store object is live and the edit deliberately retains the exact same
  // timestamp/watermark. The primitive revision captured before the await is
  // still stale and must reject preparation.
  current.tree_revision = 8;
  releaseReadiness();
  await assert.rejects(prepareAfterReadiness, /Local installation work changed/);
});

test('completion captures one actor generation and revalidates pending state at dispatch', () => {
  const screen = readFileSync(
    new URL('../src/screens/InstallationDetailScreen.tsx', import.meta.url),
    'utf8',
  );
  const start = screen.indexOf('  async function completeInstallation()');
  const end = screen.indexOf('\n  async function reopenInstallation()', start);
  const completion = screen.slice(start, end);
  const capture = completion.indexOf('captureAssignedWorkMutationAuthority()');
  const sync = completion.indexOf('await triggerSync()');
  const prepare = completion.indexOf('await installationsRepo.prepareCompletionAttempt(');
  const dispatchFence = completion.indexOf(
    'await installationsRepo.assertCompletionAttemptCanDispatch(',
  );
  const finalAuthorityFence = completion.indexOf(
    'assertCompletionAuthority();',
    dispatchFence,
  );
  const request = completion.indexOf('await apiClient.completeInstallation(');

  assert.ok(capture >= 0 && capture < sync);
  assert.ok(prepare > sync && prepare < dispatchFence);
  assert.ok(dispatchFence < finalAuthorityFence && finalAuthorityFence < request);
  assert.ok(
    completion.indexOf('await getInstallationBackupTree(installationId)')
      < completion.indexOf('await apiClient.getInstallationReadiness('),
  );
  assert.ok(
    completion.indexOf('await apiClient.getInstallationReadiness(')
      < completion.indexOf('await installationsRepo.prepareCompletionAttempt('),
  );
  assert.match(completion, /captureCompletionTreeSnapshot\(completionTree\)/);
  assert.match(completion, /localTreeRevision,[\s\S]*treeWatermark: completionSnapshot\.treeWatermark/);
  assert.equal(
    completion.slice(0, request).includes('applyServerState(installationId, {\n        status: latest.status'),
    false,
  );
});

test('pending completion persistence is an authenticated repository command, not server reconciliation', () => {
  const repository = readFileSync(
    new URL('../src/repositories/index.ts', import.meta.url),
    'utf8',
  );
  const prepareStart = repository.indexOf('  async prepareCompletionAttempt(');
  const dispatchStart = repository.indexOf('  async assertCompletionAttemptCanDispatch(');
  const discardStart = repository.indexOf('  async discardPreparedCompletionAttempt(');
  const applyStart = repository.indexOf('  async applyServerState(');
  const prepare = repository.slice(prepareStart, dispatchStart);
  const dispatch = repository.slice(dispatchStart, repository.indexOf('\n  async ', dispatchStart + 1));
  const discard = repository.slice(discardStart, repository.indexOf('\n  async ', discardStart + 1));
  const applyServerState = repository.slice(applyStart, repository.indexOf('\n  async ', applyStart + 1));
  const stateGuard = repository.slice(
    repository.indexOf('function assertCompletionAttemptState('),
    repository.indexOf('export const installationsRepo'),
  );

  assert.match(stateGuard, /assertCurrentAssignedWorkAuthority\(attempt\.authority, attempt\.actorUserId\)/);
  assert.match(stateGuard, /assertAssignedWorkMutationAllowed\(installation, attempt\.authority\)/);
  assert.match(prepare, /await updateStore\(\(store\) =>/);
  assert.match(prepare, /assertCompletionAttemptState\(store, current, attempt, false\)/);
  assert.match(prepare, /pending_completion: pendingCompletion/);
  assert.match(dispatch, /assertCompletionAttemptState\(store, installation, attempt, true\)/);
  assert.match(discard, /assertCurrentAssignedWorkAuthority\(attempt\.authority, attempt\.actorUserId\)/);
  assert.match(discard, /pendingCompletionAttemptsMatch/);
  assert.match(discard, /pending_completion: undefined/);
  assert.match(applyServerState, /patch\.pending_completion !== undefined/);
  assert.match(applyServerState, /Use the authenticated completion-attempt command/);
});
