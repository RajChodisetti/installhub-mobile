import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildBackupPayload, discoverBackupMedia } from '../src/services/backupMedia';
import { uploadThenConfirmForAuthority } from '../src/services/backupAuthorityFence';
import {
  installationAllowsNewBackupDispatch,
  reconciledBackupMediaQueue,
  type InstallationBackupTree,
} from '../src/repositories/cloudSyncRepository';
import type { CloudUploadQueueItem } from '../src/types';

const tree: InstallationBackupTree = {
  treeSchemaVersion: 2,
  installation: {
    id: 'installation-1',
    client_name: 'Example Client',
    site_name: 'Example Site',
    site_address: '42 Example Road',
    inspector_name: 'Installer One',
    audit_date: '2026-07-22',
    status: 'Completed',
    cloud_backup_enabled: true,
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-22T00:00:00.000Z',
  },
  gridSupplies: [],
  zones: [{
    id: 'zone-1',
    audit_id: 'installation-1',
    zone_name: 'Main building',
    zone_description: '',
    photos: ['file:///zone.jpg'],
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-22T00:00:00.000Z',
  }],
  electricalAssets: [{
    id: 'board-1',
    audit_id: 'installation-1',
    zone_id: 'zone-1',
    asset_name: 'Main switchboard',
    display_code: 'MSB-1',
    asset_type: 'MSB',
    photo: 'file:///board.jpg',
    extra_photos: [],
    meter_present: true,
    meters: [{
      id: 'meter-1',
      device_name: 'Auditor',
      device_type: 'A3RM',
      device_id: 'device-1',
      ww_photos: { labeling: 'file:///label.jpg' },
    }],
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-22T00:00:00.000Z',
  }],
  siteAssets: [],
  meterDevices: [],
  measurementAssignments: [],
  formSubmissions: [{
    id: 'form-1',
    form_type: 'a3rm-installation',
    schema_version: 1,
    status: 'Completed',
    installation_id: 'installation-1',
    answers: {},
    attachments: [{
      id: 'attachment-1',
      slot: 'evidence',
      uri: 'file:///form.jpg',
      mime_type: 'image/jpeg',
      caption: 'Completed installation',
      captured_at: '2026-07-22T00:00:00.000Z',
    }],
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-22T00:00:00.000Z',
  }],
  watermark: '2026-07-22T00:00:00.000Z',
};

test('cloud backup discovers every supported local evidence family', () => {
  const media = discoverBackupMedia(tree);
  assert.deepEqual(
    media.map((item) => `${item.entity_type}:${item.field_name}`).sort(),
    [
      'electrical_asset:meters[0].wwPhotos.labeling',
      'electrical_asset:photo',
      'form_submission:attachments[0].uri',
      'zone:photos[0]',
    ],
  );
});

test('only a current non-inactive opt-in can dispatch new backup work', () => {
  assert.equal(installationAllowsNewBackupDispatch({
    cloud_backup_enabled: true,
    local_owner_user_id: 'technician-1',
    assigned_work_state: 'active',
    assigned_work_actor_user_id: 'technician-1',
  }, 'technician-1'), true);
  assert.equal(installationAllowsNewBackupDispatch({
    cloud_backup_enabled: true,
    local_owner_user_id: 'technician-1',
    assigned_work_state: 'none',
  }, 'technician-1'), true);
  assert.equal(installationAllowsNewBackupDispatch({
    cloud_backup_enabled: true,
    local_owner_user_id: 'technician-1',
    assigned_work_state: 'inactive',
    assigned_work_actor_user_id: 'technician-1',
  }, 'technician-1'), false);
  assert.equal(installationAllowsNewBackupDispatch({
    cloud_backup_enabled: false,
    local_owner_user_id: 'technician-1',
    assigned_work_state: 'active',
    assigned_work_actor_user_id: 'technician-1',
  }, 'technician-1'), false);
  assert.equal(installationAllowsNewBackupDispatch({
    cloud_backup_enabled: true,
    local_owner_user_id: 'technician-1',
    assigned_work_state: 'active',
    assigned_work_actor_user_id: 'technician-1',
  }, 'technician-2'), false);
});

