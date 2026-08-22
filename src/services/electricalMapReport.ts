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

const ICON_MARKUP = {
  grid: '<path d="m13 2-8 12h7l-1 8 8-12h-7l1-8Z"/>',
  board: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h3M13 11h3M8 15h3M13 15h3M9 18h6"/>',
  meter: '<path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h3M14 15h2"/>',
  hvac: '<path d="M12 2v20M4.9 6l14.2 12M19.1 6 4.9 18M9 4.5 12 7l3-2.5M9 19.5l3-2.5 3 2.5M5.5 9l.5-4 4 .5M18.5 15l-.5 4-4-.5M18.5 9l-.5-4-4 .5M5.5 15l.5 4 4-.5"/>',
  lighting: '<path d="M9 18h6M10 21h4M8.4 14.5A6 6 0 1 1 15.6 14.5c-.9.7-1.4 1.7-1.4 2.5h-4.4c0-.8-.5-1.8-1.4-2.5Z"/><path d="M12 2V1M4.9 4.9l-.7-.7M19.1 4.9l.7-.7"/>',
  solar: '<circle cx="7" cy="7" r="3"/><path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.8 2.8l1.4 1.4M9.8 9.8l1.4 1.4M11.2 2.8 9.8 4.2M4.2 9.8l-1.4 1.4M5 15h14l2 7H3l2-7ZM8 15l-1 7M12 15v7M16 15l1 7M4 19h16"/>',
  charger: '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="M7 10h4M9 8v4M15 10h2a3 3 0 0 1 3 3v2M18 4v4M22 4v4M17 8h6M20 8v4"/>',
  battery: '<rect x="3" y="6" width="17" height="12" rx="2"/><path d="M20 10h2v4h-2M7 9v6M4 12h6M14 9v6"/>',
  fan: '<circle cx="12" cy="12" r="2"/><path d="M12 10c-1-5 1-7 3-7 3 0 4 4 1 7M14 12c5-1 7 1 7 3 0 3-4 4-7 1M12 14c1 5-1 7-3 7-3 0-4-4-1-7M10 12c-5 1-7-1-7-3 0-3 4-4 7-1"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5-5L7 4l3 3 2.7-2.7a4 4 0 0 0 2 2ZM8.5 8.5 2 15v5h5l6.5-6.5"/>',
  water: '<path d="M12 2s7 7.2 7 12a7 7 0 0 1-14 0c0-4.8 7-12 7-12Z"/><path d="M9 15a3 3 0 0 0 3 2"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0M12 18l4-6M6 18h12"/>',
  building: '<path d="M4 21V5l8-3v19M12 8h8v13M8 7h1M8 11h1M8 15h1M16 11h1M16 15h1M3 21h18"/>',
  residual: '<path d="M3 12h4l2-6 4 12 2-6h6"/>',
} as const;

type IconName = keyof typeof ICON_MARKUP;

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

function iconName(node: ElectricalDiagramNode): IconName {
  if (node.kind === 'GRID') return 'grid';
  if (node.kind === 'BOARD') return 'board';
  if (node.kind === 'VIRTUAL_RESIDUAL') return 'residual';
  if (node.typeCode === 'HVAC' || node.typeCode === 'REFRIGERATION') return 'hvac';
  if (node.typeCode === 'LIGHTING') return 'lighting';
  if (node.typeCode === 'PV') return 'solar';
  if (node.typeCode === 'EV_CHARGER' || node.typeCode === 'POWER_OUTLET') return 'charger';
  if (node.typeCode === 'FORKLIFT') return 'battery';
  if (node.typeCode === 'EXHAUST_FAN_SYSTEM') return 'fan';
  if (node.typeCode === 'VEHICLE_HOIST') return 'tool';
  if (node.typeCode === 'HEATER_GEYSER') return 'water';
  if (node.typeCode === 'COMPRESSED_AIR') return 'gauge';
  return 'building';
}

