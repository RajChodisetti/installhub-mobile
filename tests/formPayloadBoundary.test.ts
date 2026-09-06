import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBackupPayload } from '../src/services/backupMedia';
import type { InstallationBackupTree } from '../src/repositories/cloudSyncRepository';

test('completed schema-v2 transport excludes invalid prefills and preserves the local immutable snapshot', () => {
  const tree: InstallationBackupTree = {
    treeSchemaVersion: 2,
    installation: {
      id: 'installation', client_name: '', site_name: 'Site', site_address: '',
      inspector_name: '', audit_date: '', status: 'Draft', cloud_backup_enabled: true,
      created_at: '', updated_at: '',
    },
    gridSupplies: [], zones: [], electricalAssets: [], siteAssets: [],
    meterDevices: [], measurementAssignments: [], watermark: '',
    formSubmissions: [{
      id: 'form', form_type: 'honeywell-q400', schema_version: 2,
      status: 'Completed', installation_id: 'installation',
      answers: {
        'water.serial_number': 'WATER-123', 'site.customer_name': 'Customer',
        'auditor.switchboard_name': 'Unrelated board prefill',
        'existing.device_id': 'Unrelated old device',
      },
      attachments: [{
        id: 'photo', slot: 'water.lcd_photo', uri: 'https://example.test/photo.jpg',
        mime_type: 'image/jpeg', caption: 'LCD evidence', captured_at: '2026-09-05T00:00:00.000Z',
      }],
      created_at: '', updated_at: '', completed_at: '2026-09-05T00:00:00.000Z',
    }],
  };
  const before = JSON.stringify(tree);
  const transmitted = buildBackupPayload(tree, [], 'complete').formSubmissions[0];
  assert.equal(transmitted.status, 'Completed');
  assert.deepEqual(transmitted.answers, { 'water.serial_number': 'WATER-123', 'site.customer_name': 'Customer' });
  assert.equal(transmitted.attachments[0].caption, 'LCD evidence');
  assert.equal(transmitted.attachments[0].slot, 'water.lcd_photo');
  assert.equal(JSON.stringify(tree), before);

  tree.formSubmissions[0].form_type = 'a3rm-installation';
  tree.formSubmissions[0].schema_version = 1;
  assert.deepEqual(buildBackupPayload(tree, [], 'complete').formSubmissions[0].answers, tree.formSubmissions[0].answers);
});