test('a backup stage selected while active cannot dispatch after deferred revocation', async () => {
  const installation = {
    cloud_backup_enabled: true,
    local_owner_user_id: 'technician-1',
    assigned_work_state: 'active' as 'active' | 'inactive',
    assigned_work_actor_user_id: 'technician-1',
  };
  let release!: () => void;
  const boundary = new Promise<void>((resolve) => { release = resolve; });
  let dispatched = false;
  const selectedFlight = (async () => {
    await boundary;
    if (installationAllowsNewBackupDispatch(installation, 'technician-1')) dispatched = true;
  })();

  installation.assigned_work_state = 'inactive';
  release();
  await selectedFlight;
  assert.equal(dispatched, false);
});

test('a session replacement after signed PUT prevents authenticated confirmation', async () => {
  let current = true;
  let confirmCalled = false;
  let releaseUpload!: () => void;
  const uploadHeld = new Promise<void>((resolve) => { releaseUpload = resolve; });
  const operation = uploadThenConfirmForAuthority(
    () => {
      if (!current) throw new Error('session replaced');
    },
    () => uploadHeld,
    async () => {
      confirmCalled = true;
      return 'confirmed';
    },
  );

  await Promise.resolve();
  current = false;
  releaseUpload();
  await assert.rejects(operation, /session replaced/);
  assert.equal(confirmCalled, false);

  const source = readFileSync(
    new URL('../src/services/syncService.ts', import.meta.url),
    'utf8',
  );
  const upload = source.slice(
    source.indexOf('async function processUpload('),
    source.indexOf('async function fetchAndMergeCanonicalTree('),
  );
  assert.match(upload, /CloudBackupAuthorityChangedError[\s\S]*status: 'pending'/);
  const retryablePatch = upload.slice(
    upload.indexOf("status: 'pending'"),
    upload.indexOf('throw error;', upload.indexOf("status: 'pending'")),
  );
  assert.doesNotMatch(retryablePatch, /session_id:/);
});

test('running backup flights recheck revocation before every new request family', () => {
  const source = readFileSync(
    new URL('../src/services/syncService.ts', import.meta.url),
    'utf8',
  );
  const execute = source.slice(source.indexOf('async function executeCloudBackup('));
  const ambiguousRecovery = execute.indexOf(
    'confirmCompleteBackupAttempt(attempt, recoveryConfirmationDependencies)',
  );
  const firstNewDispatchGate = execute.indexOf(
    'if (!backupDispatchStillAllowed(installationId, authority.actorUserId)) continue;',
  );
  assert.ok(ambiguousRecovery >= 0 && ambiguousRecovery < firstNewDispatchGate);
  assert.match(
    execute,
    /if \(!backupDispatchStillAllowed\(installationId, authority\.actorUserId\)\) break;/,
  );
  assert.match(execute, /newConfirmationDependencies/);

  const upload = source.slice(
    source.indexOf('async function processUpload('),
    source.indexOf('async function fetchAndMergeCanonicalTree('),
  );
  for (const request of [
    'apiClient.checkPhoto',
    'apiClient.createUploadSession',
    'apiClient.uploadPhoto',
  ]) {
    const requestIndex = upload.indexOf(request);
    const guardIndex = upload.lastIndexOf(
      'assertInstallationAllowsNewBackupDispatch(',
      requestIndex,
    );
    assert.ok(guardIndex >= 0 && guardIndex < requestIndex, `${request} is dispatch-guarded`);
  }
});

