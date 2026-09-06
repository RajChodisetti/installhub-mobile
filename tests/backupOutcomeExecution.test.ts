import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as confirmation from '../src/services/completeBackupConfirmation';
import * as metadataRejection from '../src/services/metadataBackupRejection';
import * as metadataConfirmation from '../src/services/metadataBackupConfirmation';
import { sha256 } from 'js-sha256';
import * as singleFlight from '../src/services/singleFlightProgress';
import { shouldRecordConfirmedBackup } from '../src/services/backupOutcome';
import type { SyncProgress } from '../src/services/syncService';

const actor = 'authorized-actor';
const watermark = '2026-09-05T12:00:00.000Z';
type Options = {
  selected?: string[];
  deferred?: string[];
  current?: string[];
  skipAtDispatch?: { id: string; becomes: 'deferred' | 'opted-out' | 'invisible' };
  invalidCompleteAck?: string;
  changedCanonicalLifecycle?: string;
  delayFinish?: boolean;
  pendingMetadata?: string;
  failMetadataPush?: boolean;
  refreshAssigned?: boolean;
  firstCreate?: string;
  preimageError?: { status: number; message: string };
  manualRetry?: boolean;
  emptyFirstCreate?: boolean;
};

/** Execute the production engine AND exact final-confirmation state machine.
 * Only repository/API/native I/O is controlled; no actual network/store/device.
 * The repository selector's own authority rules have separate production tests.
 */
