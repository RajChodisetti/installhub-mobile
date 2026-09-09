import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validIanaTimezone,
  validateInstallationIdentity,
  installationIdentityForWrite,
} from '../src/domain/installationValidation';

test('portal permits blank optional installation identity fields', () => {
  const errors = validateInstallationIdentity({
    client_name: '', site_name: ' ', site_address: '', inspector_name: '',
    site_code: '', audit_date: '', timezone: undefined,
  });
  assert.deepEqual(errors, []);
});

test('blank capture uses portal defaults and produces a valid write', () => {
  const values = installationIdentityForWrite({
    client_name: ' ', site_name: '', site_address: '', inspector_name: '',
    site_code: '', audit_date: '', timezone: undefined,
  }, undefined, '2026-09-05');
  assert.deepEqual(values, {
    client_name: '', site_name: 'Untitled installation', site_address: '', inspector_name: '',
    site_code: 'UI', audit_date: '2026-09-05', timezone: 'Australia/Sydney',
  });
  assert.deepEqual(validateInstallationIdentity(values), []);
});

test('unrelated edits preserve a historical site code byte-for-byte', () => {
  for (const site_code of ['old mixed Code', '123456789012345678901234', ' OLD ']) {
    const initial = { site_code };
    const values = installationIdentityForWrite({
      client_name: 'Client', site_name: 'Renamed', site_address: '', inspector_name: '',
      site_code, audit_date: '2026-09-05', timezone: 'Australia/Sydney',
    }, initial);
    assert.equal(values.site_code, site_code);
    assert.deepEqual(validateInstallationIdentity(values, initial), []);
    assert.deepEqual(validateInstallationIdentity({ ...values, site_code: 'bad code' }, initial).map((error) => error.field), ['site_code']);
  }
});

test('cleared code regenerates and a newly authored code normalizes as in portal', () => {
  const input = {
    client_name: '', site_name: 'Essendon Test', site_address: '', inspector_name: '',
    site_code: '', audit_date: '2026-09-05', timezone: 'Australia/Sydney',
  };
  assert.equal(installationIdentityForWrite(input, { site_code: 'OLD' }).site_code, 'ET');
  assert.equal(installationIdentityForWrite({ ...input, site_code: ' new-01 ' }).site_code, 'NEW-01');
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

test('job end date is optional, real, and not before the scheduled date', () => {
  const base = {
    client_name: 'Client', site_name: 'Site', site_address: 'Address', inspector_name: 'Inspector',
    site_code: 'SITE', audit_date: '2026-09-09', timezone: 'Australia/Sydney',
  };
  assert.deepEqual(validateInstallationIdentity({ ...base, job_end_date: null }), []);
  assert.deepEqual(validateInstallationIdentity({
    ...base, job_end_date: '2026-02-30',
  }).map((error) => error.field), ['job_end_date']);
  assert.deepEqual(validateInstallationIdentity({
    ...base, job_end_date: '2026-09-08',
  }).map((error) => error.field), ['job_end_date']);
  assert.equal(installationIdentityForWrite({
    ...base, job_end_date: ' 2026-09-11 ',
  }).job_end_date, '2026-09-11');
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
