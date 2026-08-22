import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalNmiForBoard } from '../src/domain/gridSupplyContext';
import type { ElectricalAsset, GridSupply } from '../src/types';

const timestamp = '2026-08-22T00:00:00.000Z';
const board: ElectricalAsset = {
  id: 'board-1',
  audit_id: 'installation-1',
  zone_id: 'zone-1',
  asset_name: 'Main board',
  display_code: 'SITE-MSB-01',
  asset_type: 'MSB',
  electrical_source: { kind: 'GRID', gridSupplyId: 'grid-source' },
  site_nmi: 'LEGACY-BOARD-NMI',
  meter_present: false,
  meters: [],
  created_at: timestamp,
  updated_at: timestamp,
};
const grids: GridSupply[] = [
  {
    id: 'grid-default', installationId: 'installation-1', name: 'Default',
    nmi: 'DEFAULT-NMI', isDefault: true,
  },
  {
    id: 'grid-source', installationId: 'installation-1', name: 'Source',
    nmi: 'SOURCE-NMI', isDefault: false,
  },
];

test('grid-supply NMI takes authority over the legacy board field', () => {
  assert.equal(canonicalNmiForBoard(board, grids), 'SOURCE-NMI');
  assert.equal(
    canonicalNmiForBoard({
      ...board,
      electrical_source: { kind: 'TBC' },
    }, grids),
    'DEFAULT-NMI',
  );
});

test('legacy board NMI remains a read-only compatibility fallback', () => {
  assert.equal(canonicalNmiForBoard(board, []), 'LEGACY-BOARD-NMI');
});
