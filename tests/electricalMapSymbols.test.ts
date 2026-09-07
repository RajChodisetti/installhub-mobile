import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ELECTRICAL_MAP_LEGEND_SYMBOL_SIZES,
  ELECTRICAL_MAP_LOAD_SYMBOLS,
  ELECTRICAL_MAP_NODE_SYMBOLS,
  ELECTRICAL_MAP_SYMBOL_DEFINITIONS,
  ELECTRICAL_MAP_SYMBOL_LABELS,
  ELECTRICAL_MAP_SYMBOL_NAMES,
  electricalMapSymbolDefinition,
  electricalMapSymbolForNode,
  electricalMapSymbolLabel,
} from '../src/domain/electricalMapSymbols';

test('all canonical board and load codes use the same symbols as the portal', () => {
  const boards = {
    MSB: 'board-msb', MSSB: 'board-mssb', DB: 'board-db', HVAC_DB: 'board-hvac-db',
    LX_DB: 'board-lighting-db', PV_DB: 'board-pv-db', MCC: 'board-mcc', OTHER: 'board-other',
  } as const;
  const loads = {
    PV: 'load-pv', HVAC: 'load-hvac', LIGHTING: 'load-lighting', EV_CHARGER: 'load-ev-charger',
    VEHICLE_HOIST: 'load-vehicle-hoist', FORKLIFT: 'load-forklift', EXHAUST_FAN_SYSTEM: 'load-exhaust-fan',
    POWER_OUTLET: 'load-power-outlet', HEATER_GEYSER: 'load-hot-water', REFRIGERATION: 'load-refrigeration',
    COMPRESSED_AIR: 'load-compressed-air', OTHER: 'load-other',
  } as const;

  for (const [typeCode, expected] of Object.entries(boards)) {
    assert.equal(electricalMapSymbolForNode({ kind: 'BOARD', typeCode }), expected);
  }
  for (const [typeCode, expected] of Object.entries(loads)) {
    assert.equal(electricalMapSymbolForNode({ kind: 'SITE_ASSET', typeCode }), expected);
  }
});

test('the complete 25-symbol portal registry has unique vector artwork and labels', () => {
  assert.equal(ELECTRICAL_MAP_SYMBOL_NAMES.length, 25);
  assert.equal(ELECTRICAL_MAP_NODE_SYMBOLS.length, 5);
  assert.equal(ELECTRICAL_MAP_LOAD_SYMBOLS.length, 14);
  assert.equal(new Set(ELECTRICAL_MAP_LOAD_SYMBOLS.map((item) => item.symbol)).size, 14);
  assert.deepEqual(Object.keys(ELECTRICAL_MAP_SYMBOL_DEFINITIONS).sort(), [...ELECTRICAL_MAP_SYMBOL_NAMES].sort());
  assert.deepEqual(Object.keys(ELECTRICAL_MAP_SYMBOL_LABELS).sort(), [...ELECTRICAL_MAP_SYMBOL_NAMES].sort());

  const signatures = new Set<string>();
  for (const symbol of ELECTRICAL_MAP_SYMBOL_NAMES) {
    const definition = electricalMapSymbolDefinition(symbol);
    assert.ok(definition.primitives.length > 0);
    assert.match(definition.accent, /^#[0-9A-F]{6}$/i);
    assert.match(definition.tint, /^#[0-9A-F]{6}$/i);
    assert.ok(electricalMapSymbolLabel(symbol).trim().length >= 4);
    const signature = JSON.stringify([definition.category, definition.boardCode, definition.primitives]);
    assert.equal(signatures.has(signature), false, `${symbol} must keep distinct artwork`);
    signatures.add(signature);
  }

  assert.deepEqual(ELECTRICAL_MAP_LEGEND_SYMBOL_SIZES, { system: 30, load: 28, meterBadge: 17 });
});

test('legacy names and HVAC variants retain portal-compatible symbol selection', () => {
  assert.equal(electricalMapSymbolForNode({ kind: 'SITE_ASSET', typeLabel: 'Commercial refrigeration' }), 'load-refrigeration');
  assert.equal(electricalMapSymbolForNode({ kind: 'SITE_ASSET', typeLabel: 'HVAC packaged unit' }), 'load-hvac');
  assert.equal(electricalMapSymbolForNode({ kind: 'SITE_ASSET', typeLabel: 'General power outlet' }), 'load-power-outlet');
  assert.equal(electricalMapSymbolForNode({ kind: 'SITE_ASSET', typeCode: 'HVAC', name: 'PAC-10' }), 'load-hvac-indoor');
  assert.equal(electricalMapSymbolForNode({ kind: 'SITE_ASSET', typeCode: 'HVAC', name: 'VRV-CU' }), 'load-hvac-condenser');
  assert.equal(electricalMapSymbolForNode({ kind: 'SITE_ASSET', typeCode: 'OTHER', name: 'Blast freezer' }), 'load-refrigeration');
  assert.equal(electricalMapSymbolForNode({ kind: 'BOARD', name: 'MSSB1 Main Switchboard' }), 'board-mssb');
});
