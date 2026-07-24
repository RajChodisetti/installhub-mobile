import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyLocalDeletionPlan,
  planLocalDeletion,
} from '../src/repositories/deletionIntegrity';
import { evidenceDirectoryIsReferenced } from '../src/services/formStorageOwnership';
import type {
  AppDataStore,
  CloudUploadQueueItem,
  FormSubmission,
} from '../src/types';

const timestamp = '2026-07-23T12:00:00.000Z';
const repairedAt = '2026-07-23T13:00:00.000Z';

function form(
  id: string,
  links: Partial<
    Pick<
      FormSubmission,
      'zone_id' | 'board_id' | 'meter_id' | 'site_asset_id' | 'supersedes_id'
    >
  > = {},
  attachmentUri?: string,
): FormSubmission {
  return {
    id,
    form_type: 'captis-logger',
    schema_version: 2,
    status: 'Completed',
    installation_id: 'installation-1',
    answers: {},
    attachments: attachmentUri
      ? [{
          id: `${id}-attachment`,
          slot: 'logger.photo',
          uri: attachmentUri,
          mime_type: 'image/jpeg',
          captured_at: timestamp,
        }]
      : [],
    created_at: timestamp,
    updated_at: timestamp,
    ...links,
  };
}

function queue(
  entityType: CloudUploadQueueItem['entity_type'],
  entityId: string,
): CloudUploadQueueItem {
  return {
    id: `queue-${entityId}`,
    installation_id: 'installation-1',
    entity_type: entityType,
    entity_id: entityId,
    field_name: 'photo',
    local_uri: `file:///${entityId}.jpg`,
    mime_type: 'image/jpeg',
    status: 'pending',
    attempts: 0,
    updated_at: timestamp,
  };
}

