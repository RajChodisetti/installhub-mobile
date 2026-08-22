import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import type { AppDataStore, Installation } from '../src/types';
import {
  installationAllowsBackupRecovery,
  installationAllowsNewBackupDispatch,
} from '../src/repositories/cloudSyncRepository';
import {
  activeAssignedWorkCheckoutIds,
  assignedWorkInstallationIsVisibleToActor,
} from '../src/services/assignedWorkPolicy';
import {
  ASSIGNED_WORK_RECOVERY_MANIFEST_WARNING,
  assignedWorkRecoveryCheckoutsForActor,
  buildAssignedWorkRecoveryManifest,
  quarantineAssignedWorkCheckout,
} from '../src/services/assignedWorkRecovery';
import { createActiveTimeOutboxStore } from '../src/services/activeTimeOutbox';
import {
  activeTimeServerParentIsReady,
  activeTimeSessionMayDeliverFromLocalState,
} from '../src/services/activeTimeDeliveryPolicy';
import {
  removeSiteAssetEditorDraftForActor,
  siteAssetEditorDraftRecordForActor,
} from '../src/services/siteAssetEditorDraft';

function installation(
  patch: Partial<Installation> = {},
): Installation {
  return {
    id: 'installation-shared',
    local_owner_user_id: 'actor-a',
    assigned_work_state: 'active',
    assigned_work_actor_user_id: 'actor-a',
    client_name: 'Client A',
    site_name: 'A unsent site',
    site_address: '1 Example Road',
    inspector_name: 'Actor A',
    audit_date: '2026-08-21',
    status: 'Draft',
    tree_schema_version: 2,
    tree_revision: 4,
    server_tree_revision: 3,
    cloud_backup_enabled: true,
    created_at: '2026-08-20T00:00:00.000Z',
    updated_at: '2026-08-21T00:00:00.000Z',
    ...patch,
  };
}

function storeWithActorATree(): AppDataStore {
  const local = installation({
    pending_completion: {
      baseTreeRevision: 3,
      localTreeRevision: 4,
      treeWatermark: 'watermark-a',
      idempotencyKey: 'completion-a',
      createdAt: '2026-08-21T00:00:00.000Z',
    },
  });
  return {
    schemaVersion: 3,
    user: {
      id: 'actor-b',
      email: 'b@example.test',
      full_name: 'Actor B',
      role: 'user',
    },
    installations: [local],
    gridSupplies: [{
      id: 'grid-shared',
      installationId: local.id,
      name: 'Grid',
      isDefault: true,
    }],
    zones: [{
      id: 'zone-shared',
      audit_id: local.id,
      zone_name: 'Zone A',
      zone_description: '',
      photos: ['file:///actor-a-zone.jpg'],
      created_at: local.created_at,
      updated_at: local.updated_at,
    }],
    electricalAssets: [],
    siteAssets: [],
    meterDevices: [],
    measurementAssignments: [],
    formSubmissions: [{
      id: 'form-shared',
      form_type: 'ww-installation',
      schema_version: 1,
      status: 'Draft',
      installation_id: local.id,
      answers: { note: 'A unsent answer' },
      attachments: [{
        id: 'attachment-shared',
        slot: 'evidence',
        uri: 'file:///actor-a-form.jpg',
        mime_type: 'image/jpeg',
        captured_at: local.updated_at,
      }],
      created_at: local.created_at,
      updated_at: local.updated_at,
    }],
    siteAssetEditorDrafts: [{
      scope: 'new:installation-shared:zone-shared',
      userId: 'actor-a',
      installationId: local.id,
      baseTreeRevision: 4,
      createdAt: local.created_at,
      updatedAt: local.updated_at,
      expiresAt: '2026-08-28T00:00:00.000Z',
      payload: {
        version: 1,
        assetName: 'A draft asset',
        typeCode: 'OTHER',
        customTypeName: '',
        displayCode: '',
        customCode: false,
        locationDescription: '',
        locationPhoto: 'file:///actor-a-draft.jpg',
        extraPhotos: ['file:///actor-a-draft-extra.jpg'],
        sourceKey: 'TBC',
        sourceBoardSearch: '',
        meteringKind: 'TBC',
        selectedMeterId: '',
        selectedChannelIds: [],
        phaseMode: 'OTHER',
        direction: '',
        meterSearch: '',
        comments: '',
        deviceDetour: null,
      },
      checksum: 'draft-checksum',
    }],
    assignedWorkRecoveryCheckouts: [],
    cloudSync: {
      synced_at_by_installation: { [local.id]: '2026-08-20T00:00:00.000Z' },
      force_dirty_installation_ids: [local.id],
      pending_complete_attempts: {
        [local.id]: {
          version: 1,
          id: 'complete-backup:payload-a',
          installation_id: local.id,
          payload: { installation: { id: local.id } },
          payload_sha256: 'payload-a',
          local_tree_revision: 4,
          tree_watermark: 'watermark-a',
          installation_status: 'Draft',
          prepared_at: local.updated_at,
        },
      },
      conflicted_complete_attempts: {},
      upload_queue: [{
        id: 'upload-a',
        installation_id: local.id,
        entity_type: 'form_submission',
        entity_id: 'form-shared',
        field_name: 'attachments[0]',
        local_uri: 'file:///actor-a-form.jpg',
        mime_type: 'image/jpeg',
        status: 'pending',
        attempts: 0,
        updated_at: local.updated_at,
      }],
      thumbnail_queue: [{
        id: 'thumbnail-a',
        installation_id: local.id,
        remote_uri: 'https://example.test/a.jpg',
        local_uri: 'file:///actor-a-thumbnail.jpg',
        status: 'ready',
        attempts: 1,
        updated_at: local.updated_at,
      }],
    },
  };
}

