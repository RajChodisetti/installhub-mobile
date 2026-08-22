import assert from 'node:assert/strict';
import test from 'node:test';
import { preserveUnmaterializedInstallationFields } from '../src/domain/installationMetadata';
import type { Installation } from '../src/types';

const legacyInitial: Partial<Installation> = {
  id: 'legacy-installation',
  client_name: 'Contracting client',
  site_name: 'Legacy site',
  site_address: '1 Example Street',
  inspector_name: 'Technician',
  audit_date: '2026-08-22',
};

test('legacy editor defaults do not become explicit metadata clears', () => {
  const result = preserveUnmaterializedInstallationFields(legacyInitial, {
    client_name: 'Updated client',
    customer_name: null,
    site_contact_name: null,
    access_information: null,
    monitoring_installed: null,
    solar_capacity_kw: null,
  });

  assert.equal(result.client_name, 'Updated client');
  assert.equal('customer_name' in result, false);
  assert.equal('site_contact_name' in result, false);
  assert.equal('access_information' in result, false);
  assert.equal('monitoring_installed' in result, false);
  assert.equal('solar_capacity_kw' in result, false);
});

test('authored values and clears of materialized fields remain explicit', () => {
  const result = preserveUnmaterializedInstallationFields({
    ...legacyInitial,
    customer_name: 'Existing customer',
    site_contact_name: null,
  }, {
    customer_name: null,
    site_contact_name: 'New contact',
    access_information: 'Use the eastern gate',
  });

  assert.equal(result.customer_name, null);
  assert.equal(result.site_contact_name, 'New contact');
  assert.equal(result.access_information, 'Use the eastern gate');
});

test('new installations keep explicit unknown values', () => {
  const result = preserveUnmaterializedInstallationFields(undefined, {
    customer_name: null,
    maas: null,
    monitoring_installed: null,
  });

  assert.equal('customer_name' in result, true);
  assert.equal('maas' in result, true);
  assert.equal('monitoring_installed' in result, true);
});
