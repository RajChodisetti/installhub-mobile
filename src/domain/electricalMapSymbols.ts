export const ELECTRICAL_MAP_SYMBOL_NAMES = [
  'node-grid', 'node-meter', 'node-residual',
  'board-msb', 'board-mssb', 'board-db', 'board-hvac-db', 'board-lighting-db',
  'board-pv-db', 'board-mcc', 'board-other',
  'load-pv', 'load-hvac', 'load-hvac-indoor', 'load-hvac-condenser',
  'load-lighting', 'load-ev-charger', 'load-vehicle-hoist', 'load-forklift',
  'load-exhaust-fan', 'load-power-outlet', 'load-hot-water', 'load-refrigeration',
  'load-compressed-air', 'load-other',
] as const;

export type ElectricalMapSymbolName = (typeof ELECTRICAL_MAP_SYMBOL_NAMES)[number];

export const ELECTRICAL_MAP_SYMBOL_LABELS: Readonly<Record<ElectricalMapSymbolName, string>> = {
  'node-grid': 'Incoming grid',
  'node-meter': 'Installed meter',
  'node-residual': 'Calculated residual',
  'board-msb': 'Main switchboard',
  'board-mssb': 'Sub-main switchboard',
  'board-db': 'Distribution board',
  'board-hvac-db': 'HVAC distribution board',
  'board-lighting-db': 'Lighting distribution board',
  'board-pv-db': 'Solar distribution board',
  'board-mcc': 'Motor control centre',
  'board-other': 'Switchboard',
  'load-pv': 'Solar / PV',
  'load-hvac': 'HVAC system',
  'load-hvac-indoor': 'AC indoor unit',
  'load-hvac-condenser': 'HVAC condenser',
  'load-lighting': 'Lighting',
  'load-ev-charger': 'EV charger',
  'load-vehicle-hoist': 'Vehicle hoist',
  'load-forklift': 'Forklift',
  'load-exhaust-fan': 'Exhaust / air fan',
  'load-power-outlet': 'Power outlet',
  'load-hot-water': 'Hot water / heater',
  'load-refrigeration': 'Refrigeration',
  'load-compressed-air': 'Compressed air',
  'load-other': 'Other site asset',
};

export type ElectricalMapSymbolCategory = 'grid' | 'meter' | 'residual' | 'board' | 'load';
export type ElectricalMapSymbolPrimitive =
  | { kind: 'path'; d: string; fill?: boolean; dashed?: boolean }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx?: number; fill?: boolean; dashed?: boolean }
  | { kind: 'circle'; cx: number; cy: number; r: number; fill?: boolean; dashed?: boolean }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; dashed?: boolean }
  | { kind: 'polyline'; points: string; fill?: boolean; dashed?: boolean };

export type ElectricalMapSymbolDefinition = {
  category: ElectricalMapSymbolCategory;
  accent: string;
  tint: string;
  boardCode?: string;
  primitives: readonly ElectricalMapSymbolPrimitive[];
};

const path = (d: string, options: { fill?: boolean; dashed?: boolean } = {}): ElectricalMapSymbolPrimitive => ({ kind: 'path', d, ...options });
const rect = (x: number, y: number, width: number, height: number, rx = 0, options: { fill?: boolean; dashed?: boolean } = {}): ElectricalMapSymbolPrimitive => ({ kind: 'rect', x, y, width, height, rx, ...options });
const circle = (cx: number, cy: number, r: number, options: { fill?: boolean; dashed?: boolean } = {}): ElectricalMapSymbolPrimitive => ({ kind: 'circle', cx, cy, r, ...options });
const line = (x1: number, y1: number, x2: number, y2: number, dashed = false): ElectricalMapSymbolPrimitive => ({ kind: 'line', x1, y1, x2, y2, ...(dashed ? { dashed } : {}) });
const polyline = (points: string, options: { fill?: boolean; dashed?: boolean } = {}): ElectricalMapSymbolPrimitive => ({ kind: 'polyline', points, ...options });

const GRID_TONE = { accent: '#9A551D', tint: '#FFF7ED' } as const;
const METER_TONE = { accent: '#0F766E', tint: '#ECFDF5' } as const;
const RESIDUAL_TONE = { accent: '#475569', tint: '#F8FAFC' } as const;
const BOARD_TONE = { accent: '#1D4ED8', tint: '#EFF6FF' } as const;
const LOAD_TONE = { accent: '#166534', tint: '#F0FDF4' } as const;

