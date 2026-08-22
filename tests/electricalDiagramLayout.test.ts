import assert from 'node:assert/strict';
import test from 'node:test';
import { buildElectricalDiagramModel } from '../src/domain/electricalDiagram';
import {
  buildElectricalDiagramLayout,
  electricalDiagramOrthogonalPoints,
} from '../src/domain/electricalDiagramLayout';
import type { ElectricalDiagramModel } from '../src/domain/electricalDiagram';
import { electricalDiagramFixture } from './fixtures/electricalDiagramFixture';

function segmentIntersectsNodeInterior(
  start: { x: number; y: number },
  end: { x: number; y: number },
  node: { x: number; y: number; width: number; height: number },
): boolean {
  if (start.x === end.x) {
    return (
      start.x > node.x &&
      start.x < node.x + node.width &&
      Math.max(start.y, end.y) > node.y &&
      Math.min(start.y, end.y) < node.y + node.height
    );
  }
  if (start.y === end.y) {
    return (
      start.y > node.y &&
      start.y < node.y + node.height &&
      Math.max(start.x, end.x) > node.x &&
      Math.min(start.x, end.x) < node.x + node.width
    );
  }
  throw new Error('Expected an orthogonal connector segment.');
}

test('electrical diagram layout and connector routes are deterministic', () => {
  const model = buildElectricalDiagramModel(electricalDiagramFixture());
  const first = buildElectricalDiagramLayout(model);
  const second = buildElectricalDiagramLayout(model);

  assert.deepEqual(second, first);
  assert.ok(first.width > 0);
  assert.ok(first.height > 0);
  for (const edge of first.edges) {
    const source = first.nodes.find((node) => node.node.id === edge.sourceNodeId);
    const target = first.nodes.find((node) => node.node.id === edge.targetNodeId);
    assert.ok(source && target);
    const points = electricalDiagramOrthogonalPoints(source!, target!);
    assert.ok(points.length >= 4);
    assert.ok(points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  }
});

test('terminal load packing keeps a wide asset fan-out readable without overlaps', () => {
  const input = electricalDiagramFixture();
  const baseAsset = input.siteAssets[0]!;
  input.siteAssets = Array.from({ length: 17 }, (_, index) => ({
    ...structuredClone(baseAsset),
    id: `packed-asset-${index + 1}`,
    asset_name: `Packed HVAC ${index + 1}`,
    display_code: `E-SHOW-HVAC-${index + 1}`,
    metering_state: { kind: 'UNMETERED' as const },
  }));
  input.measurementAssignments = input.measurementAssignments.filter(
    (assignment) => assignment.target.kind !== 'SITE_ASSET',
  );
  input.virtualMeterDefinitions = [];

  const layout = buildElectricalDiagramLayout(buildElectricalDiagramModel(input));
  const packed = layout.nodes.filter((node) => node.packedTerminal);
  assert.equal(packed.length, 17);
  assert.ok(new Set(packed.map((node) => `${node.x}:${node.y}`)).size === 17);
  for (let leftIndex = 0; leftIndex < packed.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < packed.length; rightIndex += 1) {
      const left = packed[leftIndex]!;
      const right = packed[rightIndex]!;
      const overlaps =
        left.x < right.x + right.width &&
        left.x + left.width > right.x &&
        left.y < right.y + right.height &&
        left.y + left.height > right.y;
      assert.equal(overlaps, false);
    }
  }

  const secondLaneTarget = packed.find(
    (node) => node.presentationLane === 1,
  );
  assert.ok(secondLaneTarget);
  const supplyEdge = layout.edges.find(
    (edge) =>
      edge.relationship === 'FED_FROM' &&
      edge.targetNodeId === secondLaneTarget!.node.id,
  );
  assert.ok(supplyEdge);
  const source = layout.nodes.find(
    (node) => node.node.id === supplyEdge!.sourceNodeId,
  );
  assert.ok(source);
  const points = electricalDiagramOrthogonalPoints(source!, secondLaneTarget!);
  assert.equal(points.length, 5);
  const firstLane = packed.filter((node) => node.presentationLane === 0);
  const firstLaneX = Math.min(...firstLane.map((node) => node.x));
  const firstLaneRight = Math.max(
    ...firstLane.map((node) => node.x + node.width),
  );
  assert.ok(points[1]!.x > source!.x + source!.width);
  assert.ok(points[1]!.x < firstLaneX);
  assert.ok(points[3]!.x > firstLaneRight);
  for (const node of firstLane) {
    assert.ok(
      points[2]!.y < node.y || points[2]!.y > node.y + node.height,
      `deeper-lane route should stay outside ${node.node.id}`,
    );
  }

  for (const edge of layout.edges.filter(
    (candidate) => candidate.relationship === 'FED_FROM',
  )) {
    const edgeSource = layout.nodes.find(
      (node) => node.node.id === edge.sourceNodeId,
    );
    const edgeTarget = layout.nodes.find(
      (node) => node.node.id === edge.targetNodeId,
    );
    assert.ok(edgeSource && edgeTarget);
    const edgePoints = electricalDiagramOrthogonalPoints(
      edgeSource!,
      edgeTarget!,
    );
    for (let index = 1; index < edgePoints.length; index += 1) {
      const start = edgePoints[index - 1]!;
      const end = edgePoints[index]!;
      for (const obstacle of packed) {
        if (
          obstacle.node.id === edge.sourceNodeId ||
          obstacle.node.id === edge.targetNodeId
        ) {
          continue;
        }
        assert.equal(
          segmentIntersectsNodeInterior(start, end, obstacle),
          false,
          `${edge.id} should not cross ${obstacle.node.id}`,
        );
      }
    }
  }
});

