import type {
  ElectricalAsset, ElectricalSource, GridSupply, MeasurementAssignment,
  MeasurementDirection, MeterDevice,
} from '../types';
import { assignmentApprovalSignature } from './meterAssignmentTakeover';

export type SiteAssetMeteringDraft = (
  | { kind: 'METERED'; meterId: string; channelIds: string[];
      phaseMode: MeasurementAssignment['phaseMode']; direction: MeasurementDirection;
      takeoverApprovals?: Record<string, string>;
      preserveMapping?: { assignment: MeasurementAssignment; source: ElectricalSource; normalizedSource?: ElectricalSource } }
  | { kind: 'UNMETERED' }
  | { kind: 'TBC' }
) & { baselineAssignments?: MeasurementAssignment[] };

export function assertSiteAssetMappingBaseline(
  assetId: string, current: MeasurementAssignment[], baseline: MeasurementAssignment[],
): void {
  const signature = (items: MeasurementAssignment[]) => JSON.stringify([...items]
    .sort((left, right) => left.id.localeCompare(right.id)).map(assignmentApprovalSignature));
  const owned = current.filter((assignment) => assignment.target.kind === 'SITE_ASSET' && assignment.target.siteAssetId === assetId);
  if (baseline.some((assignment) => assignment.target.kind !== 'SITE_ASSET' || assignment.target.siteAssetId !== assetId)
    || signature(owned) !== signature(baseline)) {
    throw new Error('This asset’s measurement changed while the editor was open. Reopen it and review the current mapping before saving.');
  }
}

/** Missing selections remain an explicit unresolved relationship, as on web. */
export function electricalSourceFromSelection(
  key: string, boards: ElectricalAsset[], grids: GridSupply[],
): ElectricalSource {
  if (key.startsWith('BOARD:') && boards.some((board) => board.id === key.slice(6))) {
    return { kind: 'BOARD', boardId: key.slice(6) };
  }
  if (key.startsWith('GRID:') && grids.some((grid) => grid.id === key.slice(5))) {
    return { kind: 'GRID', gridSupplyId: key.slice(5) };
  }
  return { kind: 'TBC' };
}

/** Keep optional partial capture savable, without creating a false confirmed
 * channel connection or taking a channel from another exact assignment. */
export function siteAssetMeteringForSave(input: {
  kind: SiteAssetMeteringDraft['kind']; source: ElectricalSource;
  selectedMeter?: MeterDevice; selectedMeterId?: string; eligibleMeterIds: string[]; channelIds: string[];
  phaseMode: MeasurementAssignment['phaseMode']; direction: MeasurementDirection | '';
  assignments: MeasurementAssignment[]; previousAssignmentId?: string;
  previousAssignment?: MeasurementAssignment; previousSource?: ElectricalSource;
  draftSource?: ElectricalSource;
  takeoverApprovals?: Record<string, string>;
}): SiteAssetMeteringDraft {
  if (input.kind !== 'METERED') return { kind: input.kind };
  const previous = input.previousAssignment;
  if (previous && input.previousSource
    && !input.eligibleMeterIds.includes(previous.meterId)
    && (input.selectedMeterId ?? input.selectedMeter?.id ?? previous.meterId) === previous.meterId
    && JSON.stringify(input.previousSource) === JSON.stringify(input.draftSource ?? input.source)
    && JSON.stringify(previous.channelIds) === JSON.stringify(input.channelIds)
    && previous.phaseMode === input.phaseMode && previous.direction === input.direction) {
    return { kind: 'METERED', meterId: previous.meterId, channelIds: [...previous.channelIds],
      phaseMode: previous.phaseMode, direction: previous.direction,
      preserveMapping: { assignment: structuredClone(previous), source: structuredClone(input.previousSource),
        ...(JSON.stringify(input.previousSource) !== JSON.stringify(input.source) ? { normalizedSource: structuredClone(input.source) } : {}) } };
  }
  const ids = [...new Set(input.channelIds)];
  const count = input.phaseMode === 'SINGLE_PHASE' ? 1 : input.phaseMode === 'THREE_PHASE' ? 3 : ids.length;
  const conflicts = input.assignments.filter((assignment) =>
    assignment.id !== input.previousAssignmentId && assignment.target.kind !== 'TBC'
    && assignment.channelIds.some((id) => ids.includes(id)));
  const conflict = conflicts.some((assignment) => assignment.target.kind !== 'SITE_ASSET'
    || input.takeoverApprovals?.[assignment.id] !== assignmentApprovalSignature(assignment));
  if (input.source.kind !== 'BOARD' || !input.selectedMeter
    || !input.eligibleMeterIds.includes(input.selectedMeter.id)
    || !ids.length || ids.length !== count || ids.length !== input.channelIds.length
    || !ids.every((id) => input.selectedMeter!.channels.find((channel) => channel.id === id)?.purpose === 'SUB_CIRCUIT')
    || conflict) return { kind: 'TBC' };
  return { kind: 'METERED', meterId: input.selectedMeter.id, channelIds: ids,
    phaseMode: input.phaseMode, direction: input.direction || 'CONSUMPTION',
    ...(conflicts.length ? { takeoverApprovals: Object.fromEntries(conflicts.map((assignment) => [assignment.id, input.takeoverApprovals![assignment.id]!])) } : {}) };
}
