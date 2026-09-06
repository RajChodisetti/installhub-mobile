import type { ElectricalDiagramLayout } from './electricalDiagramLayout';

export interface ElectricalMapLayoutDocument {
  version: 1;
  canvas: { width: number; height: number };
  nodes: Array<{ nodeId: string; centerX: number; centerY: number }>;
}
export interface SavedElectricalMapLayout extends ElectricalMapLayoutDocument {
  layoutRevision: number;
  updatedAt?: string;
}
export interface ElectricalMapViewResponse {
  installationId: string;
  treeRevision: number;
  recordVersionNumber?: number;
  mapLayout?: SavedElectricalMapLayout;
  nodes: Array<{ id: string; kind: string; coverageState?: string; parentNodeId?: string }>;
  edges: Array<{ sourceNodeId: string; targetNodeId: string; relationship: string }>;
  unresolved: Array<{ subjectType: string; subjectId: string }>;
}
export interface SaveElectricalMapLayoutResult {
  installationId: string;
  treeRevision: number;
  mapLayout: SavedElectricalMapLayout;
}

export function validateElectricalMapLayout(value: unknown, expectedIds?: Iterable<string>): ElectricalMapLayoutDocument {
  const item = value as ElectricalMapLayoutDocument | null;
  const dimension = (number: unknown) => typeof number === 'number' && Number.isFinite(number) && number >= 320 && number <= 20_000;
  if (!item || item.version !== 1 || !dimension(item.canvas?.width) || !dimension(item.canvas?.height)
    || !Array.isArray(item.nodes) || !item.nodes.length || item.nodes.length > 2000) throw new Error('The saved electrical arrangement is invalid.');
  const canvas = { width: Number(item.canvas.width.toFixed(2)), height: Number(item.canvas.height.toFixed(2)) };
  const ids = new Set<string>();
  const nodes = item.nodes.map((node) => {
    if (!node || typeof node.nodeId !== 'string' || !node.nodeId.trim() || node.nodeId.length > 256 || ids.has(node.nodeId.trim())
      || !Number.isFinite(node.centerX) || !Number.isFinite(node.centerY)
      || node.centerX < 0 || node.centerX > canvas.width || node.centerY < 0 || node.centerY > canvas.height) throw new Error('The arrangement has invalid, duplicate or out-of-canvas symbol positions.');
    ids.add(node.nodeId.trim());
    return { nodeId: node.nodeId.trim(), centerX: Number(node.centerX.toFixed(2)), centerY: Number(node.centerY.toFixed(2)) };
  }).sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  if (expectedIds) {
    const expected = new Set(expectedIds);
    if (expected.size !== ids.size || [...ids].some((id) => !expected.has(id))) throw new Error('The arrangement no longer matches the current confirmed electrical map. Reload its saved arrangement.');
  }
  return { version: 1, canvas, nodes };
}

/** Mirrors the API clientElectricalMapNodeIds: only confirmed grid-reachable symbols. */
export function confirmedElectricalMapNodeIds(view: ElectricalMapViewResponse): Set<string> {
  const excluded = new Set(view.unresolved.filter((item) => item.subjectType === 'BOARD' || item.subjectType === 'SITE_ASSET').map((item) => item.subjectId));
  view.nodes.filter((node) => node.kind === 'SITE_ASSET' && (node.coverageState === 'TBC' || node.coverageState === 'INVALID')).forEach((node) => excluded.add(node.id));
  const included = new Set(view.nodes.filter((node) => node.kind === 'GRID' && !excluded.has(node.id)).map((node) => node.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of view.edges) if (edge.relationship === 'FED_FROM' && included.has(edge.sourceNodeId) && !included.has(edge.targetNodeId) && !excluded.has(edge.targetNodeId)) { included.add(edge.targetNodeId); changed = true; }
    for (const node of view.nodes) if (node.kind === 'VIRTUAL_RESIDUAL' && node.parentNodeId && included.has(node.parentNodeId) && !included.has(node.id) && !excluded.has(node.id)) { included.add(node.id); changed = true; }
  }
  return included;
}

export function electricalMapDocumentFromLayout(layout: ElectricalDiagramLayout): ElectricalMapLayoutDocument {
  return validateElectricalMapLayout({ version: 1, canvas: { width: Math.max(320, layout.width), height: Math.max(320, layout.height) },
    nodes: layout.nodes.map((item) => ({ nodeId: item.node.id, centerX: item.x + item.width / 2, centerY: item.y + item.height / 2 })) });
}

export function applyElectricalMapLayout(layout: ElectricalDiagramLayout, document: ElectricalMapLayoutDocument): ElectricalDiagramLayout {
  const validated = validateElectricalMapLayout(document, layout.nodes.map((item) => item.node.id));
  const positions = new Map(validated.nodes.map((node) => [node.nodeId, node]));
  const nodes = layout.nodes.map((item) => {
    const position = positions.get(item.node.id)!;
    return { ...item, x: position.centerX - item.width / 2, y: position.centerY - item.height / 2 };
  });
  // Portal symbols and native cards have different dimensions. Translate the entire
  // render canvas, preserving saved centres relative to one another, to avoid clipping.
  const offsetX = Math.max(0, 40 - Math.min(...nodes.map((node) => node.x)));
  const offsetY = Math.max(0, 40 - Math.min(...nodes.map((node) => node.y)));
  return { ...layout,
    width: Math.max(validated.canvas.width, ...nodes.map((node) => node.x + node.width + 40)) + offsetX,
    height: Math.max(validated.canvas.height, ...nodes.map((node) => node.y + node.height + 40)) + offsetY,
    nodes: nodes.map((node) => ({ ...node, x: node.x + offsetX, y: node.y + offsetY })) };
}

export function moveElectricalMapNode(document: ElectricalMapLayoutDocument, id: string, dx: number, dy: number): ElectricalMapLayoutDocument {
  return validateElectricalMapLayout({ ...document, nodes: document.nodes.map((node) => node.nodeId === id ? {
    ...node, centerX: Math.min(document.canvas.width, Math.max(0, node.centerX + dx)), centerY: Math.min(document.canvas.height, Math.max(0, node.centerY + dy)),
  } : node) });
}
