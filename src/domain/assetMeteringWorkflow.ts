import type {
  MeasurementAssignment,
  MeterChannel,
  MeterDevice,
  MeteringState,
} from '../types';
import { assignmentApprovalSignature, type AssignmentTakeoverApprovals } from './meterAssignmentTakeover';

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

export type AssetMeteringChannelAvailability =
  | 'AVAILABLE'
  | 'CURRENT'
  | 'TBC_ASSIGNMENT'
  | 'TAKEOVER_REQUIRED'
  | 'TAKEOVER_APPROVED'
  | 'PROTECTED_ASSIGNMENT'
  | 'NOT_ASSET_CHANNEL'
  | 'CAPABILITY_REQUIRED'
  | 'INVALID_TOPOLOGY';

export interface AssetMeteringChannelChoice {
  channel: MeterChannel;
  availability: AssetMeteringChannelAvailability;
  ownAssignments: MeasurementAssignment[];
  conflictingAssignments: MeasurementAssignment[];
  selectable: boolean;
}

export interface AssetMeteringDeviceChoice {
  meter: MeterDevice;
  channels: AssetMeteringChannelChoice[];
  topologyIssue?: string;
  availableCount: number;
  currentCount: number;
  tbcCount: number;
  directlySelectableCount: number;
  occupiedCount: number;
  takeoverCount: number;
  /** A device remains offerable when it has a free/current channel or a
   * site-asset attachment that the deliberate takeover flow can approve. */
  selectable: boolean;
}

export function requiredAssetMeteringChannelCount(
  phaseMode: MeasurementAssignment['phaseMode'],
): number | null {
  if (phaseMode === 'SINGLE_PHASE') return 1;
  if (phaseMode === 'THREE_PHASE') return 3;
  return null;
}

export function assetMeteringChannelGroupComplete(
  phaseMode: MeasurementAssignment['phaseMode'],
  channelIds: string[],
): boolean {
  const count = new Set(channelIds).size;
  const required = requiredAssetMeteringChannelCount(phaseMode);
  return required === null ? count > 0 : count === required;
}

export function assetMeteringSelectionAfterToggle(input: {
  phaseMode: MeasurementAssignment['phaseMode'];
  selectedChannelIds: string[];
  channelId: string;
}): string[] {
  const selected = [...new Set(input.selectedChannelIds)];
  if (selected.includes(input.channelId)) {
    return selected.filter((channelId) => channelId !== input.channelId);
  }
  const required = requiredAssetMeteringChannelCount(input.phaseMode);
  if (required === 1) return [input.channelId];
  if (required !== null && selected.length >= required) return selected;
  return [...selected, input.channelId];
}

function fixedModelChannelCount(meter: MeterDevice): number | undefined {
  if (meter.deviceFamily !== 'WATTWATCHERS') return undefined;
  if (meter.deviceModel === 'A3RM') return 3;
  if (meter.deviceModel === 'A6M') return 6;
  return undefined;
}

function channelIdentity(channel: MeterChannel): string {
  return typeof channel.id === 'string' ? channel.id : '';
}

function structurallyValidChannelIds(
  meter: MeterDevice,
  duplicateDeviceChannelIds: ReadonlySet<string>,
): { validIds: Set<string>; topologyIssue?: string } {
  const expected = fixedModelChannelCount(meter);
  const isCustom = meter.deviceFamily === 'OTHER' && meter.deviceModel === 'OTHER';
  if (expected === undefined && !isCustom) {
    return {
      validIds: new Set(),
      topologyIssue: 'The device family and model do not describe a supported meter topology.',
    };
  }
  if (!meter.channels.length) {
    return {
      validIds: new Set(),
      topologyIssue: expected
        ? `${meter.deviceModel} must contain channels 1–${expected}.`
        : 'This custom meter has no captured channels or capabilities.',
    };
  }

  const ids = new Set<string>();
  const ordinals = new Set<number>();
  let malformed = false;
  for (const channel of meter.channels) {
    const channelId = channelIdentity(channel);
    if (!channelId.trim() || ids.has(channelId) || duplicateDeviceChannelIds.has(channelId)
      || !Number.isSafeInteger(channel.ordinal) || channel.ordinal < 1 || ordinals.has(channel.ordinal)) {
      malformed = true;
    }
    ids.add(channelId);
    ordinals.add(channel.ordinal);
  }
  if (expected !== undefined) {
    malformed ||= meter.channels.length !== expected
      || Array.from({ length: expected }, (_, index) => index + 1)
        .some((ordinal) => !ordinals.has(ordinal));
  }
  if (malformed) {
    return {
      validIds: new Set(),
      topologyIssue: expected
        ? `${meter.deviceModel} requires unique channel IDs and exact ordinals 1–${expected}.`
        : 'Custom meter channels require unique IDs and positive, unique ordinals.',
    };
  }
  return { validIds: ids };
}

