import type {
  ElectricalAsset,
  GridSupply,
  Installation,
  MeasurementAssignment,
  MeterChannel,
  MeterDevice,
  SiteAsset,
  SiteAssetTypeCode,
  VirtualMeterDefinition,
  Zone,
} from '../types';
import {
  BOARD_TYPE_LABELS,
  SITE_ASSET_TYPE_LABELS,
  boardTypeCode,
  isSemanticallyConfirmedMeasurementAssignment,
  siteAssetTypeCode,
} from './installationV2';

export type ElectricalDiagramCoverage =
  | 'DIRECT'
  | 'VIRTUAL'
  | 'UNMETERED'
  | 'TBC'
  | 'INVALID';

export type ElectricalDiagramNodeKind =
  | 'GRID'
  | 'BOARD'
  | 'SITE_ASSET'
  | 'VIRTUAL_RESIDUAL';

export type ElectricalDiagramEdgeRelationship =
  | 'FED_FROM'
  | 'MEASURES'
  | 'CALCULATED_RESIDUAL';

export interface ElectricalDiagramChannel {
  id: string;
  ordinal: number;
  purpose: MeterChannel['purpose'];
  loadLabel: string;
  description?: string;
  sensorRating?: string;
}

export interface ElectricalDiagramDevice {
  id: string;
  name: string;
  model: string;
  serialNumber?: string;
  deviceNumber?: string;
  channels: ElectricalDiagramChannel[];
}

export interface ElectricalDiagramNode {
  id: string;
  kind: ElectricalDiagramNodeKind;
  name: string;
  displayCode?: string;
  typeCode?: string;
  typeLabel: string;
  zoneId?: string;
  zoneCode?: string;
  zoneName: string;
  coverageState?: ElectricalDiagramCoverage;
  parentNodeId?: string;
  devices: ElectricalDiagramDevice[];
}

export interface ElectricalDiagramEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  relationship: ElectricalDiagramEdgeRelationship;
  assignmentId?: string;
  meterId?: string;
  channelOrdinals?: number[];
  phaseMode?: MeasurementAssignment['phaseMode'];
  direction?: MeasurementAssignment['direction'];
}

export interface ElectricalDiagramUnresolvedRelationship {
  id: string;
  subjectType: 'BOARD' | 'SITE_ASSET' | 'MEASUREMENT_ASSIGNMENT';
  subjectId: string;
  relation: 'SUPPLY' | 'MEASUREMENT';
  missingEnd: 'SOURCE' | 'TARGET';
  knownNodeId?: string;
  reason: 'TBC' | 'ORPHAN' | 'INVALID';
}

export interface ElectricalDiagramModel {
  installationId: string;
  siteName: string;
  treeRevision: number;
  nodes: ElectricalDiagramNode[];
  edges: ElectricalDiagramEdge[];
  unresolved: ElectricalDiagramUnresolvedRelationship[];
}

export interface ElectricalDiagramInput {
  installation: Installation;
  zones: Zone[];
  boards: ElectricalAsset[];
  siteAssets: SiteAsset[];
  gridSupplies: GridSupply[];
  meterDevices: MeterDevice[];
  measurementAssignments: MeasurementAssignment[];
  virtualMeterDefinitions?: VirtualMeterDefinition[];
}

const NODE_KIND_ORDER: Record<ElectricalDiagramNodeKind, number> = {
  GRID: 0,
  BOARD: 1,
  SITE_ASSET: 2,
  VIRTUAL_RESIDUAL: 3,
};

function displayCode(value: ElectricalAsset | SiteAsset): string {
  return value.display_code_meta?.value ?? value.display_code ?? '';
}

function channelLoadLabel(channel: MeterChannel): string {
  if (channel.customLoadTypeName?.trim()) return channel.customLoadTypeName.trim();
  if (channel.loadTypeCode) return SITE_ASSET_TYPE_LABELS[channel.loadTypeCode];
  return channel.purpose === 'SPARE' ? 'Spare / unused' : '';
}

