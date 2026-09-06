import type { AppDataStore, MeasurementAssignment } from '../types';

/** Consent is bound to the complete displayed assignment, not just its ID. */
export type AssignmentTakeoverApprovals = Record<string, string>;

export function assignmentApprovalSignature(assignment: MeasurementAssignment): string {
  return JSON.stringify({
    ...assignment,
    channelIds: [...assignment.channelIds].sort(),
  });
}

export function assertExactAssignmentApprovals(
  required: readonly MeasurementAssignment[],
  approvals?: AssignmentTakeoverApprovals,
): void {
  const requiredById = new Map(required.map((assignment) => [assignment.id, assignment]));
  const entries = Object.entries(approvals ?? {});
  if (requiredById.size !== required.length || required.some((assignment) => !assignment.id.trim())) {
    throw new Error('The current assignments have conflicting identities. Reconcile them before taking over channels.');
  }
  if (required.length && !entries.length) {
    throw new Error('Approve the exact current site-asset assignments before taking over their measurements.');
  }
  if (entries.length !== required.length || entries.some(([id, signature]) => {
    const assignment = requiredById.get(id);
    return !assignment || signature !== assignmentApprovalSignature(assignment);
  })) {
    throw new Error('The approved assignment takeover is stale. Review the current channel attachments and confirm again.');
  }
}

function copyAssignment(assignment: MeasurementAssignment): MeasurementAssignment {
  return { ...assignment, channelIds: [...assignment.channelIds], target: { ...assignment.target } };
}

/** Retain unclaimed channels as explicit TBC work, including their stable ID. */
export function releasedAssignmentRemainder(
  assignment: MeasurementAssignment,
  claimedChannelIds: ReadonlySet<string>,
): MeasurementAssignment | null {
  const channelIds = assignment.channelIds.filter((id) => !claimedChannelIds.has(id));
  if (!channelIds.length) return null;
  const phaseMode = (
    (assignment.phaseMode === 'SINGLE_PHASE' && channelIds.length === 1)
    || (assignment.phaseMode === 'THREE_PHASE' && channelIds.length === 3)
    || assignment.phaseMode === 'OTHER'
  )
    ? assignment.phaseMode
    : channelIds.length === 1
      ? 'SINGLE_PHASE'
      : channelIds.length === 3
        ? 'THREE_PHASE'
        : 'OTHER';
  return { ...assignment, channelIds, phaseMode, target: { kind: 'TBC' }, status: 'TBC' };
}

function assertAssetInInstallation(store: AppDataStore, assetId: string, installationId: string): void {
  const assets = store.siteAssets.filter((asset) => asset.id === assetId);
  if (assets.length !== 1 || assets[0]!.audit_id !== installationId) {
    throw new Error('The site asset attached to this measurement is unavailable in this installation. Reconcile the existing measurement first.');
  }
}

function assertAssignmentInInstallation(
  store: AppDataStore,
  assignment: MeasurementAssignment,
  installationId: string,
): void {
  const devices = store.meterDevices.filter((device) => device.id === assignment.meterId);
  if (assignment.installationId !== installationId || devices.length !== 1
    || devices[0]!.installationId !== installationId) {
    throw new Error('A conflicting measurement belongs to an unavailable device or another installation. Reconcile it before taking over channels.');
  }
}

/**
 * Return the whole-store remainder before incoming assignments are appended.
 * Only approved SITE_ASSET conflicts on other meters are released. The caller
 * validates incoming groups/source eligibility and commits the plan atomically.
 */