/** Byte-for-byte primitive geometry and palette parity with the portal registry. */
export const ELECTRICAL_MAP_SYMBOL_DEFINITIONS: Readonly<Record<ElectricalMapSymbolName, ElectricalMapSymbolDefinition>> = {
  'node-grid': { category: 'grid', ...GRID_TONE, primitives: [path('M18 52 27 12h10l9 40M23 34h18M20 43h24M27 12l-9 13h28L37 12'), path('m34 22-7 10h6l-2 9 7-11h-6l2-8Z', { fill: true }), line(14, 53, 50, 53)] },
  'node-meter': { category: 'meter', ...METER_TONE, primitives: [rect(14, 8, 36, 48, 5), rect(20, 15, 24, 12, 2, { fill: true }), line(23, 32, 41, 32), circle(23, 45, 3), circle(32, 45, 3), circle(41, 45, 3), line(23, 48, 23, 54), line(32, 48, 32, 54), line(41, 48, 41, 54)] },
  'node-residual': { category: 'residual', ...RESIDUAL_TONE, primitives: [circle(32, 32, 22, { dashed: true }), path('M13 34h8l5-14 10 27 6-15h9'), polyline('45,26 51,32 45,38')] },
  'board-msb': { category: 'board', ...BOARD_TONE, boardCode: 'MSB', primitives: [rect(23, 24, 18, 10, 2, { fill: true }), line(20, 39, 44, 39), line(23, 39, 23, 49), line(32, 39, 32, 49), line(41, 39, 41, 49)] },
  'board-mssb': { category: 'board', ...BOARD_TONE, boardCode: 'MSSB', primitives: [line(32, 23, 32, 31), line(19, 31, 45, 31), line(19, 31, 19, 39), line(32, 31, 32, 39), line(45, 31, 45, 39), rect(15, 39, 8, 8, 1), rect(28, 39, 8, 8, 1), rect(41, 39, 8, 8, 1)] },
  'board-db': { category: 'board', ...BOARD_TONE, boardCode: 'DB', primitives: [rect(17, 24, 12, 8, 1, { fill: true }), rect(35, 24, 12, 8, 1), rect(17, 37, 12, 8, 1), rect(35, 37, 12, 8, 1, { fill: true })] },
  'board-hvac-db': { category: 'board', ...BOARD_TONE, boardCode: 'HVAC', primitives: [circle(27, 35, 10), circle(27, 35, 2, { fill: true }), path('M27 33c-2-7 5-9 8-5 2 3-2 6-6 7M29 35c7-2 9 5 5 8-3 2-6-2-7-6M27 37c2 7-5 9-8 5-2-3 2-6 6-7'), rect(41, 27, 7, 7, 1), rect(41, 39, 7, 7, 1, { fill: true })] },
  'board-lighting-db': { category: 'board', ...BOARD_TONE, boardCode: 'LIGHT', primitives: [path('M25 40h14M27 45h10M24 33a8 8 0 1 1 16 0c0 4-4 5-4 7h-8c0-2-4-3-4-7Z'), line(32, 22, 32, 18), line(20, 25, 17, 22), line(44, 25, 47, 22)] },
  'board-pv-db': { category: 'board', ...BOARD_TONE, boardCode: 'PV', primitives: [circle(22, 28, 5), line(22, 19, 22, 16), line(13, 28, 10, 28), line(29, 21, 32, 18), polyline('25,37 47,37 50,49 22,49 25,37'), line(28, 37, 27, 49), line(36, 37, 36, 49), line(44, 37, 46, 49), line(24, 43, 48, 43)] },
  'board-mcc': { category: 'board', ...BOARD_TONE, boardCode: 'MCC', primitives: [circle(20, 34, 7, { fill: true }), circle(32, 34, 7), circle(44, 34, 7, { fill: true }), line(20, 41, 20, 48), line(32, 41, 32, 48), line(44, 41, 44, 48)] },
  'board-other': { category: 'board', ...BOARD_TONE, boardCode: 'SWB', primitives: [rect(17, 25, 13, 9, 1), rect(34, 25, 13, 9, 1, { fill: true }), rect(17, 38, 13, 9, 1, { fill: true }), rect(34, 38, 13, 9, 1)] },
  'load-pv': { category: 'load', ...LOAD_TONE, primitives: [circle(18, 17, 6), line(18, 7, 18, 4), line(8, 17, 5, 17), line(25, 10, 28, 7), polyline('14,30 49,30 54,51 9,51 14,30'), line(21, 30, 18, 51), line(32, 30, 32, 51), line(43, 30, 47, 51), line(11, 41, 52, 41)] },
  'load-hvac': { category: 'load', ...LOAD_TONE, primitives: [circle(32, 32, 20), circle(32, 32, 3, { fill: true }), path('M32 29c-3-12 8-15 13-8 4 6-3 10-10 11M35 32c12-3 15 8 8 13-6 4-10-3-11-10M32 35c3 12-8 15-13 8-4-6 3-10 10-11M29 32c-12 3-15-8-8-13 6-4 10 3 11 10')] },
  'load-hvac-indoor': { category: 'load', ...LOAD_TONE, primitives: [rect(8, 17, 48, 24, 5), line(14, 25, 50, 25), line(17, 32, 47, 32), path('M18 47c3-4 6-4 9 0M30 47c3-4 6-4 9 0M42 47c3-4 6-4 9 0')] },
  'load-hvac-condenser': { category: 'load', ...LOAD_TONE, primitives: [rect(9, 10, 46, 43, 4), circle(32, 31, 15), circle(32, 31, 3, { fill: true }), path('M32 28c-2-9 6-11 10-6 3 5-2 8-8 9M35 31c9-2 11 6 6 10-5 3-8-2-9-8M32 34c2 9-6 11-10 6-3-5 2-8 8-9'), line(17, 53, 17, 57), line(47, 53, 47, 57)] },
  'load-lighting': { category: 'load', ...LOAD_TONE, primitives: [path('M21 27a11 11 0 1 1 22 0c0 6-6 8-6 13H27c0-5-6-7-6-13ZM27 46h10M29 52h6'), line(32, 7, 32, 3), line(14, 13, 11, 10), line(50, 13, 53, 10), line(10, 28, 5, 28), line(54, 28, 59, 28)] },
  'load-ev-charger': { category: 'load', ...LOAD_TONE, primitives: [rect(10, 11, 29, 42, 5), rect(16, 18, 17, 10, 2, { fill: true }), path('m27 33-7 9h6l-2 7 8-10h-6l1-6Z', { fill: true }), path('M39 26h5c6 0 7 5 7 10v8M47 17v8M55 17v8M45 25h12')] },
  'load-vehicle-hoist': { category: 'load', ...LOAD_TONE, primitives: [line(13, 12, 13, 53), line(51, 12, 51, 53), line(9, 12, 17, 12), line(47, 12, 55, 12), path('M17 40h30l-3-10H22l-5 10Z', { fill: true }), circle(23, 42, 4), circle(41, 42, 4), line(13, 48, 51, 48)] },
  'load-forklift': { category: 'load', ...LOAD_TONE, primitives: [path('M10 18h21v24H10V18Zm21 11h10l7 13H31V29Z', { fill: true }), line(49, 12, 49, 43), line(49, 43, 57, 43), circle(18, 48, 6), circle(40, 48, 6), line(17, 18, 17, 10), line(17, 10, 34, 10)] },
  'load-exhaust-fan': { category: 'load', ...LOAD_TONE, primitives: [rect(8, 8, 48, 48, 5), circle(32, 32, 18), circle(32, 32, 3, { fill: true }), path('M32 29c-3-12 9-14 13-7 3 6-4 9-10 10M35 32c12-3 14 9 7 13-6 3-9-4-10-10M32 35c3 12-9 14-13 7-3-6 4-9 10-10')] },
  'load-power-outlet': { category: 'load', ...LOAD_TONE, primitives: [rect(12, 9, 40, 46, 7), line(24, 23, 24, 32), line(40, 23, 40, 32), path('M26 41h12M32 37v8'), circle(32, 41, 12)] },
  'load-hot-water': { category: 'load', ...LOAD_TONE, primitives: [rect(15, 6, 34, 51, 12), path('M32 18s9 9 9 16a9 9 0 0 1-18 0c0-7 9-16 9-16Z', { fill: true }), line(22, 11, 42, 11), line(22, 52, 42, 52)] },
  'load-refrigeration': { category: 'load', ...LOAD_TONE, primitives: [rect(14, 6, 36, 52, 5), line(14, 29, 50, 29), line(22, 16, 22, 24), line(22, 36, 22, 44), path('M38 12v12M32 15l12 6M44 15l-12 6')] },
  'load-compressed-air': { category: 'load', ...LOAD_TONE, primitives: [rect(9, 23, 46, 27, 13), circle(32, 17, 8), line(32, 17, 37, 13), line(18, 50, 18, 56), line(46, 50, 46, 56), path('M14 35h7l4-5h15l4 5h6')] },
  'load-other': { category: 'load', ...LOAD_TONE, primitives: [path('M10 54V19l20-9v44M30 27h24v27M17 25h5M17 34h5M17 43h5M38 35h8M38 44h8M7 54h50'), path('m43 13-6 9h6l-2 8 8-10h-6l0-7Z', { fill: true })] },
};