function hasConfiguredChannelCapabilities(channel: MeterChannel): boolean {
  const capabilities = Object.entries(channel.capabilities ?? {});
  return capabilities.length > 0 && capabilities.every(([key, value]) => (
    key.trim().length > 0
    && value !== null
    && value !== undefined
    && (typeof value !== 'string' || value.trim().length > 0)
  ));
}

/**
 * Derive the asset meter/device/channel choices exclusively from canonical
 * meterDevices and measurementAssignments. Fixed Wattwatchers models must
 * have their exact topology; custom meters use only their explicitly captured
 * channel capabilities. Occupancy is scoped by meter + channel so an invalid
 * cross-device ID collision cannot hide or steal another device's channel.
 */
export function assetMeteringDeviceChoices(input: {
  meters: MeterDevice[];
  assignments: MeasurementAssignment[];
  supplyingBoardId?: string;
  assetId?: string;
  takeoverApprovals?: AssignmentTakeoverApprovals;
}): AssetMeteringDeviceChoice[] {
  if (!input.supplyingBoardId) return [];
  const channelOwners = new Map<string, Set<string>>();
  for (const meter of input.meters) {
    for (const channel of meter.channels) {
      const channelId = channelIdentity(channel);
      const owners = channelOwners.get(channelId) ?? new Set<string>();
      owners.add(meter.id);
      channelOwners.set(channelId, owners);
    }
  }
  const duplicateDeviceChannelIds = new Set(
    [...channelOwners].filter(([, owners]) => owners.size > 1).map(([channelId]) => channelId),
  );

  return input.meters
    .filter((meter) => (
      meter.installedOnBoardId === input.supplyingBoardId
      && (meter.lifecycleState ?? 'ACTIVE') === 'ACTIVE'
    ))
    .map((meter): AssetMeteringDeviceChoice => {
      const { validIds, topologyIssue } = structurallyValidChannelIds(
        meter,
        duplicateDeviceChannelIds,
      );
      const channels = [...meter.channels]
        .sort((left, right) => left.ordinal - right.ordinal
          || channelIdentity(left).localeCompare(channelIdentity(right)))
        .map((channel): AssetMeteringChannelChoice => {
          const channelId = channelIdentity(channel);
          const ownAssignments = input.assignments.filter((assignment) =>
            assignment.meterId === meter.id
            && assignment.channelIds.includes(channelId)
            && assignment.target.kind === 'SITE_ASSET'
            && assignment.target.siteAssetId === input.assetId);
          const conflictingAssignments = input.assignments.filter((assignment) =>
            assignment.meterId === meter.id
            && assignment.channelIds.includes(channelId)
            && !ownAssignments.some((owned) => owned.id === assignment.id));
          const topologyValid = validIds.has(channelId);
          const customCapabilityMissing = meter.deviceModel === 'OTHER'
            && !hasConfiguredChannelCapabilities(channel);
          const protectedAssignment = conflictingAssignments.some((assignment) =>
            assignment.target.kind === 'BOARD' || assignment.target.kind === 'GRID_BOUNDARY');
          const siteAssetConflicts = conflictingAssignments.filter((assignment) =>
            assignment.target.kind === 'SITE_ASSET');
          const takeoverApproved = siteAssetConflicts.length > 0
            && siteAssetConflicts.every((assignment) =>
              input.takeoverApprovals?.[assignment.id] === assignmentApprovalSignature(assignment));
          let availability: AssetMeteringChannelAvailability;
          if (!topologyValid) availability = 'INVALID_TOPOLOGY';
          else if (protectedAssignment) availability = 'PROTECTED_ASSIGNMENT';
          else if (channel.purpose !== 'SUB_CIRCUIT') availability = 'NOT_ASSET_CHANNEL';
          else if (customCapabilityMissing) availability = 'CAPABILITY_REQUIRED';
          else if (siteAssetConflicts.length && !takeoverApproved) availability = 'TAKEOVER_REQUIRED';
          else if (siteAssetConflicts.length) availability = 'TAKEOVER_APPROVED';
          else if (conflictingAssignments.some((assignment) => assignment.target.kind === 'TBC')) {
            availability = 'TBC_ASSIGNMENT';
          } else if (ownAssignments.length) availability = 'CURRENT';
          else availability = 'AVAILABLE';
          return {
            channel,
            availability,
            ownAssignments,
            conflictingAssignments,
            selectable: ['AVAILABLE', 'CURRENT', 'TBC_ASSIGNMENT', 'TAKEOVER_APPROVED']
              .includes(availability),
          };
        });
      const availableCount = channels.filter((choice) => choice.availability === 'AVAILABLE').length;
      const currentCount = channels.filter((choice) => choice.ownAssignments.length > 0).length;
      const tbcCount = channels.filter((choice) => choice.availability === 'TBC_ASSIGNMENT').length;
      const directlySelectableCount = channels.filter((choice) => choice.selectable).length;
      const occupiedCount = channels.filter((choice) => choice.conflictingAssignments.some(
        (assignment) => assignment.target.kind !== 'TBC',
      )).length;
      const takeoverCount = channels.filter((choice) =>
        choice.availability === 'TAKEOVER_REQUIRED' || choice.availability === 'TAKEOVER_APPROVED').length;
      return {
        meter,
        channels,
        topologyIssue,
        availableCount,
        currentCount,
        tbcCount,
        directlySelectableCount,
        occupiedCount,
        takeoverCount,
        selectable: channels.some((choice) => choice.selectable
          || choice.availability === 'TAKEOVER_REQUIRED'),
      };
    });
}

