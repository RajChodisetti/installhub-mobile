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
      },
      { ...form, import_source_server_id: 'server-form' },
      true,
    ),
    {
      installationId: 'server-installation',
      formId: 'server-form',
      usesOriginalImportedRecord: true,
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
      },
    );
  }
});
