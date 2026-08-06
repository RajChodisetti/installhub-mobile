import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeStore } from '../src/data/seed';
import type { AppDataStore, SiteAssetEditorDraftRecord } from '../src/types';

test('encrypted store restart normalization retains a protected site-asset editor draft', () => {
  const draft: SiteAssetEditorDraftRecord = {
    scope: 'asset:asset-1',
    userId: 'user-1',
    installationId: 'installation-1',
    assetId: 'asset-1',
    baseTreeRevision: 7,
    baseAssetUpdatedAt: '2026-08-02T00:00:00.000Z',
    createdAt: '2026-08-02T01:00:00.000Z',
    updatedAt: '2026-08-02T01:05:00.000Z',
    expiresAt: '2026-08-09T01:05:00.000Z',
    payload: {
      version: 1,
      assetName: 'Pack 10 draft',
      typeCode: 'HVAC',
      customTypeName: '',
      displayCode: 'SITE-HVAC-010',
      customCode: false,
      locationDescription: 'Showroom',
      locationPhoto: 'file:///showroom.jpg',
      extraPhotos: ['file:///nameplate.jpg', 'file:///context.jpg'],
      sourceKey: 'BOARD:db-1',
      sourceBoardSearch: 'DB 1',
      meteringKind: 'METERED',
      selectedMeterId: 'meter-1',
      selectedChannelIds: ['meter-1:4'],
      phaseMode: 'SINGLE_PHASE',
      direction: 'CONSUMPTION',
      meterSearch: 'A6M',
      comments: 'Return after commissioning',
      deviceDetour: { beforeMeterIds: ['meter-old'], startReturnToken: 2 },
    },
    checksum: 'integrity-checked-by-draft-service',
  };
  const persisted = {
    user: { id: 'user-1', email: 'field@example.test', full_name: 'Field User', role: 'admin' },
    siteAssetEditorDrafts: [draft],
  } satisfies Partial<AppDataStore>;

  const firstLoad = normalizeStore(JSON.parse(JSON.stringify(persisted)) as Partial<AppDataStore>);
  assert.deepEqual(firstLoad.siteAssetEditorDrafts, [draft]);

  const restarted = normalizeStore(
    JSON.parse(JSON.stringify(firstLoad)) as Partial<AppDataStore>,
  );
  assert.deepEqual(restarted.siteAssetEditorDrafts, [draft]);
  assert.deepEqual(restarted.siteAssetEditorDrafts?.[0]?.payload.deviceDetour, {
    beforeMeterIds: ['meter-old'], startReturnToken: 2,
  });
  assert.equal(
    restarted.siteAssetEditorDrafts?.[0]?.payload.locationPhoto,
    'file:///showroom.jpg',
  );
  assert.deepEqual(restarted.siteAssetEditorDrafts?.[0]?.payload.extraPhotos, [
    'file:///nameplate.jpg',
    'file:///context.jpg',
  ]);
});
