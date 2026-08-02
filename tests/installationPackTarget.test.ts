import assert from 'node:assert/strict';
import test from 'node:test';
import type { InstallationBackupTree } from '../src/repositories/cloudSyncRepository';
import {
  hasIntactImportedSourceProvenance,
  installationPackRevision,
  isInstallationTreeBackedUpCurrent,
  resolveInstallationPackServerTarget,
} from '../src/services/installationPackTarget';
import {
  formReportJobKey,
  installationReportJobKey,
} from '../src/services/reportJobKeys';

const importedAt = '2026-07-23T12:00:00.000Z';

const pristineImportedTree: InstallationBackupTree = {
  treeSchemaVersion: 2,
  installation: {
    id: 'local-copy',
    client_name: 'Example Client',
    site_name: 'Example Site cp1',
    site_address: '42 Example Road',
    inspector_name: 'Inspector',
    audit_date: '2026-07-23',
    status: 'Completed',
    cloud_backup_enabled: false,
    is_imported_copy: true,
    import_source_server_id: 'source-installation',
    import_source_record_version_number: 7,
    record_version_number: 3,
    import_provenance_watermark: importedAt,
    copy_index: 1,
    thumbnail_status: 'ready',
    thumbnail_total: 2,
    thumbnail_ready: 2,
    created_at: importedAt,
    updated_at: importedAt,
  },
  gridSupplies: [],
  zones: [{
    id: 'local-zone',
    audit_id: 'local-copy',
    zone_name: 'Main building',
    zone_description: '',
    photos: ['https://api.example.test/original-zone.jpg'],
    created_at: importedAt,
    updated_at: importedAt,
  }],
  electricalAssets: [],
  siteAssets: [],
  meterDevices: [],
  measurementAssignments: [],
  formSubmissions: [{
    id: 'local-form',
    import_source_server_id: 'source-form',
    form_type: 'captis-logger',
    schema_version: 2,
    status: 'Completed',
    installation_id: 'local-copy',
    answers: { 'job.siteName': 'Example Site' },
    attachments: [],
    created_at: importedAt,
    updated_at: importedAt,
  }],
  watermark: importedAt,
};

const noSyncMetadata = { forceDirty: false };

test('installation pack reuses source IDs only for intact import provenance', () => {
  assert.equal(
    hasIntactImportedSourceProvenance(
      pristineImportedTree,
      noSyncMetadata,
    ),
    true,
  );
  assert.deepEqual(
    resolveInstallationPackServerTarget(
      pristineImportedTree,
      noSyncMetadata,
      true,
    ),
    {
      installationId: 'source-installation',
      formSubmissionIds: ['source-form'],
      usesOriginalImportedRecord: true,
      reason: 'original-import-provenance',
      recordVersionNumber: 7,
    },
  );
});

test('an intact local import does not reuse its source until the remote revision is verified', () => {
  const target = resolveInstallationPackServerTarget(
    pristineImportedTree,
    noSyncMetadata,
  );
  assert.equal(target.usesOriginalImportedRecord, false);
  assert.equal(target.installationId, 'local-copy');
  assert.equal(target.reason, 'remote-source-divergence');
});

test('edited, added, amended, deleted or previously backed-up cpN trees target the local copy', () => {
  const changedAt = '2026-07-23T12:05:00.000Z';
  const localDraft = {
    ...pristineImportedTree.formSubmissions[0]!,
    id: 'new-local-form',
    import_source_server_id: undefined,
    status: 'Draft' as const,
    created_at: changedAt,
    updated_at: changedAt,
  };
  const cases: Array<{
    tree: InstallationBackupTree;
    metadata: { forceDirty: boolean; syncedWatermark?: string };
  }> = [
    {
      tree: {
        ...pristineImportedTree,
        installation: {
          ...pristineImportedTree.installation,
          client_name: 'Edited client',
          updated_at: changedAt,
        },
        watermark: changedAt,
      },
      metadata: noSyncMetadata,
    },
    {
      tree: {
        ...pristineImportedTree,
        zones: [{
          ...pristineImportedTree.zones[0]!,
          zone_name: 'Edited zone',
          updated_at: changedAt,
        }],
        watermark: changedAt,
      },
      metadata: noSyncMetadata,
    },
    {
      tree: {
        ...pristineImportedTree,
        formSubmissions: [
          pristineImportedTree.formSubmissions[0]!,
          localDraft,
        ],
        watermark: changedAt,
      },
      metadata: noSyncMetadata,
    },
    {
      tree: {
        ...pristineImportedTree,
        formSubmissions: [{
          ...pristineImportedTree.formSubmissions[0]!,
          import_source_server_id: undefined,
          updated_at: changedAt,
        }],
        watermark: changedAt,
      },
      metadata: noSyncMetadata,
    },
    {
      // A deletion cannot be inferred from remaining timestamps; repository
      // deletion marks the durable force-dirty signal instead.
      tree: { ...pristineImportedTree, zones: [] },
      metadata: { forceDirty: true },
    },
    {
      tree: pristineImportedTree,
      metadata: { forceDirty: false, syncedWatermark: importedAt },
    },
  ];

  for (const candidate of cases) {
    const target = resolveInstallationPackServerTarget(
      candidate.tree,
      candidate.metadata,
    );
    assert.equal(target.usesOriginalImportedRecord, false);
    assert.equal(target.installationId, 'local-copy');
    assert.equal(target.reason, 'local-divergence');
    assert.deepEqual(target.formSubmissionIds, ['local-form']);
  }
});