test('cloud payload never leaks local file URIs and substitutes confirmed URLs', () => {
  const queue: CloudUploadQueueItem[] = discoverBackupMedia(tree).map((item, index) => ({
    ...item,
    id: `upload-${index}`,
    status: 'cleared',
    attempts: 1,
    remote_url: `https://api.example.test/v1/files/evidence-${index}.jpg`,
    updated_at: '2026-07-22T00:00:00.000Z',
  }));
  const payload = buildBackupPayload(tree, queue);
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /file:\/\//);
  assert.match(serialized, /https:\/\/api\.example\.test\/v1\/files/);
  assert.equal(payload.formSubmissions[0]?.attachments.length, 1);
  assert.equal(
    payload.formSubmissions[0]?.attachments[0]?.caption,
    'Completed installation',
  );
});

test('cloud payload labels metadata and complete pushes without changing legacy callers', () => {
  const queue: CloudUploadQueueItem[] = discoverBackupMedia(tree).map((item, index) => ({
    ...item,
    id: `upload-${index}`,
    status: 'cleared',
    attempts: 1,
    remote_url: `https://api.example.test/v1/files/evidence-${index}.jpg`,
    updated_at: '2026-07-22T00:00:00.000Z',
  }));

  assert.equal(buildBackupPayload(tree, queue, 'metadata').syncStage, 'metadata');
  assert.equal(buildBackupPayload(tree, queue, 'complete').syncStage, 'complete');
  assert.equal('syncStage' in buildBackupPayload(tree, queue), false);
});

test('legacy local records omit unknown additive job fields instead of clearing server values', () => {
  const installation = buildBackupPayload(tree, [], 'metadata').installation;
  assert.equal('customerName' in installation, false);
  assert.equal('maas' in installation, false);
  assert.equal('siteContactName' in installation, false);
  assert.equal('accessInformation' in installation, false);
  assert.equal('monitoringInstalled' in installation, false);
  assert.equal('solarCapacityKw' in installation, false);
});

test('WW purpose and custom-load answers survive backup serialization unchanged', () => {
  const answers = {
    'channel.1.purpose': 'Sub-circuit / asset',
    'channel.1.load': 'Other',
    'channel.1.custom_load_type': 'Refrigeration',
    'channel.1.rating': '3000A - 9cm',
    'channel.1.description': 'Cold room plant',
  };
  const purposeTree: InstallationBackupTree = {
    ...tree,
    formSubmissions: [{
      ...tree.formSubmissions[0]!,
      form_type: 'ww-installation',
      answers,
    }],
  };

  const payload = buildBackupPayload(purposeTree, [], 'metadata');
  assert.deepEqual(payload.formSubmissions[0]?.answers, answers);
  assert.equal(payload.formSubmissions[0]?.historicalMeterRemoved, false);
});

test('staged sync keeps unresolved local Completed forms Draft until evidence is remote', () => {
  const metadata = buildBackupPayload(tree, [], 'metadata');
  assert.equal(metadata.formSubmissions[0]?.status, 'Draft');
  assert.equal(metadata.formSubmissions[0]?.completedAt, null);
  assert.equal(metadata.formSubmissions[0]?.attachments.length, 0);
  assert.equal(tree.formSubmissions[0]?.status, 'Completed');

  const clearedQueue: CloudUploadQueueItem[] = discoverBackupMedia(tree).map((item, index) => ({
    ...item,
    id: `staged-${index}`,
    status: 'cleared',
    attempts: 1,
    remote_url: `https://api.example.test/v1/files/staged-${index}.jpg`,
    updated_at: '2026-07-22T01:00:00.000Z',
  }));
  const confirmedMetadata = buildBackupPayload(tree, clearedQueue, 'metadata');
  const complete = buildBackupPayload(tree, clearedQueue, 'complete');
  assert.equal(confirmedMetadata.formSubmissions[0]?.status, 'Draft');
  assert.equal(confirmedMetadata.formSubmissions[0]?.completedAt, null);
  assert.equal(complete.formSubmissions[0]?.status, 'Completed');
  assert.equal(complete.formSubmissions[0]?.attachments.length, 1);
});

