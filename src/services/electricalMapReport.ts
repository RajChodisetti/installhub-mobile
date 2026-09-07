import type { InstallationReportDetailMode } from '../types';
import type {
  ElectricalDiagramEdge,
  ElectricalDiagramModel,
  ElectricalDiagramNode,
} from '../domain/electricalDiagram';
import { electricalDiagramMeasurementDeviceLabel } from '../domain/electricalDiagram';
import {
  buildElectricalDiagramLayout,
  electricalDiagramOrthogonalPoints,
  type ElectricalDiagramLayout,
  type ElectricalDiagramLayoutNode,
} from '../domain/electricalDiagramLayout';
import {
  ELECTRICAL_MAP_LOAD_SYMBOLS,
  ELECTRICAL_MAP_NODE_SYMBOLS,
  electricalMapSymbolDefinition,
  electricalMapSymbolForNode,
  type ElectricalMapSymbolName,
  type ElectricalMapSymbolPrimitive,
} from '../domain/electricalMapSymbols';
import {
  electricalMapBoardChannelLayout,
  type ElectricalMapBoardChannel,
} from '../domain/electricalMapBoardChannels';

export const ELECTRICAL_REPORT_WINDOW_WIDTH = 1080;
export const ELECTRICAL_REPORT_WINDOW_HEIGHT = 720;
export const ELECTRICAL_REPORT_WINDOW_OVERLAP = 120;
export const ELECTRICAL_REPORT_MAX_DETAIL_WINDOWS = 24;

export interface ElectricalReportWindow {
  x: number;
  y: number;
  width: number;
  height: number;
  row: number;
  column: number;
  rowCount: number;
  columnCount: number;
}

const COVERAGE_LABELS = {
  DIRECT: 'Direct',
  VIRTUAL: 'Virtual',
  UNMETERED: 'Unmetered',
  TBC: 'TBC',
  INVALID: 'Issue',
} as const;

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function escapeElectricalReportHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function truncate(value: string, length: number): string {
  const clean = value.trim();
  return clean.length <= length ? clean : `${clean.slice(0, Math.max(1, length - 3))}...`;
}

function symbolPrimitiveSvg(primitive: ElectricalMapSymbolPrimitive, accent: string): string {
  const filled = 'fill' in primitive && primitive.fill;
  const presentation = `fill="${filled ? accent : 'none'}"${filled ? ' fill-opacity="0.14"' : ''} stroke="${accent}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"${primitive.dashed ? ' stroke-dasharray="4 3"' : ''}`;
  if (primitive.kind === 'path') return `<path d="${primitive.d}" ${presentation}/>`;
  if (primitive.kind === 'rect') return `<rect x="${primitive.x}" y="${primitive.y}" width="${primitive.width}" height="${primitive.height}" rx="${primitive.rx ?? 0}" ${presentation}/>`;
  if (primitive.kind === 'circle') return `<circle cx="${primitive.cx}" cy="${primitive.cy}" r="${primitive.r}" ${presentation}/>`;
  if (primitive.kind === 'line') return `<line x1="${primitive.x1}" y1="${primitive.y1}" x2="${primitive.x2}" y2="${primitive.y2}" ${presentation}/>`;
  return `<polyline points="${primitive.points}" ${presentation}/>`;
}

function boardChannelsSvg(channels: readonly ElectricalMapBoardChannel[], accent: string): string {
  const layout = electricalMapBoardChannelLayout(channels);
  const twoColumns = layout.some((item) => item.portSide === 'left');
  return layout.map((item) => `<g data-channel-id="${escapeXml(item.channel.id)}"><rect x="${item.x}" y="${item.y}" width="${item.columnWidth}" height="${item.cellHeight}" rx="1.2" fill="${item.state === 'assigned' ? accent : '#FFFFFF'}" fill-opacity="${item.state === 'assigned' ? 0.17 : 0.92}" stroke="${accent}" stroke-width="0.9"${item.state === 'spare' ? ' stroke-dasharray="2 1.5"' : ''}/>${svgText(item.label, item.x + 2, item.y + item.cellHeight / 2 + 1.15, { size: twoColumns ? 2.45 : 3.05, color: accent, weight: 800 })}<circle cx="${item.portX}" cy="${item.portY}" r="1.65" fill="${item.state === 'spare' ? '#FFFFFF' : accent}" stroke="${accent}" stroke-width="0.9"/></g>`).join('');
}

