import type { ElectricalAsset, GridSupply } from '../types';

/** Electricity NMI belongs to a GridSupply. Board NMI is a read-only legacy
 * fallback so installed clients can still round-trip historical records. */
export function canonicalNmiForBoard(
  board: ElectricalAsset,
  gridSupplies: GridSupply[],
): string {
  const source = board.electrical_source;
  const sourceGrid = source?.kind === 'GRID'
    ? gridSupplies.find((grid) => grid.id === source.gridSupplyId)
    : undefined;
  return sourceGrid?.nmi?.trim()
    || gridSupplies.find((grid) => grid.isDefault)?.nmi?.trim()
    || board.site_nmi?.trim()
    || '';
}
