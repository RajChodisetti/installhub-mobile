import type { ElectricalAsset, GridSupply } from '../types';

/** Portal keeps one deterministic default when a default is cleared/deleted. */
export function ensureGridSupplyDefault(supplies: GridSupply[]): void {
  const ordered = [...supplies].sort((left, right) => left.id.localeCompare(right.id));
  const selected = ordered.find((supply) => supply.isDefault) ?? ordered[0];
  for (const supply of supplies) supply.isDefault = supply.id === selected?.id;
}

export function gridSupplyNameForWrite(name: string): string {
  return name.trim() || 'Incoming grid connection';
}

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