function svgSchematicSymbol(
  name: ElectricalMapSymbolName,
  x: number,
  y: number,
  size: number,
  channels: readonly ElectricalMapBoardChannel[] = [],
): string {
  const definition = electricalMapSymbolDefinition(name);
  const scale = size / 64;
  const body = definition.category === 'board'
    ? `<rect x="9" y="7" width="46" height="50" rx="4" fill="#FFFFFF" fill-opacity="0.94" stroke="${definition.accent}" stroke-width="2.4"/><path d="M9 18h46" fill="none" stroke="${definition.accent}" stroke-width="1.4"/><circle cx="49" cy="12.5" r="1.7" fill="${definition.accent}" opacity="0.88"/>${svgText(definition.boardCode ?? 'SWB', 14, 14.8, { size: 5.2, color: definition.accent, weight: 900, letterSpacing: 0.18 })}${channels.length ? boardChannelsSvg(channels, definition.accent) : ['L1', 'L2', 'L3'].map((phase, index) => { const railY = 27 + index * 10; return `${svgText(phase, 14, railY + 1.7, { size: 4.4, color: definition.accent, weight: 900 })}<line x1="23" y1="${railY}" x2="50" y2="${railY}" stroke="${definition.accent}" stroke-width="1.4"/><rect x="31" y="${railY - 3}" width="8" height="6" rx="1.2" fill="#DBEAFE" stroke="${definition.accent}" stroke-width="0.9"/><circle cx="51" cy="${railY}" r="1.6" fill="${definition.accent}"/>`; }).join('')}`
    : definition.primitives.map((primitive) => symbolPrimitiveSvg(primitive, definition.accent)).join('');
  return `<g data-electrical-map-symbol="${name}" transform="translate(${x} ${y}) scale(${scale})"><rect x="3" y="3" width="58" height="58" rx="15" fill="${definition.tint}"/>${body}</g>`;
}

function nodeSymbolChannels(node: ElectricalDiagramNode, model: ElectricalDiagramModel): ElectricalMapBoardChannel[] {
  return node.devices.flatMap((device) => device.channels.map((channel) => ({
    id: channel.id,
    ordinal: channel.ordinal,
    meterLabel: device.name,
    purpose: channel.purpose,
    assigned: model.edges.some((edge) => edge.relationship === 'MEASURES'
      && edge.meterId === device.id && edge.channelOrdinals?.includes(channel.ordinal)),
  })));
}

