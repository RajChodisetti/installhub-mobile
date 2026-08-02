import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countStoreEntities,
  formatBytes,
  formatStorageBytes,
  summarizeQueueState,
  utf8ByteLength,
} from '../src/services/storageDiagnostics';
import type { AppDataStore } from '../src/types';

const store = {
  installations: [{ id: 'installation-1' }],
  zones: [{ id: 'zone-1' }, { id: 'zone-2' }],
  electricalAssets: [
    { id: 'board-1', meters: [{ id: 'meter-1' }, { id: 'meter-2' }] },
    { id: 'board-2', meters: [] },
  ],
  siteAssets: [{ id: 'site-asset-1' }],
  formSubmissions: [
    { id: 'form-1', attachments: [{ id: 'attachment-1' }] },
    { id: 'form-2', attachments: [] },
  ],
  cloudSync: {
    synced_at_by_installation: {},
    force_dirty_installation_ids: [],
    upload_queue: [
      { id: 'upload-1', status: 'pending' },
      { id: 'upload-2', status: 'uploading' },
      { id: 'upload-3', status: 'failed' },
      { id: 'upload-4', status: 'cleared' },
    ],
    thumbnail_queue: [
      { id: 'thumb-1', status: 'pending' },
      { id: 'thumb-2', status: 'downloading' },
      { id: 'thumb-3', status: 'failed' },
      { id: 'thumb-4', status: 'ready' },
      { id: 'thumb-5', status: 'ready' },
    ],
  },
} as unknown as AppDataStore;

test('counts locally stored entities and nested evidence', () => {
  assert.deepEqual(countStoreEntities(store), {
    installations: 1,
    zones: 2,
    electricalAssets: 2,
    siteAssets: 1,
    meters: 2,
    formSubmissions: 2,
    attachments: 1,
  });
});

test('summarizes backup and thumbnail queue states independently', () => {
  assert.deepEqual(summarizeQueueState(store), {
    backup: {
      total: 4,
      pending: 1,
      uploading: 1,
      failed: 1,
      cleared: 1,
    },
    thumbnails: {
      total: 5,
      pending: 1,
      downloading: 1,
      failed: 1,
      ready: 2,
    },
  });
});

test('estimates UTF-8 byte length for ASCII and multibyte text', () => {
  assert.equal(utf8ByteLength('Field App Complete'), 18);
  assert.equal(utf8ByteLength('A–B'), 5);
  assert.equal(utf8ByteLength('📷'), 4);
});

test('formats storage sizes for diagnostics', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(10 * 1024 * 1024), '10 MB');
  assert.equal(formatStorageBytes(1536), '1.5 KB');
});