function backupHarness(options: Options = {}) {
  const initial = options.selected ?? [];
  const deferred = new Set(options.deferred ?? []);
  const current = new Set(options.current ?? []);
  const visible = new Set([...initial, ...deferred, ...current]);
  const optedIn = new Set(visible);
  const blocked = new Set<string>();
  const finished: string[] = [];
  const events: Array<{ kind: string; id?: string; mode?: string }> = [];
  const progress: SyncProgress[] = [];
  const pending = new Map<string, any>();
  const metadataPending = new Map<string, any>();
  if (options.pendingMetadata) metadataPending.set(options.pendingMetadata, {
    id: `metadata:${options.pendingMetadata}`, installation_id: options.pendingMetadata, actor_user_id: actor,
    payload: { id: options.pendingMetadata, mode: 'metadata' }, base_tree_revision: 10,
  });
  const lastPushMode = new Map<string, string>();
  const cloudAuthority = {};
  const assignedAuthority = {};
  let selectionReads = 0;
  let releaseFinish!: () => void;
  const finishGate = options.delayFinish ? new Promise<void>((resolve) => { releaseFinish = resolve; }) : Promise.resolve();
  const tree = (id: string) => ({
    installation: { id, status: 'Draft', tree_revision: 7, cloud_backup_enabled: optedIn.has(id) },
    watermark, baseTreeRevision: options.firstCreate === id ? undefined : 10,
  });
  const assertActor = (value: string) => assert.equal(value, actor);
  const assertCloud = (authority: unknown, id: string) => { assert.equal(authority, cloudAuthority); assertActor(id); };
  class DispatchBlocked extends Error {}
  class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }
  class AuthError extends Error {}
  class NetworkError extends Error {}
  const assertDispatch = (id: string, actorId: string) => {
    assertActor(actorId);
    if (blocked.has(id)) throw new DispatchBlocked('Dispatch paused');
  };
  const checkedFence = (fence: any, id: string) => {
    assertActor(fence.actorUserId); assert.equal(fence.expectedLocalTreeRevision, 7);
    assert.equal(fence.expectedTreeWatermark, watermark); assert.ok(visible.has(id));
    fence.assertCurrent();
  };
  const repository = {
    InstallationBackupDispatchBlockedError: DispatchBlocked,
    assertInstallationAllowsNewBackupDispatch: assertDispatch,
    assertInstallationAllowsBackupRecovery: (_: string, actorId: string) => assertActor(actorId),
    resetInterruptedUploads: async (actorId: string) => { assertActor(actorId); events.push({ kind: 'reset' }); },
    listPendingCompleteBackupAttempts: async () => [],
    getInstallationBackupSelection: async (actorId: string) => {
      assertActor(actorId); selectionReads += 1;
      return {
        trees: initial.filter((id) => visible.has(id) && optedIn.has(id) && !deferred.has(id) && !current.has(id)).map(tree),
        visibleInstallationIds: [...visible], optedInInstallationIds: [...optedIn],
        deferredInstallationIds: [...deferred].filter((id) => visible.has(id) && optedIn.has(id)),
        alreadyCurrentInstallationIds: [...current].filter((id) => visible.has(id) && optedIn.has(id)),
      };
    },
    getInstallationBackupTree: async (id: string) => visible.has(id) ? tree(id) : null,
    listUploadQueue: async () => [],
    getNextUpload: async () => null,
    reconcileBackupMediaQueue: async (id: string, media: unknown[], fence: any) => {
      checkedFence(fence, id); assert.deepEqual(media, []);
      const skip = options.skipAtDispatch;
      if (skip?.id === id) {
        blocked.add(id);
        if (skip.becomes === 'deferred') deferred.add(id);
        if (skip.becomes === 'opted-out') optedIn.delete(id);
        // A disappearance happens only after the recovery tree has been read;
        // the final-selection filter is exercised by the dispatch assertion.
      }
    },
    prepareCompleteBackupAttempt: async (id: string, actorId: string, payload: any, mark: string, status: string, revision: number, fence: any) => {
      assertActor(actorId); checkedFence(fence, id); assert.equal(payload.mode, 'complete');
      const attempt = { id: `attempt:${id}`, installation_id: id, payload, tree_watermark: mark,
        installation_status: status, local_tree_revision: revision };
      pending.set(id, attempt); events.push({ kind: 'prepare', id }); return attempt;
    },
    recordAcceptedCompleteBackupAttempt: async (id: string, attemptId: string, revision: number, _version: number | null, check: () => void) => {
      check(); assert.equal(pending.get(id)?.id, attemptId); assert.equal(revision, 12);
      pending.get(id).accepted_tree_revision = revision; events.push({ kind: 'accepted', id });
    },
    finishCompleteBackupAttempt: async (id: string, attemptId: string, check: () => void) => {
      check(); assert.equal(pending.get(id)?.id, attemptId);
      events.push({ kind: 'finish-started', id }); await finishGate; check();
      pending.delete(id); current.add(id); finished.push(id); events.push({ kind: 'finished', id });
    },
    getPendingCompleteBackupAttempt: async (id: string) => pending.get(id),
    discardCompleteBackupAttempt: async (id: string, attemptId: string, check: () => void) => {
      check(); assert.equal(pending.get(id)?.id, attemptId); pending.delete(id); events.push({ kind: 'discarded', id });
    },
    markInstallationBackupConflict: async (id: string, _revision: number, check: () => void) => {
      check(); deferred.add(id); events.push({ kind: 'conflict', id });
    },
  };
  const normalDispatch = repository.assertInstallationAllowsNewBackupDispatch;
  // Keep the former selector available to the baseline regression run, so
  // old reporting fails on its outcome rather than a missing mock dependency.
  Object.assign(repository, { listInstallationsNeedingBackup: async (actorId: string) =>
    (await repository.getInstallationBackupSelection(actorId)).trees });
  repository.assertInstallationAllowsNewBackupDispatch = (id: string, actorId: string) => {
    if (options.skipAtDispatch?.id === id && options.skipAtDispatch.becomes === 'invisible' && blocked.has(id)) {
      visible.delete(id); optedIn.delete(id);
    }
    normalDispatch(id, actorId);
  };
  const modules: Record<string, unknown> = {
    './ownedMediaPaths': { resolveOwnedMediaUri: (uri: string) => uri },
    './installationRecoveryFence': { anyInstallationRecoveryIsActive: () => false },
    'expo-file-system': { File: class { constructor() { throw new Error('Unexpected evidence file access'); } } },
    'js-sha256': { sha256 },
    '../api/apiClient': {
      ApiError, AuthError, NetworkError, assertCurrentCloudSessionAuthority: assertCloud,
      apiClient: {
        push: async (payload: any, authority: unknown) => {
          assert.equal(authority, cloudAuthority); const { id, mode } = payload;
          events.push({ kind: 'push', id, mode }); lastPushMode.set(id, mode);
          if (mode === 'metadata' && options.failMetadataPush) throw new Error('Metadata response lost');
          return { installationId: mode === 'complete' && options.invalidCompleteAck === id ? 'foreign-installation' : id,
            treeRevision: mode === 'complete' ? 12 : 11, recordVersionNumber: null };
        },
        pull: async (since: string, id: string, authority: unknown) => {
          assert.equal(authority, cloudAuthority); assert.equal(since, '1970-01-01T00:00:00.000Z');
          events.push({ kind: 'pull', id });
          if (!lastPushMode.has(id) && options.emptyFirstCreate) return { installations: [] };
          if (!lastPushMode.has(id) && options.preimageError) throw new ApiError(options.preimageError.message, options.preimageError.status);
          const revision = lastPushMode.get(id) === 'complete' ? 12 : lastPushMode.has(id) ? 11 : 10;
          return { installations: [{ treeSchemaVersion: 2, treeRevision: revision, installation: { id,
            status: options.changedCanonicalLifecycle === id && lastPushMode.get(id) === 'complete' ? 'Completed' : 'Draft' } }] };
        },
      },
    },
    '../repositories/cloudSyncRepository': repository,
    '../repositories/metadataBackupRepository': {
      listAcceptedMetadataConflicts: async () => [],
      listPendingMetadataBackupAttempts: async (actorId: string) => { assertActor(actorId); return [...metadataPending.values()]; },
      prepareMetadataBackupAttempt: async (value: any, payload: any, guard: any, prior: any, foreground: any) => {
        const id = value.installation.id; checkedFence(guard, id);
        assert.equal(payload.mode, 'metadata');
        if (options.manualRetry) {
          assert.equal(foreground.descriptor, authority.rejectedMetadataRetry);
          assert.equal(foreground.firstCreateAbsenceProved, options.preimageError?.status === 404);
          if (options.firstCreate === id && !foreground.firstCreateAbsenceProved) throw new Error('Exact scoped absence proof required');
        } else assert.equal(foreground, undefined);
        if (options.firstCreate === id) assert.equal(prior, undefined);
        else { assert.equal(prior.installation.id, id); assert.equal(prior.treeRevision, 10); }
        const attempt = { id: `metadata:${id}`, installation_id: id, actor_user_id: actor, payload, base_tree_revision: 10 };
        metadataPending.set(id, attempt); events.push({ kind: 'metadata-prepared', id }); return attempt;
      },
      recordAcceptedMetadataBackupAttempt: async (attempt: any, result: any, check: () => void) => {
        check(); assert.equal(metadataPending.get(attempt.installation_id)?.id, attempt.id); assert.equal(result.treeRevision, 11);
        events.push({ kind: 'metadata-accepted', id: attempt.installation_id });
      },
      finishMetadataBackupAttempt: async (attempt: any, remote: any, guard: any, revision: number) => {
        checkedFence(guard, attempt.installation_id); assert.equal(remote.installation.id, attempt.installation_id); assert.equal(revision, 11);
        assert.equal(guard.expectedTreeSnapshotSha256, sha256(JSON.stringify(tree(attempt.installation_id))));
        metadataPending.delete(attempt.installation_id); events.push({ kind: 'metadata-finished', id: attempt.installation_id });
      },
      archiveConflictedMetadataBackupAttempt: async () => { throw new Error('Unexpected metadata conflict archive'); },
    },
    './metadataBackupConfirmation': metadataConfirmation,
    './metadataBackupRejection': metadataRejection,
    './remoteInstallationValidation': { validateCanonicalRemoteTreeIds: (remote: any) => {
      assert.equal(remote.treeSchemaVersion, 2); assert.ok(visible.has(remote.installation.id));
    } },
    '../repositories': { installationsRepo: { applyServerState: async (id: string, _patch: unknown, fence: any) => { checkedFence(fence, id); events.push({ kind: 'apply', id }); } } },
    './backupMedia': { buildBackupPayload: (value: any, queue: unknown[], mode: string) => {
      assert.deepEqual(queue, []); return { id: value.installation.id, mode };
    }, discoverBackupMedia: () => [] },
    './completeBackupConfirmation': confirmation,
    './displayCodeReconciliation': { reconcileResolvedDisplayCodes: async (id: string, remote: any, revision: number, fence: any) => {
      checkedFence(fence, id); assert.equal(remote.installation.id, id);
      assert.equal(revision, lastPushMode.get(id) === 'complete' ? 12 : 11);
    } },
    './operationalDiagnostics': { recordBackupPendingAge: async () => {}, recordSyncDiagnostic: async () => {} },
    './uploadConfirmationRevision': {}, './uploadConfirmationRecovery': {}, './backupAuthorityFence': {},
    './singleFlightProgress': singleFlight,
    './assignedWorkMutationGuard': { assertCurrentAssignedWorkAuthority: (authority: unknown, actorId: string) => { assert.equal(authority, assignedAuthority); assertActor(actorId); } },
    './serverResultCommitFence': { captureServerResultInstallationSnapshot: (value: any) => ({
      localTreeRevision: value.installation.tree_revision, treeWatermark: value.watermark,
      status: value.installation.status, recordVersionNumber: undefined,
    }) },
  };
  const exports: any = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/services/syncService.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, Error, Date, Set, Map, Promise,
    require: (name: string) => { assert.ok(name in modules, `Unexpected runtime dependency ${name}`); return modules[name]; },
  });
  const authority = { identity: {}, actorUserId: actor, cloudAuthority, assignedWorkAuthority: assignedAuthority,
    rejectedMetadataRetry: options.manualRetry ? Object.freeze({ actorUserId: actor, attempts: Object.freeze([]) }) : undefined,
    ...(options.refreshAssigned ? { beforeNewBackups: async () => {
      assert.equal(metadataPending.size, 0, 'Assigned pull must not precede metadata recovery');
      events.push({ kind: 'assigned-pull' });
    } } : {}),
  };
  return {
    run: () => exports.runCloudBackup((value: SyncProgress) => { progress.push(value); }, authority) as Promise<SyncProgress>,
    events, progress, finished, pending, metadataPending, releaseFinish: () => releaseFinish(), selectionReads: () => selectionReads,
  };
}
function outcome(progress: SyncProgress) {
  assert.ok(progress.installationOutcome, 'Run must report installation counts separately from the evidence queue');
  return JSON.parse(JSON.stringify(progress.installationOutcome));
}