function compactChannelLabel(ordinals: number[]): string {
  if (!ordinals.length) return 'No active channels';
  const sorted = [...new Set(ordinals)].sort((left, right) => left - right);
  const ranges: string[] = [];
  let start = sorted[0];
  let end = sorted[0];
  for (const ordinal of sorted.slice(1)) {
    if (ordinal === end + 1) {
      end = ordinal;
      continue;
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    start = ordinal;
    end = ordinal;
  }
  ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return `Ch ${ranges.join(', ')}`;
}

function svgText(
  value: string,
  x: number,
  y: number,
  options: {
    size?: number;
    color?: string;
    weight?: number;
    letterSpacing?: number;
    anchor?: 'start' | 'middle' | 'end';
  } = {},
): string {
  return `<text x="${x}" y="${y}" fill="${options.color ?? '#0F172A'}" font-family="-apple-system,BlinkMacSystemFont,Helvetica Neue,Arial,sans-serif" font-size="${options.size ?? 10}" font-weight="${options.weight ?? 500}"${options.letterSpacing ? ` letter-spacing="${options.letterSpacing}"` : ''}${options.anchor ? ` text-anchor="${options.anchor}"` : ''}>${escapeXml(value)}</text>`;
}

function coveragePresentation(coverage?: ElectricalDiagramNode['coverageState']): {
  label: string;
  fill: string;
  text: string;
} | null {
  if (!coverage) return null;
  if (coverage === 'DIRECT') return { label: 'DIRECT', fill: '#DCFCE7', text: '#166534' };
  if (coverage === 'VIRTUAL') return { label: 'VIRTUAL', fill: '#DBEAFE', text: '#1D4ED8' };
  if (coverage === 'INVALID') return { label: 'ISSUE', fill: '#FEE2E2', text: '#B91C1C' };
  if (coverage === 'TBC') return { label: 'TBC', fill: '#FEF3C7', text: '#92400E' };
  return { label: 'UNMETERED', fill: '#FEF3C7', text: '#92400E' };
}

function renderNode(item: ElectricalDiagramLayoutNode, model: ElectricalDiagramModel): string {
  const { node, x, y, width, height } = item;
  const board = node.kind === 'BOARD';
  const asset = node.kind === 'SITE_ASSET';
  const fill = board ? '#EEF2FF' : asset ? '#ECFDF5' : '#FFFFFF';
  const stroke = board ? '#2563EB' : asset ? '#2F855A' : '#64748B';
  const symbol = electricalMapSymbolForNode(node);
  const branchRoot = node.kind !== 'GRID' && !item.parentId;
  const coverage = coveragePresentation(node.coverageState);
  const title = node.displayCode || node.name;
  const kindLabel = node.kind === 'GRID'
    ? 'INCOMING GRID'
    : node.kind === 'BOARD'
      ? 'SWITCHBOARD'
      : node.kind === 'SITE_ASSET'
        ? 'SITE ASSET'
        : 'VIRTUAL RESIDUAL';
  const parts = [
    `<g data-node-id="${escapeXml(node.id)}">`,
    `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="11" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`,
    svgSchematicSymbol(symbol, x + 9, y + 8, 34, board ? nodeSymbolChannels(node, model) : []),
    svgText(kindLabel, x + 48, y + 20, { size: 8, color: '#64748B', weight: 800, letterSpacing: 0.8 }),
  ];
  if (coverage) {
    const pillWidth = Math.max(38, coverage.label.length * 5.6 + 12);
    parts.push(
      `<rect x="${x + width - pillWidth - 9}" y="${y + 9}" width="${pillWidth}" height="18" rx="9" fill="${coverage.fill}"/>`,
      svgText(coverage.label, x + width - pillWidth / 2 - 9, y + 21, { size: 7, color: coverage.text, weight: 800, anchor: 'middle' }),
    );
  }
  parts.push(
    svgText(truncate(title, board ? 31 : 24), x + 12, y + 57, { size: board ? 11 : 10.5, weight: 800 }),
  );
  if (node.displayCode && node.name !== node.displayCode) {
    parts.push(svgText(truncate(node.name, board ? 35 : 25), x + 12, y + 73, { size: 8.5, color: '#475569', weight: 600 }));
  }
  if (branchRoot) {
    parts.push(svgText('Branch root — upstream not shown', x + 12, y + (node.displayCode ? 84 : 70), { size: 7, color: '#92400E', weight: 750 }));
  }
  if (board) {
    let moduleY = y + (branchRoot ? 94 : 84);
    for (const device of node.devices.slice(0, 3)) {
      const activeChannels = device.channels
        .filter((channel) => channel.purpose !== 'SPARE')
        .map((channel) => channel.ordinal);
      parts.push(
        `<rect x="${x + 10}" y="${moduleY}" width="${width - 20}" height="34" rx="7" fill="#FFFFFF" stroke="#86EFAC"/>`,
        svgSchematicSymbol('node-meter', x + 14, moduleY + 4, 22),
        svgText(truncate(device.name, 29), x + 36, moduleY + 13, { size: 8, weight: 750 }),
        svgText(truncate(`${compactChannelLabel(activeChannels)}${device.serialNumber && device.serialNumber !== device.name ? ` - ${device.serialNumber}` : ''}`, 40), x + 36, moduleY + 26, { size: 7, color: '#64748B', weight: 500 }),
      );
      moduleY += 38;
    }
    if (!node.devices.length) {
      parts.push(svgText('No installed meter', x + 12, y + 96, { size: 8, color: '#64748B' }));
    } else if (node.devices.length > 3) {
      parts.push(svgText(`+${node.devices.length - 3} more devices`, x + 12, y + height - 10, { size: 7.5, color: '#64748B' }));
    }
  } else {
    parts.push(svgText(truncate(`${node.typeLabel} - ${node.zoneName}`, 34), x + 12, y + (branchRoot ? 101 : node.displayCode ? 91 : 76), { size: 8, color: '#64748B' }));
  }
  parts.push('</g>');
  return parts.join('');
}

function renderEdge(
  edge: ElectricalDiagramEdge,
  layoutById: Map<string, ElectricalDiagramLayoutNode>,
  edgeIndex: number,
): string {
  const source = layoutById.get(edge.sourceNodeId);
  const target = layoutById.get(edge.targetNodeId);
  if (!source || !target) return '';
  if (edge.relationship === 'MEASURES' && edge.sourceNodeId === edge.targetNodeId) return '';
  const offset = edge.relationship === 'MEASURES' ? ((edgeIndex % 5) - 2) * 4 : 0;
  const points = electricalDiagramOrthogonalPoints(source, target, {
    sourceYOffset: offset,
    targetYOffset: offset,
    trunkRatio: edge.relationship === 'MEASURES' ? 0.62 : 0.46,
  }).map((point) => `${point.x},${point.y}`).join(' ');
  const measurement = edge.relationship === 'MEASURES';
  const residual = edge.relationship === 'CALCULATED_RESIDUAL';
  return `<polyline data-edge-id="${escapeXml(edge.id)}" points="${points}" fill="none" stroke="${measurement ? '#2459C4' : residual ? '#64748B' : '#A46124'}" stroke-width="${measurement ? 2.2 : 2.4}"${measurement ? ' stroke-dasharray="8 6"' : residual ? ' stroke-dasharray="2 5"' : ''} stroke-linecap="round" stroke-linejoin="round"/>`;
}

export function renderElectricalDiagramSvg(
  model: ElectricalDiagramModel,
  options: { window?: ElectricalReportWindow; includeTitle?: boolean } = {},
): string {
  const layout = buildElectricalDiagramLayout(model);
  if (!layout.nodes.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(model.siteName)} electrical single-line diagram" viewBox="0 0 1080 520" preserveAspectRatio="xMidYMid meet"><rect width="1080" height="520" fill="#FFFFFF"/><rect x="160" y="130" width="760" height="240" rx="22" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="2" stroke-dasharray="8 7"/>${svgSchematicSymbol('board-other', 496, 168, 88)}${svgText('No electrical items', 540, 292, { size: 24, color: '#0E2240', weight: 850, anchor: 'middle' })}${svgText('Add or import an electrical item to build the diagram.', 540, 328, { size: 13, color: '#64748B', weight: 500, anchor: 'middle' })}</svg>`;
  }
  const window = options.window ?? {
    x: 0,
    y: 0,
    width: layout.width,
    height: layout.height,
    row: 0,
    column: 0,
    rowCount: 1,
    columnCount: 1,
  };
  const layoutById = new Map(layout.nodes.map((item) => [item.node.id, item]));
  const titleHeight = options.includeTitle === false ? 0 : 40;
  const body = [
    ...layout.edges.map((edge, index) => renderEdge(edge, layoutById, index)),
    ...layout.nodes.map((item) => renderNode(item, model)),
  ].join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(model.siteName)} electrical single-line diagram" viewBox="${window.x} ${window.y - titleHeight} ${window.width} ${window.height + titleHeight}" preserveAspectRatio="xMidYMid meet"><rect x="${window.x}" y="${window.y - titleHeight}" width="${window.width}" height="${window.height + titleHeight}" fill="#FFFFFF"/>${options.includeTitle === false ? '' : `${svgText(model.siteName, 8, 18, { size: 15, color: '#0E2240', weight: 850 })}${svgText('Electrical supply, metering and connected loads', 8, 34, { size: 8, color: '#64748B', weight: 500 })}`}${body}</svg>`;
}