test('cross-actor reassignment preserves A exactly and frees canonical IDs for clean B work', () => {
  const store = storeWithActorATree();
  const recovery = quarantineAssignedWorkCheckout(
    store,
    'installation-shared',
    'actor-b',
    {
      createRecoveryId: () => 'recovery-a',
      quarantinedAt: '2026-08-21T01:00:00.000Z',
    },
  );

  assert.equal(store.installations.length, 0);
  assert.equal(store.zones.length, 0);
  assert.equal(store.formSubmissions.length, 0);
  assert.equal(store.cloudSync.upload_queue.length, 0);
  assert.equal(store.cloudSync.thumbnail_queue.length, 0);
  assert.equal(store.cloudSync.pending_complete_attempts?.['installation-shared'], undefined);
  assert.equal(recovery.actor_user_id, 'actor-a');
  assert.equal(recovery.installation.pending_completion?.idempotencyKey, 'completion-a');
  assert.equal(recovery.zones[0]?.photos[0], 'file:///actor-a-zone.jpg');
  assert.equal(recovery.formSubmissions[0]?.answers.note, 'A unsent answer');
  assert.equal(recovery.cloudSync.upload_queue[0]?.session_id, undefined);
  assert.equal(recovery.siteAssetEditorDrafts[0]?.payload.assetName, 'A draft asset');
  assert.deepEqual(
    assignedWorkRecoveryCheckoutsForActor(store, 'actor-a').map((item) => item.id),
    ['recovery-a'],
  );
  assert.deepEqual(assignedWorkRecoveryCheckoutsForActor(store, 'actor-b'), []);

  const actorB = installation({
    local_owner_user_id: 'actor-b',
    assigned_work_actor_user_id: 'actor-b',
    site_name: 'Clean server site for B',
    tree_revision: 5,
    server_tree_revision: 5,
    pending_completion: undefined,
  });
  store.installations.push(actorB);

  assert.equal(assignedWorkInstallationIsVisibleToActor(actorB, 'actor-b'), true);
  assert.equal(assignedWorkInstallationIsVisibleToActor(actorB, 'actor-a'), false);
  assert.equal(installationAllowsNewBackupDispatch(actorB, 'actor-b'), true);
  assert.equal(installationAllowsNewBackupDispatch(actorB, 'actor-a'), false);
  assert.equal(recovery.installation.site_name, 'A unsent site');
});

