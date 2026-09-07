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
  assert.equal(model.nodes.find((node) => node.id === 'asset-tbc')?.partialRoot, true);
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
  assert.ok(model.edges.some((edge) => edge.relationship === 'MEASURES'
    && edge.sourceNodeId === 'board-mssb'
    && edge.targetNodeId === 'board-mssb'), 'same-board main-supply measurement remains semantic data');
});

test('safe forest drops every cycle-member supply edge and retains downstream branches', () => {
  const input = electricalDiagramFixture();
  input.boards.find((board) => board.id === 'board-msb')!.electrical_source = {
    kind: 'BOARD', boardId: 'board-mssb',
  };
  input.boards.find((board) => board.id === 'board-mssb')!.electrical_source = {
    kind: 'BOARD', boardId: 'board-msb',
  };
  const model = buildElectricalDiagramModel(input);

  assert.ok(model.nodes.some((node) => node.id === 'board-msb'));
  assert.ok(model.nodes.some((node) => node.id === 'board-mssb'));
  assert.ok(!model.edges.some((edge) => edge.relationship === 'FED_FROM'
    && (edge.targetNodeId === 'board-msb' || edge.targetNodeId === 'board-mssb')));
  assert.ok(model.edges.some((edge) => edge.relationship === 'FED_FROM'
    && edge.sourceNodeId === 'board-mssb' && edge.targetNodeId === 'asset-pac'));
  assert.equal(model.nodes.find((node) => node.id === 'board-msb')?.partialRoot, true);
  assert.equal(model.nodes.find((node) => node.id === 'board-mssb')?.partialRoot, true);
  assert.ok(model.unresolved.some((item) => item.id === 'unresolved:supply-cycle:board-msb'));
  assert.ok(model.unresolved.some((item) => item.id === 'unresolved:supply-cycle:board-mssb'));
});

test('safe forest rejects self supply without removing the known board', () => {
  const input = electricalDiagramFixture();
  input.boards.find((board) => board.id === 'board-msb')!.electrical_source = {
    kind: 'BOARD', boardId: 'board-msb',
  };
  const model = buildElectricalDiagramModel(input);
  assert.ok(model.nodes.some((node) => node.id === 'board-msb'));
  assert.ok(!model.edges.some((edge) => edge.relationship === 'FED_FROM'
    && edge.sourceNodeId === 'board-msb' && edge.targetNodeId === 'board-msb'));
  assert.ok(model.unresolved.some((item) => item.subjectId === 'board-msb'
    && item.relation === 'SUPPLY' && item.reason === 'INVALID'));
});

test('electrical diagram keeps useful downstream components when an upstream link is unknown', () => {
  const input = electricalDiagramFixture();
  input.gridSupplies = [];
  const model = buildElectricalDiagramModel(input);

  assert.equal(model.nodes.length > 0, true);
  assert.equal(model.nodes.find((node) => node.id === 'board-msb')?.partialRoot, true);
  assert.ok(model.edges.some((edge) => edge.relationship === 'FED_FROM'
    && edge.sourceNodeId === 'board-msb' && edge.targetNodeId === 'board-mssb'));
  assert.ok(model.unresolved.some((relationship) => relationship.subjectId === 'board-msb'));
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