export function planElectricalReportWindows(
  layout: ElectricalDiagramLayout,
): ElectricalReportWindow[] {
  if (
    layout.width <= ELECTRICAL_REPORT_WINDOW_WIDTH &&
    layout.height <= ELECTRICAL_REPORT_WINDOW_HEIGHT
  ) {
    return [];
  }
  const stepX = ELECTRICAL_REPORT_WINDOW_WIDTH - ELECTRICAL_REPORT_WINDOW_OVERLAP;
  const stepY = ELECTRICAL_REPORT_WINDOW_HEIGHT - ELECTRICAL_REPORT_WINDOW_OVERLAP;
  const columnCount = Math.max(1, Math.ceil((layout.width - ELECTRICAL_REPORT_WINDOW_OVERLAP) / stepX));
  const rowCount = Math.max(1, Math.ceil((layout.height - ELECTRICAL_REPORT_WINDOW_OVERLAP) / stepY));
  const windows: ElectricalReportWindow[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    for (let column = 0; column < columnCount; column += 1) {
      if (windows.length >= ELECTRICAL_REPORT_MAX_DETAIL_WINDOWS) return windows;
      const x = Math.min(column * stepX, Math.max(0, layout.width - ELECTRICAL_REPORT_WINDOW_WIDTH));
      const y = Math.min(row * stepY, Math.max(0, layout.height - ELECTRICAL_REPORT_WINDOW_HEIGHT));
      windows.push({
        x,
        y,
        width: Math.min(ELECTRICAL_REPORT_WINDOW_WIDTH, layout.width),
        height: Math.min(ELECTRICAL_REPORT_WINDOW_HEIGHT, layout.height),
        row,
        column,
        rowCount,
        columnCount,
      });
    }
  }
  return windows;
}

