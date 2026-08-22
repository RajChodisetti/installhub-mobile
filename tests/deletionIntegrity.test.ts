import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  applyLocalDeletionPlan,
  assertLocalDeletionLifecycleAllowed,
  assertLocalDeletionPlanStillAllowed,
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
    gridSupplies: [],
    zones: [
      {
        id: 'zone-delete',
        audit_id: 'installation-1',
        zone_name: 'Delete',
        zone_description: '',
        photos: [
          'https://api.example.test/v1/files/zone-delete.jpg',
          'file:///documents/installhub-media/zone-delete.jpg',
        ],
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
        photo: 'file:///documents/installhub-media/board-delete.jpg',
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
    meterDevices: [
      {
        id: 'meter-delete',
        installationId: 'installation-1',
        installedOnBoardId: 'board-delete',
        deviceFamily: 'WATTWATCHERS',
        deviceModel: 'A3RM',
        serialNumber: 'serial-delete',
        displayName: {
          value: 'SITE-ZONE-01-A3RM-METER',
          generatedValue: 'SITE-ZONE-01-A3RM-METER',
          isOverridden: false,
          ruleVersion: 2,
        },
        channels: [],
      },
      {
        id: 'meter-keep',
        installationId: 'installation-1',
        installedOnBoardId: 'board-keep',
        deviceFamily: 'WATTWATCHERS',
        deviceModel: 'A3RM',
        serialNumber: 'serial-keep',
        displayName: {
          value: 'SITE-ZONE-02-A3RM-METER',
          generatedValue: 'SITE-ZONE-02-A3RM-METER',
          isOverridden: false,
          ruleVersion: 2,
        },
        channels: [],
      },
    ],
    measurementAssignments: [],
    siteAssets: [
      {
        id: 'site-delete',
        audit_id: 'installation-1',
        zone_id: 'zone-delete',
        asset_name: 'Deleted asset',
        asset_type: 'HVAC',
        location_photo: 'file:///documents/installhub-media/site-delete.jpg',
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
        queue('meter_device', 'meter-delete'),
        queue('meter_device', 'meter-keep'),
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
  assert.equal(
    store.cloudSync.upload_queue.some((item) =>
      item.entity_type === 'meter_device' && item.entity_id === 'meter-keep'),
    true,
  );
  assert.deepEqual(
    store.cloudSync.thumbnail_queue.map((item) => item.id).sort(),
    ['thumb-site-keep', 'thumb-zone-keep'],
  );
  assert.deepEqual(effects.orphanedThumbnailCacheUris, [
    'file:///cache/deleted.jpg',
  ]);
  assert.deepEqual(
    [...effects.deletedEntityMediaUris].sort(),
    [
      'file:///documents/installhub-media/board-delete.jpg',
      'file:///documents/installhub-media/site-delete.jpg',
      'file:///documents/installhub-media/zone-delete.jpg',
      'https://api.example.test/v1/files/zone-delete.jpg',
    ],
  );
  assert.equal(
    effects.protectedEntityMediaUris.includes(
      'https://api.example.test/v1/files/zone-keep.jpg',
    ),
    true,
  );
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

test('draft-form deletion removes only that draft, its queue entry, and unreferenced evidence', () => {
  const store = storeFixture();
  const draft = {
    ...form(
      'form-draft',
      { zone_id: 'zone-keep', board_id: 'board-keep' },
      'file:///documents/form-media/form-draft/photo.jpg',
    ),
    status: 'Draft' as const,
  };
  store.formSubmissions.push(draft);
  store.cloudSync.upload_queue.push(queue('form_submission', draft.id));

  const plan = planLocalDeletion(store, { kind: 'form_draft', id: draft.id });
  assert.ok(plan);
  assert.deepEqual(plan.formIds, [draft.id]);
  assert.deepEqual(plan.zoneIds, []);
  assert.deepEqual(plan.electricalAssetIds, []);
  assert.deepEqual(plan.siteAssetIds, []);
  assert.deepEqual(plan.meterIds, []);
  assert.deepEqual(plan.measurementAssignmentIds, []);

  const effects = applyLocalDeletionPlan(store, plan, repairedAt);
  assert.equal(store.formSubmissions.some((item) => item.id === draft.id), false);
  assert.equal(store.cloudSync.upload_queue.some((item) => item.entity_id === draft.id), false);
  assert.deepEqual(effects.deletedForms.map((item) => item.id), [draft.id]);
  assert.equal(
    effects.protectedFormAttachmentUris.includes(draft.attachments[0]!.uri),
    false,
  );
  assert.equal(store.zones.some((item) => item.id === 'zone-keep'), true);
  assert.equal(store.electricalAssets.some((item) => item.id === 'board-keep'), true);
});

test('draft-form deletion planning identifies later amendment descendants for repository protection', () => {
  const store = storeFixture();
  const draft = { ...form('form-draft'), status: 'Draft' as const };
  const later = {
    ...form('form-later', { supersedes_id: draft.id }),
    status: 'Draft' as const,
  };
  store.formSubmissions.push(draft, later);

  const plan = planLocalDeletion(store, { kind: 'form_draft', id: draft.id });
  assert.ok(plan);
  assert.deepEqual([...plan.formIds].sort(), [draft.id, later.id]);
});

test('queued deletion revalidates cloud, lifecycle, amendment, and Draft-form guards', () => {
  const store = storeFixture();
  const draft: FormSubmission = { ...form('form-draft-race'), status: 'Draft' };
  store.formSubmissions.push(draft);

  const initialPlan = planLocalDeletion(store, { kind: 'form_draft', id: draft.id });
  assert.ok(initialPlan);
  assert.doesNotThrow(() => assertLocalDeletionPlanStillAllowed(store, initialPlan));

  store.cloudSync.pending_complete_attempts = {
    'installation-1': {
      version: 1,
      id: 'complete-backup-attempt',
      installation_id: 'installation-1',
      payload: {},
      payload_sha256: 'sha256',
      local_tree_revision: 1,
      tree_watermark: timestamp,
      installation_status: 'Draft',
      prepared_at: timestamp,
    },
  };
  assert.throws(
    () => assertLocalDeletionPlanStillAllowed(store, initialPlan),
    /pending cloud backup/,
  );

  delete store.cloudSync.pending_complete_attempts['installation-1'];
  store.installations[0]!.pending_completion = {
    baseTreeRevision: 1,
    idempotencyKey: 'completion-attempt',
    createdAt: timestamp,
  };
  assert.throws(
    () => assertLocalDeletionPlanStillAllowed(store, initialPlan),
    /pending installation completion/,
  );

  delete store.installations[0]!.pending_completion;
  store.formSubmissions.push({
    ...form('form-later-race', { supersedes_id: draft.id }),
    status: 'Draft',
  });
  const descendantPlan = planLocalDeletion(store, { kind: 'form_draft', id: draft.id });
  assert.ok(descendantPlan);
  assert.throws(
    () => assertLocalDeletionPlanStillAllowed(store, descendantPlan),
    /later amendment/,
  );

  store.formSubmissions = store.formSubmissions.filter(
    (item) => item.id !== 'form-later-race',
  );
  draft.status = 'Completed';
  const completedPlan = planLocalDeletion(store, { kind: 'form_draft', id: draft.id });
  assert.ok(completedPlan);
  assert.throws(
    () => assertLocalDeletionPlanStillAllowed(store, completedPlan),
    /Completed forms cannot be deleted/,
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

test('all deletion invariants are revalidated inside the serialized store mutation', () => {
  assert.doesNotThrow(() => {
    assertLocalDeletionLifecycleAllowed('Draft', { kind: 'zone', id: 'zone-delete' });
  });
  assert.throws(
    () => assertLocalDeletionLifecycleAllowed(
      'Completed',
      { kind: 'zone', id: 'zone-delete' },
    ),
    /Reopen this completed installation/,
  );
  assert.doesNotThrow(() => {
    assertLocalDeletionLifecycleAllowed(
      'Completed',
      { kind: 'installation', id: 'installation-1' },
    );
  });

  const repository = readFileSync(
    new URL('../src/repositories/index.ts', import.meta.url),
    'utf8',
  );
  const start = repository.indexOf('async function removeLocalTreeTarget(');
  const end = repository.indexOf('\nexport const installationsRepo', start);
  const remove = repository.slice(start, end);
  const transaction = remove.indexOf('await updateStore((store) =>');
  const transactionalPlan = remove.indexOf(
    'const plan = planLocalDeletion(store, target)',
    transaction,
  );
  const transactionalInvariantCheck = remove.indexOf(
    'assertLocalDeletionPlanStillAllowed(store, plan)',
    transaction,
  );
  const deletion = remove.indexOf('effects = applyLocalDeletionPlan', transaction);

  assert.ok(transaction >= 0);
  assert.ok(transactionalPlan > transaction);
  assert.ok(transactionalInvariantCheck > transactionalPlan);
  assert.ok(transactionalInvariantCheck < deletion);
});

test('amendment cloning re-reads a Completed source inside the transaction before insert', () => {
  const repository = readFileSync(
    new URL('../src/repositories/index.ts', import.meta.url),
    'utf8',
  );
  const start = repository.indexOf('async cloneAmendment(id)');
  const end = repository.indexOf('\n  async removeDraft(id)', start);
  const cloneAmendment = repository.slice(start, end);
  const transaction = cloneAmendment.indexOf('await updateStore((store) =>');
  const reread = cloneAmendment.indexOf(
    'const currentOriginal = store.formSubmissions.find',
    transaction,
  );
  const existenceCheck = cloneAmendment.indexOf(
    "if (!currentOriginal) throw new Error('Form submission not found')",
    reread,
  );
  const completedCheck = cloneAmendment.indexOf(
    "if (currentOriginal.status !== 'Completed')",
    existenceCheck,
  );
  const cloneBuild = cloneAmendment.indexOf('clone = {', completedCheck);
  const insert = cloneAmendment.indexOf('store.formSubmissions.unshift(clone)', cloneBuild);

  assert.ok(transaction >= 0);
  assert.ok(reread > transaction);
  assert.ok(existenceCheck > reread);
  assert.ok(completedCheck > existenceCheck);
  assert.ok(cloneBuild > completedCheck);
  assert.ok(insert > cloneBuild);
});
