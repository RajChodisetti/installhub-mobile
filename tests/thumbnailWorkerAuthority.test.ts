import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  nextThumbnailDownloadForActor,
  thumbnailDownloadsForActor,
  updateThumbnailDownloadForActor,
} from '../src/services/thumbnailWorkerPolicy';
import { fetchAndCommitThumbnailForAuthority } from '../src/services/thumbnailWorkerFence';
import type { AppDataStore } from '../src/types';

function actorPartitionedStore(): AppDataStore {
  return {
    installations: [
      {
        id: 'installation-a',
        local_owner_user_id: 'actor-a',
        assigned_work_state: 'none',
        thumbnail_status: 'pending',
        thumbnail_total: 1,
        thumbnail_ready: 0,
      },
      {
        id: 'installation-b',
        local_owner_user_id: 'actor-b',
        assigned_work_state: 'none',
        thumbnail_status: 'ready',
        thumbnail_total: 0,
        thumbnail_ready: 0,
      },
    ],
    cloudSync: {
      synced_at_by_installation: {},
      force_dirty_installation_ids: [],
      upload_queue: [],
      thumbnail_queue: [{
        id: 'thumbnail-a',
        installation_id: 'installation-a',
        remote_uri: 'https://api.example.test/v1/files/a.jpg',
        local_uri: 'file:///cache/actor-a.jpg',
        status: 'pending',
        attempts: 0,
        updated_at: '2026-08-21T09:00:00.000Z',
      }],
    },
    zones: [],
    electricalAssets: [],
    siteAssets: [],
    gridSupplies: [],
    meterDevices: [],
    measurementAssignments: [],
    formSubmissions: [],
    user: null,
  } as unknown as AppDataStore;
}

test('an A thumbnail pending when B starts remains completely untouched', () => {
  const store = actorPartitionedStore();
  const before = JSON.stringify(store);
  let deletedFiles = 0;

  const selected = nextThumbnailDownloadForActor(store, 'actor-b');
  if (selected) deletedFiles += 1;
  const updated = updateThumbnailDownloadForActor(
    store,
    'thumbnail-a',
    'actor-b',
    {
      status: 'ready',
      local_uri: 'file:///cache/actor-b.jpg',
    },
    '2026-08-21T10:00:00.000Z',
  );

  assert.equal(selected, null);
  assert.deepEqual(thumbnailDownloadsForActor(store, 'actor-b'), []);
  assert.equal(updated, false);
  assert.equal(deletedFiles, 0);
  assert.equal(JSON.stringify(store), before);
});

test('an already-inactive assigned checkout cannot select, fetch, or update thumbnails', () => {
  const store = actorPartitionedStore();
  const installation = store.installations[0]!;
  installation.assigned_work_state = 'inactive';
  installation.assigned_work_actor_user_id = 'actor-a';
  const before = JSON.stringify(store);
  let fetches = 0;

  const selected = nextThumbnailDownloadForActor(store, 'actor-a');
  if (selected) fetches += 1;
  const updated = updateThumbnailDownloadForActor(
    store,
    'thumbnail-a',
    'actor-a',
    { status: 'downloading', attempts: 1 },
    '2026-08-21T10:00:00.000Z',
  );

  assert.equal(selected, null);
  assert.deepEqual(thumbnailDownloadsForActor(store, 'actor-a'), []);
  assert.equal(fetches, 0);
  assert.equal(updated, false);
  assert.equal(JSON.stringify(store), before);
});

test('A to B while thumbnail fetch is held cannot validate or commit A as B', async () => {
  const store = actorPartitionedStore();
  const before = JSON.stringify(store);
  let currentActorUserId = 'actor-a';
  let releaseFetch!: () => void;
  const fetchHeld = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  let fetchStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    fetchStarted = resolve;
  });
  let validations = 0;
  let commits = 0;
  let cleanups = 0;

  const fetch = fetchAndCommitThumbnailForAuthority(
    () => {
      if (currentActorUserId !== 'actor-a') throw new Error('thumbnail authority changed');
    },
    async () => {
      fetchStarted();
      await fetchHeld;
      return { uri: 'file:///cache/actor-a-attempt.jpg' };
    },
    async () => {
      validations += 1;
    },
    async () => {
      commits += 1;
      updateThumbnailDownloadForActor(
        store,
        'thumbnail-a',
        currentActorUserId,
        { status: 'ready' },
        '2026-08-21T10:00:00.000Z',
      );
    },
    () => {
      cleanups += 1;
    },
  );

  await started;
  currentActorUserId = 'actor-b';
  releaseFetch();
  await assert.rejects(fetch, /thumbnail authority changed/);
  assert.equal(validations, 0);
  assert.equal(commits, 0);
  assert.equal(cleanups, 1);
  assert.equal(JSON.stringify(store), before);
});