function legendSymbol(symbol: ElectricalMapSymbolName, label: string): string {
  return `<span class="legend-symbol"><svg viewBox="0 0 64 64">${svgSchematicSymbol(symbol, 0, 0, 64)}</svg>${escapeElectricalReportHtml(label)}</span>`;
}

function legendHtml(): string {
  return `<div class="electrical-legend">
    <div class="legend-group"><strong>Node symbols</strong>${ELECTRICAL_MAP_NODE_SYMBOLS.map((item) => legendSymbol(item.symbol, item.label)).join('')}</div>
    <div class="legend-group"><strong>Load symbols</strong>${ELECTRICAL_MAP_LOAD_SYMBOLS.map((item) => legendSymbol(item.symbol, item.label)).join('')}</div>
    <div class="legend-group connections"><strong>Connections</strong><span><i class="line supply"></i>Supply - confirmed FED_FROM cable path</span><span><i class="line measures"></i>Measures - confirmed channels; never changes supply</span><span><i class="line residual"></i>Residual - calculation, not a physical cable</span></div>
    <div class="legend-group"><strong>Partial map</strong><span>Branch root — upstream not shown</span><span>Known record retained without inventing a supply link</span></div>
    <div class="legend-group coverage-group"><strong>Coverage</strong><span class="coverage direct">DIRECT</span><span class="coverage virtual">VIRTUAL</span><span class="coverage unmetered">UNMETERED</span><span class="coverage tbc">TBC</span><span class="coverage issue">ISSUE</span></div>
  </div>`;
}

function nodeMeasurementDetails(
  node: ElectricalDiagramNode,
  model: ElectricalDiagramModel,
): string[] {
  const nodeById = new Map(model.nodes.map((candidate) => [candidate.id, candidate]));
  const name = (id: string) => {
    const candidate = nodeById.get(id);
    return candidate?.displayCode || candidate?.name || id;
  };
  const incoming = model.edges
    .filter((edge) => edge.relationship === 'MEASURES' && edge.targetNodeId === node.id)
    .map((edge) => `Measured by ${electricalDiagramMeasurementDeviceLabel(model, edge)} on ${name(edge.sourceNodeId)} - ${compactChannelLabel(edge.channelOrdinals ?? [])} - ${(edge.phaseMode ?? '').replaceAll('_', ' ').toLocaleLowerCase()} - ${(edge.direction ?? '').toLocaleLowerCase()}`);
  const outgoing = model.edges
    .filter((edge) => edge.relationship === 'MEASURES' && edge.sourceNodeId === node.id)
    .map((edge) => `Measures ${name(edge.targetNodeId)} via ${electricalDiagramMeasurementDeviceLabel(model, edge)} - ${compactChannelLabel(edge.channelOrdinals ?? [])}`);
  return [...incoming, ...outgoing];
}