export function planMeterAssetTakeover(
  store: AppDataStore,
  meterId: string,
  incoming: readonly MeasurementAssignment[],
  approvals?: AssignmentTakeoverApprovals,
): MeasurementAssignment[] {
  const devices = store.meterDevices.filter((device) => device.id === meterId);
  if (devices.length !== 1) throw new Error('The metering device is unavailable.');
  const installationId = devices[0]!.installationId;
  if (incoming.some((assignment) => assignment.meterId !== meterId
    || assignment.installationId !== installationId)) {
    throw new Error('Incoming assignments must belong to the selected meter and installation.');
  }
  const desiredAssets = new Set(incoming.flatMap((assignment) =>
    assignment.target.kind === 'SITE_ASSET' ? [assignment.target.siteAssetId] : []));
  for (const assetId of desiredAssets) assertAssetInInstallation(store, assetId, installationId);
  const conflicts: MeasurementAssignment[] = [];
  for (const assignment of store.measurementAssignments) {
    if (assignment.meterId === meterId) {
      assertAssignmentInInstallation(store, assignment, installationId);
    } else if (assignment.target.kind === 'SITE_ASSET' && desiredAssets.has(assignment.target.siteAssetId)) {
      assertAssignmentInInstallation(store, assignment, installationId);
      conflicts.push(assignment);
    }
  }
  assertExactAssignmentApprovals(conflicts, approvals);
  const released = new Set(conflicts);
  return store.measurementAssignments.flatMap((assignment) => {
    if (assignment.meterId === meterId) return [];
    if (!released.has(assignment)) return [copyAssignment(assignment)];
    const remainder = releasedAssignmentRemainder(assignment, new Set());
    return remainder ? [remainder] : [];
  });
}

/**
 * Return the whole-store remainder before a site's new exact mapping is added.
 * Own mappings and TBC overlaps need no takeover consent; Board/Grid attachments
 * cannot be claimed here. Callers also mark displaced assets TBC in the commit.
 */
export function planSiteChannelTakeover(
  store: AppDataStore,
  assetId: string,
  selectedChannelIds: ReadonlySet<string>,
  approvals?: AssignmentTakeoverApprovals,
): { assignments: MeasurementAssignment[]; displacedAssetIds: string[] } {
  const assets = store.siteAssets.filter((asset) => asset.id === assetId);
  if (assets.length !== 1) throw new Error('The selected site asset is unavailable.');
  const installationId = assets[0]!.audit_id;
  if (!selectedChannelIds.size) throw new Error('Select an available meter channel before assigning the site asset.');
  const selectedMeterIds = new Set<string>();
  for (const channelId of selectedChannelIds) {
    const owners = store.meterDevices.filter((device) => device.channels.some((channel) => channel.id === channelId));
    if (owners.length !== 1 || owners[0]!.installationId !== installationId) {
      throw new Error('A selected channel is unavailable or belongs to another installation.');
    }
    selectedMeterIds.add(owners[0]!.id);
  }
  if (selectedMeterIds.size !== 1) throw new Error('Selected channels must belong to one metering device.');
  const owned = store.measurementAssignments.filter((assignment) =>
    assignment.target.kind === 'SITE_ASSET' && assignment.target.siteAssetId === assetId);
  const ownedSet = new Set(owned);
  const overlapping = store.measurementAssignments.filter((assignment) =>
    !ownedSet.has(assignment) && assignment.channelIds.some((id) => selectedChannelIds.has(id)));
  for (const assignment of [...owned, ...overlapping]) {
    assertAssignmentInInstallation(store, assignment, installationId);
  }
  if (overlapping.some((assignment) => ['BOARD', 'GRID_BOUNDARY'].includes(assignment.target.kind))) {
    throw new Error('A channel attached to a switchboard or Grid boundary cannot be taken over from a site asset. Reconcile that measurement at the meter instead.');
  }
  const conflicts = overlapping.filter((assignment) => assignment.target.kind === 'SITE_ASSET');
  for (const conflict of conflicts) {
    if (conflict.target.kind === 'SITE_ASSET') {
      assertAssetInInstallation(store, conflict.target.siteAssetId, installationId);
    }
  }
  assertExactAssignmentApprovals(conflicts, approvals);
  const released = new Set([...owned, ...overlapping]);
  const assignments = store.measurementAssignments.flatMap((assignment) => {
    if (!released.has(assignment)) return [copyAssignment(assignment)];
    const remainder = releasedAssignmentRemainder(assignment, selectedChannelIds);
    return remainder ? [remainder] : [];
  });
  const displacedAssetIds = [...new Set(conflicts.flatMap((assignment) =>
    assignment.target.kind === 'SITE_ASSET' ? [assignment.target.siteAssetId] : []))];
  return { assignments, displacedAssetIds };
}