const BOARD_SYMBOL_BY_CODE: Readonly<Record<string, ElectricalMapSymbolName>> = {
  MSB: 'board-msb', MSSB: 'board-mssb', DB: 'board-db', HVAC_DB: 'board-hvac-db',
  LX_DB: 'board-lighting-db', PV_DB: 'board-pv-db', MCC: 'board-mcc', OTHER: 'board-other',
};
const LOAD_SYMBOL_BY_CODE: Readonly<Record<string, ElectricalMapSymbolName>> = {
  PV: 'load-pv', HVAC: 'load-hvac', LIGHTING: 'load-lighting', EV_CHARGER: 'load-ev-charger',
  VEHICLE_HOIST: 'load-vehicle-hoist', FORKLIFT: 'load-forklift', EXHAUST_FAN_SYSTEM: 'load-exhaust-fan',
  POWER_OUTLET: 'load-power-outlet', HEATER_GEYSER: 'load-hot-water', REFRIGERATION: 'load-refrigeration',
  COMPRESSED_AIR: 'load-compressed-air', OTHER: 'load-other',
};

const normalizedCode = (value?: string) => value?.trim().toUpperCase().replaceAll('-', '_') ?? '';
function legacyBoardSymbol(value: string): ElectricalMapSymbolName {
  if (/\bMSSB(?:[-_ ]?\d+)?\b|SUB.?MAIN/.test(value)) return 'board-mssb';
  if (/\bMSB\b|MAIN\s+SWITCHBOARD/.test(value)) return 'board-msb';
  if (/HVAC/.test(value)) return 'board-hvac-db';
  if (/LIGHT|\bLX\b/.test(value)) return 'board-lighting-db';
  if (/SOLAR|\bPV\b/.test(value)) return 'board-pv-db';
  if (/MOTOR|\bMCC\b/.test(value)) return 'board-mcc';
  if (/DISTRIBUTION|\bDB\b/.test(value)) return 'board-db';
  return 'board-other';
}
const HVAC_CONDENSER_PATTERN = /\b(?:VRV|VRF)[-_ ]?CU\b|\bCONDENS(?:ING|ER)?(?: UNIT)?\b|\bOUTDOOR(?: UNIT)?\b|\bODU\b/;
const HVAC_INDOOR_PATTERN = /\bPAC[-_ ]?\d+\b|\bINDOOR(?: UNIT)?\b|\bIDU\b|\bFAN[- ]?COIL\b|\bFCU\b|\bCASSETTE\b|\bAIR[- ]?HANDLER\b|\bAHU\b|\b(?:VRV|VRF)\b.*\bUNITS?\b/;
function hvacVariantSymbol(value: string): ElectricalMapSymbolName | null {
  if (HVAC_CONDENSER_PATTERN.test(value)) return 'load-hvac-condenser';
  if (HVAC_INDOOR_PATTERN.test(value)) return 'load-hvac-indoor';
  return null;
}
function legacyLoadSymbol(value: string): ElectricalMapSymbolName {
  if (/REFRIG|CHILL|FREEZ|COOL\s*ROOM|COLD\s*ROOM/.test(value)) return 'load-refrigeration';
  const hvac = hvacVariantSymbol(value); if (hvac) return hvac;
  if (/HVAC|AIR\s*CON|VRV|VRF|SPLIT/.test(value)) return 'load-hvac';
  if (/LIGHT/.test(value)) return 'load-lighting';
  if (/SOLAR|\bPV\b/.test(value)) return 'load-pv';
  if (/FORKLIFT|BATTER/.test(value)) return 'load-forklift';
  if (/POWER\s*OUTLET|GENERAL\s*POWER|\bGPO\b|\bSOCKET\b/.test(value)) return 'load-power-outlet';
  if (/\bEV\b|CHARG/.test(value)) return 'load-ev-charger';
  if (/EXHAUST|\bFAN\b/.test(value)) return 'load-exhaust-fan';
  if (/HOIST|VEHICLE\s*LIFT/.test(value)) return 'load-vehicle-hoist';
  if (/COMPRESS/.test(value)) return 'load-compressed-air';
  if (/HOT\s*WATER|HEATER|GEYSER/.test(value)) return 'load-hot-water';
  return 'load-other';
}

