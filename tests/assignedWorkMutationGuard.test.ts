import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  assignedWorkActionIsLocked,
  assignedWorkRouteMustReturnToDetail,
  createAssignedWorkMutationAuthorityRuntime,
  isAssignedWorkAccessRequiredError,
} from '../src/services/assignedWorkMutationGuard';
import {
  createAssignedWorkJobSummarySnapshot,
  createAssignedWorkPrestartAcknowledgement,
  reconcileAssignedWorkPrestartAcknowledgement,
} from '../src/services/assignedWorkPrestart';
import type { AssignedWorkJobSummarySnapshot, Installation } from '../src/types';
import {
  auditWorkIsSuspendedForActor,
  registerAuditWorkSuspension,
  resumeSuspendedAuditWorkForAuthority,
  suspendAuditWorkForAuthority,
  type AuditWorkSuspensionRegistry,
} from '../src/services/auditWorkTrackingResume';

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
  const installation: Installation = {
    id: 'assigned-job',
    local_owner_user_id: 'technician-1',
    client_name: 'Local Client',
    site_name: 'Local Site',
    site_address: 'Local Address',
    inspector_name: 'Technician One',
    audit_date: '2026-08-22',
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
  if (
    installation.status === 'Draft'
    && installation.assigned_work_state === 'active'
    && installation.assigned_work_actor_user_id
  ) {
    installation.assigned_work_prestart_acknowledgement =
      createAssignedWorkPrestartAcknowledgement(
        installation,
        installation.assigned_work_actor_user_id,
        timestamp,
      );
  }
  return installation;
}

test('a pulled summary invalidation ejects an open editor and rejects its captured mutation', () => {
  const runtime = createAssignedWorkMutationAuthorityRuntime();
  runtime.replaceAuthenticatedActor('technician-1');
  const beforePull = assignedDraft();
  const editorMutationAuthority = runtime.capture();

  assert.equal(assignedWorkRouteMustReturnToDetail(
    beforePull,
    'technician-1',
    'FormEditor',
    beforePull.id,
  ), false);
  assert.doesNotThrow(() => {
    runtime.assertMutationAllowed(beforePull, editorMutationAuthority);
  });

  const afterPull: Installation = {
    ...beforePull,
    assigned_work_job_summary: summary({
      site_address: 'Changed scheduler address',
      pulled_at: '2026-08-21T10:00:00.000Z',
    }),
  };
  afterPull.assigned_work_prestart_acknowledgement =
    reconcileAssignedWorkPrestartAcknowledgement(beforePull, afterPull);

  assert.equal(assignedWorkRouteMustReturnToDetail(
    afterPull,
    'technician-1',
    'FormEditor',
    afterPull.id,
  ), true);
  assert.throws(
    () => runtime.assertMutationAllowed(afterPull, editorMutationAuthority),
    isAssignedWorkAccessRequiredError,
  );
  assert.equal(assignedWorkRouteMustReturnToDetail(
    afterPull,
    'technician-1',
    'InstallationDetail',
    afterPull.id,
  ), false);
});

test('an actor/session transition invalidates an in-flight assigned-work authority', () => {
  const runtime = createAssignedWorkMutationAuthorityRuntime();
  runtime.replaceAuthenticatedActor('technician-1');
  const installation = assignedDraft();
  const captured = runtime.capture();

  runtime.replaceAuthenticatedActor(null);
  runtime.replaceAuthenticatedActor('technician-1');

  assert.throws(
    () => runtime.assertMutationAllowed(installation, captured),
    isAssignedWorkAccessRequiredError,
  );
  assert.doesNotThrow(() => {
    runtime.assertMutationAllowed(installation, runtime.capture());
  });
});

test('a fresh headless runtime bootstraps only from one matching persisted cloud actor', () => {
  const runtime = createAssignedWorkMutationAuthorityRuntime();
  const authority = runtime.bootstrapHeadlessActor('technician-1', 'technician-1');

  assert.equal(
    runtime.assertCurrentAuthority(authority, 'technician-1'),
    'technician-1',
  );
  assert.equal(runtime.actorForCurrentAuthority(authority), 'technician-1');
});

test('headless bootstrap fails closed on actor mismatch without seeding the runtime', () => {
  const runtime = createAssignedWorkMutationAuthorityRuntime();

  assert.throws(
    () => runtime.bootstrapHeadlessActor('technician-1', 'technician-2'),
    isAssignedWorkAccessRequiredError,
  );
  assert.equal(runtime.actorForCurrentAuthority(runtime.capture()), null);
});

