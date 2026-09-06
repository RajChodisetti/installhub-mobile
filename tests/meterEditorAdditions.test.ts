import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilitiesFromDrafts, capabilityDrafts, insertStagedMeterSiteAssets, stagedMeterSiteAsset } from '../src/domain/meterEditorAdditions';
import type { AppDataStore, MeasurementAssignment } from '../src/types';

test('arbitrary capability values round-trip without flattening typed historical evidence', () => {
  const original = { labels: ['power', 'voltage'], ratio: 1.5, bidirectional: true, metadata: { unit: 'kW', ranges: [1, 2] }, optional: null, note: 'text' };
  assert.deepEqual(capabilitiesFromDrafts(capabilityDrafts(original)), original);
  const rows = capabilityDrafts(original);
  rows.find((row) => row.key === 'ratio')!.value = '2';
  assert.deepEqual(capabilitiesFromDrafts(rows), { ...original, ratio: 2 });
  assert.deepEqual(capabilitiesFromDrafts([{ id: 'one', key: ' __proto__ ', format: 'JSON', value: '{"safe":true}' }]), JSON.parse('{"__proto__":{"safe":true}}'));
});

test('capability key collision, blank key and invalid JSON fail without mutating original values', () => {
  const original = { ratio: 2, units: 'kW' };
  for (const mutation of ['duplicate', 'blank', 'json']) {
    const rows = capabilityDrafts(original);
    if (mutation === 'duplicate') rows[1]!.key = ' ratio ';
    if (mutation === 'blank') rows[0]!.key = ' ';
    if (mutation === 'json') rows[0]!.value = '{';
    assert.throws(() => capabilitiesFromDrafts(rows));
    assert.deepEqual(original, { ratio: 2, units: 'kW' });
  }
});

function fixture() {
  const timestamp = '2026-09-05T00:00:00.000Z';
  const store = {
    installations: [{ id: 'installation', site_name: 'Example Site', site_code: 'ES', status: 'Draft' }],
    zones: [{ id: 'zone', audit_id: 'installation', zone_name: 'Plant', zone_code: 'PLANT' }],
    electricalAssets: [], siteAssets: [], meterDevices: [],
  } as unknown as AppDataStore;
  const asset = stagedMeterSiteAsset({ id: 'new', installationId: 'installation', zoneId: 'zone', boardId: 'board', name: '', typeCode: 'OTHER', customType: 'New pump', timestamp });
  const assignment = { id: 'mapping', target: { kind: 'SITE_ASSET', siteAssetId: asset.id } } as MeasurementAssignment;
  return { store, asset, assignment };
}

test('only referenced quick assets persist, with exact zone/source and generated IDs', () => {
  const { store, asset, assignment } = fixture();
  assert.equal(asset.asset_name, 'New pump');
  insertStagedMeterSiteAssets(store, store.installations[0]!, 'board', [], [asset]);
  assert.equal(store.siteAssets.length, 0);
  insertStagedMeterSiteAssets(store, store.installations[0]!, 'board', [assignment], [asset]);
  assert.equal(store.siteAssets.length, 1);
  assert.equal(store.siteAssets[0]!.zone_id, 'zone');
  assert.deepEqual(store.siteAssets[0]!.electrical_source, { kind: 'BOARD', boardId: 'board' });
  assert.match(store.siteAssets[0]!.display_code!, /^ES-PLANT-/);
  assert.equal(asset.display_code, undefined, 'the editor draft is never mutated during save');
});

test('stale zone, cross-installation/source, and ID collision prevent staged insertion', () => {
  for (const mutation of ['zone', 'installation', 'source', 'duplicate']) {
    const { store, asset, assignment } = fixture();
    if (mutation === 'zone') asset.zone_id = 'gone';
    if (mutation === 'installation') asset.audit_id = 'other';
    if (mutation === 'source') asset.electrical_source = { kind: 'BOARD', boardId: 'another' };
    if (mutation === 'duplicate') store.siteAssets.push(structuredClone(asset));
    const before = JSON.stringify(store);
    assert.throws(() => insertStagedMeterSiteAssets(store, store.installations[0]!, 'board', [assignment], [asset]));
    assert.equal(JSON.stringify(store), before);
  }
});