function deviceSummary(meter: MeterDevice): ElectricalDiagramDevice {
  return {
    id: meter.id,
    name:
      meter.displayName.value ||
      meter.customName ||
      meter.deviceNumber ||
      meter.serialNumber ||
      meter.deviceModel,
    model:
      meter.deviceModel === 'OTHER'
        ? meter.customModelName || 'Other'
        : meter.deviceModel,
    ...(meter.serialNumber ? { serialNumber: meter.serialNumber } : {}),
    ...(meter.deviceNumber ? { deviceNumber: meter.deviceNumber } : {}),
    channels: [...meter.channels]
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((channel) => ({
        id: channel.id,
        ordinal: channel.ordinal,
        purpose: channel.purpose,
        loadLabel: channelLoadLabel(channel),
        ...(channel.description?.trim()
          ? { description: channel.description.trim() }
          : {}),
        ...(channel.sensorRating?.trim()
          ? { sensorRating: channel.sensorRating.trim() }
          : {}),
      })),
  };
}

function measurementTargetNodeId(
  assignment: MeasurementAssignment,
): string | null {
  if (assignment.target.kind === 'BOARD') return assignment.target.boardId;
  if (assignment.target.kind === 'SITE_ASSET') {
    return assignment.target.siteAssetId;
  }
  if (assignment.target.kind === 'GRID_BOUNDARY') {
    return assignment.target.gridSupplyId;
  }
  return null;
}

function immediateChildUsesParent(
  input: ElectricalDiagramInput,
  parentNodeId: string,
  parentKind: 'BOARD' | 'GRID_BOUNDARY',
  assignment: MeasurementAssignment,
): boolean {
  const expectedSourceKind = parentKind === 'BOARD' ? 'BOARD' : 'GRID';
  let target: ElectricalAsset | SiteAsset | undefined;
  if (assignment.target.kind === 'BOARD') {
    const boardId = assignment.target.boardId;
    target = input.boards.find((board) => board.id === boardId);
  } else if (assignment.target.kind === 'SITE_ASSET') {
    const siteAssetId = assignment.target.siteAssetId;
    target = input.siteAssets.find((asset) => asset.id === siteAssetId);
  }
  if (!target?.electrical_source) return false;
  return expectedSourceKind === 'BOARD'
    ? target.electrical_source.kind === 'BOARD' &&
        target.electrical_source.boardId === parentNodeId
    : target.electrical_source.kind === 'GRID' &&
        target.electrical_source.gridSupplyId === parentNodeId;
}

function usableVirtualMeterDefinitions(
  input: ElectricalDiagramInput,
): VirtualMeterDefinition[] {
  const assignmentById = new Map(
    input.measurementAssignments.map((assignment) => [assignment.id, assignment]),
  );
  return (input.virtualMeterDefinitions ?? []).filter((definition) => {
    const total = assignmentById.get(definition.totalMeasurementAssignmentId);
    if (
      !total ||
      !isSemanticallyConfirmedMeasurementAssignment(input, total)
    ) {
      return false;
    }
    const parentKind = total.target.kind;
    const totalMatchesParent =
      parentKind === 'BOARD'
        ? total.target.boardId === definition.parentNodeId
        : parentKind === 'GRID_BOUNDARY'
          ? total.target.gridSupplyId === definition.parentNodeId
          : false;
    if (!totalMatchesParent) return false;

    const subtractIds = new Set(definition.subtractAssignmentIds);
    if (
      subtractIds.size !== definition.subtractAssignmentIds.length ||
      subtractIds.has(total.id)
    ) {
      return false;
    }
    return [...subtractIds].every((assignmentId) => {
      const assignment = assignmentById.get(assignmentId);
      return Boolean(
        assignment &&
          isSemanticallyConfirmedMeasurementAssignment(input, assignment) &&
          immediateChildUsesParent(
            input,
            definition.parentNodeId,
            parentKind as 'BOARD' | 'GRID_BOUNDARY',
            assignment,
          ),
      );
    });
  });
}

function virtualForAsset(
  input: ElectricalDiagramInput,
  asset: SiteAsset,
): VirtualMeterDefinition | null {
  const source = asset.electrical_source;
  if (!source || source.kind === 'TBC') return null;
  const parentNodeId =
    source.kind === 'GRID' ? source.gridSupplyId : source.boardId;
  const expectedTargetKind = source.kind === 'GRID' ? 'GRID_BOUNDARY' : 'BOARD';
  const assignmentById = new Map(
    input.measurementAssignments.map((assignment) => [assignment.id, assignment]),
  );
  const definition = input.virtualMeterDefinitions?.find((candidate) => {
    if (candidate.parentNodeId !== parentNodeId) return false;
    const total = assignmentById.get(candidate.totalMeasurementAssignmentId);
    if (!total) return false;
    return expectedTargetKind === 'GRID_BOUNDARY'
      ? total.target.kind === 'GRID_BOUNDARY' &&
          total.target.gridSupplyId === parentNodeId
      : total.target.kind === 'BOARD' && total.target.boardId === parentNodeId;
  });
  if (!definition) return null;
  const directlyMeasuredAssetIds = new Set(
    definition.subtractAssignmentIds.flatMap((assignmentId) => {
      const assignment = assignmentById.get(assignmentId);
      return assignment?.target.kind === 'SITE_ASSET'
        ? [assignment.target.siteAssetId]
        : [];
    }),
  );
  return directlyMeasuredAssetIds.has(asset.id) ? null : definition;
}