function storeFixture(): AppDataStore {
  const forms = [
    form('form-zone', { zone_id: 'zone-delete' }),
    form('form-board', { board_id: 'board-delete' }),
    form('form-meter', { meter_id: 'meter-delete' }),
    form('form-site', { site_asset_id: 'site-delete' }),
    form('form-amendment', { supersedes_id: 'form-board' }),
    form(
      'form-survive',
      { zone_id: 'zone-keep', board_id: 'board-keep' },
      'file:///documents/form-media/form-board/inherited.jpg',
    ),
  ];
  return {
    user: {
      id: 'user-1',
      email: 'installer@example.test',
      full_name: 'Installer',
      role: 'admin',
    },
    installations: [{
      id: 'installation-1',
      client_name: 'Client',
      site_name: 'Site',
      site_address: 'Address',
      inspector_name: 'Installer',
      audit_date: '2026-07-23',
      status: 'Draft',
      cloud_backup_enabled: true,
      is_imported_copy: true,
      thumbnail_status: 'ready',
      thumbnail_total: 3,
      thumbnail_ready: 3,
      created_at: timestamp,
      updated_at: timestamp,
    }],
    zones: [
      {
        id: 'zone-delete',
        audit_id: 'installation-1',
        zone_name: 'Delete',
        zone_description: '',
        photos: ['https://api.example.test/v1/files/zone-delete.jpg'],
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: 'zone-keep',
        audit_id: 'installation-1',
        zone_name: 'Keep',
        zone_description: '',
        photos: ['https://api.example.test/v1/files/zone-keep.jpg'],
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    electricalAssets: [
      {
        id: 'board-delete',
        audit_id: 'installation-1',
        zone_id: 'zone-delete',
        asset_name: 'Deleted board',
        display_code: 'DB-1',
        asset_type: 'DB',
        meter_present: true,
        meters: [{
          id: 'meter-delete',
          device_name: 'Meter',
          device_type: 'A3RM',
          device_id: 'serial',
        }],
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: 'board-keep',
        audit_id: 'installation-1',
        zone_id: 'zone-keep',
        asset_name: 'Child board',
        display_code: 'DB-2',
        asset_type: 'DB',
        electrical_parent_id: 'board-delete',
        electrical_parent_tbc: false,
        meter_present: false,
        meters: [],
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    siteAssets: [
      {
        id: 'site-delete',
        audit_id: 'installation-1',
        zone_id: 'zone-delete',
        asset_name: 'Deleted asset',
        asset_type: 'HVAC',
        meter_present: false,
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        id: 'site-keep',
        audit_id: 'installation-1',
        zone_id: 'zone-keep',
        asset_name: 'Linked asset',
        asset_type: 'Lighting',
        electrical_board_id: 'board-delete',
        electrical_board_tbc: false,
        meter_present: true,
        meter_switchboard_id: 'board-delete',
        meter_switchboard_tbc: false,
        meter_channels: [{ channel: '1', description: 'Lights' }],
        location_photo: 'https://api.example.test/v1/files/site-keep.jpg',
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
    formSubmissions: forms,
    cloudSync: {
      synced_at_by_installation: { 'installation-1': timestamp },
      force_dirty_installation_ids: [],
      upload_queue: [
        queue('zone', 'zone-delete'),
        queue('zone', 'zone-keep'),
        queue('electrical_asset', 'board-delete'),
        queue('electrical_asset', 'board-keep'),
        queue('site_asset', 'site-delete'),
        queue('site_asset', 'site-keep'),
        ...forms.map((item) => queue('form_submission', item.id)),
      ],
      thumbnail_queue: [
        {
          id: 'thumb-delete',
          installation_id: 'installation-1',
          remote_uri: 'https://api.example.test/v1/files/zone-delete.jpg',
          local_uri: 'file:///cache/deleted.jpg',
          status: 'ready',
          attempts: 1,
          updated_at: timestamp,
        },
        {
          id: 'thumb-zone-keep',
          installation_id: 'installation-1',
          remote_uri: 'https://api.example.test/v1/files/zone-keep.jpg',
          local_uri: 'file:///cache/zone-keep.jpg',
          status: 'ready',
          attempts: 1,
          updated_at: timestamp,
        },
        {
          id: 'thumb-site-keep',
          installation_id: 'installation-1',
          remote_uri: 'https://api.example.test/v1/files/site-keep.jpg',
          local_uri: 'file:///cache/site-keep.jpg',
          status: 'ready',
          attempts: 1,
          updated_at: timestamp,
        },
      ],
    },
  };
}

test('zone deletion includes child-linked forms, meter forms and amendment descendants', () => {
  const store = storeFixture();
  const plan = planLocalDeletion(store, { kind: 'zone', id: 'zone-delete' });
  assert.ok(plan);
  assert.deepEqual(plan.zoneIds, ['zone-delete']);
  assert.deepEqual(plan.electricalAssetIds, ['board-delete']);
  assert.deepEqual(plan.meterIds, ['meter-delete']);
  assert.deepEqual(plan.siteAssetIds, ['site-delete']);
  assert.deepEqual(
    [...plan.formIds].sort(),
    [
      'form-amendment',
      'form-board',
      'form-meter',
      'form-site',
      'form-zone',
    ],
  );

  const effects = applyLocalDeletionPlan(store, plan, repairedAt);
  assert.deepEqual(store.zones.map((item) => item.id), ['zone-keep']);
  assert.deepEqual(store.electricalAssets.map((item) => item.id), ['board-keep']);
  assert.deepEqual(store.siteAssets.map((item) => item.id), ['site-keep']);
  assert.deepEqual(store.formSubmissions.map((item) => item.id), ['form-survive']);

  const board = store.electricalAssets[0]!;
  assert.equal(board.electrical_parent_id, null);
  assert.equal(board.electrical_parent_tbc, true);
  assert.equal(board.updated_at, repairedAt);
  const asset = store.siteAssets[0]!;
  assert.equal(asset.electrical_board_id, null);
  assert.equal(asset.electrical_board_tbc, true);
  assert.equal(asset.meter_switchboard_id, null);
  assert.equal(asset.meter_switchboard_tbc, true);
  assert.deepEqual(asset.meter_channels, []);
  assert.equal(asset.updated_at, repairedAt);

  assert.equal(
    store.cloudSync.upload_queue.some((item) =>
      [
        'zone-delete',
        'board-delete',
        'site-delete',
        'form-zone',
        'form-board',
        'form-meter',
        'form-site',
        'form-amendment',
      ].includes(item.entity_id)),
    false,
  );
  assert.deepEqual(
    store.cloudSync.thumbnail_queue.map((item) => item.id).sort(),
    ['thumb-site-keep', 'thumb-zone-keep'],
  );
  assert.deepEqual(effects.orphanedThumbnailCacheUris, [
    'file:///cache/deleted.jpg',
  ]);
  assert.deepEqual(store.cloudSync.force_dirty_installation_ids, [
    'installation-1',
  ]);
  assert.equal(store.installations[0]!.thumbnail_total, 2);
  assert.equal(store.installations[0]!.thumbnail_ready, 2);
  assert.equal(store.installations[0]!.thumbnail_status, 'ready');
  assert.ok(
    effects.protectedFormAttachmentUris.includes(
      'file:///documents/form-media/form-board/inherited.jpg',
    ),
  );
});

test('board and site-asset deletion plans remove every formally linked form', () => {
  const boardStore = storeFixture();
  const boardPlan = planLocalDeletion(boardStore, {
    kind: 'electrical_asset',
    id: 'board-delete',
  });
  assert.ok(boardPlan);
  assert.deepEqual(
    [...boardPlan.formIds].sort(),
    ['form-amendment', 'form-board', 'form-meter'],
  );
  applyLocalDeletionPlan(boardStore, boardPlan, repairedAt);
  assert.equal(
    boardStore.formSubmissions.some((item) =>
      item.board_id === 'board-delete' || item.meter_id === 'meter-delete'),
    false,
  );
  assert.equal(
    boardStore.electricalAssets.some(
      (item) => item.electrical_parent_id === 'board-delete',
    ),
    false,
  );
  assert.equal(
    boardStore.siteAssets.some(
      (item) =>
        item.electrical_board_id === 'board-delete' ||
        item.meter_switchboard_id === 'board-delete',
    ),
    false,
  );

  const siteStore = storeFixture();
  const sitePlan = planLocalDeletion(siteStore, {
    kind: 'site_asset',
    id: 'site-delete',
  });
  assert.ok(sitePlan);
  assert.deepEqual(sitePlan.formIds, ['form-site']);
  applyLocalDeletionPlan(siteStore, sitePlan, repairedAt);
  assert.equal(siteStore.siteAssets.some((item) => item.id === 'site-delete'), false);
  assert.equal(
    siteStore.formSubmissions.some((item) => item.site_asset_id === 'site-delete'),
    false,
  );
});

test('evidence ownership protects exact inherited amendment directories only', () => {
  const protectedUris = [
    'file:///documents/form-media/form-original/photo-1.jpg',
    'file:///documents/form-media/form-originality/not-the-same.jpg',
  ];
  assert.equal(
    evidenceDirectoryIsReferenced(
      'file:///documents/form-media/form-original',
      protectedUris,
    ),
    true,
  );
  assert.equal(
    evidenceDirectoryIsReferenced(
      'file:///documents/form-media/form-other',
      protectedUris,
    ),
    false,
  );
});
