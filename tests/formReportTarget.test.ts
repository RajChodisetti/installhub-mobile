import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFormReportServerTarget } from '../src/services/formReportTarget';
import type { FormSubmission, Installation } from '../src/types';

const installation: Installation = {
  id: 'local-installation',
  client_name: 'Example',
  site_name: 'Example site',
  site_address: 'Example address',
  inspector_name: 'Inspector',
  audit_date: '2026-07-23',
  status: 'Draft',
  cloud_backup_enabled: false,
  created_at: '2026-07-23T00:00:00.000Z',
  updated_at: '2026-07-23T00:00:00.000Z',
};

const form: FormSubmission = {
  id: 'local-form',
  form_type: 'captis-logger',
  schema_version: 2,
  status: 'Completed',
  installation_id: installation.id,
  answers: {},
  attachments: [],
  created_at: '2026-07-23T00:00:00.000Z',
  updated_at: '2026-07-23T00:00:00.000Z',
};

test('server form PDF targets the unchanged imported cloud record when available', () => {
  assert.deepEqual(
    resolveFormReportServerTarget(
      {
        ...installation,
        is_imported_copy: true,
        import_source_server_id: 'server-installation',
        import_source_record_version_number: 9,
      },
      { ...form, import_source_server_id: 'server-form' },
      true,
    ),
    {
      installationId: 'server-installation',
      formId: 'server-form',
      usesOriginalImportedRecord: true,
      recordVersionNumber: 9,
    },
  );
});

test('server form PDF requires a caller-verified intact installation provenance', () => {
  assert.deepEqual(
    resolveFormReportServerTarget(
      {
        ...installation,
        is_imported_copy: true,
        import_source_server_id: 'server-installation',
      },
      { ...form, import_source_server_id: 'server-form' },
    ),
    {
      installationId: 'local-installation',
      formId: 'local-form',
      usesOriginalImportedRecord: false,
      liveMode: true,
    },
  );
});

test('server form PDF targets the local identities when the copy is backed up or incomplete', () => {
  for (const candidate of [
    {
      installation: {
        ...installation,
        is_imported_copy: true,
        cloud_backup_enabled: true,
        import_source_server_id: 'server-installation',
      },
      form: { ...form, import_source_server_id: 'server-form' },
    },
    {
      installation: {
        ...installation,
        is_imported_copy: true,
        import_source_server_id: 'server-installation',
      },
      form,
    },
    { installation, form },
  ]) {
    assert.deepEqual(
      resolveFormReportServerTarget(candidate.installation, candidate.form),
      {
        installationId: 'local-installation',
        formId: 'local-form',
        usesOriginalImportedRecord: false,
        liveMode: true,
      },
    );
  }
});

test('later local edits still request the pinned authoritative version', () => {
  const pinnedInstallation: Installation = {
    ...installation,
    status: 'Completed',
    record_version_number: 12,
    tree_revision: 4,
    server_tree_revision: 18,
  };
  const beforeEdit = resolveFormReportServerTarget(pinnedInstallation, form);
  const afterEdit = resolveFormReportServerTarget(
    {
      ...pinnedInstallation,
      status: 'Draft',
      tree_revision: 27,
      server_tree_revision: 21,
      updated_at: '2026-07-24T00:00:00.000Z',
    },
    { ...form, updated_at: '2026-07-24T00:00:00.000Z' },
  );

  assert.equal(beforeEdit.recordVersionNumber, 12);
  assert.equal(afterEdit.recordVersionNumber, 12);
  assert.equal('liveMode' in afterEdit, false);
});