test('same actor revocation during a held fetch cleans the attempt without committing', async () => {
  const store = actorPartitionedStore();
  const installation = store.installations[0]!;
  installation.assigned_work_state = 'active';
  installation.assigned_work_actor_user_id = 'actor-a';
  const selected = nextThumbnailDownloadForActor(store, 'actor-a');
  assert.equal(selected?.id, 'thumbnail-a');
  assert.equal(updateThumbnailDownloadForActor(
    store,
    'thumbnail-a',
    'actor-a',
    {
      status: 'downloading',
      attempts: 1,
      local_uri: 'file:///cache/actor-a-attempt.jpg',
    },
    '2026-08-21T09:30:00.000Z',
  ), true);
  const claimedQueue = JSON.stringify(store.cloudSync.thumbnail_queue);
  const claimedCounters = {
    status: installation.thumbnail_status,
    total: installation.thumbnail_total,
    ready: installation.thumbnail_ready,
  };

  let releaseFetch!: () => void;
  const fetchHeld = new Promise<void>((resolve) => {
    releaseFetch = resolve;
  });
  let fetchStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    fetchStarted = resolve;
  });
  let validations = 0;
  let readyCommits = 0;
  let cleanups = 0;
  const fetch = fetchAndCommitThumbnailForAuthority(
    () => {},
    async () => {
      fetchStarted();
      await fetchHeld;
      return { uri: 'file:///cache/actor-a-attempt.jpg' };
    },
    async () => {
      validations += 1;
    },
    async () => {
      const committed = updateThumbnailDownloadForActor(
        store,
        'thumbnail-a',
        'actor-a',
        { status: 'ready' },
        '2026-08-21T10:00:00.000Z',
      );
      if (!committed) throw new Error('thumbnail checkout revoked');
      readyCommits += 1;
    },
    () => {
      cleanups += 1;
    },
  );

  await started;
  installation.assigned_work_state = 'inactive';
  releaseFetch();
  await assert.rejects(fetch, /thumbnail checkout revoked/);
  const failedRecorded = updateThumbnailDownloadForActor(
    store,
    'thumbnail-a',
    'actor-a',
    {
      status: 'failed',
      local_uri: undefined,
      last_error: 'thumbnail checkout revoked',
    },
    '2026-08-21T10:00:01.000Z',
  );
  assert.equal(validations, 1);
  assert.equal(readyCommits, 0);
  assert.equal(cleanups, 1);
  assert.equal(failedRecorded, false);
  assert.equal(JSON.stringify(store.cloudSync.thumbnail_queue), claimedQueue);
  assert.deepEqual({
    status: installation.thumbnail_status,
    total: installation.thumbnail_total,
    ready: installation.thumbnail_ready,
  }, claimedCounters);
});

test('thumbnail repository, worker, import, and foreground calls carry one pinned lease', () => {
  const repository = readFileSync(
    new URL('../src/repositories/cloudSyncRepository.ts', import.meta.url),
    'utf8',
  );
  for (const methodName of [
    'enqueueThumbnailDownloads',
    'getNextThumbnailDownload',
    'updateThumbnailDownload',
    'listThumbnailDownloads',
  ]) {
    const start = repository.indexOf(`export async function ${methodName}(`);
    const end = repository.indexOf('\nexport ', start + 1);
    const method = repository.slice(start, end);
    assert.match(method, /actorUserId: string/);
    assert.match(method, /authority: AssignedWorkMutationAuthority/);
    assert.match(method, /assertCurrentAssignedWorkAuthority\(authority, actorUserId\)/);
  }
  assert.match(repository, /nextThumbnailDownloadForActor\(getStore\(\), actorUserId\)/);
  assert.match(repository, /updateStore\(\(store\) => \{[\s\S]*updateThumbnailDownloadForActor/);
  assert.match(repository, /assignedWorkInstallationIsVisibleToActor\(item, actorUserId\)/);

  const worker = readFileSync(
    new URL('../src/services/thumbnailCache.ts', import.meta.url),
    'utf8',
  );
  assert.match(worker, /runThumbnailDownloadWorker\([\s\S]*AuthenticatedCloudActionLease/);
  assert.match(worker, /cloudSessionAuthoritiesMatch/);
  assert.match(worker, /runWithCloudAccessToken\(storeDownloadedFile, lease\.cloudAuthority\)/);
  assert.match(worker, /getNextThumbnailDownload\([\s\S]*lease\.actorUserId[\s\S]*lease\.processAuthority/);
  assert.match(worker, /updateThumbnailDownload\([\s\S]*lease\.actorUserId[\s\S]*lease\.processAuthority/);

  const remoteImport = readFileSync(
    new URL('../src/repositories/remoteInstallationsRepository.ts', import.meta.url),
    'utf8',
  );
  const thumbnailStart = remoteImport.indexOf('const thumbnailWorkerLease');
  const thumbnailEnd = remoteImport.indexOf('\n  return installationId;', thumbnailStart);
  const thumbnailCalls = remoteImport.slice(thumbnailStart, thumbnailEnd);
  assert.match(thumbnailCalls, /bindAuthenticatedCloudActionLease/);
  assert.match(thumbnailCalls, /enqueueThumbnailDownloads\([\s\S]*thumbnailWorkerLease\.processAuthority/);
  assert.match(thumbnailCalls, /runThumbnailDownloadWorker\(thumbnailWorkerLease\)/);

  const syncStatus = readFileSync(
    new URL('../src/services/SyncStatusContext.tsx', import.meta.url),
    'utf8',
  );
  assert.match(syncStatus, /captureAuthenticatedCloudActionLease\(\)/);
  assert.match(syncStatus, /lease\.actorUserId !== thumbnailActorUserId/);
  assert.match(syncStatus, /runThumbnailDownloadWorker\(lease\)/);
});