function detailRowHtml(
  node: ElectricalDiagramNode,
  model: ElectricalDiagramModel,
  depth = 0,
  rootLabel?: string,
): string {
  const devices = node.devices.flatMap((device) => {
    const channels = device.channels.map((channel) => `Ch ${channel.ordinal} (${channel.loadLabel || channel.purpose.replaceAll('_', ' ').toLocaleLowerCase()}${channel.description ? ` - ${channel.description}` : ''}${channel.sensorRating ? ` - ${channel.sensorRating}` : ''})`).join(', ');
    return [`Installed device: ${device.name} - ${device.model}${device.serialNumber ? ` - serial ${device.serialNumber}` : ''}${device.deviceNumber ? ` - device ${device.deviceNumber}` : ''}${channels ? ` - ${channels}` : ''}`];
  });
  const detail = [
    node.typeLabel,
    rootLabel,
    node.zoneName ? `Physical zone: ${node.zoneName}${node.zoneCode ? ` (${node.zoneCode})` : ''}` : '',
    node.coverageState ? `Coverage: ${COVERAGE_LABELS[node.coverageState]}` : '',
    ...devices,
    ...nodeMeasurementDetails(node, model),
  ].filter(Boolean);
  const symbol = electricalMapSymbolForNode(node);
  return `<div class="electrical-detail-row" style="--depth:${Math.min(depth, 8)}"><div class="electrical-detail-name"><span class="detail-icon"><svg viewBox="0 0 64 64">${svgSchematicSymbol(symbol, 0, 0, 64)}</svg></span><span><strong>${escapeElectricalReportHtml(node.displayCode || node.name)}</strong>${node.displayCode && node.name !== node.displayCode ? `<small>${escapeElectricalReportHtml(node.name)}</small>` : ''}</span></div><div class="electrical-detail-copy">${detail.map((line) => `<span>${escapeElectricalReportHtml(line)}</span>`).join('')}</div></div>`;
}

function hierarchyDetailsHtml(model: ElectricalDiagramModel): string {
  const layout = buildElectricalDiagramLayout(model);
  const childrenById = new Map<string, ElectricalDiagramLayoutNode[]>();
  for (const item of layout.nodes) {
    if (!item.parentId) continue;
    const children = childrenById.get(item.parentId) ?? [];
    children.push(item);
    childrenById.set(item.parentId, children);
  }
  for (const children of childrenById.values()) {
    children.sort((left, right) => left.y - right.y || left.node.id.localeCompare(right.node.id));
  }
  const rows: string[] = [];
  const emitted = new Set<string>();
  const walk = (item: ElectricalDiagramLayoutNode, depth: number) => {
    if (emitted.has(item.node.id)) return;
    emitted.add(item.node.id);
    rows.push(detailRowHtml(
      item.node,
      model,
      depth,
      !item.parentId
        ? item.node.kind === 'GRID' ? 'Grid root' : 'Branch root — upstream not shown'
        : undefined,
    ));
    for (const child of childrenById.get(item.node.id) ?? []) walk(child, depth + 1);
  };
  layout.nodes.filter((item) => !item.parentId).sort((left, right) => left.y - right.y).forEach((item) => walk(item, 0));
  layout.nodes.forEach((item) => walk(item, item.depth));
  return `<section class="report-section"><h2>Details by electrical hierarchy</h2><h3>Known supply branches and connected loads</h3>${rows.length ? `<div class="electrical-details">${rows.join('')}</div>` : '<p>No electrical items are available.</p>'}</section>`;
}