export function assetMeteringChannelDescription(
  meter: MeterDevice,
  channel: MeterChannel,
): string {
  const capturedLoad = channel.loadTypeCode === 'OTHER'
    ? channel.customLoadTypeName?.trim()
    : channel.loadTypeCode?.replaceAll('_', ' ');
  const sensor = channel.sensorRating?.trim()
    ? `${meter.deviceModel === 'A3RM' ? 'Rogowski' : meter.deviceModel === 'A6M' ? 'CT' : 'Sensor'} ${channel.sensorRating.trim()}`
    : '';
  const capabilities = meter.deviceModel === 'OTHER'
    ? Object.entries(channel.capabilities ?? {}).slice(0, 3)
      .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' · ')
    : '';
  return [channel.description?.trim(), capturedLoad, sensor, capabilities]
    .filter(Boolean)
    .join(' · ') || channel.purpose.replaceAll('_', ' ').toLocaleLowerCase('en-AU');
}

/** Drop recovered or concurrently stale channel IDs unless the exact existing
 * historical mapping is intentionally being retained read-only. */
export function compatibleAssetMeteringChannelIds(input: {
  selectedChannelIds: string[];
  deviceChoice?: AssetMeteringDeviceChoice;
  preserveHistorical?: boolean;
}): string[] {
  if (input.preserveHistorical) return [...input.selectedChannelIds];
  if (!input.deviceChoice) return [];
  const selectable = new Set(
    input.deviceChoice.channels
      .filter((choice) => choice.selectable)
      .map((choice) => choice.channel.id),
  );
  return [...new Set(input.selectedChannelIds)].filter((channelId) => selectable.has(channelId));
}

/** An exact saved mapping is history, not a draft to normalize. Keep it
 * read-only when its device or any saved channel is no longer eligible, even
 * if another channel leaves the same device generally selectable. */
export function historicalAssetMeteringSelectionIsReadOnly(input: {
  selectionUnchanged: boolean;
  selectedChannelIds: string[];
  deviceChoice?: AssetMeteringDeviceChoice;
}): boolean {
  if (!input.selectionUnchanged) return false;
  if (!input.deviceChoice) return true;
  const selectable = new Set(input.deviceChoice.channels
    .filter((choice) => choice.selectable)
    .map((choice) => choice.channel.id));
  return input.selectedChannelIds.some((channelId) => !selectable.has(channelId));
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
