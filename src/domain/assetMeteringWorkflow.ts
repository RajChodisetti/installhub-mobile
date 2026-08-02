import type {
  MeasurementAssignment,
  MeterDevice,
  MeteringState,
} from '../types';

export type DeviceDetourOutcome = 'SUCCESS' | 'CANCELLED' | 'FAILED';

/**
 * A commissioning detour may update only the device selection. The caller's
 * draft object is returned by identity so all partially entered asset fields
 * survive success, cancellation, and failure.
 */
export function resolveDeviceCommissioningDetour<TDraft>(input: {
  draft: TDraft;
  beforeMeterIds: Iterable<string>;
  eligibleAfterMeterIds: Iterable<string>;
  outcome: DeviceDetourOutcome;
}): { draft: TDraft; newMeterId?: string } {
  if (input.outcome !== 'SUCCESS') return { draft: input.draft };
  const before = new Set(input.beforeMeterIds);
  const added = [...new Set(input.eligibleAfterMeterIds)].filter((id) => !before.has(id));
  return added.length === 1
    ? { draft: input.draft, newMeterId: added[0] }
    : { draft: input.draft };
}

export interface MeteringRemovalPreview {
  assignmentIds: string[];
  channelLabels: string[];
}

export function meteringRemovalPreview(
  state: MeteringState | undefined,
  assignments: MeasurementAssignment[],
  meters: MeterDevice[],
): MeteringRemovalPreview {
  if (state?.kind !== 'METERED') return { assignmentIds: [], channelLabels: [] };
  const ids = new Set(state.measurementAssignmentIds);
  const selected = assignments.filter((assignment) => ids.has(assignment.id));
  const channelLabels = selected.flatMap((assignment) => {
    const meter = meters.find((item) => item.id === assignment.meterId);
    return assignment.channelIds.map((channelId) => {
      const channel = meter?.channels.find((item) => item.id === channelId);
      return `${meter?.displayName.value ?? assignment.meterId} · Ch ${channel?.ordinal ?? channelId}`;
    });
  });
  return {
    assignmentIds: selected.map((assignment) => assignment.id).sort(),
    channelLabels: channelLabels.sort(),
  };
}