test('empty backup run rechecks selection and cannot record an installation confirmation', async () => {
  const h = backupHarness(); const done = await h.run();
  assert.equal(done.phase, 'done'); assert.equal(h.selectionReads(), 2);
  assert.deepEqual(outcome(done), { selected: 0, confirmed: 0, alreadyCurrent: 0, deferred: 0, remaining: 0 });
  assert.equal(shouldRecordConfirmedBackup(done), false); assert.deepEqual(h.events.map((event) => event.kind), ['reset']);
});

test('already current installations are reported without claiming a new upload', async () => {
  const h = backupHarness({ current: ['current'] }); const done = await h.run();
  assert.deepEqual(outcome(done), { selected: 0, confirmed: 0, alreadyCurrent: 1, deferred: 0, remaining: 0 });
  assert.equal(shouldRecordConfirmedBackup(done), false); assert.deepEqual(h.finished, []);
});

test('deferred-only opted-in work is visible even with zero evidence queue and zero selected trees', async () => {
  const h = backupHarness({ deferred: ['paused'] }); const done = await h.run();
  assert.equal(done.phase, 'done'); assert.equal(done.total, 0); assert.equal(done.failedCount, 0);
  assert.deepEqual(outcome(done), { selected: 0, confirmed: 0, alreadyCurrent: 0, deferred: 1, remaining: 1 });
  assert.equal(shouldRecordConfirmedBackup(done), false); assert.deepEqual(h.finished, []);
  assert.equal(h.events.some((event) => event.kind === 'push'), false);
});