test('metadata stages a zero-attachment local Completed form as Draft', () => {
  const completedAt = '2026-07-22T02:00:00.000Z';
  const zeroAttachmentTree: InstallationBackupTree = {
    ...tree,
    formSubmissions: [{
      ...tree.formSubmissions[0]!,
      attachments: [],
      completed_at: completedAt,
    }],
  };

  const metadata = buildBackupPayload(zeroAttachmentTree, [], 'metadata');
  const legacySafeDefault = buildBackupPayload(zeroAttachmentTree, []);
  const complete = buildBackupPayload(zeroAttachmentTree, [], 'complete');

  assert.equal(metadata.formSubmissions[0]?.status, 'Draft');
  assert.equal(metadata.formSubmissions[0]?.completedAt, null);
  assert.equal(legacySafeDefault.formSubmissions[0]?.status, 'Draft');
  assert.equal(complete.formSubmissions[0]?.status, 'Completed');
  assert.equal(complete.formSubmissions[0]?.completedAt, completedAt);
  assert.equal(zeroAttachmentTree.formSubmissions[0]?.status, 'Completed');
});

test('metadata stages an already-remote local Completed form as Draft', () => {
  const remoteAttachmentTree: InstallationBackupTree = {
    ...tree,
    formSubmissions: [{
      ...tree.formSubmissions[0]!,
      completed_at: '2026-07-22T03:00:00.000Z',
      attachments: [{
        ...tree.formSubmissions[0]!.attachments[0]!,
        uri: 'https://api.example.test/v1/files/already-remote.jpg',
      }],
    }],
  };

  const metadata = buildBackupPayload(remoteAttachmentTree, [], 'metadata');
  const complete = buildBackupPayload(remoteAttachmentTree, [], 'complete');

  assert.equal(metadata.formSubmissions[0]?.status, 'Draft');
  assert.equal(metadata.formSubmissions[0]?.attachments.length, 1);
  assert.equal(metadata.formSubmissions[0]?.completedAt, null);
  assert.equal(complete.formSubmissions[0]?.status, 'Completed');
  assert.equal(complete.formSubmissions[0]?.attachments.length, 1);
  assert.equal(remoteAttachmentTree.formSubmissions[0]?.status, 'Completed');
});

test('queue reconciliation removes evidence deleted after a failed upload', () => {
  const references = discoverBackupMedia(tree);
  const failedQueue: CloudUploadQueueItem[] = references.map((reference, index) => ({
    ...reference,
    id: `existing-${index}`,
    status: reference.local_uri === 'file:///form.jpg' ? 'failed' : 'cleared',
    attempts: 1,
    remote_url: reference.local_uri === 'file:///form.jpg'
      ? undefined
      : `https://api.example.test/v1/files/${index}.jpg`,
    updated_at: '2026-07-22T00:00:00.000Z',
  }));
  const withoutAttachment: InstallationBackupTree = {
    ...tree,
    formSubmissions: [{
      ...tree.formSubmissions[0]!,
      attachments: [],
    }],
  };

  const reconciled = reconciledBackupMediaQueue(
    failedQueue,
    tree.installation.id,
    discoverBackupMedia(withoutAttachment),
    () => 'unexpected-new-row',
  );

  assert.equal(reconciled.some((item) => item.local_uri === 'file:///form.jpg'), false);
  assert.equal(reconciled.some((item) => item.status === 'failed'), false);
  assert.equal(reconciled.length, failedQueue.length - 1);
  assert.equal(reconciled.every((item) => item.id.startsWith('existing-')), true);
});

