import assert from 'node:assert/strict';
import test from 'node:test';
import { PRIVACY_POLICY_URL } from '../src/constants/legalLinks';

test('Privacy Policy uses the public credential-free QA HTTPS route', () => {
  const url = new URL(PRIVACY_POLICY_URL);

  assert.equal(url.protocol, 'https:');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  assert.equal(url.pathname, '/privacy-policy');
  assert.equal(url.search, '');
  assert.equal(url.hash, '');
  assert.equal(url.hostname, 'ecoaudit-qa.170.64.154.143.sslip.io');
});
