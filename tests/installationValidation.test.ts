import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validIanaTimezone,
  validateInstallationIdentity,
} from '../src/domain/installationValidation';

test('installation identity requires every completion-critical field', () => {
  const errors = validateInstallationIdentity({
    client_name: '', site_name: ' ', site_address: '', inspector_name: '',
    site_code: '', audit_date: '', timezone: undefined,
  });
  assert.deepEqual(errors.map((error) => error.field), [
    'client_name', 'site_name', 'site_code', 'site_address', 'inspector_name', 'audit_date', 'timezone',
  ]);
});

test('installation identity validates a real audit date and IANA timezone', () => {
  const base = {
    client_name: 'Client', site_name: 'Site', site_address: 'Address', inspector_name: 'Inspector',
    site_code: 'SITE',
  };
  assert.deepEqual(validateInstallationIdentity({
    ...base, audit_date: '2026-02-30', timezone: 'Mars/Olympus',
  }).map((error) => error.field), ['audit_date', 'timezone']);
  assert.deepEqual(validateInstallationIdentity({
    ...base, audit_date: '2026-08-02', timezone: 'Australia/Sydney',
  }), []);
  assert.equal(validIanaTimezone('America/Phoenix'), true);
  assert.equal(validIanaTimezone(''), false);
});

test('installation short code is bounded for generated asset prefixes', () => {
  const base = {
    client_name: 'Client', site_name: 'Site', site_address: 'Address', inspector_name: 'Inspector',
    audit_date: '2026-08-02', timezone: 'Australia/Sydney',
  };
  for (const site_code of ['site', 'SITE CODE', '-SITE', 'SITE-', 'SITE--A', 'ABCDEFGHIJKLMNOPQ']) {
    assert.deepEqual(
      validateInstallationIdentity({ ...base, site_code }).map((error) => error.field),
      ['site_code'],
      site_code,
    );
  }
  assert.deepEqual(validateInstallationIdentity({ ...base, site_code: 'SITE-01' }), []);
});