export function electricalMapSymbolForNode(node: { kind: string; typeCode?: string; typeLabel?: string; name?: string }): ElectricalMapSymbolName {
  if (node.kind === 'GRID') return 'node-grid';
  if (node.kind === 'VIRTUAL_RESIDUAL') return 'node-residual';
  const typeCode = normalizedCode(node.typeCode);
  if (node.kind === 'BOARD') return BOARD_SYMBOL_BY_CODE[typeCode]
    ?? legacyBoardSymbol(`${node.typeLabel ?? ''} ${node.name ?? ''}`.toUpperCase());
  if (node.kind === 'SITE_ASSET') {
    const semanticLabel = `${node.typeLabel ?? ''} ${node.name ?? ''}`.toUpperCase();
    if (typeCode === 'HVAC') return hvacVariantSymbol(semanticLabel) ?? 'load-hvac';
    if (typeCode === 'OTHER') return legacyLoadSymbol(semanticLabel);
    return LOAD_SYMBOL_BY_CODE[typeCode] ?? legacyLoadSymbol(semanticLabel);
  }
  return 'load-other';
}

export const electricalMapSymbolDefinition = (symbol: ElectricalMapSymbolName) => ELECTRICAL_MAP_SYMBOL_DEFINITIONS[symbol];
export const electricalMapSymbolLabel = (symbol: ElectricalMapSymbolName) => ELECTRICAL_MAP_SYMBOL_LABELS[symbol];

