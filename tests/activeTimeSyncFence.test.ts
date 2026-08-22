import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createAuditWorkTracker } from '../src/services/auditWorkTrackingPolicy';
import { dispatchAndAcknowledgeActiveTimeForAuthority } from '../src/services/activeTimeDispatchFence';
import { activeTimeServerParentIsReady } from '../src/services/activeTimeDeliveryPolicy';
import { installationAllowsActiveWorkTracking } from '../src/services/assignedWorkPrestart';
import { assignedWorkInstallationIsVisibleToActor } from '../src/services/assignedWorkPolicy';
import type { Installation } from '../src/types';

const timestamp = '2026-08-21T09:00:00.000Z';

test('active assigned parent readiness requires the exact checkpoint actor', () => {
  const assigned = {
    cloud_backup_enabled: true,
    server_tree_revision: 5,
    local_owner_user_id: 'actor-a',
    assigned_work_state: 'active' as const,
    assigned_work_actor_user_id: 'actor-a',
  };
  assert.equal(activeTimeServerParentIsReady(assigned, 'actor-a'), true);
  assert.equal(activeTimeServerParentIsReady(assigned, 'actor-b'), false);
  const local = {
    ...assigned,
    assigned_work_state: 'none',
    assigned_work_actor_user_id: undefined,
  } as const;
  assert.equal(activeTimeServerParentIsReady(local, 'actor-a'), true);
  assert.equal(activeTimeServerParentIsReady(local, 'actor-b'), false);
});

test('session replacement after held active-time PUT cannot acknowledge A under B', async () => {
  let current = true;
  let acknowledgeCalled = false;
  let dispatchStarted!: () => void;
  const started = new Promise<void>((resolve) => { dispatchStarted = resolve; });
  let releaseDispatch!: () => void;
  const held = new Promise<void>((resolve) => { releaseDispatch = resolve; });

  const delivery = dispatchAndAcknowledgeActiveTimeForAuthority(
    () => {
      if (!current) throw new Error('session replaced');
    },
    async () => {
      dispatchStarted();
      await held;
      return { revision: 4 };
    },
    () => true,
    async () => {
      acknowledgeCalled = true;
    },
  );

  await started;
  current = false;
  releaseDispatch();
  await assert.rejects(delivery, /session replaced/);
  assert.equal(acknowledgeCalled, false);
});

test('a focused checkout owned by A cannot start or persist active time for B', async () => {
  const actorACheckout: Installation = {
    id: 'actor-a-local-job',
    client_name: 'Client',
    site_name: 'Site',
    site_address: 'Address',
    inspector_name: 'Technician A',
    audit_date: '2026-08-21',
    status: 'Draft',
    local_owner_user_id: 'actor-a',
    assigned_work_state: 'none',
    cloud_backup_enabled: true,
    created_at: timestamp,
    updated_at: timestamp,
  };
  const actorBCanTrack = assignedWorkInstallationIsVisibleToActor(
    actorACheckout,
    'actor-b',
  ) && installationAllowsActiveWorkTracking(actorACheckout, 'actor-b');
  let createdSessions = 0;
  const persisted: string[] = [];
  const tracker = createAuditWorkTracker({
    createSessionId: () => `session-${++createdSessions}`,
    monotonicNow: () => 0,
    wallTimeNow: () => timestamp,
    persist: async (checkpoint) => { persisted.push(checkpoint.sessionId); },
  });

  await tracker.setEligibility({
    actorUserId: 'actor-b',
    installationId: actorACheckout.id,
    installationIsDraft: actorBCanTrack,
    appIsActive: true,
    windowIsFocused: true,
    suspended: false,
  });
  await tracker.checkpoint();

  assert.equal(installationAllowsActiveWorkTracking(actorACheckout, 'actor-b'), true);
  assert.equal(assignedWorkInstallationIsVisibleToActor(actorACheckout, 'actor-b'), false);
  assert.equal(createdSessions, 0);
  assert.deepEqual(persisted, []);

  const provider = readFileSync(
    new URL('../src/services/AuditWorkTrackingContext.tsx', import.meta.url),
    'utf8',
  );
  const persistence = provider.slice(
    provider.indexOf('persist: async (checkpoint) =>'),
    provider.indexOf('onPersisted:', provider.indexOf('persist: async (checkpoint) =>')),
  );
  const eligibility = provider.slice(
    provider.indexOf('const applyEligibility = useCallback'),
    provider.indexOf('const setFocusedRoute = useCallback'),
  );
  assert.match(persistence, /localInstallationVisibleToActor\([\s\S]*checkpoint\.actorUserId/);
  assert.match(eligibility, /localInstallationVisibleToActor\([\s\S]*eligibilityActorUserId/);
});

test('active-time callers and checkpoint confirmation use exact actor/session leases', () => {
  const sync = readFileSync(
    new URL('../src/services/activeTimeSync.ts', import.meta.url),
    'utf8',
  );
  assert.match(sync, /captureCloudSessionAuthority\(\)/);
  assert.match(sync, /cloudSessionAuthoritiesMatch\(existing\.authority, authority\)/);
  assert.match(sync, /await existing\.flight\.catch[\s\S]*assertCurrentCloudSessionAuthority/);
  assert.match(sync, /putInstallationActiveTimeSession\([\s\S]*authority/);
  assert.match(sync, /outbox\.acknowledge\([\s\S]*dispatchAuthority/);

  const tracking = readFileSync(
    new URL('../src/services/AuditWorkTrackingContext.tsx', import.meta.url),
    'utf8',
  );
  assert.match(
    tracking,
    /localServerParentIsConfirmed\([\s\S]*checkpoint\.actorUserId/,
  );
  const background = readFileSync(
    new URL('../src/services/backgroundSync.ts', import.meta.url),
    'utf8',
  );
  assert.match(background, /captureCloudSessionAuthority\(\)/);
  assert.match(background, /syncActiveTimeSessions\(cloudAuthority\.actorUserId, cloudAuthority\)/);
});