function zoneDetailsHtml(model: ElectricalDiagramModel): string {
  const finalRoots = new Map(buildElectricalDiagramLayout(model).nodes
    .filter((item) => !item.parentId)
    .map((item) => [item.node.id, item.node.kind === 'GRID' ? 'Grid root' : 'Branch root — upstream not shown']));
  const zoneGroups = new Map<
    string,
    { zoneName: string; zoneCode?: string; nodes: ElectricalDiagramNode[] }
  >();
  for (const node of model.nodes) {
    if (!node.zoneId) continue;
    const group = zoneGroups.get(node.zoneId) ?? {
      zoneName: node.zoneName,
      zoneCode: node.zoneCode,
      nodes: [],
    };
    group.nodes.push(node);
    zoneGroups.set(node.zoneId, group);
  }
  const emitted = new Set<string>();
  const groups = [...zoneGroups.entries()]
    .sort((left, right) =>
      left[1].zoneName.localeCompare(right[1].zoneName) ||
      (left[1].zoneCode ?? '').localeCompare(right[1].zoneCode ?? '') ||
      left[0].localeCompare(right[0]),
    )
    .map(([, zone]) => {
    const rows = zone.nodes
      .sort((left, right) => (left.displayCode || left.name).localeCompare(right.displayCode || right.name))
      .map((node) => {
        emitted.add(node.id);
        return detailRowHtml(node, model, 0, finalRoots.get(node.id));
      });
    const label = zone.zoneCode
      ? `${zone.zoneName} (${zone.zoneCode})`
      : zone.zoneName;
    return `<h3>${escapeElectricalReportHtml(label)}</h3><div class="electrical-details">${rows.join('')}</div>`;
  });
  const shared = model.nodes.filter((node) => !emitted.has(node.id));
  if (shared.length) {
    groups.push(`<h3>Shared / unassigned electrical infrastructure</h3><div class="electrical-details">${shared.map((node) => detailRowHtml(node, model, 0, finalRoots.get(node.id))).join('')}</div>`);
  }
  return `<section class="report-section"><h2>Details by physical zone</h2>${groups.length ? groups.join('') : '<p>No electrical items are available.</p>'}</section>`;
}

export function buildElectricalMapReportHtml(
  model: ElectricalDiagramModel,
  detailMode: InstallationReportDetailMode,
): string {
  const layout = buildElectricalDiagramLayout(model);
  const windows = planElectricalReportWindows(layout);
  const overview = `<section class="report-section map-page"><h2>Installation electrical map</h2><div class="map-frame overview">${renderElectricalDiagramSvg(model)}</div>${legendHtml()}<p class="map-note">Every known electrical item remains visible. Solid copper lines show safe FED_FROM supply links; blue dashed lines show measurements; grey dotted lines show calculated residual relationships. Branch roots have no invented upstream link.</p></section>`;
  const requestedWindowCount = windows[0]
    ? windows[0].rowCount * windows[0].columnCount
    : 0;
  const omittedWindowCount = Math.max(0, requestedWindowCount - windows.length);
  const detailPages = windows.map((window, index) => `<section class="report-section map-page"><h2>Electrical map detail - row ${window.row + 1} of ${window.rowCount}, column ${window.column + 1} of ${window.columnCount}</h2><div class="map-frame detail">${renderElectricalDiagramSvg(model, { window, includeTitle: false })}</div><p class="map-note"><strong>Detail page ${index + 1} of ${windows.length}.</strong> Adjacent rows and columns overlap to preserve connector continuity. Refer to the complete overview for the full topology and legend.${omittedWindowCount > 0 && index === windows.length - 1 ? ` ${omittedWindowCount} additional map window${omittedWindowCount === 1 ? '' : 's'} ${omittedWindowCount === 1 ? 'was' : 'were'} omitted from this bounded on-device report; use API server generation for the complete large-format pack.` : ''}</p></section>`).join('');
  const details = detailMode === 'by-zone'
    ? zoneDetailsHtml(model)
    : hierarchyDetailsHtml(model);
  const unresolved = `<section class="report-section"><h2>Needs follow-up</h2>${model.unresolved.length ? `<p>${model.unresolved.length} relationship${model.unresolved.length === 1 ? '' : 's'} need follow-up. Known records and safe downstream branches remain in the map.</p><table><thead><tr><th>Record</th><th>Relationship</th><th>Missing end</th><th>Reason</th></tr></thead><tbody>${model.unresolved.map((relationship) => `<tr><td>${escapeElectricalReportHtml(`${relationship.subjectType}: ${relationship.subjectId}`)}</td><td>${escapeElectricalReportHtml(relationship.relation)}</td><td>${escapeElectricalReportHtml(relationship.missingEnd)}</td><td>${escapeElectricalReportHtml(relationship.reason)}</td></tr>`).join('')}</tbody></table>` : '<p>No electrical relationships need follow-up.</p>'}</section>`;
  return `${overview}${detailPages}${details}${unresolved}`;
}

