import assert from 'node:assert/strict';
import test from 'node:test';
import { applyElectricalMapLayout, confirmedElectricalMapNodeIds, electricalMapDocumentFromLayout, moveElectricalMapNode, validateElectricalMapLayout, type ElectricalMapViewResponse } from '../src/domain/electricalMapLayout';
import type { ElectricalDiagramLayout } from '../src/domain/electricalDiagramLayout';

const document = { version: 1, canvas: { width: 600, height: 400 }, nodes: [{ nodeId: 'a', centerX: 100, centerY: 100 }, { nodeId: 'b', centerX: 300, centerY: 200 }] } as const;
const copy = () => structuredClone(document);

test('layout schema validates exact node IDs, finite canvas bounds, duplicate IDs and coordinate limits', () => {
  assert.deepEqual(validateElectricalMapLayout(copy(), ['b', 'a']).nodes.map((node) => node.nodeId), ['a', 'b']);
  for (const value of [
    { ...copy(), version: 2 }, { ...copy(), canvas: { width: 200, height: 400 } },
    { ...copy(), nodes: [{ nodeId: 'a', centerX: NaN, centerY: 0 }] },
    { ...copy(), nodes: [{ nodeId: 'a', centerX: 601, centerY: 0 }] },
    { ...copy(), nodes: [{ nodeId: 'a', centerX: 1, centerY: 0 }, { nodeId: ' a ', centerX: 2, centerY: 0 }] },
  ]) assert.throws(() => validateElectricalMapLayout(value));
  assert.throws(() => validateElectricalMapLayout(copy(), ['a', 'foreign']));
  assert.equal(validateElectricalMapLayout({ ...copy(), canvas: { width: 600.126, height: 400.555 } }).canvas.width, 600.13);
});

test('move controls retain stable IDs and other positions and cannot move outside the design canvas', () => {
  const before = validateElectricalMapLayout(copy());
  const moved = moveElectricalMapNode(before, 'a', -1000, 1000);
  assert.deepEqual(moved.nodes[0], { nodeId: 'a', centerX: 0, centerY: 400 });
  assert.deepEqual(moved.nodes[1], before.nodes[1]);
  assert.equal(before.nodes[0]?.centerX, 100);
});

test('native rendering preserves relative portal centres without clipping larger native cards', () => {
  const layout = { width: 600, height: 400, edges: [], nodes: [
    { node: { id: 'a', kind: 'BOARD', name: 'Board', typeLabel: 'Board', zoneName: 'Zone', devices: [] }, x: 0, y: 0, width: 248, height: 142, depth: 0 },
    { node: { id: 'b', kind: 'SITE_ASSET', name: 'Asset', typeLabel: 'Asset', zoneName: 'Zone', devices: [] }, x: 200, y: 100, width: 184, height: 116, depth: 1 },
  ] } as ElectricalDiagramLayout;
  const rendered = applyElectricalMapLayout(layout, validateElectricalMapLayout(copy()));
  const [a, b] = rendered.nodes;
  assert.equal(b!.x + b!.width / 2 - (a!.x + a!.width / 2), 200);
  assert.equal(b!.y + b!.height / 2 - (a!.y + a!.height / 2), 100);
  assert.ok(rendered.nodes.every((node) => node.x >= 0 && node.y >= 0 && node.x + node.width <= rendered.width));
  const auto = electricalMapDocumentFromLayout(layout);
  assert.deepEqual(auto.nodes.map((node) => node.nodeId), ['a', 'b']);
});

test('only grid-reachable confirmed board, asset and residual symbols belong to the saved client map', () => {
  const view = { nodes: [{ id: 'g', kind: 'GRID' }, { id: 'b', kind: 'BOARD' }, { id: 'a', kind: 'SITE_ASSET', coverageState: 'DIRECT' }, { id: 't', kind: 'SITE_ASSET', coverageState: 'TBC' }, { id: 'v', kind: 'VIRTUAL_RESIDUAL', parentNodeId: 'b' }, { id: 'orphan', kind: 'BOARD' }], edges: [
    { sourceNodeId: 'g', targetNodeId: 'b', relationship: 'FED_FROM' }, { sourceNodeId: 'b', targetNodeId: 'a', relationship: 'FED_FROM' }, { sourceNodeId: 'b', targetNodeId: 't', relationship: 'FED_FROM' },
  ], unresolved: [] } as unknown as ElectricalMapViewResponse;
  assert.deepEqual([...confirmedElectricalMapNodeIds(view)].sort(), ['a', 'b', 'g', 'v']);
});