function coverageForAsset(
  input: ElectricalDiagramInput,
  asset: SiteAsset,
): ElectricalDiagramCoverage {
  const assignments = input.measurementAssignments.filter(
    (assignment) =>
      assignment.target.kind === 'SITE_ASSET' &&
      assignment.target.siteAssetId === asset.id,
  );
  const relationshipInvalid = assignments.some(
    (assignment) =>
      !isSemanticallyConfirmedMeasurementAssignment(input, assignment),
  );
  const meteringState = asset.metering_state ?? { kind: 'TBC' as const };
  if (meteringState.kind === 'METERED') {
    const declaredIds = new Set(meteringState.measurementAssignmentIds);
    const actualIds = new Set(assignments.map((assignment) => assignment.id));
    const exactSingleAssignment =
      declaredIds.size === 1 &&
      actualIds.size === 1 &&
      [...declaredIds].every((id) => actualIds.has(id)) &&
      assignments[0]?.status === 'CONFIRMED';
    return exactSingleAssignment && !relationshipInvalid ? 'DIRECT' : 'INVALID';
  }
  if (assignments.length || relationshipInvalid) return 'INVALID';
  if (meteringState.kind === 'TBC') return 'TBC';
  return virtualForAsset(input, asset) ? 'VIRTUAL' : 'UNMETERED';
}

function sourceNodeId(
  source: ElectricalAsset['electrical_source'] | SiteAsset['electrical_source'],
  boardIds: Set<string>,
  gridIds: Set<string>,
): string | null {
  if (source?.kind === 'GRID') {
    return gridIds.has(source.gridSupplyId) ? source.gridSupplyId : null;
  }
  if (source?.kind === 'BOARD') {
    return boardIds.has(source.boardId) ? source.boardId : null;
  }
  return null;
}

function assetTypeCode(asset: SiteAsset): SiteAssetTypeCode {
  return asset.type_code ?? siteAssetTypeCode(asset.asset_type);
}

/**
 * Builds the same confirmed FED_FROM hierarchy and independent MEASURES
 * overlay used by the portal/server report. Unresolved records stay available
 * in the reconciliation UI but do not become misleading roots in the map.
 */
