import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildElectricalDiagramModel,
  electricalDiagramSearchText,
} from '../src/domain/electricalDiagram';
import { electricalDiagramFixture } from './fixtures/electricalDiagramFixture';

test('electrical diagram keeps confirmed supply and measurement semantics separate', () => {
  const model = buildElectricalDiagramModel(electricalDiagramFixture());

  assert.ok(model.nodes.some((node) => node.id === 'grid-1'));
  assert.ok(model.nodes.some((node) => node.id === 'board-mssb'));
  assert.ok(!model.nodes.some((node) => node.id === 'asset-tbc'));
  assert.ok(
    model.edges.some(
      (edge) =>
        edge.relationship === 'FED_FROM' &&
        edge.sourceNodeId === 'board-mssb' &&
        edge.targetNodeId === 'asset-pac',
    ),
  );
  assert.ok(
    model.edges.some(
      (edge) =>
        edge.relationship === 'MEASURES' &&
        edge.sourceNodeId === 'board-mssb' &&
        edge.targetNodeId === 'asset-pac' &&
        edge.channelOrdinals?.join(',') === '4',
    ),
  );
});

test('direct asset measurement requires the device on the immediate supply board', () => {
  const model = buildElectricalDiagramModel(electricalDiagramFixture());
  const direct = model.nodes.find((node) => node.id === 'asset-pac');
  const invalid = model.nodes.find((node) => node.id === 'asset-invalid');

  assert.equal(direct?.coverageState, 'DIRECT');
  assert.equal(invalid?.coverageState, 'INVALID');
  assert.ok(
    !model.edges.some(
      (edge) =>
        edge.relationship === 'MEASURES' &&
        edge.targetNodeId === 'asset-invalid',
    ),
  );
  assert.ok(
    model.unresolved.some(
      (relationship) =>
        relationship.subjectId === 'assignment-wrong-board' &&
        relationship.reason === 'INVALID',
    ),
  );
});

test('diagram exposes exact device, channel, load and residual data for search and display', () => {
  const model = buildElectricalDiagramModel(electricalDiagramFixture());
  const board = model.nodes.find((node) => node.id === 'board-mssb');
  const virtualAsset = model.nodes.find((node) => node.id === 'asset-lighting');

  assert.equal(board?.devices[0]?.name, 'Essendon HVAC Meter');
  assert.equal(board?.devices[0]?.serialNumber, 'DD83710147339');
  assert.equal(board?.devices[0]?.channels[1]?.loadLabel, 'AC / HVAC');
  assert.equal(board?.devices[0]?.channels[1]?.description, 'PAC 1 compressor');
  assert.ok(electricalDiagramSearchText(board!).includes('pac 1 compressor'));
  assert.ok(electricalDiagramSearchText(board!).includes('dd83710147339'));
  assert.equal(virtualAsset?.coverageState, 'VIRTUAL');
  assert.ok(
    model.edges.some(
      (edge) => edge.relationship === 'CALCULATED_RESIDUAL',
    ),
  );
});

test('diagram rejects a stale residual whose authoritative total no longer exists', () => {
  const input = electricalDiagramFixture();
  input.measurementAssignments = input.measurementAssignments.filter(
    (assignment) => assignment.id !== 'assignment-mssb-total',
  );

  const model = buildElectricalDiagramModel(input);
  assert.equal(
    model.nodes.find((node) => node.id === 'asset-lighting')?.coverageState,
    'UNMETERED',
  );
  assert.equal(
    model.nodes.some((node) => node.kind === 'VIRTUAL_RESIDUAL'),
    false,
  );
  assert.equal(
    model.edges.some((edge) => edge.relationship === 'CALCULATED_RESIDUAL'),
    false,
  );
});