export const ELECTRICAL_MAP_REPORT_CSS = `
  .report-section { break-before: page; page-break-before: always; }
  .map-frame { width: 100%; border: 1px solid #DBEAFE; border-radius: 8px; overflow: hidden; background: #FFFFFF; }
  .map-frame.overview { height: 145mm; }
  .map-frame.detail { height: 186mm; }
  .map-frame svg { width: 100%; height: 100%; display: block; }
  .map-note { color: #64748B; font-size: 7.5pt; line-height: 1.45; margin: 7px 0 0; }
  .electrical-legend { width: 100%; margin-top: 7px; padding: 7px 9px; border: 1px solid #DBEAFE; background: #F8FAFC; font-size: 6.7pt; }
  .electrical-legend .legend-group { display: inline-block; width: 50%; vertical-align: top; margin-bottom: 5px; }
  .electrical-legend .connections { margin-bottom: 0; }
  .electrical-legend .coverage-group { margin-bottom: 0; }
  .electrical-legend strong { display: block; color: #1E3A8A; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
  .electrical-legend span { display: inline-block; margin: 2px 8px 2px 0; }
  .electrical-legend .legend-symbol { min-width: 23%; color: #334155; white-space: nowrap; }
  .electrical-legend .legend-symbol svg { width: 12px; height: 12px; margin-right: 3px; vertical-align: middle; color: #1E40AF; }
  .electrical-legend .line { display: inline-block; width: 24px; border-top: 2px solid; margin-right: 5px; vertical-align: middle; }
  .electrical-legend .line.supply { border-color: #A46124; }
  .electrical-legend .line.measures { border-color: #2459C4; border-top-style: dashed; }
  .electrical-legend .line.residual { border-color: #64748B; border-top-style: dotted; }
  .electrical-legend .coverage { border-radius: 10px; padding: 2px 5px; font-weight: 800; font-size: 6.5pt; }
  .coverage.direct { background: #DCFCE7; color: #166534; }
  .coverage.virtual { background: #DBEAFE; color: #1D4ED8; }
  .coverage.unmetered, .coverage.tbc { background: #FEF3C7; color: #92400E; }
  .coverage.issue { background: #FEE2E2; color: #B91C1C; }
  .electrical-details { border: 1px solid #DBEAFE; border-radius: 7px; overflow: hidden; margin-bottom: 11px; }
  .electrical-detail-row { display: table; width: 100%; table-layout: fixed; border-bottom: 1px solid #DBEAFE; break-inside: avoid; }
  .electrical-detail-row:last-child { border-bottom: 0; }
  .electrical-detail-name, .electrical-detail-copy { display: table-cell; vertical-align: top; padding: 7px 9px; }
  .electrical-detail-name { width: 45%; padding-left: calc(9px + var(--depth) * 12px); }
  .electrical-detail-name > span:last-child { display: inline-block; width: calc(100% - 26px); vertical-align: top; }
  .electrical-detail-name strong { display: block; color: #0F172A; font-size: 8pt; }
  .electrical-detail-name small { display: block; color: #64748B; font-size: 7pt; margin-top: 2px; }
  .detail-icon { display: inline-block; width: 20px; height: 20px; margin-right: 6px; color: #1E40AF; vertical-align: top; }
  .detail-icon svg { width: 20px; height: 20px; }
  .electrical-detail-copy { width: 55%; color: #475569; font-size: 7.2pt; }
  .electrical-detail-copy span { display: block; margin-bottom: 2px; }
`;