test('malformed cyclic topology is broken at a stable root and remains bounded', () => {
  const model: ElectricalDiagramModel = {
    installationId: 'cycle-installation',
    siteName: 'Cycle test',
    treeRevision: 1,
    nodes: ['a', 'b', 'c'].map((id) => ({
      id,
      kind: 'BOARD' as const,
      name: `Board ${id}`,
      displayCode: id.toUpperCase(),
      typeLabel: 'Switchboard',
      zoneName: 'Test',
      devices: [],
    })),
    edges: [
      { id: 'a-b', sourceNodeId: 'a', targetNodeId: 'b', relationship: 'FED_FROM' },
      { id: 'b-a', sourceNodeId: 'b', targetNodeId: 'a', relationship: 'FED_FROM' },
      { id: 'b-c', sourceNodeId: 'b', targetNodeId: 'c', relationship: 'FED_FROM' },
    ],
    unresolved: [],
  };

  const layout = buildElectricalDiagramLayout(model);
  assert.equal(layout.nodes.length, 3);
  assert.ok(layout.width < 5_000);
  assert.ok(layout.height < 5_000);
  assert.equal(layout.nodes.filter((node) => !node.parentId).length, 1);
  assert.deepEqual(
    buildElectricalDiagramLayout(model).nodes.map((node) => node.parentId),
    layout.nodes.map((node) => node.parentId),
  );
});

test('canvas bounds include self-loop and backwards measurement routes', () => {
  const model: ElectricalDiagramModel = {
    installationId: 'route-bounds-installation',
    siteName: 'Route bounds',
    treeRevision: 1,
    nodes: [
      {
        id: 'grid',
        kind: 'GRID',
        name: 'Incoming grid',
        typeLabel: 'Incoming grid',
        zoneName: 'Site-wide',
        devices: [],
      },
      {
        id: 'leaf-board',
        kind: 'BOARD',
        name: 'Leaf board',
        typeLabel: 'Switchboard',
        zoneName: 'Plant',
        devices: [],
      },
    ],
    edges: [
      {
        id: 'supply',
        sourceNodeId: 'grid',
        targetNodeId: 'leaf-board',
        relationship: 'FED_FROM',
      },
      {
        id: 'self-measurement',
        sourceNodeId: 'leaf-board',
        targetNodeId: 'leaf-board',
        relationship: 'MEASURES',
      },
      {
        id: 'backwards-measurement',
        sourceNodeId: 'leaf-board',
        targetNodeId: 'grid',
        relationship: 'MEASURES',
      },
    ],
    unresolved: [],
  };

  const layout = buildElectricalDiagramLayout(model);
  for (const [edgeIndex, edge] of layout.edges.entries()) {
    const source = layout.nodes.find((node) => node.node.id === edge.sourceNodeId);
    const target = layout.nodes.find((node) => node.node.id === edge.targetNodeId);
    assert.ok(source && target);
    const offset = edge.relationship === 'MEASURES'
      ? ((edgeIndex % 5) - 2) * 4
      : 0;
    const points = electricalDiagramOrthogonalPoints(source!, target!, {
      sourceYOffset: offset,
      targetYOffset: offset,
      trunkRatio: edge.relationship === 'MEASURES' ? 0.62 : 0.46,
    });
    assert.ok(
      points.every(
        (point) =>
          point.x >= 0 &&
          point.x <= layout.width &&
          point.y >= 0 &&
          point.y <= layout.height,
      ),
      `${edge.id} must stay within the diagram canvas`,
    );
  }
});

test('a 250-load installation produces finite bounded geometry', () => {
  const input = electricalDiagramFixture();
  const baseAsset = input.siteAssets[0]!;
  input.siteAssets = Array.from({ length: 250 }, (_, index) => ({
    ...structuredClone(baseAsset),
    id: `large-asset-${index + 1}`,
    asset_name: `Large load ${index + 1}`,
    display_code: `LOAD-${index + 1}`,
    metering_state: { kind: 'UNMETERED' as const },
  }));
  input.measurementAssignments = input.measurementAssignments.filter(
    (assignment) => assignment.target.kind !== 'SITE_ASSET',
  );
  input.virtualMeterDefinitions = [];

  const layout = buildElectricalDiagramLayout(buildElectricalDiagramModel(input));
  assert.equal(layout.nodes.filter((node) => node.node.kind === 'SITE_ASSET').length, 250);
  assert.ok(Number.isFinite(layout.width) && layout.width < 20_000);
  assert.ok(Number.isFinite(layout.height) && layout.height < 20_000);
  assert.ok(layout.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y)));
});