test('one exact completed tree confirmation and one paused tree yield a mixed outcome', async () => {
  const h = backupHarness({ selected: ['ready'], deferred: ['paused'] }); const done = await h.run();
  assert.equal(done.phase, 'done'); assert.equal(done.total, 0);
  assert.deepEqual(outcome(done), { selected: 1, confirmed: 1, alreadyCurrent: 0, deferred: 1, remaining: 1 });
  assert.deepEqual(h.finished, ['ready']); assert.equal(shouldRecordConfirmedBackup(done), false);
  assert.deepEqual(h.events.filter((event) => event.kind === 'push').map(({ id, mode }) => ({ id, mode })),
    [{ id: 'ready', mode: 'metadata' }, { id: 'ready', mode: 'complete' }]);
  assert.equal(JSON.stringify(done.installationOutcome).includes('paused'), false, 'progress exposes scoped counts, not record IDs');
});

for (const becomes of ['deferred', 'opted-out', 'invisible'] as const) {
  test(`dispatch-time ${becomes} transition cannot claim a completed tree`, async () => {
    const h = backupHarness({ selected: ['racing'], skipAtDispatch: { id: 'racing', becomes } }); const done = await h.run();
    assert.equal(done.phase, 'done'); assert.deepEqual(h.finished, []);
    assert.equal(h.events.some((event) => event.kind === 'push'), false);
    assert.deepEqual(outcome(done), { selected: becomes === 'invisible' ? 0 : 1, confirmed: 0, alreadyCurrent: 0,
      deferred: becomes === 'deferred' ? 1 : 0, remaining: becomes === 'deferred' ? 1 : 0 });
    assert.equal(shouldRecordConfirmedBackup(done), false);
  });
}

