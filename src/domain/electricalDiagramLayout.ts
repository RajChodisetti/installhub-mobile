import type {
  ElectricalDiagramEdge,
  ElectricalDiagramModel,
  ElectricalDiagramNode,
} from './electricalDiagram';

export const ELECTRICAL_DIAGRAM_NODE_WIDTH = 184;
export const ELECTRICAL_DIAGRAM_NODE_HEIGHT = 116;
const BOARD_WIDTH = 248;
const BOARD_BASE_HEIGHT = 142;
const GRID_WIDTH = 152;
const GRID_HEIGHT = 112;
const RESIDUAL_WIDTH = 170;
const RESIDUAL_HEIGHT = 88;
const HORIZONTAL_GAP = 112;
const VERTICAL_GAP = 28;
const PACKED_TERMINAL_MAX_ROWS = 5;
const PACKED_TERMINAL_LANE_GAP = 36;
// Orthogonal self-loops and backwards connectors escape 34px beyond a node.
// Keep enough canvas safety area for those routes plus their stroke width.
const CANVAS_PADDING = 40;

export interface ElectricalDiagramNodeSize {
  width: number;
  height: number;
}

export interface ElectricalDiagramLayoutNode {
  node: ElectricalDiagramNode;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  parentId?: string;
  presentationLane?: number;
  presentationRow?: number;
  packedTerminal?: boolean;
}

export interface ElectricalDiagramLayout {
  width: number;
  height: number;
  nodes: ElectricalDiagramLayoutNode[];
  edges: ElectricalDiagramEdge[];
}

export interface ElectricalDiagramPoint {
  x: number;
  y: number;
}

