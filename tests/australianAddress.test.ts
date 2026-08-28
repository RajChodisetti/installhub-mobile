import assert from 'node:assert/strict';
import test from 'node:test';
import {
  australianAddressFingerprint,
  australianAddressFromInstallation,
  installationAddressFields,
  manualAustralianAddressEdit,
  md5Hex,
  normalizeAustralianAddress,
  normalizeClientNameKey,
} from '../src/domain/australianAddress';

test('mobile fingerprint matches the shared PostgreSQL-compatible address contract', () => {
  assert.equal(md5Hex(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5Hex('abc'), '900150983cd24fb0d6963f7d28e17f72');
  assert.equal(australianAddressFingerprint({
    display_address: ' 1 Example  Road ',
    locality: 'Sydney',
    state: 'NSW',
    postcode: '2000',
    country_code: 'AU',
  }), '72fad9b7d6f5635bdc1287ca88b5ccbb100ff044bb150ca765ef29422b270f0e');
});

test('client matching applies NFKC, whitespace collapse, and case folding', () => {
  assert.equal(normalizeClientNameKey('  ＡＢＣ   Energy '), 'abc energy');
  assert.equal(normalizeClientNameKey('ABC Energy'), normalizeClientNameKey('abc energy'));
});

test('manual edits preserve display text but invalidate stale selected-address geocoding', () => {
  const selected = normalizeAustralianAddress({
    display_address: '1 Example Road, Sydney NSW 2000',
    locality: 'Sydney',
    state: 'NSW',
    postcode: '2000',
    country_code: 'AU',
    latitude: -33.8688,
    longitude: 151.2093,
    provider: 'geoapify',
    place_id: 'provider-place',
    source: 'suggested',
    geocoding_status: 'resolved',
    fingerprint: '',
  });
  const edited = manualAustralianAddressEdit(selected, { postcode: '2001' });
  assert.equal(edited.display_address, selected.display_address);
  assert.equal(edited.postcode, '2001');
  assert.equal(edited.latitude, null);
  assert.equal(edited.longitude, null);
  assert.equal(edited.provider, null);
  assert.equal(edited.place_id, null);
  assert.equal(edited.source, 'manual');
  assert.equal(edited.geocoding_status, 'unresolved');
  assert.notEqual(edited.fingerprint, selected.fingerprint);
});

test('legacy and invalid suggested addresses remain valid manual Australian records', () => {
  const legacy = australianAddressFromInstallation({
    site_address: '9 Manual Street',
    site_locality: 'Hobart',
    site_state: 'tas',
    site_postcode: '7000',
  });
  assert.equal(legacy.country_code, 'AU');
  assert.equal(legacy.state, 'TAS');
  assert.equal(legacy.source, 'manual');
  assert.equal(legacy.geocoding_status, 'unresolved');
  assert.match(legacy.fingerprint, /^[0-9a-f]{64}$/);

  const incompleteSuggestion = normalizeAustralianAddress({
    ...legacy,
    source: 'suggested',
    geocoding_status: 'resolved',
    provider: 'geoapify',
    place_id: 'missing-coordinates',
  });
  assert.equal(incompleteSuggestion.source, 'manual');
  assert.equal(incompleteSuggestion.geocoding_status, 'unresolved');
});

test('installation mapping carries every additive wire field without requiring coordinates', () => {
  const fields = installationAddressFields(normalizeAustralianAddress({
    display_address: '9 Manual Street',
    locality: 'Hobart',
    state: 'TAS',
    postcode: '7000',
    country_code: 'AU',
    latitude: null,
    longitude: null,
    provider: null,
    place_id: null,
    source: 'manual',
    geocoding_status: 'unresolved',
    fingerprint: '',
  }));
  assert.deepEqual({
    source: fields.site_address_source,
    status: fields.site_geocoding_status,
    latitude: fields.site_latitude,
    longitude: fields.site_longitude,
    country: fields.site_country_code,
  }, {
    source: 'manual', status: 'unresolved', latitude: null, longitude: null, country: 'AU',
  });
});
