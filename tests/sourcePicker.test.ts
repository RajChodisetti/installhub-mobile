import assert from 'node:assert/strict';
import test from 'node:test';
import {
  boundedPickerResults,
  pagedPickerResults,
  searchSourceBoards,
  sourceKeyAfterKindSelection,
} from '../src/domain/sourcePicker';
import type { ElectricalAsset, Zone } from '../src/types';

const zone: Zone = {
  id: 'zone', audit_id: 'installation', zone_name: 'Warehouse', zone_description: '',
  photos: [], created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
};

function board(index: number): ElectricalAsset {
  return {
    id: `board-${index}`, audit_id: 'installation', zone_id: 'zone',
    asset_name: `Lighting board ${index}`, display_code: `LX-${index}`,
    asset_type: 'LX-DB', type_code: 'LX_DB',
    electrical_source: { kind: 'TBC' }, electrical_parent_id: null,
    electrical_parent_tbc: true, location_description: '', phase: '', amperage_rating: '',
    site_nmi: '', photo: '', extra_photos: [], meter_present: false, meters: [],
    sub_circuits_description: '', comments: '', created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

test('changing to a concrete source kind never silently chooses its first record', () => {
  assert.equal(sourceKeyAfterKindSelection('BOARD'), 'BOARD:');
  assert.equal(sourceKeyAfterKindSelection('GRID'), 'GRID:');
  assert.equal(sourceKeyAfterKindSelection('TBC'), 'TBC');
});

test('source board search includes code, name, type, and zone and stays bounded', () => {
  const boards = Array.from({ length: 140 }, (_, index) => board(index + 1));
  const bounded = searchSourceBoards(boards, [zone], '', 100);
  assert.equal(bounded.total, 140);
  assert.equal(bounded.visible.length, 100);
  assert.equal(searchSourceBoards(boards, [zone], 'warehouse').total, 140);
  assert.equal(searchSourceBoards(boards, [zone], 'lx-139').visible[0]?.id, 'board-139');
  assert.equal(searchSourceBoards(boards, [zone], 'lx-db').total, 140);
  const pinned = searchSourceBoards(boards, [zone], '', 100, 'board-140');
  assert.equal(pinned.visible.length, 100);
  assert.equal(pinned.visible[0]?.id, 'board-140');
  assert.equal(pinned.selectedPinned, true);
  const pinnedOutsideQuery = searchSourceBoards(boards, [zone], 'lx-2', 100, 'board-140');
  assert.equal(pinnedOutsideQuery.visible[0]?.id, 'board-140');
  assert.equal(pinnedOutsideQuery.selectedPinned, true);
});

test('generic assignment-target results cap a 5k match set and preserve its selected row', () => {
  const matches = Array.from({ length: 5000 }, (_, index) => ({ key: `asset-${index}` }));
  const result = boundedPickerResults(matches, 100, (item) => item.key === 'asset-4999');
  assert.equal(result.total, 5000);
  assert.equal(result.visible.length, 100);
  assert.equal(result.visible[0]?.key, 'asset-4999');
  assert.equal(result.selectedPinned, true);
});

test('zone inventory paging keeps every 5.5k page mounted at a fixed 100-row maximum', () => {
  const matches = Array.from({ length: 5500 }, (_, index) => ({ key: `asset-${index + 1}` }));
  for (let requestedPage = 0; requestedPage < 55; requestedPage += 1) {
    const result = pagedPickerResults(matches, requestedPage, 100);
    assert.equal(result.page, requestedPage);
    assert.equal(result.visible.length, 100);
    assert.equal(result.start, requestedPage * 100 + 1);
    assert.equal(result.end, (requestedPage + 1) * 100);
  }

  const finalPage = pagedPickerResults(matches, 54, 100);
  assert.equal(finalPage.visible[0]?.key, 'asset-5401');
  assert.equal(finalPage.visible.at(-1)?.key, 'asset-5500');
  assert.equal(finalPage.hasNext, false);
  assert.equal(finalPage.hasPrevious, true);

  const clampedAfterDeletion = pagedPickerResults(matches.slice(0, 120), 54, 100);
  assert.equal(clampedAfterDeletion.page, 1);
  assert.equal(clampedAfterDeletion.visible.length, 20);
  assert.equal(clampedAfterDeletion.start, 101);
  assert.equal(clampedAfterDeletion.end, 120);
});

test('WW board search caps the accepted 500-board floor', () => {
  const boards = Array.from({ length: 500 }, (_, index) => board(index + 1));
  const result = searchSourceBoards(boards, [zone], '', 100, 'board-500');
  assert.equal(result.total, 500);
  assert.equal(result.visible.length, 100);
  assert.equal(result.visible[0]?.id, 'board-500');
});