export interface ElectricalDiagramViewport {
  x: number;
  y: number;
  scale: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function electricalDiagramNodeSize(
  node: ElectricalDiagramNode,
): ElectricalDiagramNodeSize {
  if (node.kind === 'BOARD') {
    const visibleDeviceRows = Math.min(node.devices.length, 3);
    return {
      width: BOARD_WIDTH,
      height: BOARD_BASE_HEIGHT + Math.max(0, visibleDeviceRows - 1) * 38,
    };
  }
  if (node.kind === 'GRID') return { width: GRID_WIDTH, height: GRID_HEIGHT };
  if (node.kind === 'VIRTUAL_RESIDUAL') {
    return { width: RESIDUAL_WIDTH, height: RESIDUAL_HEIGHT };
  }
  return {
    width: ELECTRICAL_DIAGRAM_NODE_WIDTH,
    height: ELECTRICAL_DIAGRAM_NODE_HEIGHT,
  };
}

function topologyParentById(model: ElectricalDiagramModel): Map<string, string> {
  const nodeIds = new Set(model.nodes.map((node) => node.id));
  const parentById = new Map<string, string>();
  const sorted = [...model.edges].sort(
    (left, right) =>
      left.relationship.localeCompare(right.relationship) ||
      left.sourceNodeId.localeCompare(right.sourceNodeId) ||
      left.targetNodeId.localeCompare(right.targetNodeId) ||
      left.id.localeCompare(right.id),
  );
  for (const edge of sorted) {
    if (
      edge.relationship !== 'FED_FROM' &&
      edge.relationship !== 'CALCULATED_RESIDUAL'
    ) {
      continue;
    }
    if (
      !nodeIds.has(edge.sourceNodeId) ||
      !nodeIds.has(edge.targetNodeId) ||
      edge.sourceNodeId === edge.targetNodeId ||
      parentById.has(edge.targetNodeId)
    ) {
      continue;
    }
    parentById.set(edge.targetNodeId, edge.sourceNodeId);
  }

  // Imported or partially reconciled data can contain a parent cycle. Break
  // each cycle at a stable node so layout remains bounded and reproducible.
  for (const startId of [...nodeIds].sort()) {
    const path: string[] = [];
    const pathIndex = new Map<string, number>();
    let currentId: string | undefined = startId;
    while (currentId && parentById.has(currentId)) {
      const existingIndex = pathIndex.get(currentId);
      if (existingIndex !== undefined) {
        const cycleIds = path.slice(existingIndex);
        const promotedRoot = [...cycleIds].sort()[0];
        parentById.delete(promotedRoot);
        break;
      }
      pathIndex.set(currentId, path.length);
      path.push(currentId);
      currentId = parentById.get(currentId);
    }
  }
  return parentById;
}

/** Deterministic left-to-right layout shared by the native canvas and PDF SVG. */
export function buildElectricalDiagramLayout(
  model?: ElectricalDiagramModel,
): ElectricalDiagramLayout {
  if (!model?.nodes.length) return { width: 0, height: 0, nodes: [], edges: [] };

  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const orderById = new Map(model.nodes.map((node, index) => [node.id, index]));
  const parentById = topologyParentById(model);
  const childrenById = new Map<string, string[]>();
  for (const [nodeId, parentId] of parentById) {
    const children = childrenById.get(parentId) ?? [];
    children.push(nodeId);
    childrenById.set(parentId, children);
  }
  for (const children of childrenById.values()) {
    children.sort(
      (left, right) =>
        (orderById.get(left) ?? 0) - (orderById.get(right) ?? 0) ||
        left.localeCompare(right),
    );
  }

  const depthById = new Map<string, number>();
  const selectedParentDepth = (nodeId: string, path = new Set<string>()): number => {
    const cached = depthById.get(nodeId);
    if (cached !== undefined) return cached;
    const parentId = parentById.get(nodeId);
    if (!parentId || !nodeById.has(parentId) || path.has(nodeId)) {
      depthById.set(nodeId, 0);
      return 0;
    }
    const depth = selectedParentDepth(parentId, new Set(path).add(nodeId)) + 1;
    depthById.set(nodeId, depth);
    return depth;
  };
  model.nodes.forEach((node) => selectedParentDepth(node.id));

  const sizeById = new Map(
    model.nodes.map((node) => [node.id, electricalDiagramNodeSize(node)]),
  );
  const centerYById = new Map<string, number>();
  const presentationById = new Map<string, { lane: number; row: number }>();
  type ChildUnit =
    | { kind: 'NODE'; nodeIds: [string] }
    | {
        kind: 'PACKED_TERMINALS';
        nodeIds: string[];
        laneCount: number;
        rowCount: number;
      };
  const childUnitsById = new Map<string, ChildUnit[]>();
  const subtreeHeightById = new Map<string, number>();

  const childUnits = (nodeId: string): ChildUnit[] => {
    const cached = childUnitsById.get(nodeId);
    if (cached) return cached;
    const children = childrenById.get(nodeId) ?? [];
    const packableIds = children.filter((childId) => {
      const node = nodeById.get(childId);
      return node?.kind === 'SITE_ASSET' && !(childrenById.get(childId)?.length);
    });
    if (packableIds.length <= PACKED_TERMINAL_MAX_ROWS) {
      const units: ChildUnit[] = children.map((childId) => ({
        kind: 'NODE',
        nodeIds: [childId],
      }));
      childUnitsById.set(nodeId, units);
      return units;
    }
    const packable = new Set(packableIds);
    const laneCount = Math.ceil(
      packableIds.length / PACKED_TERMINAL_MAX_ROWS,
    );
    const rowCount = Math.ceil(packableIds.length / laneCount);
    const units: ChildUnit[] = [];
    let inserted = false;
    for (const childId of children) {
      if (!packable.has(childId)) {
        units.push({ kind: 'NODE', nodeIds: [childId] });
      } else if (!inserted) {
        units.push({
          kind: 'PACKED_TERMINALS',
          nodeIds: packableIds,
          laneCount,
          rowCount,
        });
        inserted = true;
      }
    }
    childUnitsById.set(nodeId, units);
    return units;
  };

  const packedUnitHeight = (
    unit: Extract<ChildUnit, { kind: 'PACKED_TERMINALS' }>,
  ) => {
    const tallestNode = Math.max(
      ...unit.nodeIds.map(
        (nodeId) => sizeById.get(nodeId)?.height ?? ELECTRICAL_DIAGRAM_NODE_HEIGHT,
      ),
    );
    return (
      unit.rowCount * tallestNode +
      Math.max(0, unit.rowCount - 1) * VERTICAL_GAP
    );
  };

  const subtreeHeight = (nodeId: string, path = new Set<string>()): number => {
    const cached = subtreeHeightById.get(nodeId);
    if (cached !== undefined) return cached;
    const ownHeight =
      sizeById.get(nodeId)?.height ?? ELECTRICAL_DIAGRAM_NODE_HEIGHT;
    if (path.has(nodeId)) return ownHeight;
    const nextPath = new Set(path).add(nodeId);
    const units = childUnits(nodeId);
    const childrenHeight =
      units.reduce(
        (total, unit) =>
          total +
          (unit.kind === 'PACKED_TERMINALS'
            ? packedUnitHeight(unit)
            : subtreeHeight(unit.nodeIds[0], nextPath)),
        0,
      ) + Math.max(0, units.length - 1) * VERTICAL_GAP;
    const height = Math.max(ownHeight, childrenHeight);
    subtreeHeightById.set(nodeId, height);
    return height;
  };

  const placeNode = (nodeId: string, top: number, path = new Set<string>()) => {
    if (centerYById.has(nodeId)) return;
    const height = subtreeHeight(nodeId, path);
    centerYById.set(nodeId, top + height / 2);
    if (path.has(nodeId)) return;
    const nextPath = new Set(path).add(nodeId);
    const units = childUnits(nodeId);
    const unitHeights = units.map((unit) =>
      unit.kind === 'PACKED_TERMINALS'
        ? packedUnitHeight(unit)
        : subtreeHeight(unit.nodeIds[0], nextPath),
    );
    const totalChildrenHeight =
      unitHeights.reduce((total, heightValue) => total + heightValue, 0) +
      Math.max(0, units.length - 1) * VERTICAL_GAP;
    let childTop = top + (height - totalChildrenHeight) / 2;
    units.forEach((unit, unitIndex) => {
      if (unit.kind === 'NODE') {
        placeNode(unit.nodeIds[0], childTop, nextPath);
      } else {
        const tallestNode = Math.max(
          ...unit.nodeIds.map(
            (childId) =>
              sizeById.get(childId)?.height ?? ELECTRICAL_DIAGRAM_NODE_HEIGHT,
          ),
        );
        unit.nodeIds.forEach((childId, childIndex) => {
          const lane = Math.floor(childIndex / unit.rowCount);
          const row = childIndex % unit.rowCount;
          centerYById.set(
            childId,
            childTop + row * (tallestNode + VERTICAL_GAP) + tallestNode / 2,
          );
          presentationById.set(childId, { lane, row });
        });
      }
      childTop += unitHeights[unitIndex] + VERTICAL_GAP;
    });
  };

  const roots = model.nodes.filter((node) => !parentById.has(node.id));
  let nextRootTop = CANVAS_PADDING;
  for (const root of roots) {
    placeNode(root.id, nextRootTop);
    nextRootTop += subtreeHeight(root.id) + VERTICAL_GAP;
  }
  for (const node of model.nodes) {
    if (centerYById.has(node.id)) continue;
    placeNode(node.id, nextRootTop);
    nextRootTop += subtreeHeight(node.id) + VERTICAL_GAP;
  }

  const maxDepth = Math.max(
    0,
    ...model.nodes.map((node) => depthById.get(node.id) ?? 0),
  );
  const maxWidthByDepth = Array.from({ length: maxDepth + 1 }, () => 0);
  for (const node of model.nodes) {
    const depth = depthById.get(node.id) ?? 0;
    maxWidthByDepth[depth] = Math.max(
      maxWidthByDepth[depth],
      sizeById.get(node.id)?.width ?? ELECTRICAL_DIAGRAM_NODE_WIDTH,
    );
  }
  const xByDepth = [CANVAS_PADDING];
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    xByDepth[depth] =
      xByDepth[depth - 1] + maxWidthByDepth[depth - 1] + HORIZONTAL_GAP;
  }
  const nodes: ElectricalDiagramLayoutNode[] = model.nodes.map((node) => {
    const size = sizeById.get(node.id) ?? electricalDiagramNodeSize(node);
    const presentation = presentationById.get(node.id);
    const depth = depthById.get(node.id) ?? 0;
    return {
      node,
      x:
        xByDepth[depth] +
        (presentation?.lane ?? 0) * (size.width + PACKED_TERMINAL_LANE_GAP),
      y: (centerYById.get(node.id) ?? CANVAS_PADDING) - size.height / 2,
      width: size.width,
      height: size.height,
      depth,
      ...(parentById.has(node.id) ? { parentId: parentById.get(node.id) } : {}),
      ...(presentation
        ? {
            presentationLane: presentation.lane,
            presentationRow: presentation.row,
            packedTerminal: true,
          }
        : {}),
    };
  });
  const visibleNodeIds = new Set(nodes.map((item) => item.node.id));
  const edges = model.edges.filter(
    (edge) =>
      visibleNodeIds.has(edge.sourceNodeId) &&
      visibleNodeIds.has(edge.targetNodeId) &&
      (edge.relationship === 'MEASURES' ||
        parentById.get(edge.targetNodeId) === edge.sourceNodeId),
  );
  const maxRight = Math.max(
    CANVAS_PADDING,
    ...nodes.map((item) => item.x + item.width),
  );
  const maxBottom = Math.max(
    CANVAS_PADDING,
    ...nodes.map((item) => item.y + item.height),
  );
  return {
    width: maxRight + CANVAS_PADDING,
    height: maxBottom + CANVAS_PADDING,
    nodes,
    edges,
  };
}

