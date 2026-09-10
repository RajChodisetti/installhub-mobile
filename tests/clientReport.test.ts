import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clientReportModel, collectClientReportPhotos, parseClientReportPhotoExclusions,
  withClientReportPhotoIncluded, type ClientReportData,
} from '../src/domain/clientReport';
import { buildClientReportHtml } from '../src/services/clientReportHtml';

function fixture(): ClientReportData {
  return {
    installation: {
      id: 'installation', client_name: 'Client', site_name: '<script>Site</script>',
      site_address: 'Address', inspector_name: 'Technician', audit_date: '2026-09-05',
      status: 'Draft', cloud_backup_enabled: false, created_at: '', updated_at: '',
    },
    zones: [{ id: 'zone', audit_id: 'installation', zone_name: 'Plant', zone_description: '', photos: ['file:///zone.jpg'], photo_notes: { 'photos[0]': 'Incoming supply room' }, photoMetadata: { 'photos[0]': { largeInPdf: true } }, created_at: '', updated_at: '' }],
    electricalAssets: [{
      id: 'board', audit_id: 'installation', zone_id: 'zone', asset_name: 'Main', asset_type: 'MSB',
      display_code: 'MSB-01', meters: [{ id: 'meter', device_name: 'Meter', device_type: 'A3RM', device_id: 'SERIAL', ww_photos: { labeling: 'file:///label.jpg' }, photo_notes: { 'wwPhotos.labeling': 'Channel labels after work' } }],
      meter_present: true, electrical_source: { kind: 'TBC' }, created_at: '', updated_at: '',
    }],
    siteAssets: [{
      id: 'asset', audit_id: 'installation', zone_id: 'zone', asset_name: 'HVAC', asset_type: 'HVAC',
      metering_state: { kind: 'UNMETERED' }, meter_present: false, created_at: '', updated_at: '',
    }],
    meterDevices: [],
    formSubmissions: [{
      id: 'form', installation_id: 'installation', form_type: 'honeywell-q400', schema_version: 2,
      status: 'Completed', answers: {}, created_at: '', updated_at: '',
      attachments: [{ id: 'photo', slot: 'water.lcd_photo', uri: 'file:///water.jpg', caption: 'Water <meter>', mime_type: 'image/jpeg', captured_at: '' }],
    }],
  };
}

test('gallery and report include zone, legacy meter and form evidence with portal keys', () => {
  const data = fixture();
  const report = clientReportModel(data);
  assert.deepEqual(report.photos.map((photo) => photo.key), ['zone:zone:0', 'meter:meter:labeling', 'form:form:photo']);
  assert.deepEqual(report.photos.map((photo) => photo.label), ['Incoming supply room', 'Channel labels after work', 'Water <meter>']);
  assert.deepEqual(report.photos.map((photo) => photo.largeInPdf), [true, false, false]);
  assert.deepEqual(report.missingEvidence, ['Site asset · HVAC']);
  assert.equal(report.meterCount, 1);
  assert.equal(report.completedFormCount, 1);
  assert.equal(report.openTbcCount, 1);
  assert.deepEqual(report.zones, [{ id: 'zone', name: 'Plant', boards: 1, assets: 1 }]);
});

test('canonical meter photos override duplicated legacy projections without dropping unprojected devices', () => {
  const data = fixture();
  data.meterDevices = [{ id: 'meter', installedOnBoardId: 'board', displayName: { value: 'Canonical Meter' }, wwPhotos: { labeling: 'file:///canonical.jpg' } },
    { id: 'new-meter', installedOnBoardId: 'board', displayName: { value: 'New Meter' }, wwPhotos: { deviceInstalled: 'file:///new.jpg' } },
  ] as ClientReportData['meterDevices'];
  const photos = collectClientReportPhotos(data);
  assert.equal(photos.filter((photo) => photo.key === 'meter:meter:labeling').length, 1);
  assert.equal(photos.find((photo) => photo.key === 'meter:meter:labeling')?.uri, 'file:///canonical.jpg');
  assert.ok(photos.some((photo) => photo.key === 'meter:new-meter:device installed'));
});

test('photo choices survive storage serialization and never exclude replaced evidence', () => {
  const data = fixture();
  const photo = collectClientReportPhotos(data)[0];
  const excluded = parseClientReportPhotoExclusions(JSON.stringify(withClientReportPhotoIncluded({}, photo, false)));
  assert.equal(clientReportModel(data, excluded).includedPhotos.length, 2);
  data.zones[0].photos[0] = 'file:///replacement.jpg';
  assert.equal(clientReportModel(data, excluded).includedPhotos.length, 3);
  assert.deepEqual(withClientReportPhotoIncluded(excluded, photo, true), {});
  assert.deepEqual(parseClientReportPhotoExclusions('broken'), {});
  assert.deepEqual(parseClientReportPhotoExclusions('["not-a-map"]'), {});
});

test('client PDF contains the same selected evidence and escapes all captured text', () => {
  const data = fixture();
  const photos = collectClientReportPhotos(data);
  const excluded = withClientReportPhotoIncluded({}, photos[0], false);
  const images = Object.fromEntries(photos.map((photo) => [photo.key, 'data:image/jpeg;base64,YWJj']));
  const html = buildClientReportHtml(data, excluded, images);
  assert.match(html, /&lt;script&gt;Site&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Water &lt;meter&gt;/);
  assert.match(html, /2 of 3 available photos included/);
  assert.doesNotMatch(html, /Plant photo 1/);
  assert.doesNotMatch(html, /Incoming supply room/);
  assert.match(html, /Honeywell Q400/);
  // Native print must keep a heading (including its rule) with the following
  // content while allowing the selected-evidence collection to span pages.
  assert.match(html, /h2\{[^}]*break-inside:avoid;page-break-inside:avoid;break-after:avoid;page-break-after:avoid\}/);
  assert.equal((html.match(/<figure>/g) ?? []).length, 2);
  assert.throws(() => buildClientReportHtml(data, excluded, {}), /Preview image unavailable/);
  assert.throws(() => buildClientReportHtml(data, excluded, { ...images, 'meter:meter:labeling': 'javascript:alert(1)' }), /Preview image unavailable/);
});

test('client PDF keeps flagged evidence full width and compact evidence in EcoAudit grids', () => {
  const data = fixture();
  const photos = collectClientReportPhotos(data);
  const images = Object.fromEntries(photos.map((photo) => [photo.key, 'data:image/jpeg;base64,YWJj']));
  const html = buildClientReportHtml(data, {}, images);

  assert.match(html, /class="photo-large"/);
  assert.match(html, /class="photo-grid cols-2"/);
  assert.match(html, /max-height:172px/);
  assert.match(html, /max-height:370px/);
  assert.match(html, /border:1px solid #CBD5E1/);
  assert.match(html, /Incoming supply room/);
});