export const ELECTRICAL_MAP_LEGEND_SYMBOL_SIZES = {
  system: 30,
  load: 28,
  meterBadge: 17,
} as const;

export const ELECTRICAL_MAP_NODE_SYMBOLS: ReadonlyArray<{ label: string; symbol: ElectricalMapSymbolName }> = [
  { label: 'Incoming grid', symbol: 'node-grid' },
  { label: 'Switchboard', symbol: 'board-other' },
  { label: 'Installed meter', symbol: 'node-meter' },
  { label: 'Site asset', symbol: 'load-other' },
  { label: 'Calculated residual', symbol: 'node-residual' },
];

export const ELECTRICAL_MAP_LOAD_SYMBOLS: ReadonlyArray<{ code: string; label: string; symbol: ElectricalMapSymbolName }> = [
  { code: 'HVAC', label: 'HVAC (general)', symbol: 'load-hvac' },
  { code: 'HVAC_INDOOR', label: 'AC indoor unit', symbol: 'load-hvac-indoor' },
  { code: 'HVAC_CONDENSER', label: 'HVAC condenser', symbol: 'load-hvac-condenser' },
  { code: 'REFRIGERATION', label: 'Refrigeration', symbol: 'load-refrigeration' },
  { code: 'LIGHTING', label: 'Lighting', symbol: 'load-lighting' },
  { code: 'PV', label: 'Solar / PV', symbol: 'load-pv' },
  { code: 'EV_CHARGER', label: 'EV charger', symbol: 'load-ev-charger' },
  { code: 'POWER_OUTLET', label: 'Power outlet', symbol: 'load-power-outlet' },
  { code: 'FORKLIFT', label: 'Forklift', symbol: 'load-forklift' },
  { code: 'EXHAUST_FAN_SYSTEM', label: 'Exhaust / air fan', symbol: 'load-exhaust-fan' },
  { code: 'VEHICLE_HOIST', label: 'Vehicle hoist', symbol: 'load-vehicle-hoist' },
  { code: 'HEATER_GEYSER', label: 'Hot water / heater', symbol: 'load-hot-water' },
  { code: 'COMPRESSED_AIR', label: 'Compressed air', symbol: 'load-compressed-air' },
  { code: 'OTHER', label: 'Other site asset', symbol: 'load-other' },
];