function svgIcon(name: IconName, x: number, y: number, size: number, color: string): string {
  const scale = size / 24;
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_MARKUP[name]}</g>`;
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

function renderNode(item: ElectricalDiagramLayoutNode): string {
  const { node, x, y, width, height } = item;
  const board = node.kind === 'BOARD';
  const asset = node.kind === 'SITE_ASSET';
  const fill = board ? '#EEF2FF' : asset ? '#ECFDF5' : '#FFFFFF';
  const stroke = board ? '#2563EB' : asset ? '#2F855A' : '#64748B';
  const iconFill = board ? '#1E40AF' : asset ? '#166534' : '#334155';
  const icon = iconName(node);
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
    `<rect x="${x + 10}" y="${y + 10}" width="30" height="30" rx="9" fill="${iconFill}"/>`,
    svgIcon(icon, x + 16, y + 16, 18, '#FFFFFF'),
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
  if (board) {
    let moduleY = y + 84;
    for (const device of node.devices.slice(0, 3)) {
      const activeChannels = device.channels
        .filter((channel) => channel.purpose !== 'SPARE')
        .map((channel) => channel.ordinal);
      parts.push(
        `<rect x="${x + 10}" y="${moduleY}" width="${width - 20}" height="34" rx="7" fill="#FFFFFF" stroke="#86EFAC"/>`,
        svgIcon('meter', x + 16, moduleY + 7, 15, '#166534'),
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
    parts.push(svgText(truncate(`${node.typeLabel} - ${node.zoneName}`, 34), x + 12, y + (node.displayCode ? 91 : 76), { size: 8, color: '#64748B' }));
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
    return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(model.siteName)} electrical single-line diagram" viewBox="0 0 1080 520" preserveAspectRatio="xMidYMid meet"><rect width="1080" height="520" fill="#FFFFFF"/><rect x="160" y="130" width="760" height="240" rx="22" fill="#F8FAFC" stroke="#CBD5E1" stroke-width="2" stroke-dasharray="8 7"/>${svgIcon('board', 496, 168, 88, '#64748B')}${svgText('No confirmed electrical map', 540, 292, { size: 24, color: '#0E2240', weight: 850, anchor: 'middle' })}${svgText('Resolve the incoming supply and electrical relationships to build the diagram.', 540, 328, { size: 13, color: '#64748B', weight: 500, anchor: 'middle' })}</svg>`;
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
    ...layout.nodes.map(renderNode),
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

function legendSymbol(icon: IconName, label: string): string {
  return `<span class="legend-symbol"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_MARKUP[icon]}</svg>${escapeElectricalReportHtml(label)}</span>`;
}

function legendHtml(): string {
  return `<div class="electrical-legend">
    <div class="legend-group"><strong>Node symbols</strong>${legendSymbol('grid', 'Incoming grid')}${legendSymbol('board', 'Switchboard')}${legendSymbol('meter', 'Installed meter')}${legendSymbol('residual', 'Calculated residual')}</div>
    <div class="legend-group"><strong>Load symbols</strong>${legendSymbol('hvac', 'HVAC / refrigeration')}${legendSymbol('lighting', 'Lighting')}${legendSymbol('solar', 'Solar / PV')}${legendSymbol('charger', 'EV charging / outlet')}${legendSymbol('battery', 'Forklift / battery')}${legendSymbol('fan', 'Exhaust / fan')}${legendSymbol('tool', 'Vehicle hoist')}${legendSymbol('water', 'Hot water / heater')}${legendSymbol('gauge', 'Compressed air')}${legendSymbol('building', 'Other asset')}</div>
    <div class="legend-group connections"><strong>Connections</strong><span><i class="line supply"></i>Supply - confirmed FED_FROM cable path</span><span><i class="line measures"></i>Measures - confirmed channels; never changes supply</span><span><i class="line residual"></i>Residual - calculation, not a physical cable</span></div>
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

function detailRowHtml(node: ElectricalDiagramNode, model: ElectricalDiagramModel, depth = 0): string {
  const devices = node.devices.flatMap((device) => {
    const channels = device.channels.map((channel) => `Ch ${channel.ordinal} (${channel.loadLabel || channel.purpose.replaceAll('_', ' ').toLocaleLowerCase()}${channel.description ? ` - ${channel.description}` : ''}${channel.sensorRating ? ` - ${channel.sensorRating}` : ''})`).join(', ');
    return [`Installed device: ${device.name} - ${device.model}${device.serialNumber ? ` - serial ${device.serialNumber}` : ''}${device.deviceNumber ? ` - device ${device.deviceNumber}` : ''}${channels ? ` - ${channels}` : ''}`];
  });
  const detail = [
    node.typeLabel,
    node.zoneName ? `Physical zone: ${node.zoneName}${node.zoneCode ? ` (${node.zoneCode})` : ''}` : '',
    node.coverageState ? `Coverage: ${COVERAGE_LABELS[node.coverageState]}` : '',
    ...devices,
    ...nodeMeasurementDetails(node, model),
  ].filter(Boolean);
  const icon = iconName(node);
  return `<div class="electrical-detail-row" style="--depth:${Math.min(depth, 8)}"><div class="electrical-detail-name"><span class="detail-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_MARKUP[icon]}</svg></span><span><strong>${escapeElectricalReportHtml(node.displayCode || node.name)}</strong>${node.displayCode && node.name !== node.displayCode ? `<small>${escapeElectricalReportHtml(node.name)}</small>` : ''}</span></div><div class="electrical-detail-copy">${detail.map((line) => `<span>${escapeElectricalReportHtml(line)}</span>`).join('')}</div></div>`;
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
    rows.push(detailRowHtml(item.node, model, depth));
    for (const child of childrenById.get(item.node.id) ?? []) walk(child, depth + 1);
  };
  layout.nodes.filter((item) => !item.parentId).sort((left, right) => left.y - right.y).forEach((item) => walk(item, 0));
  layout.nodes.forEach((item) => walk(item, item.depth));
  return `<section class="report-section"><h2>Details by electrical hierarchy</h2><h3>Incoming supply to connected loads</h3>${rows.length ? `<div class="electrical-details">${rows.join('')}</div>` : '<p>No confirmed electrical hierarchy is available.</p>'}</section>`;
}