test('queue reconciliation replaces failed evidence with one exact pending identity', () => {
  const references = discoverBackupMedia(tree);
  const failedQueue: CloudUploadQueueItem[] = references.map((reference, index) => ({
    ...reference,
    id: `existing-${index}`,
    status: reference.local_uri === 'file:///form.jpg' ? 'failed' : 'cleared',
    attempts: 5,
    remote_url: reference.local_uri === 'file:///form.jpg'
      ? undefined
      : `https://api.example.test/v1/files/${index}.jpg`,
    updated_at: '2026-07-22T00:00:00.000Z',
  }));
  const withReplacement: InstallationBackupTree = {
    ...tree,
    formSubmissions: [{
      ...tree.formSubmissions[0]!,
      attachments: [{
        ...tree.formSubmissions[0]!.attachments[0]!,
        uri: 'file:///replacement.jpg',
      }],
    }],
  };

  const reconciled = reconciledBackupMediaQueue(
    failedQueue,
    tree.installation.id,
    discoverBackupMedia(withReplacement),
    () => 'replacement-upload',
    '2026-07-23T00:00:00.000Z',
  );
  const formRows = reconciled.filter((item) => item.entity_type === 'form_submission');

  assert.deepEqual(formRows, [{
    installation_id: 'installation-1',
    entity_type: 'form_submission',
    entity_id: 'form-1',
    field_name: 'attachments[0].uri',
    local_uri: 'file:///replacement.jpg',
    mime_type: 'image/jpeg',
    id: 'replacement-upload',
    status: 'pending',
    attempts: 0,
    updated_at: '2026-07-23T00:00:00.000Z',
  }]);
  assert.equal(reconciled.some((item) => item.local_uri === 'file:///form.jpg'), false);
});

test('legacy meter evidence is promoted once to stable meter identity and survives reorder/retry', () => {
  const canonicalTree: InstallationBackupTree = {
    ...tree,
    meterDevices: [{
      id: 'meter-1',
      installationId: 'installation-1',
      installedOnBoardId: 'board-1',
      deviceFamily: 'WATTWATCHERS',
      deviceModel: 'A3RM',
      serialNumber: 'device-1',
      displayName: {
        value: 'SITE-A3RM-001', generatedValue: 'SITE-A3RM-001',
        isOverridden: false, ruleVersion: 1, provisional: true,
      },
      channels: [],
      wwPhotos: { labeling: 'file:///label.jpg' },
    }],
  };
  const references = discoverBackupMedia(canonicalTree);
  const stable = references.find((item) => item.entity_type === 'meter_device');
  assert.equal(stable?.entity_id, 'meter-1');
  assert.equal(stable?.field_name, 'wwPhotos.labeling');

  const legacy: CloudUploadQueueItem = {
    id: 'legacy-upload',
    installation_id: 'installation-1',
    entity_type: 'electrical_asset',
    entity_id: 'board-1',
    field_name: 'meters[0].wwPhotos.labeling',
    local_uri: 'file:///label.jpg',
    mime_type: 'image/jpeg',
    status: 'cleared',
    attempts: 2,
    remote_url: 'https://api.example.test/evidence/label.jpg',
    updated_at: '2026-07-22T00:00:00.000Z',
  };
  const promoted = reconciledBackupMediaQueue([legacy], 'installation-1', references);
  const promotedMeter = promoted.find((item) => item.id === 'legacy-upload');
  assert.equal(promotedMeter?.entity_type, 'meter_device');
  assert.equal(promotedMeter?.field_name, 'wwPhotos.labeling');
  assert.equal(promotedMeter?.status, 'cleared');

  const reorderedTree: InstallationBackupTree = {
    ...canonicalTree,
    electricalAssets: [{
      ...canonicalTree.electricalAssets[0]!,
      meters: [
        { id: 'meter-new', device_name: 'New', device_type: 'Other', device_id: 'new' },
        canonicalTree.electricalAssets[0]!.meters[0]!,
      ],
    }],
  };
  const afterReorder = reconciledBackupMediaQueue(
    promoted,
    'installation-1',
    discoverBackupMedia(reorderedTree),
  );
  const retained = afterReorder.find((item) => item.entity_type === 'meter_device');
  assert.equal(retained?.id, 'legacy-upload');
  assert.equal(retained?.status, 'cleared');
  assert.equal(retained?.remote_url, legacy.remote_url);
});