export function buildElectricalDiagramModel(
  input: ElectricalDiagramInput,
): ElectricalDiagramModel {
  const virtualMeterDefinitions = usableVirtualMeterDefinitions(input);
  const verifiedInput: ElectricalDiagramInput = {
    ...input,
    virtualMeterDefinitions,
  };
  const zonesById = new Map(input.zones.map((zone) => [zone.id, zone]));
  const boardIds = new Set(input.boards.map((board) => board.id));
  const gridIds = new Set(input.gridSupplies.map((grid) => grid.id));
  const devicesByBoard = new Map<string, ElectricalDiagramDevice[]>();
  for (const meter of input.meterDevices) {
    const devices = devicesByBoard.get(meter.installedOnBoardId) ?? [];
    devices.push(deviceSummary(meter));
    devicesByBoard.set(meter.installedOnBoardId, devices);
  }
  for (const devices of devicesByBoard.values()) {
    devices.sort((left, right) => left.name.localeCompare(right.name));
  }

  const allNodes: ElectricalDiagramNode[] = [
    ...input.gridSupplies.map(
      (grid): ElectricalDiagramNode => ({
        id: grid.id,
        kind: 'GRID',
        name: grid.name,
        typeLabel: 'Incoming grid',
        zoneName: 'Site-wide / derived',
        devices: [],
      }),
    ),
    ...input.boards.map((board): ElectricalDiagramNode => {
      const typeCode = board.type_code ?? boardTypeCode(board.asset_type);
      return {
        id: board.id,
        kind: 'BOARD',
        name: board.asset_name,
        displayCode: displayCode(board),
        typeCode,
        typeLabel:
          typeCode === 'OTHER'
            ? board.custom_type_name || BOARD_TYPE_LABELS.OTHER
            : BOARD_TYPE_LABELS[typeCode],
        zoneId: board.zone_id,
        zoneCode: zonesById.get(board.zone_id)?.zone_code,
        zoneName: zonesById.get(board.zone_id)?.zone_name ?? 'Unknown zone',
        devices: devicesByBoard.get(board.id) ?? [],
      };
    }),
    ...input.siteAssets.map((asset): ElectricalDiagramNode => {
      const typeCode = assetTypeCode(asset);
      return {
        id: asset.id,
        kind: 'SITE_ASSET',
        name: asset.asset_name,
        displayCode: displayCode(asset),
        typeCode,
        typeLabel:
          typeCode === 'OTHER'
            ? asset.custom_type_name || SITE_ASSET_TYPE_LABELS.OTHER
            : SITE_ASSET_TYPE_LABELS[typeCode],
        zoneId: asset.zone_id,
        zoneCode: zonesById.get(asset.zone_id)?.zone_code,
        zoneName: zonesById.get(asset.zone_id)?.zone_name ?? 'Unknown zone',
        coverageState: coverageForAsset(verifiedInput, asset),
        devices: [],
      };
    }),
    ...virtualMeterDefinitions.map(
      (definition): ElectricalDiagramNode => ({
        id: definition.id,
        kind: 'VIRTUAL_RESIDUAL',
        name: `Residual at ${definition.parentNodeId}`,
        displayCode: `VIRTUAL-${definition.id
          .replace(/^virtual_/, '')
          .toUpperCase()}`,
        typeLabel: 'Calculated residual',
        zoneName: 'Site-wide / derived',
        parentNodeId: definition.parentNodeId,
        coverageState: 'VIRTUAL',
        devices: [],
      }),
    ),
  ];

  const unresolved: ElectricalDiagramUnresolvedRelationship[] = [];
  const edges: ElectricalDiagramEdge[] = [];
  for (const entity of [
    ...input.boards.map((item) => ({ item, subjectType: 'BOARD' as const })),
    ...input.siteAssets.map((item) => ({
      item,
      subjectType: 'SITE_ASSET' as const,
    })),
  ]) {
    const sourceId = sourceNodeId(
      entity.item.electrical_source,
      boardIds,
      gridIds,
    );
    if (sourceId) {
      edges.push({
        id: `supplies:${sourceId}:${entity.item.id}`,
        sourceNodeId: sourceId,
        targetNodeId: entity.item.id,
        relationship: 'FED_FROM',
      });
    } else {
      unresolved.push({
        id: `unresolved:supply:${entity.item.id}`,
        subjectType: entity.subjectType,
        subjectId: entity.item.id,
        relation: 'SUPPLY',
        missingEnd: 'SOURCE',
        reason:
          entity.item.electrical_source?.kind === 'TBC' ? 'TBC' : 'INVALID',
      });
    }
  }

  const meterById = new Map(
    input.meterDevices.map((meter) => [meter.id, meter]),
  );
  const assetCoverageById = new Map(
    input.siteAssets.map((asset) => [
      asset.id,
      coverageForAsset(verifiedInput, asset),
    ]),
  );
  for (const assignment of input.measurementAssignments) {
    const meter = meterById.get(assignment.meterId);
    const targetNodeId = measurementTargetNodeId(assignment);
    const siteAssetTargetId =
      assignment.target.kind === 'SITE_ASSET'
        ? assignment.target.siteAssetId
        : null;
    const targetExists =
      assignment.target.kind === 'BOARD'
        ? boardIds.has(assignment.target.boardId)
        : assignment.target.kind === 'SITE_ASSET'
          ? input.siteAssets.some(
              (asset) => asset.id === siteAssetTargetId,
            )
          : assignment.target.kind === 'GRID_BOUNDARY'
            ? gridIds.has(assignment.target.gridSupplyId)
            : false;
    const sourceExists = Boolean(meter && boardIds.has(meter.installedOnBoardId));
    const targetCoverageConfirmed =
      siteAssetTargetId === null ||
      assetCoverageById.get(siteAssetTargetId) === 'DIRECT';
    if (
      meter &&
      targetNodeId &&
      targetExists &&
      sourceExists &&
      targetCoverageConfirmed &&
      isSemanticallyConfirmedMeasurementAssignment(verifiedInput, assignment)
    ) {
      edges.push({
        id: `measures:${assignment.id}`,
        sourceNodeId: meter.installedOnBoardId,
        targetNodeId,
        relationship: 'MEASURES',
        assignmentId: assignment.id,
        meterId: meter.id,
        channelOrdinals: assignment.channelIds
          .map(
            (channelId) =>
              meter.channels.find((channel) => channel.id === channelId)?.ordinal,
          )
          .filter((ordinal): ordinal is number => ordinal !== undefined)
          .sort((left, right) => left - right),
        phaseMode: assignment.phaseMode,
        direction: assignment.direction,
      });
    } else {
      const isTbc =
        assignment.status !== 'CONFIRMED' || assignment.target.kind === 'TBC';
      const missingSource = !isTbc && !sourceExists && targetExists;
      unresolved.push({
        id: `unresolved:measurement:${assignment.id}`,
        subjectType: 'MEASUREMENT_ASSIGNMENT',
        subjectId: assignment.id,
        relation: 'MEASUREMENT',
        missingEnd: missingSource ? 'SOURCE' : 'TARGET',
        ...(missingSource && targetNodeId ? { knownNodeId: targetNodeId } : {}),
        reason: isTbc
          ? 'TBC'
          : !sourceExists || !targetExists
            ? 'ORPHAN'
            : 'INVALID',
      });
    }
  }

  const allNodeIds = new Set(allNodes.map((node) => node.id));
  for (const node of allNodes) {
    if (
      node.kind !== 'VIRTUAL_RESIDUAL' ||
      !node.parentNodeId ||
      !allNodeIds.has(node.parentNodeId)
    ) {
      continue;
    }
    edges.push({
      id: `residual:${node.parentNodeId}:${node.id}`,
      sourceNodeId: node.parentNodeId,
      targetNodeId: node.id,
      relationship: 'CALCULATED_RESIDUAL',
    });
  }

  const resolvedNodeIds = new Set<string>(input.gridSupplies.map((grid) => grid.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (
        (edge.relationship === 'FED_FROM' ||
          edge.relationship === 'CALCULATED_RESIDUAL') &&
        resolvedNodeIds.has(edge.sourceNodeId) &&
        !resolvedNodeIds.has(edge.targetNodeId)
      ) {
        resolvedNodeIds.add(edge.targetNodeId);
        changed = true;
      }
    }
  }
  const nodes = allNodes
    .filter((node) => resolvedNodeIds.has(node.id))
    .sort(
      (left, right) =>
        NODE_KIND_ORDER[left.kind] - NODE_KIND_ORDER[right.kind] ||
        (left.displayCode || left.name).localeCompare(
          right.displayCode || right.name,
        ) ||
        left.id.localeCompare(right.id),
    );
  const nodeIds = new Set(nodes.map((node) => node.id));
  const visibleEdges = edges
    .filter(
      (edge) =>
        nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId),
    )
    .sort(
      (left, right) =>
        left.relationship.localeCompare(right.relationship) ||
        left.sourceNodeId.localeCompare(right.sourceNodeId) ||
        left.targetNodeId.localeCompare(right.targetNodeId) ||
        left.id.localeCompare(right.id),
    );
  unresolved.sort((left, right) => left.id.localeCompare(right.id));

  return {
    installationId: input.installation.id,
    siteName: input.installation.site_name,
    treeRevision: input.installation.tree_revision ?? 0,
    nodes,
    edges: visibleEdges,
    unresolved,
  };
}

export function electricalDiagramMeasurementDeviceLabel(
  model: ElectricalDiagramModel,
  edge: ElectricalDiagramEdge,
): string {
  const source = model.nodes.find((node) => node.id === edge.sourceNodeId);
  const device = source?.devices.find((candidate) => candidate.id === edge.meterId);
  if (!device) return source?.displayCode || source?.name || edge.sourceNodeId;
  return [
    device.name,
    device.serialNumber ? `Serial ${device.serialNumber}` : '',
    device.deviceNumber ? `Device ${device.deviceNumber}` : '',
    !device.serialNumber && !device.deviceNumber ? `ID ${device.id}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function electricalDiagramSearchText(
  node: ElectricalDiagramNode,
): string {
  return [
    node.kind,
    node.displayCode,
    node.name,
    node.typeLabel,
    node.zoneCode,
    node.zoneName,
    node.coverageState,
    ...node.devices.flatMap((device) => [
      device.name,
      device.model,
      device.serialNumber,
      device.deviceNumber,
      ...device.channels.flatMap((channel) => [
        `channel ${channel.ordinal}`,
        channel.loadLabel,
        channel.description,
        channel.sensorRating,
      ]),
    ]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleLowerCase();
}