test('a backup-enabled imported copy and a regular installation always use local IDs', () => {
  const backedUp = resolveInstallationPackServerTarget(
    {
      ...pristineImportedTree,
      installation: {
        ...pristineImportedTree.installation,
        cloud_backup_enabled: true,
      },
    },
    noSyncMetadata,
  );
  assert.equal(backedUp.installationId, 'local-copy');
  assert.equal(backedUp.usesOriginalImportedRecord, false);
  assert.equal(backedUp.reason, 'local-backup-enabled');

  const local = resolveInstallationPackServerTarget(
    {
      ...pristineImportedTree,
      installation: {
        ...pristineImportedTree.installation,
        is_imported_copy: false,
        import_source_server_id: undefined,
      },
    },
    noSyncMetadata,
  );
  assert.equal(local.installationId, 'local-copy');
  assert.equal(local.reason, 'local-installation');
});

test('an older imported copy without an explicit provenance anchor is backed up locally', () => {
  const target = resolveInstallationPackServerTarget(
    {
      ...pristineImportedTree,
      installation: {
        ...pristineImportedTree.installation,
        import_provenance_watermark: undefined,
      },
    },
    noSyncMetadata,
  );
  assert.equal(target.usesOriginalImportedRecord, false);
  assert.equal(target.installationId, 'local-copy');
  assert.equal(target.reason, 'local-divergence');
});

test('server generation accepts a local tree only at its durable synced watermark', () => {
  assert.equal(
    isInstallationTreeBackedUpCurrent(pristineImportedTree, {
      forceDirty: false,
      syncedWatermark: importedAt,
    }),
    true,
  );
  assert.equal(
    isInstallationTreeBackedUpCurrent(pristineImportedTree, {
      forceDirty: true,
      syncedWatermark: importedAt,
    }),
    false,
  );
  assert.equal(
    isInstallationTreeBackedUpCurrent(pristineImportedTree, {
      forceDirty: false,
      syncedWatermark: '2026-07-23T11:00:00.000Z',
    }),
    false,
  );
});

test('remembered installation jobs are separated by target and exact tree revision', () => {
  const originalRevision = installationPackRevision(
    pristineImportedTree,
    noSyncMetadata,
  );
  const changedRevision = installationPackRevision(
    {
      ...pristineImportedTree,
      zones: [{
        ...pristineImportedTree.zones[0]!,
        zone_description: 'Locally amended without relying on a timestamp',
      }],
    },
    noSyncMetadata,
  );
  const thumbnailOnlyRevision = installationPackRevision(
    {
      ...pristineImportedTree,
      installation: {
        ...pristineImportedTree.installation,
        thumbnail_status: 'pending',
        thumbnail_ready: 1,
      },
    },
    noSyncMetadata,
  );

  assert.notEqual(originalRevision, changedRevision);
  assert.equal(originalRevision, thumbnailOnlyRevision);
  assert.notEqual(
    installationReportJobKey(
      'local-copy',
      'source-installation',
      originalRevision,
      7,
    ),
    installationReportJobKey('local-copy', 'local-copy', changedRevision, 3),
  );
  assert.notEqual(
    formReportJobKey(
      'local-form',
      'source-installation',
      'source-form',
      originalRevision,
      7,
    ),
    formReportJobKey(
      'local-form',
      'local-copy',
      'local-form',
      changedRevision,
      3,
    ),
  );
  assert.notEqual(
    installationReportJobKey('local-copy', 'source-installation', originalRevision, 7),
    installationReportJobKey('local-copy', 'source-installation', originalRevision, 8),
  );
  assert.equal(
    installationReportJobKey('local-copy'),
    'installation:local-copy',
  );
});
