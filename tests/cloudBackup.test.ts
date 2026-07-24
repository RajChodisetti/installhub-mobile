import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBackupPayload, discoverBackupMedia } from '../src/services/backupMedia';
import {
  reconciledBackupMediaQueue,
  type InstallationBackupTree,
} from '../src/repositories/cloudSyncRepository';
import type { CloudUploadQueueItem } from '../src/types';

const tree: InstallationBackupTree = {
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