test('exact acknowledgement rejection is not counted or recorded as a confirmed backup', async () => {
  const h = backupHarness({ selected: ['ready'], invalidCompleteAck: 'ready' }); const result = await h.run();
  assert.equal(result.phase, 'error'); assert.match(result.lastError!, /invalid complete backup acknowledgement/);
  assert.equal(result.failedCount, 0, 'confirmation failure is not a failed evidence upload');
  assert.deepEqual(h.finished, []); assert.equal(h.events.some((event) => event.kind === 'accepted'), false);
  assert.equal(h.pending.size, 1, 'ambiguous final attempt remains durable for its normal recovery path');
  assert.equal(shouldRecordConfirmedBackup(result), false);
  assert.equal(h.progress.some((progress) => progress.phase === 'done'), false);
});

test('accepted push followed by canonical lifecycle rejection is never a confirmation', async () => {
  const h = backupHarness({ selected: ['ready'], changedCanonicalLifecycle: 'ready' }); const result = await h.run();
  assert.equal(result.phase, 'error'); assert.match(result.lastError!, /Server lifecycle changed/);
  assert.equal(result.failedCount, 0, 'canonical lifecycle failure is not a failed evidence upload');
  assert.equal(h.events.some((event) => event.kind === 'accepted'), true);
  assert.deepEqual(h.finished, []); assert.equal(h.events.some((event) => event.kind === 'conflict'), true);
  assert.equal(shouldRecordConfirmedBackup(result), false);
});