test('A offline media and time remain in an A-only support manifest after B reassignment', async () => {
  const store = storeWithActorATree();
  const recovery = quarantineAssignedWorkCheckout(
    store,
    'installation-shared',
    'actor-b',
    {
      createRecoveryId: () => 'recovery-a',
      quarantinedAt: '2026-08-21T01:00:00.000Z',
    },
  );
  const actorB = installation({
    local_owner_user_id: 'actor-b',
    assigned_work_actor_user_id: 'actor-b',
    site_name: 'Clean server site for B',
    tree_revision: 5,
    server_tree_revision: 5,
    pending_completion: undefined,
  });
  store.installations.push(actorB);

  let activeTimeDocument: string | null = null;
  const outbox = createActiveTimeOutboxStore({
    getItem: async () => activeTimeDocument,
    setItem: async (_key, value) => { activeTimeDocument = value; },
  });
  await outbox.save({
    sessionId: 'actor-a-offline-time',
    actorUserId: 'actor-a',
    installationId: 'installation-shared',
    revision: 2,
    activeMilliseconds: 120_000,
    startedAt: '2026-08-21T00:00:00.000Z',
    lastActiveAt: '2026-08-21T00:02:00.000Z',
    endedAt: '2026-08-21T00:02:00.000Z',
  }, true);
  const document = await outbox.read();
  const manifest = buildAssignedWorkRecoveryManifest(
    recovery,
    document.sessions,
    '2026-08-21T02:00:00.000Z',
  );

  assert.equal(manifest.media.filesEmbedded, false);
  assert.ok(manifest.media.localUriReferences.includes('file:///actor-a-zone.jpg'));
  assert.ok(manifest.media.localUriReferences.includes('file:///actor-a-form.jpg'));
  assert.equal(manifest.activeTime.pendingSessionCount, 1);
  assert.equal(manifest.activeTime.pendingSessions[0]?.sessionId, 'actor-a-offline-time');
  assert.equal(manifest.activeTime.pendingSessions[0]?.activeMilliseconds, 120_000);
  assert.equal(
    manifest.activeTime.disposition,
    'support_only_not_automatically_delivered_after_reassignment',
  );
  assert.deepEqual(assignedWorkRecoveryCheckoutsForActor(store, 'actor-b'), []);
  assert.deepEqual(await outbox.pending('actor-b'), []);
  assert.equal(activeTimeServerParentIsReady(actorB, 'actor-a'), false);
  assert.match(
    ASSIGNED_WORK_RECOVERY_MANIFEST_WARNING,
    /not a backup[\s\S]*not embedded[\s\S]*DO NOT reset[\s\S]*clear app data[\s\S]*reinstall/,
  );

  const settings = readFileSync(
    new URL('../src/screens/SettingsScreen.tsx', import.meta.url),
    'utf8',
  );
  assert.match(settings, /Recovery support manifests/);
  assert.match(settings, /ASSIGNED_WORK_RECOVERY_MANIFEST_WARNING/);
  assert.match(settings, /pendingActiveTimeSessions/);
  assert.match(settings, /Share support manifest/);
  assert.doesNotMatch(settings, /Share recovery package/);
});

test('logout retains A draft and quarantine selects exact actor when A and B share a scope', () => {
  const store = storeWithActorATree();
  const actorADraft = store.siteAssetEditorDrafts?.[0];
  assert.ok(actorADraft);
  const actorBDraft = {
    ...actorADraft,
    userId: 'actor-b',
    payload: {
      ...actorADraft.payload,
      assetName: 'B independent draft',
      locationPhoto: 'file:///actor-b-location.jpg',
    },
    checksum: 'actor-b-checksum',
  };
  store.siteAssetEditorDrafts?.push(actorBDraft);

  assert.equal(
    siteAssetEditorDraftRecordForActor(
      store.siteAssetEditorDrafts ?? [],
      actorADraft.scope,
      'actor-b',
    )?.payload.assetName,
    'B independent draft',
  );
  assert.deepEqual(
    removeSiteAssetEditorDraftForActor(
      store.siteAssetEditorDrafts ?? [],
      actorADraft.scope,
      'actor-a',
    ).map((item) => item.userId),
    ['actor-b'],
  );

  const recovery = quarantineAssignedWorkCheckout(
    store,
    'installation-shared',
    'actor-b',
    {
      createRecoveryId: () => 'recovery-a-draft',
      quarantinedAt: '2026-08-21T01:00:00.000Z',
    },
  );
  assert.deepEqual(recovery.siteAssetEditorDrafts.map((item) => item.userId), ['actor-a']);
  assert.equal(
    recovery.siteAssetEditorDrafts[0]?.payload.locationPhoto,
    'file:///actor-a-draft.jpg',
  );
  assert.deepEqual(
    store.siteAssetEditorDrafts?.map((item) => item.userId),
    ['actor-b'],
  );
  assert.equal(
    store.siteAssetEditorDrafts?.[0]?.payload.locationPhoto,
    'file:///actor-b-location.jpg',
  );

  const providers = readFileSync(
    new URL('../src/context/AppProviders.tsx', import.meta.url),
    'utf8',
  );
  const logout = providers.slice(
    providers.indexOf('const logout = useCallback'),
    providers.indexOf('const authValue = useMemo'),
  );
  assert.doesNotMatch(logout, /clearSiteAssetEditorDraftsForUser/);
});

