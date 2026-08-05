import type {
  BoardTypeCode,
  ElectricalAsset,
  ElectricalSource,
  GridSupply,
  Zone,
} from '../types';
import { boardTypeFromCode } from './installationV2';

export const SOURCE_BOARD_RESULT_LIMIT = 100;

export type ElectricalSourceKindChoice = 'GRID' | 'BOARD' | 'TBC';

export interface QuickSwitchboardDetails {
  name: string;
  typeCode: BoardTypeCode;
  customTypeName?: string;
}

/** Resolve the source inherited by a board inserted into an asset's supply
 * path. Prefer the current concrete selection, then the persisted source, then
 * the installation's default incoming grid. */
export function inheritedSourceForQuickSwitchboard(
  sourceKey: string,
  persistedSource: ElectricalSource,
  grids: GridSupply[],
): ElectricalSource {
  if (sourceKey.startsWith('BOARD:') && sourceKey.slice(6)) {
    return { kind: 'BOARD', boardId: sourceKey.slice(6) };
  }
  if (sourceKey.startsWith('GRID:') && sourceKey.slice(5)) {
    return { kind: 'GRID', gridSupplyId: sourceKey.slice(5) };
  }
  if (persistedSource.kind !== 'TBC') return persistedSource;
  const grid = grids.find((candidate) => candidate.isDefault) ?? grids[0];
  return grid ? { kind: 'GRID', gridSupplyId: grid.id } : { kind: 'TBC' };
}

export function quickSwitchboardCreateValues({
  installationId,
  zoneId,
  inheritedSource,
  details,
}: {
  installationId: string;
  zoneId: string;
  inheritedSource: ElectricalSource;
  details: QuickSwitchboardDetails;
}) {
  return {
    audit_id: installationId,
    zone_id: zoneId,
    asset_name: details.name.trim(),
    display_code: '',
    asset_type: boardTypeFromCode(details.typeCode),
    type_code: details.typeCode,
    custom_type_name: details.typeCode === 'OTHER'
      ? details.customTypeName?.trim()
      : undefined,
    electrical_source: inheritedSource,
    electrical_parent_id: inheritedSource.kind === 'BOARD' ? inheritedSource.boardId : null,
    electrical_parent_tbc: inheritedSource.kind === 'TBC',
  };
}

export function boundedPickerResults<T>(
  matches: T[],
  limit: number,
  selected: (item: T) => boolean = () => false,
): { total: number; visible: T[]; selectedPinned: boolean } {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Picker result limit must be positive.');
  let visible = matches.slice(0, limit);
  const selectedItem = matches.find(selected);
  const selectedPinned = Boolean(selectedItem && !visible.some(selected));
  if (selectedItem && selectedPinned) visible = [selectedItem, ...visible].slice(0, limit);
  return { total: matches.length, visible, selectedPinned };
}

export function pagedPickerResults<T>(
  matches: T[],
  requestedPage: number,
  pageSize: number,
): {
  total: number;
  visible: T[];
  page: number;
  totalPages: number;
  start: number;
  end: number;
  hasPrevious: boolean;
  hasNext: boolean;
} {
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 0) {
    throw new Error('Picker page must be a non-negative integer.');
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new Error('Picker page size must be positive.');
  }

  const total = matches.length;
  const totalPages = Math.ceil(total / pageSize);
  const page = totalPages === 0 ? 0 : Math.min(requestedPage, totalPages - 1);
  const offset = page * pageSize;
  const visible = matches.slice(offset, offset + pageSize);

  return {
    total,
    visible,
    page,
    totalPages,
    start: visible.length === 0 ? 0 : offset + 1,
    end: offset + visible.length,
    hasPrevious: page > 0,
    hasNext: page + 1 < totalPages,
  };
}

/**
 * Changing source kind deliberately clears the concrete selection. This keeps
 * a high-cardinality picker from silently accepting the first board or grid.
 */
export function sourceKeyAfterKindSelection(
  kind: ElectricalSourceKindChoice,
): string {
  if (kind === 'TBC') return 'TBC';
  return `${kind}:`;
}

export function searchSourceBoards(
  boards: ElectricalAsset[],
  zones: Zone[],
  query: string,
  limit = SOURCE_BOARD_RESULT_LIMIT,
  selectedBoardId?: string,
): { total: number; visible: ElectricalAsset[]; selectedPinned: boolean } {
  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const needle = query.trim().toLocaleLowerCase();
  const matches = boards.filter((board) => !needle || [
    board.asset_name,
    board.asset_type,
    board.type_code,
    board.custom_type_name,
    zoneById.get(board.zone_id)?.zone_name,
  ].some((value) => value?.toLocaleLowerCase().includes(needle)));
  const result = boundedPickerResults(matches, limit, (board) => board.id === selectedBoardId);
  const selected = selectedBoardId ? boards.find((board) => board.id === selectedBoardId) : undefined;
  if (!selected || result.visible.some((board) => board.id === selected.id)) return result;
  return {
    ...result,
    visible: [selected, ...result.visible].slice(0, limit),
    selectedPinned: true,
  };
}

export function gridSourceOptions(grids: GridSupply[]): string[] {
  return grids.map((grid) => `GRID:${grid.id}`);
}