function zoneDetailsHtml(model: ElectricalDiagramModel): string {
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
        return detailRowHtml(node, model);
      });
    const label = zone.zoneCode
      ? `${zone.zoneName} (${zone.zoneCode})`
      : zone.zoneName;
    return `<h3>${escapeElectricalReportHtml(label)}</h3><div class="electrical-details">${rows.join('')}</div>`;
  });
  const shared = model.nodes.filter((node) => !emitted.has(node.id));
  if (shared.length) {
    groups.push(`<h3>Shared / unassigned electrical infrastructure</h3><div class="electrical-details">${shared.map((node) => detailRowHtml(node, model)).join('')}</div>`);
  }
  return `<section class="report-section"><h2>Details by physical zone</h2>${groups.length ? groups.join('') : '<p>No confirmed electrical records are available.</p>'}</section>`;
}

export function buildElectricalMapReportHtml(
  model: ElectricalDiagramModel,
  detailMode: InstallationReportDetailMode,
): string {
  const layout = buildElectricalDiagramLayout(model);
  const windows = planElectricalReportWindows(layout);
  const overview = `<section class="report-section map-page"><h2>Installation electrical map</h2><div class="map-frame overview">${renderElectricalDiagramSvg(model)}</div>${legendHtml()}<p class="map-note">Solid copper lines show electrical supply. Blue dashed lines show measurements. Grey dotted lines show calculated residual relationships. Device names and active channels appear on their installed switchboards.</p></section>`;
  const requestedWindowCount = windows[0]
    ? windows[0].rowCount * windows[0].columnCount
    : 0;
  const omittedWindowCount = Math.max(0, requestedWindowCount - windows.length);
  const detailPages = windows.map((window, index) => `<section class="report-section map-page"><h2>Electrical map detail - row ${window.row + 1} of ${window.rowCount}, column ${window.column + 1} of ${window.columnCount}</h2><div class="map-frame detail">${renderElectricalDiagramSvg(model, { window, includeTitle: false })}</div><p class="map-note"><strong>Detail page ${index + 1} of ${windows.length}.</strong> Adjacent rows and columns overlap to preserve connector continuity. Refer to the complete overview for the full topology and legend.${omittedWindowCount > 0 && index === windows.length - 1 ? ` ${omittedWindowCount} additional map window${omittedWindowCount === 1 ? '' : 's'} ${omittedWindowCount === 1 ? 'was' : 'were'} omitted from this bounded on-device report; use API server generation for the complete large-format pack.` : ''}</p></section>`).join('');
  const details = detailMode === 'by-zone'
    ? zoneDetailsHtml(model)
    : hierarchyDetailsHtml(model);
  const unresolved = `<section class="report-section"><h2>Unresolved relationships</h2>${model.unresolved.length ? `<p>${model.unresolved.length} unresolved relationship${model.unresolved.length === 1 ? '' : 's'} remain outside the confirmed electrical map.</p><table><thead><tr><th>Record</th><th>Relationship</th><th>Missing end</th><th>Reason</th></tr></thead><tbody>${model.unresolved.map((relationship) => `<tr><td>${escapeElectricalReportHtml(`${relationship.subjectType}: ${relationship.subjectId}`)}</td><td>${escapeElectricalReportHtml(relationship.relation)}</td><td>${escapeElectricalReportHtml(relationship.missingEnd)}</td><td>${escapeElectricalReportHtml(relationship.reason)}</td></tr>`).join('')}</tbody></table>` : '<p>No unresolved electrical relationships.</p>'}</section>`;
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