test('support-only A time cannot dispatch after B deletes the clean live checkout', async () => {
  const store = storeWithActorATree();
  quarantineAssignedWorkCheckout(
    store,
    'installation-shared',
    'actor-b',
    {
      createRecoveryId: () => 'recovery-a-time',
      quarantinedAt: '2026-08-21T01:00:00.000Z',
    },
  );
  // B's clean canonical checkout was subsequently deleted. The old fallback
  // must not treat A's previously confirmed parent as permission to deliver.
  store.installations = [];
  const session = {
    sessionId: 'actor-a-offline-time',
    actorUserId: 'actor-a',
    installationId: 'installation-shared',
    revision: 2,
    activeMilliseconds: 120_000,
    startedAt: '2026-08-21T00:00:00.000Z',
    lastActiveAt: '2026-08-21T00:02:00.000Z',
    endedAt: '2026-08-21T00:02:00.000Z',
    acknowledgedRevision: 0,
    serverParentConfirmed: true,
  };
  let putCalls = 0;
  if (activeTimeSessionMayDeliverFromLocalState(store, session, 'actor-a')) {
    putCalls += 1;
  }
  assert.equal(putCalls, 0);

  const sync = readFileSync(
    new URL('../src/services/activeTimeSync.ts', import.meta.url),
    'utf8',
  );
  assert.match(sync, /activeTimeSessionMayDeliverFromLocalState\([\s\S]*getStore\(\)/);
});

test('state none remains exact-owner local work for visibility and backup recovery', () => {
  const local = installation({
    assigned_work_state: 'none',
    assigned_work_actor_user_id: undefined,
    local_owner_user_id: 'actor-a',
  });
  assert.equal(assignedWorkInstallationIsVisibleToActor(local, 'actor-a'), true);
  assert.equal(assignedWorkInstallationIsVisibleToActor(local, 'actor-b'), false);
  assert.equal(installationAllowsNewBackupDispatch(local, 'actor-a'), true);
  assert.equal(installationAllowsNewBackupDispatch(local, 'actor-b'), false);
  assert.equal(installationAllowsBackupRecovery(local, 'actor-a'), true);
  assert.equal(installationAllowsBackupRecovery(local, 'actor-b'), false);
});

test('assignment revocation candidates include only the current actor checkouts', () => {
  assert.deepEqual(activeAssignedWorkCheckoutIds([
    installation({ id: 'a', local_owner_user_id: 'actor-a', assigned_work_actor_user_id: 'actor-a' }),
    installation({ id: 'b', local_owner_user_id: 'actor-b', assigned_work_actor_user_id: 'actor-b' }),
  ], 'actor-b'), ['b']);
});

test('assigned materialization quarantines a different owner inside the insert transaction', () => {
  const source = readFileSync(
    new URL('../src/repositories/remoteInstallationsRepository.ts', import.meta.url),
    'utf8',
  );
  const transaction = source.slice(
    source.indexOf('  await updateStore((store) => {', source.indexOf('export async function importRemoteInstallationAsCopy')),
    source.indexOf('  if (!isAssignedMaterialization)', source.indexOf('export async function importRemoteInstallationAsCopy')),
  );
  assert.match(
    transaction,
    /assignedWorkCheckoutBelongsToDifferentActor[\s\S]*quarantineAssignedWorkCheckout[\s\S]*store\.installations\.unshift\(installation\)/,
  );
});