test('headless bootstrap cannot revive a logged-out runtime or survive replacement', () => {
  const runtime = createAssignedWorkMutationAuthorityRuntime();
  const authority = runtime.bootstrapHeadlessActor('technician-1', 'technician-1');

  runtime.replaceAuthenticatedActor(null);
  assert.throws(
    () => runtime.bootstrapHeadlessActor('technician-1', 'technician-1'),
    isAssignedWorkAccessRequiredError,
  );
  assert.throws(
    () => runtime.assertCurrentAuthority(authority, 'technician-1'),
    isAssignedWorkAccessRequiredError,
  );

  runtime.replaceAuthenticatedActor('technician-2');
  assert.throws(
    () => runtime.bootstrapHeadlessActor('technician-1', 'technician-1'),
    isAssignedWorkAccessRequiredError,
  );
});

test('background sync establishes and repeatedly checks one matching headless authority', () => {
  const source = readFileSync(
    new URL('../src/services/backgroundSync.ts', import.meta.url),
    'utf8',
  );

  const init = source.indexOf('await initStore()');
  const cloudCapture = source.indexOf('await captureCloudSessionAuthority()');
  const persistedActor = source.indexOf('const persistedActorUserId = getStore().user.id');
  const bootstrap = source.indexOf('bootstrapHeadlessAssignedWorkAuthority(');
  const backup = source.indexOf('await runCloudBackup(');
  assert.ok(init >= 0 && init < cloudCapture);
  assert.ok(cloudCapture < persistedActor && persistedActor < bootstrap && bootstrap < backup);
  assert.match(source, /bootstrapHeadlessAssignedWorkAuthority\(\s*cloudAuthority\.actorUserId,\s*persistedActorUserId/);
  assert.match(source, /assertCurrentAssignedWorkAuthority\(\s*assignedWorkAuthority,\s*cloudAuthority\.actorUserId/);
  assert.match(source, /getStore\(\)\.user\.id !== cloudAuthority\.actorUserId/);
});

test('local and nonassigned work is fenced by its captured auth session and owner', () => {
  const runtime = createAssignedWorkMutationAuthorityRuntime();
  runtime.replaceAuthenticatedActor('technician-1');
  const captured = runtime.capture();
  const local = assignedDraft({
    assigned_work_state: 'none',
    assigned_work_actor_user_id: undefined,
    assigned_work_job_summary: undefined,
    assigned_work_prestart_acknowledgement: undefined,
    server_tree_revision: undefined,
  });

  assert.doesNotThrow(() => {
    runtime.assertMutationAllowed(local, captured);
  });
  runtime.replaceAuthenticatedActor(null);
  assert.throws(
    () => runtime.assertMutationAllowed(local, captured),
    isAssignedWorkAccessRequiredError,
  );
  assert.equal(assignedWorkRouteMustReturnToDetail(
    local,
    null,
    'FormEditor',
    local.id,
  ), false);
});

test('Completed, missing-owner, and other-owner records all fail closed', () => {
  const runtime = createAssignedWorkMutationAuthorityRuntime();
  runtime.replaceAuthenticatedActor('technician-1');
  const current = runtime.capture();
  const completed = assignedDraft({ status: 'Completed' });

  assert.doesNotThrow(() => runtime.assertMutationAllowed(completed, current));
  assert.throws(
    () => runtime.assertMutationAllowed({
      ...completed,
      local_owner_user_id: undefined,
    }, current),
    isAssignedWorkAccessRequiredError,
  );
  assert.throws(
    () => runtime.assertMutationAllowed({
      ...completed,
      local_owner_user_id: 'technician-2',
    }, current),
    isAssignedWorkAccessRequiredError,
  );

  runtime.replaceAuthenticatedActor(null);
  runtime.replaceAuthenticatedActor('technician-1');
  assert.throws(
    () => runtime.assertMutationAllowed(completed, current),
    isAssignedWorkAccessRequiredError,
  );
});

test('assignment removal ejects child routes and rejects a mutation queued while active', () => {
  const runtime = createAssignedWorkMutationAuthorityRuntime();
  runtime.replaceAuthenticatedActor('technician-1');
  const beforeRemoval = assignedDraft();
  const queuedMutationAuthority = runtime.capture();
  const inactive: Installation = {
    ...beforeRemoval,
    assigned_work_state: 'inactive',
    assigned_work_prestart_acknowledgement: undefined,
  };

  assert.equal(assignedWorkActionIsLocked(inactive, 'technician-1'), true);
  assert.equal(assignedWorkRouteMustReturnToDetail(
    inactive,
    'technician-1',
    'FormEditor',
    inactive.id,
  ), true);
  assert.equal(assignedWorkRouteMustReturnToDetail(
    inactive,
    'technician-1',
    'InstallationDetail',
    inactive.id,
  ), false);
  assert.throws(
    () => runtime.assertMutationAllowed(inactive, queuedMutationAuthority),
    isAssignedWorkAccessRequiredError,
  );
});

test('an authority captured before an await cannot reconcile after actor replacement', async () => {
  const runtime = createAssignedWorkMutationAuthorityRuntime();
  runtime.replaceAuthenticatedActor('technician-1');
  const captured = runtime.capture();
  let release!: () => void;
  const boundary = new Promise<void>((resolve) => { release = resolve; });
  let reconciled = false;
  const queuedReconciliation = (async () => {
    await boundary;
    runtime.assertCurrentAuthority(captured, 'technician-1');
    reconciled = true;
  })();

  runtime.replaceAuthenticatedActor('technician-2');
  release();
  await assert.rejects(queuedReconciliation, isAssignedWorkAccessRequiredError);
  assert.equal(reconciled, false);
});

test('repository form saves and completion assert the captured guard inside the store mutation', () => {
  const source = readFileSync(
    new URL('../src/repositories/index.ts', import.meta.url),
    'utf8',
  );
  for (const [methodName, mutationMarker] of [
    ['updateDraft', 'store.formSubmissions[index] = updated'],
    ['complete', 'completeFormSubmissionInStore('],
  ] as const) {
    const start = source.indexOf(`  async ${methodName}(`);
    const end = source.indexOf('\n  async ', start + 1);
    const method = source.slice(start, end);
    assert.ok(start >= 0, `${methodName} repository method is present`);
    assert.ok(
      method.indexOf('captureAssignedWorkMutationGuard()')
        < method.indexOf('await updateStore((store) =>'),
      `${methodName} captures authority before its asynchronous mutation`,
    );
    assert.ok(
      method.indexOf('assertAssignedWorkAccess(installation)')
        < method.indexOf(mutationMarker),
      `${methodName} validates current store access before changing the form`,
    );
  }
});

test('acknowledgement uses the current auth fence and the exact summary displayed to the user', () => {
  const source = readFileSync(
    new URL('../src/repositories/index.ts', import.meta.url),
    'utf8',
  );
  const start = source.indexOf('  async acknowledgeAssignedWorkPrestart(');
  const end = source.indexOf('\n  async ', start + 1);
  const method = source.slice(start, end);

  assert.match(method, /captureAssignedWorkMutationAuthority\(\)/);
  assert.match(method, /actorForCurrentAssignedWorkAuthority\(authority\)/);
  assert.match(method, /assignedWorkSummarySha256\(installation\.assigned_work_job_summary\)/);
  assert.match(method, /!== expectedSummarySha256/);
});

test('auth transitions fence assigned mutations before asynchronous persistence or logout cleanup', () => {
  const source = readFileSync(
    new URL('../src/context/AppProviders.tsx', import.meta.url),
    'utf8',
  );
  const loginStart = source.indexOf('const login = useCallback');
  const logoutStart = source.indexOf('const logout = useCallback');
  const login = source.slice(loginStart, logoutStart);
  const logout = source.slice(logoutStart, source.indexOf('const authValue', logoutStart));

  assert.ok(
    login.indexOf('replaceAuthenticatedAssignedWorkActor(nextUser.id)')
      < login.indexOf('await userRepo.setCurrent(nextUser)'),
  );
  assert.ok(
    logout.indexOf('replaceAuthenticatedAssignedWorkActor(null)')
      < logout.indexOf('await closeAuditWorkBeforeLogout()'),
  );
});

test('a tracker resume held across logout restores the old actor suspension', async () => {
  const suspended: AuditWorkSuspensionRegistry = new Map();
  const token = registerAuditWorkSuspension(
    suspended,
    'installation-1',
    'technician-1',
    'suspension-1',
  );
  let authorityCurrent = true;
  let actorUserId: string | null = 'technician-1';
  let releaseEligibility!: () => void;
  const eligibilityHeld = new Promise<void>((resolve) => {
    releaseEligibility = resolve;
  });
  let calls = 0;
  const resume = resumeSuspendedAuditWorkForAuthority(
    suspended,
    token,
    {
      actorUserId: 'technician-1',
      isCurrent: () => authorityCurrent,
    },
    () => actorUserId,
    async () => {
      calls += 1;
      if (calls === 1) await eligibilityHeld;
    },
  );

  await Promise.resolve();
  assert.equal(
    auditWorkIsSuspendedForActor(suspended, 'installation-1', 'technician-1'),
    false,
  );
  authorityCurrent = false;
  // Logout invalidates authority before the tracking provider changes actor.
  actorUserId = 'technician-1';
  releaseEligibility();
  assert.equal(await resume, false);
  assert.equal(
    auditWorkIsSuspendedForActor(suspended, 'installation-1', 'technician-1'),
    true,
  );
  assert.equal(calls, 2);
});

test('a stale A resume cannot remove B same-installation suspension', async () => {
  const suspended: AuditWorkSuspensionRegistry = new Map();
  const actorAToken = registerAuditWorkSuspension(
    suspended,
    'installation-1',
    'actor-a',
    'actor-a-token',
  );
  let actorACurrent = true;
  let currentActorUserId: string | null = 'actor-a';
  let releaseEligibility!: () => void;
  const eligibilityHeld = new Promise<void>((resolve) => {
    releaseEligibility = resolve;
  });
  const resume = resumeSuspendedAuditWorkForAuthority(
    suspended,
    actorAToken,
    { actorUserId: 'actor-a', isCurrent: () => actorACurrent },
    () => currentActorUserId,
    () => eligibilityHeld,
  );

  await Promise.resolve();
  actorACurrent = false;
  currentActorUserId = 'actor-b';
  registerAuditWorkSuspension(
    suspended,
    'installation-1',
    'actor-b',
    'actor-b-token',
  );
  releaseEligibility();

  assert.equal(await resume, false);
  assert.equal(auditWorkIsSuspendedForActor(suspended, 'installation-1', 'actor-a'), false);
  assert.equal(auditWorkIsSuspendedForActor(suspended, 'installation-1', 'actor-b'), true);
});

test('legacy same-actor resumes release one owned suspension token at a time', async () => {
  const suspended: AuditWorkSuspensionRegistry = new Map();
  registerAuditWorkSuspension(suspended, 'installation-1', 'actor-a', 'actor-a-one');
  registerAuditWorkSuspension(suspended, 'installation-1', 'actor-a', 'actor-a-two');
  const authority = { actorUserId: 'actor-a', isCurrent: () => true };

  assert.equal(await resumeSuspendedAuditWorkForAuthority(
    suspended,
    'installation-1',
    authority,
    () => 'actor-a',
    async () => {},
  ), true);
  assert.equal(auditWorkIsSuspendedForActor(suspended, 'installation-1', 'actor-a'), true);

  assert.equal(await resumeSuspendedAuditWorkForAuthority(
    suspended,
    'installation-1',
    authority,
    () => 'actor-a',
    async () => {},
  ), true);
  assert.equal(auditWorkIsSuspendedForActor(suspended, 'installation-1', 'actor-a'), false);
});

test('a held stale A suspend removes only A token and preserves B same-ID suspension', async () => {
  const suspended: AuditWorkSuspensionRegistry = new Map();
  let actorACurrent = true;
  let currentActorUserId: string | null = 'actor-a';
  let releaseEligibility!: () => void;
  const eligibilityHeld = new Promise<void>((resolve) => {
    releaseEligibility = resolve;
  });
  const suspend = suspendAuditWorkForAuthority(
    suspended,
    'installation-1',
    { actorUserId: 'actor-a', isCurrent: () => actorACurrent },
    () => currentActorUserId,
    () => 'actor-a-token',
    () => eligibilityHeld,
  );

  await Promise.resolve();
  actorACurrent = false;
  currentActorUserId = 'actor-b';
  registerAuditWorkSuspension(
    suspended,
    'installation-1',
    'actor-b',
    'actor-b-token',
  );
  releaseEligibility();

  assert.equal(await suspend, null);
  assert.equal(auditWorkIsSuspendedForActor(suspended, 'installation-1', 'actor-a'), false);
  assert.equal(auditWorkIsSuspendedForActor(suspended, 'installation-1', 'actor-b'), true);
});

test('every installation delete flow owns suspend and resume with one captured generation', () => {
  for (const filename of [
    'DashboardScreen.tsx',
    'InstallationFormScreen.tsx',
    'InstallationDetailScreen.tsx',
  ]) {
    const source = readFileSync(
      new URL(`../src/screens/${filename}`, import.meta.url),
      'utf8',
    );
    const captureIndex = source.lastIndexOf(
      'captureAuditWorkResumeAuthority(actorUserId)',
    );
    assert.ok(captureIndex >= 0, `${filename} captures delete authority`);
    const deleteFlow = source.slice(
      Math.max(0, captureIndex - 500),
      captureIndex + 2_500,
    );
    assert.match(deleteFlow, /captureAuditWorkResumeAuthority\(actorUserId\)/, filename);
    assert.match(
      deleteFlow,
      /suspendAuditWorkForInstallation\([\s\S]*resumeAuthority[\s\S]*\)/,
      filename,
    );
    assert.match(
      deleteFlow,
      /resumeAuditWorkForInstallation\([\s\S]*suspension,[\s\S]*resumeAuthority[\s\S]*\)/,
      filename,
    );
  }
});

test('the root observer and pending-autosave release are wired to the same access policy', () => {
  const navigator = readFileSync(
    new URL('../src/navigation/RootNavigator.tsx', import.meta.url),
    'utf8',
  );
  const formEditor = readFileSync(
    new URL('../src/screens/FormEditorScreen.tsx', import.meta.url),
    'utf8',
  );

  assert.match(navigator, /subscribeStore\(enforceAssignedWorkRoute\)/);
  assert.match(navigator, /StackActions\.popTo\('InstallationDetail'/);
  assert.match(formEditor, /isAssignedWorkAccessRequiredError\(error\)/);
  assert.match(formEditor, /await autosave\.cancelPending\(\)/);
  assert.match(formEditor, /setReleasedNavigationAction\(data\.action\)/);
});

test('assignment pull, materialization and actor-scoped sync recheck one auth generation', () => {
  const repository = readFileSync(
    new URL('../src/repositories/remoteInstallationsRepository.ts', import.meta.url),
    'utf8',
  );
  const assignedSync = repository.slice(
    repository.indexOf('export async function syncAssignedInstallations'),
  );
  assert.ok(
    assignedSync.indexOf('captureAssignedWorkMutationAuthority()')
      < assignedSync.indexOf('apiClient.pull('),
  );
  assert.match(assignedSync, /apiClient\.pull\([\s\S]*cloudAuthority/);
  assert.match(assignedSync, /await apiClient\.pull[\s\S]*assertCurrentSession\(\)/);
  assert.match(assignedSync, /await updateStore\(\(store\) => \{\s*assertCurrentSession\(\)/);
  assert.match(assignedSync, /assignedWorkAuthority: authority/);

  const materialize = repository.slice(
    repository.indexOf('export async function importRemoteInstallationAsCopy'),
    repository.indexOf('export async function syncAssignedInstallations'),
  );
  assert.match(materialize, /assertAssignedMaterializationSession\(\)/);
  assert.match(
    materialize,
    /await updateStore\(\(store\) => \{\s*assertAssignedMaterializationSession\(\)/,
  );

  const context = readFileSync(
    new URL('../src/services/SyncStatusContext.tsx', import.meta.url),
    'utf8',
  );
  assert.match(context, /type AuthenticatedSyncFlight/);
  assert.match(context, /currentFlight\.actorUserId === actorUserId/);
  assert.match(context, /if \(priorFlight\) await priorFlight\.catch/);
  const backup = context.indexOf('const result = await runCloudBackup');
  const authorityCheck = context.lastIndexOf(
    'assertCurrentAssignedWorkAuthority(authority, actorUserId)',
    backup,
  );
  assert.ok(authorityCheck >= 0 && authorityCheck < backup);
});

test('detail actions and recovery-draft autosaves use the inactive access policy', () => {
  const detail = readFileSync(
    new URL('../src/screens/InstallationDetailScreen.tsx', import.meta.url),
    'utf8',
  );
  assert.match(detail, /const assignedWorkInactive = item\.assigned_work_state === 'inactive'/);
  assert.match(detail, /assignedWorkActionIsLocked\(/);
  assert.match(detail, /Assignment no longer active/);
  assert.match(
    detail,
    /item\.assigned_work_state === 'inactive'[\s\S]*setZoneModal\(false\)[\s\S]*setGridModal\(false\)[\s\S]*setSecondaryOpen\(false\)/,
  );

  const recoveryDraft = readFileSync(
    new URL('../src/services/siteAssetEditorDraft.ts', import.meta.url),
    'utf8',
  );
  const save = recoveryDraft.slice(
    recoveryDraft.indexOf('export async function saveSiteAssetEditorDraft'),
    recoveryDraft.indexOf('export async function clearSiteAssetEditorDraft'),
  );
  assert.ok(
    save.indexOf('captureAssignedWorkMutationGuard()')
      < save.indexOf('await updateStore((store) =>'),
  );
  assert.ok(
    save.indexOf('assertAssignedWorkAccess(installation)')
      < save.indexOf('store.siteAssetEditorDrafts ='),
  );
});
