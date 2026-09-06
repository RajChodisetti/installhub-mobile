import type { AllAssetMeteringRow } from './installationV2';
import type { ElectricalAsset, GridSupply, MeasurementAssignment, MeterDevice, ReadinessIssue, SiteAsset } from '../types';

export type MeteringCoverageFilter = 'ALL' | 'CONFIRMED_UNMETERED' | AllAssetMeteringRow['state'];

export function meteringCoverageMatches(row: AllAssetMeteringRow, filter: MeteringCoverageFilter): boolean {
  return filter === 'ALL' || (filter === 'CONFIRMED_UNMETERED'
    ? row.state === 'UNMETERED' || row.state === 'VIRTUAL'
    : row.state === filter);
}

export function meterRegistryMatches(meter: MeterDevice, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || [meter.id, meter.displayName.value, meter.serialNumber, meter.deviceNumber,
    meter.deviceFamily, meter.deviceModel, meter.customManufacturerName, meter.customModelName]
    .filter(Boolean).join(' ').toLocaleLowerCase().includes(needle);
}

export function meterRegistryIssues(meter: MeterDevice, assignments: MeasurementAssignment[], issues: ReadinessIssue[]): ReadinessIssue[] {
  const assignmentIds = new Set(assignments.filter((assignment) => assignment.meterId === meter.id).map((assignment) => assignment.id));
  const channelIds = new Set(meter.channels.map((channel) => channel.id));
  return issues.filter((issue) => (issue.entityType === 'meter' && issue.entityId === meter.id)
    || (issue.entityType === 'channel' && channelIds.has(issue.entityId))
    || (issue.entityType === 'measurement_assignment' && assignmentIds.has(issue.entityId)));
}

export type MeteringTargetDetail = {
  label: string;
  id?: string;
  destination?: { kind: 'BOARD'; id: string; zoneId: string } | { kind: 'SITE_ASSET'; id: string; zoneId: string } | { kind: 'GRID_BOUNDARY' };
};

/** Retain the exact recorded identity; missing targets must never link to a fallback record. */
export function meteringTargetDetail(target: MeasurementAssignment['target'], installationId: string, boards: ElectricalAsset[], assets: SiteAsset[], grids: GridSupply[]): MeteringTargetDetail {
  if (target.kind === 'BOARD') {
    const board = boards.find((item) => item.id === target.boardId && item.audit_id === installationId);
    return { id: target.boardId, label: board ? `${board.display_code} · ${board.asset_name}` : 'Missing electrical board',
      ...(board ? { destination: { kind: 'BOARD' as const, id: board.id, zoneId: board.zone_id } } : {}) };
  }
  if (target.kind === 'SITE_ASSET') {
    const asset = assets.find((item) => item.id === target.siteAssetId && item.audit_id === installationId);
    return { id: target.siteAssetId, label: asset ? `${asset.display_code} · ${asset.asset_name}` : 'Missing site asset',
      ...(asset ? { destination: { kind: 'SITE_ASSET' as const, id: asset.id, zoneId: asset.zone_id } } : {}) };
  }
  if (target.kind === 'GRID_BOUNDARY') {
    const grid = grids.find((item) => item.id === target.gridSupplyId && item.installationId === installationId);
    return { id: target.gridSupplyId, label: grid?.name || 'Missing grid supply',
      ...(grid ? { destination: { kind: 'GRID_BOUNDARY' as const } } : {}) };
  }
  return { label: 'Target TBC — blocks completion' };
}