test('confirmed count becomes available only after the real final-confirmation finish resolves', async () => {
  const h = backupHarness({ selected: ['ready'], delayFinish: true }); const running = h.run();
  for (let turn = 0; turn < 30 && !h.events.some((event) => event.kind === 'finish-started'); turn += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(h.events.some((event) => event.kind === 'finish-started'), true);
  assert.deepEqual(h.finished, []); assert.equal(h.progress.some((progress) => progress.phase === 'done'), false);
  h.releaseFinish(); const done = await running;
  assert.deepEqual(outcome(done), { selected: 1, confirmed: 1, alreadyCurrent: 0, deferred: 0, remaining: 0 });
  assert.equal(shouldRecordConfirmedBackup(done), true); assert.deepEqual(h.finished, ['ready']);
});


test('persisted metadata is acknowledged before ordinary assigned pull and is never a full backup confirmation', async () => {
  const h = backupHarness({ pendingMetadata: 'recovering', current: ['recovering'], refreshAssigned: true });
  const done = await h.run();
  assert.equal(done.phase, 'done');
  assert.deepEqual(h.events.map((event) => event.kind), [
    'reset', 'push', 'metadata-accepted', 'pull', 'metadata-finished', 'assigned-pull',
  ]);
  assert.equal(h.metadataPending.size, 0);
  assert.equal(outcome(done).confirmed, 0);
  assert.equal(shouldRecordConfirmedBackup(done), false);
  assert.deepEqual(h.finished, []);
});

test('ambiguous metadata replay prevents assigned pull and keeps the exact request pending', async () => {
  const h = backupHarness({ pendingMetadata: 'recovering', current: ['recovering'], refreshAssigned: true, failMetadataPush: true });
  const original = JSON.stringify(h.metadataPending.get('recovering'));
  const failed = await h.run();
  assert.equal(failed.phase, 'error');
  assert.match(failed.lastError ?? '', /Metadata response lost/);
  assert.deepEqual(h.events.map((event) => event.kind), ['reset', 'push']);
  assert.equal(JSON.stringify(h.metadataPending.get('recovering')), original);
  assert.equal(failed.installationOutcome?.confirmed ?? 0, 0);
  assert.equal(shouldRecordConfirmedBackup(failed), false);
});


test('first offline create treats the scoped API Installation not found 404 as no preimage and completes normally', async () => {
  const h = backupHarness({ selected: ['new'], firstCreate: 'new', preimageError: { status: 404, message: 'Installation not found' } });
  const done = await h.run();
  assert.equal(done.phase, 'done');
  assert.equal(outcome(done).confirmed, 1);
  assert.ok(h.events.findIndex((event) => event.kind === 'pull') < h.events.findIndex((event) => event.kind === 'metadata-prepared'));
  assert.deepEqual(h.finished, ['new']);
});

for (const [label, firstCreate, error] of [
  ['existing base missing', false, { status: 404, message: 'Installation not found' }],
  ['new create forbidden', true, { status: 403, message: 'Forbidden' }],
  ['new create other missing route', true, { status: 404, message: 'Route not found' }],
  ['new create service failure', true, { status: 503, message: 'Unavailable' }],
] as const) test(`metadata preimage ${label} never dispatches or creates an intent`, async () => {
  const h = backupHarness({ selected: ['job'], ...(firstCreate ? { firstCreate: 'job' } : {}), preimageError: error });
  const failed = await h.run();
  assert.equal(failed.phase, 'error');
  assert.equal(failed.lastError, error.message);
  assert.equal(h.events.some((event) => event.kind === 'push' || event.kind === 'metadata-prepared'), false);
  assert.equal(h.metadataPending.size, 0);
  assert.deepEqual(h.finished, []);
});


test('a first-create whose exact ID already exists never guesses a server base', async () => {
  const h = backupHarness({ selected: ['new'], firstCreate: 'new' });
  const failed = await h.run();
  assert.equal(failed.phase, 'error');
  assert.match(failed.lastError ?? '', /known metadata base/);
  assert.equal(h.events.some((event) => event.kind === 'push' || event.kind === 'metadata-prepared'), false);
  assert.equal(h.metadataPending.size, 0);
});


test('manual engine carries its scoped descriptor and exact first-create404 proof into durable preparation', async () => {
  const h = backupHarness({ selected: ['first'], firstCreate: 'first', manualRetry: true,
    preimageError: { status: 404, message: 'Installation not found' } });
  const result = await h.run(); assert.equal(result.phase, 'done');
  const prepared = h.events.findIndex((event) => event.kind === 'metadata-prepared');
  const push = h.events.findIndex((event) => event.kind === 'push' && event.mode === 'metadata');
  assert.ok(prepared >= 0 && push > prepared);
});

test('manual engine cannot promote an empty first-create response into scoped absence permission', async () => {
  const h = backupHarness({ selected: ['first'], firstCreate: 'first', manualRetry: true, emptyFirstCreate: true });
  const result = await h.run(); assert.equal(result.phase, 'error'); assert.match(result.lastError!, /Exact scoped absence/);
  assert.equal(h.events.filter((event) => event.kind === 'push').length, 0);
});