function cleanCoordinate(value: number): number {
  return Number(value.toFixed(2));
}

/** Orthogonal route used by both the native SVG and printed SVG. */
export function electricalDiagramOrthogonalPoints(
  source: ElectricalDiagramLayoutNode,
  target: ElectricalDiagramLayoutNode,
  options: {
    sourceYOffset?: number;
    targetYOffset?: number;
    trunkRatio?: number;
  } = {},
): ElectricalDiagramPoint[] {
  const sourceYOffset = options.sourceYOffset ?? 0;
  const targetYOffset = options.targetYOffset ?? 0;
  if (source.node.id === target.node.id) {
    const sourceX = source.x + source.width;
    const sourceY = source.y + source.height * 0.34 + sourceYOffset;
    const targetX = source.x + source.width;
    const targetY = source.y + source.height * 0.7 + targetYOffset;
    const loopX = sourceX + 34;
    return [
      { x: sourceX, y: sourceY },
      { x: loopX, y: sourceY },
      { x: loopX, y: targetY },
      { x: targetX, y: targetY },
    ].map((point) => ({
      x: cleanCoordinate(point.x),
      y: cleanCoordinate(point.y),
    }));
  }
  const sourceX = source.x + source.width;
  const sourceY = source.y + source.height / 2 + sourceYOffset;
  const targetX = target.x;
  const targetY = target.y + target.height / 2 + targetYOffset;
  if (targetX >= sourceX + 12) {
    const presentationLane = target.presentationLane ?? 0;
    const firstLaneX =
      target.x -
      presentationLane * (target.width + PACKED_TERMINAL_LANE_GAP);
    const trunkDestinationX = target.packedTerminal ? firstLaneX : targetX;
    const trunkX =
      sourceX +
      (trunkDestinationX - sourceX) * (options.trunkRatio ?? 0.5);
    if (target.packedTerminal && presentationLane > 0) {
      const routeY = target.y - VERTICAL_GAP / 2;
      return [
        { x: sourceX, y: sourceY },
        { x: trunkX, y: sourceY },
        { x: trunkX, y: routeY },
        { x: targetX, y: routeY },
        { x: targetX, y: targetY },
      ].map((point) => ({
        x: cleanCoordinate(point.x),
        y: cleanCoordinate(point.y),
      }));
    }
    return [
      { x: sourceX, y: sourceY },
      { x: trunkX, y: sourceY },
      { x: trunkX, y: targetY },
      { x: targetX, y: targetY },
    ].map((point) => ({
      x: cleanCoordinate(point.x),
      y: cleanCoordinate(point.y),
    }));
  }
  const escapeX = Math.max(sourceX, target.x + target.width) + 34;
  const approachX = target.x - 28;
  const detourY = Math.max(source.y + source.height, target.y + target.height) + 22;
  return [
    { x: sourceX, y: sourceY },
    { x: escapeX, y: sourceY },
    { x: escapeX, y: detourY },
    { x: approachX, y: detourY },
    { x: approachX, y: targetY },
    { x: targetX, y: targetY },
  ].map((point) => ({
    x: cleanCoordinate(point.x),
    y: cleanCoordinate(point.y),
  }));
}

export function fitElectricalDiagramViewport(
  viewportWidth: number,
  viewportHeight: number,
  diagramWidth: number,
  diagramHeight: number,
): ElectricalDiagramViewport {
  if (!diagramWidth || !diagramHeight) return { x: 0, y: 0, scale: 1 };
  const scale = clamp(
    Math.min(viewportWidth / diagramWidth, viewportHeight / diagramHeight),
    0.42,
    1,
  );
  return {
    scale,
    x: (viewportWidth - diagramWidth * scale) / 2,
    y: (viewportHeight - diagramHeight * scale) / 2,
  };
}

export function zoomElectricalDiagramViewport(
  viewport: ElectricalDiagramViewport,
  nextScale: number,
  anchorX: number,
  anchorY: number,
): ElectricalDiagramViewport {
  const scale = clamp(nextScale, 0.42, 1.35);
  const ratio = scale / viewport.scale;
  return {
    scale,
    x: anchorX - (anchorX - viewport.x) * ratio,
    y: anchorY - (anchorY - viewport.y) * ratio,
  };
}
