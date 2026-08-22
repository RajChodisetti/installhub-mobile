import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import {
  Activity,
  BatteryCharging,
  Building2,
  Cable,
  CircuitBoard,
  Droplets,
  Fan,
  Gauge,
  Lightbulb,
  PlugZap,
  Snowflake,
  Sun,
  Wrench,
  Zap,
} from 'lucide-react-native';
import type {
  ElectricalDiagramCoverage,
  ElectricalDiagramModel,
  ElectricalDiagramNode,
} from '../../domain/electricalDiagram';
import {
  electricalDiagramMeasurementDeviceLabel,
  electricalDiagramSearchText,
} from '../../domain/electricalDiagram';
import {
  buildElectricalDiagramLayout,
  electricalDiagramOrthogonalPoints,
} from '../../domain/electricalDiagramLayout';
import { useTheme } from '../../context/AppProviders';
import { radii, spacing, typography } from '../../theme';
import { Button, Card, EmptyState } from '../ui';

type DiagramIcon = React.ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

type Props = {
  model: ElectricalDiagramModel;
  search?: string;
  onOpenNode?: (node: ElectricalDiagramNode) => void;
};

const MIN_SCALE = 0.28;
const MAX_SCALE = 1.15;
const DEFAULT_SCALE = 0.72;
const MAX_CANVAS_VIEWPORT_HEIGHT = 720;
const FIT_CANVAS_VIEWPORT_HEIGHT = 520;

const COVERAGE_LABELS: Record<ElectricalDiagramCoverage, string> = {
  DIRECT: 'Direct',
  VIRTUAL: 'Virtual',
  UNMETERED: 'Unmetered',
  TBC: 'TBC',
  INVALID: 'Issue',
};

const LOAD_LEGEND: Array<{
  icon: DiagramIcon;
  label: string;
  codes: string[];
}> = [
  { icon: Snowflake, label: 'HVAC and refrigeration', codes: ['HVAC', 'REFRIGERATION'] },
  { icon: Lightbulb, label: 'Lighting', codes: ['LIGHTING'] },
  { icon: Sun, label: 'Solar / PV', codes: ['PV'] },
  { icon: PlugZap, label: 'EV charging and outlets', codes: ['EV_CHARGER', 'POWER_OUTLET'] },
  { icon: BatteryCharging, label: 'Forklifts and batteries', codes: ['FORKLIFT'] },
  { icon: Fan, label: 'Exhaust and fans', codes: ['EXHAUST_FAN_SYSTEM'] },
  { icon: Wrench, label: 'Vehicle hoists', codes: ['VEHICLE_HOIST'] },
  { icon: Droplets, label: 'Hot water and heaters', codes: ['HEATER_GEYSER'] },
  { icon: Gauge, label: 'Compressed air', codes: ['COMPRESSED_AIR'] },
  { icon: Building2, label: 'Other site assets', codes: ['OTHER'] },
];

function nodeIcon(node: ElectricalDiagramNode): DiagramIcon {
  if (node.kind === 'GRID') return Zap;
  if (node.kind === 'BOARD') return CircuitBoard;
  if (node.kind === 'VIRTUAL_RESIDUAL') return Activity;
  return LOAD_LEGEND.find((item) => item.codes.includes(node.typeCode ?? 'OTHER'))?.icon ?? Building2;
}

function coverageColors(
  coverage: ElectricalDiagramCoverage,
  colors: ReturnType<typeof useTheme>['colors'],
): { backgroundColor: string; color: string } {
  if (coverage === 'DIRECT') return { backgroundColor: colors.diagramAsset, color: colors.success };
  if (coverage === 'VIRTUAL') return { backgroundColor: colors.diagramBoard, color: colors.diagramMeasure };
  if (coverage === 'INVALID') return { backgroundColor: colors.muted, color: colors.destructive };
  if (coverage === 'TBC' || coverage === 'UNMETERED') {
    return { backgroundColor: colors.muted, color: colors.tbcForeground };
  }
  return { backgroundColor: colors.muted, color: colors.foreground };
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

function nodeAccessibilityLabel(node: ElectricalDiagramNode): string {
  const devices = node.devices.flatMap((device) => [
    `${device.name}, ${device.model}`,
    device.serialNumber ? `serial ${device.serialNumber}` : '',
    compactChannelLabel(
      device.channels
        .filter((channel) => channel.purpose !== 'SPARE')
        .map((channel) => channel.ordinal),
    ),
  ]);
  return [
    node.kind === 'GRID'
      ? 'Incoming grid'
      : node.kind === 'BOARD'
        ? 'Switchboard'
        : node.kind === 'SITE_ASSET'
          ? 'Site asset'
          : 'Calculated residual',
    node.displayCode,
    node.name,
    node.typeLabel,
    node.zoneName,
    node.coverageState ? `coverage ${COVERAGE_LABELS[node.coverageState]}` : '',
    ...devices,
  ]
    .filter(Boolean)
    .join('. ');
}

function DiagramLegendLine({
  color,
  dashed,
  dotted,
  label,
}: {
  color: string;
  dashed?: boolean;
  dotted?: boolean;
  label: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.legendRow}>
      <Svg width={34} height={10} accessibilityElementsHidden>
        <Polyline
          points="0,5 34,5"
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeDasharray={dotted ? '2,4' : dashed ? '8,5' : undefined}
          strokeLinecap="round"
        />
      </Svg>
      <Text style={[styles.legendText, { color: colors.foreground }]}>{label}</Text>
    </View>
  );
}

export function ElectricalSingleLineDiagram({ model, search = '', onOpenNode }: Props) {
  const { colors } = useTheme();
  const layout = useMemo(() => buildElectricalDiagramLayout(model), [model]);
  const layoutById = useMemo(
    () => new Map(layout.nodes.map((item) => [item.node.id, item])),
    [layout.nodes],
  );
  const [selectedNodeId, setSelectedNodeId] = useState(layout.nodes[0]?.node.id ?? '');
  const [scale, setScale] = useState(DEFAULT_SCALE);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [fittedSignature, setFittedSignature] = useState('');
  useEffect(() => {
    if (!layoutById.has(selectedNodeId)) {
      setSelectedNodeId(layout.nodes[0]?.node.id ?? '');
    }
  }, [layout.nodes, layoutById, selectedNodeId]);

  const fitScale = viewportWidth && layout.width && layout.height
    ? Math.max(
        MIN_SCALE,
        Math.min(
          1,
          (viewportWidth - spacing.md * 2) / layout.width,
          FIT_CANVAS_VIEWPORT_HEIGHT / layout.height,
        ),
      )
    : DEFAULT_SCALE;
  const fitSignature = `${model.installationId}:${model.treeRevision}:${layout.width}:${layout.height}:${viewportWidth}`;
  useEffect(() => {
    if (!viewportWidth || fittedSignature === fitSignature) return;
    setScale(fitScale);
    setFittedSignature(fitSignature);
  }, [fitScale, fitSignature, fittedSignature, viewportWidth]);

  if (!layout.nodes.length) {
    return (
      <Card>
        <EmptyState
          title="No confirmed electrical map"
          subtitle="Resolve the incoming supply and electrical relationships to build the diagram."
        />
      </Card>
    );
  }

  const selected = layoutById.get(selectedNodeId)?.node ?? layout.nodes[0].node;
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const matchingNodeIds = new Set(
    normalizedSearch
      ? layout.nodes
          .filter((item) => electricalDiagramSearchText(item.node).includes(normalizedSearch))
          .map((item) => item.node.id)
      : [],
  );
  const scaledWidth = layout.width * scale;
  const scaledHeight = layout.height * scale;
  const diagramViewportHeight = Math.min(
    Math.max(scaledHeight, 260),
    MAX_CANVAS_VIEWPORT_HEIGHT,
  );
  const selectedIncomingMeasures = layout.edges.filter(
    (edge) => edge.relationship === 'MEASURES' && edge.targetNodeId === selected.id,
  );
  const selectedOutgoingMeasures = layout.edges.filter(
    (edge) => edge.relationship === 'MEASURES' && edge.sourceNodeId === selected.id,
  );
  const nodeName = (id: string) => {
    const node = layoutById.get(id)?.node;
    return node ? node.displayCode || node.name : id;
  };
  const scaleValue = (value: number) => value * scale;
  const compactOverview = scale < 0.56;

  const handleLayout = (event: LayoutChangeEvent) => {
    setViewportWidth(event.nativeEvent.layout.width);
  };

  return (
    <View accessibilityLabel={`${model.siteName} electrical single-line diagram`}>
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[typography.subheading, { color: colors.foreground }]}>Electrical single-line diagram</Text>
            <Text style={[typography.caption, { color: colors.mutedForeground, marginTop: 3 }]}>Tap a symbol for exact records. Swipe to follow the supply path.</Text>
          </View>
          <View style={styles.zoomRow} accessibilityRole="toolbar" accessibilityLabel="Electrical diagram zoom controls">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Zoom out"
              disabled={scale <= MIN_SCALE}
              onPress={() => setScale((current) => Math.max(MIN_SCALE, Number((current - 0.12).toFixed(2))))}
              style={({ pressed }) => [styles.zoomButton, { borderColor: colors.border, opacity: scale <= MIN_SCALE ? 0.4 : pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.zoomButtonText, { color: colors.foreground }]}>-</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Fit diagram overview"
              onPress={() => setScale(fitScale)}
              style={({ pressed }) => [styles.zoomButton, styles.zoomWideButton, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.zoomLabel, { color: colors.foreground }]}>Fit</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show diagram at 100 percent"
              onPress={() => setScale(1)}
              style={({ pressed }) => [styles.zoomButton, styles.zoomWideButton, { borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.zoomLabel, { color: colors.foreground }]}>100%</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Zoom in"
              disabled={scale >= MAX_SCALE}
              onPress={() => setScale((current) => Math.min(MAX_SCALE, Number((current + 0.12).toFixed(2))))}
              style={({ pressed }) => [styles.zoomButton, { borderColor: colors.border, opacity: scale >= MAX_SCALE ? 0.4 : pressed ? 0.7 : 1 }]}
            >
              <Text style={[styles.zoomButtonText, { color: colors.foreground }]}>+</Text>
            </Pressable>
          </View>
        </View>
        {normalizedSearch ? (
          <Text accessibilityLiveRegion="polite" style={[styles.searchStatus, { color: colors.mutedForeground, borderBottomColor: colors.border }]}>Highlighted {matchingNodeIds.size} matching symbol{matchingNodeIds.size === 1 ? '' : 's'}; the complete supply path remains visible.</Text>
        ) : null}
        <View onLayout={handleLayout} style={{ backgroundColor: colors.background }}>
          <ScrollView
            nestedScrollEnabled
            style={{ maxHeight: diagramViewportHeight }}
            contentContainerStyle={{ minHeight: diagramViewportHeight }}
            accessibilityLabel="Scroll electrical diagram vertically"
          >
            <ScrollView
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator
              contentContainerStyle={{ minWidth: Math.max(scaledWidth, viewportWidth), minHeight: scaledHeight }}
              accessibilityLabel="Scroll electrical diagram horizontally"
            >
              <View style={{ width: scaledWidth, height: scaledHeight }}>
                <Svg
                  pointerEvents="none"
                  width={scaledWidth}
                  height={scaledHeight}
                  style={StyleSheet.absoluteFill}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  {layout.edges.map((edge, edgeIndex) => {
                    const source = layoutById.get(edge.sourceNodeId);
                    const target = layoutById.get(edge.targetNodeId);
                    if (!source || !target) return null;
                    const measurementOffset = edge.relationship === 'MEASURES'
                      ? ((edgeIndex % 5) - 2) * 4
                      : 0;
                    const points = electricalDiagramOrthogonalPoints(source, target, {
                      sourceYOffset: measurementOffset,
                      targetYOffset: measurementOffset,
                      trunkRatio: edge.relationship === 'MEASURES' ? 0.62 : 0.46,
                    })
                      .map((point) => `${scaleValue(point.x)},${scaleValue(point.y)}`)
                      .join(' ');
                    const isMeasurement = edge.relationship === 'MEASURES';
                    const isResidual = edge.relationship === 'CALCULATED_RESIDUAL';
                    return (
                      <Polyline
                        key={edge.id}
                        points={points}
                        fill="none"
                        stroke={isMeasurement ? colors.diagramMeasure : isResidual ? colors.diagramResidual : colors.diagramSupply}
                        strokeWidth={(isMeasurement ? 2.2 : 2.4) * Math.max(0.82, scale)}
                        strokeDasharray={isMeasurement ? `${8 * scale},${6 * scale}` : isResidual ? `${2 * scale},${5 * scale}` : undefined}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    );
                  })}
                </Svg>
                {layout.nodes.map((item) => {
                  const node = item.node;
                  const Icon = nodeIcon(node);
                  const selectedNode = selected.id === node.id;
                  const searchMatch = matchingNodeIds.has(node.id);
                  const board = node.kind === 'BOARD';
                  const asset = node.kind === 'SITE_ASSET';
                  const backgroundColor = board
                    ? colors.diagramBoard
                    : asset
                      ? colors.diagramAsset
                      : colors.card;
                  const accentColor = board
                    ? colors.diagramMeasure
                    : asset
                      ? colors.success
                      : colors.foreground;
                  const coverage = node.coverageState
                    ? coverageColors(node.coverageState, colors)
                    : null;
                  return (
                    <Pressable
                      key={node.id}
                      accessibilityRole="button"
                      accessibilityLabel={nodeAccessibilityLabel(node)}
                      accessibilityHint="Select for complete details below"
                      accessibilityState={{ selected: selectedNode }}
                      onPress={() => setSelectedNodeId(node.id)}
                      style={({ pressed }) => [
                        styles.nodeCard,
                        {
                          left: scaleValue(item.x),
                          top: scaleValue(item.y),
                          width: scaleValue(item.width),
                          height: scaleValue(item.height),
                          padding: compactOverview ? 4 : Math.max(7, scaleValue(11)),
                          borderRadius: compactOverview ? 7 : Math.max(9, scaleValue(radii.md)),
                          backgroundColor,
                          borderColor: selectedNode || searchMatch ? accentColor : colors.border,
                          borderWidth: selectedNode ? 2.5 : searchMatch ? 2 : 1,
                          opacity: pressed ? 0.82 : normalizedSearch && !searchMatch ? 0.64 : 1,
                        },
                      ]}
                    >
                      {compactOverview ? (
                        <View style={styles.compactNode}>
                          <View style={[styles.nodeIcon, { width: 18, height: 18, borderRadius: 6, backgroundColor: accentColor }]}> 
                            <Icon color={colors.primaryForeground} size={12} strokeWidth={2.2} />
                          </View>
                          <Text numberOfLines={2} style={[styles.compactNodeLabel, { color: colors.foreground }]}> 
                            {node.kind === 'GRID' ? 'GRID' : node.displayCode || node.name}
                          </Text>
                          {coverage ? (
                            <View accessibilityLabel={`${COVERAGE_LABELS[node.coverageState!]} coverage`} style={[styles.compactCoverageDot, { backgroundColor: coverage.color }]} />
                          ) : null}
                        </View>
                      ) : (
                        <>
                          <View style={styles.nodeHeader}>
                            <View style={[styles.nodeIcon, { width: Math.max(24, scaleValue(32)), height: Math.max(24, scaleValue(32)), borderRadius: Math.max(8, scaleValue(10)), backgroundColor: accentColor }]}> 
                              <Icon color={colors.primaryForeground} size={Math.max(14, scaleValue(18))} strokeWidth={2.1} />
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text numberOfLines={1} style={[styles.nodeKind, { color: colors.mutedForeground, fontSize: Math.max(8, scaleValue(9)) }]}> 
                                {node.kind === 'GRID' ? 'INCOMING GRID' : node.kind === 'BOARD' ? 'SWITCHBOARD' : node.kind === 'SITE_ASSET' ? 'SITE ASSET' : 'VIRTUAL RESIDUAL'}
                              </Text>
                              {coverage ? (
                                <View style={[styles.coveragePill, { backgroundColor: coverage.backgroundColor }]}> 
                                  <Text style={{ color: coverage.color, fontSize: Math.max(7, scaleValue(8)), fontWeight: '800', textTransform: 'uppercase' }}>{COVERAGE_LABELS[node.coverageState!]}</Text>
                                </View>
                              ) : null}
                            </View>
                          </View>
                          <Text numberOfLines={2} style={{ color: colors.foreground, fontWeight: '800', fontSize: Math.max(10, scaleValue(12)), lineHeight: Math.max(13, scaleValue(15)), marginTop: Math.max(4, scaleValue(6)) }}> 
                            {node.displayCode || node.name}
                          </Text>
                          {node.displayCode && node.name !== node.displayCode ? (
                            <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: Math.max(8, scaleValue(9.5)), marginTop: 2 }}>{node.name}</Text>
                          ) : null}
                        </>
                      )}
                      {!compactOverview && board ? (
                        <View style={{ gap: Math.max(3, scaleValue(4)), marginTop: Math.max(4, scaleValue(7)) }}>
                          {node.devices.slice(0, 3).map((device) => {
                            const activeOrdinals = device.channels.filter((channel) => channel.purpose !== 'SPARE').map((channel) => channel.ordinal);
                            return (
                              <View key={device.id} style={[styles.deviceModule, { borderColor: colors.success, backgroundColor: colors.card, padding: Math.max(3, scaleValue(5)), borderRadius: Math.max(5, scaleValue(7)) }]}>
                                <Cable color={colors.success} size={Math.max(10, scaleValue(12))} strokeWidth={2} />
                                <View style={{ flex: 1 }}>
                                  <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: Math.max(7.5, scaleValue(8.5)), fontWeight: '700' }}>{device.name}</Text>
                                  <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: Math.max(6.8, scaleValue(7.5)) }}>{compactChannelLabel(activeOrdinals)}{device.serialNumber && device.serialNumber !== device.name ? ` · ${device.serialNumber}` : ''}</Text>
                                </View>
                              </View>
                            );
                          })}
                          {!node.devices.length ? (
                            <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: Math.max(7.5, scaleValue(8.5)) }}>No installed meter</Text>
                          ) : null}
                          {node.devices.length > 3 ? (
                            <Text style={{ color: colors.mutedForeground, fontSize: Math.max(7.5, scaleValue(8.5)) }}>+{node.devices.length - 3} more device{node.devices.length - 3 === 1 ? '' : 's'}</Text>
                          ) : null}
                        </View>
                      ) : !compactOverview ? (
                        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: Math.max(8, scaleValue(9)), marginTop: Math.max(3, scaleValue(5)) }}>{node.typeLabel}{node.zoneName ? ` · ${node.zoneName}` : ''}</Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </ScrollView>
        </View>
        <View style={[styles.mapFooter, { borderTopColor: colors.border, backgroundColor: colors.muted }]}>
          <Text style={[typography.caption, { color: colors.mutedForeground }]}>Confirmed topology only · {layout.nodes.length} symbols · {Math.round(scale * 100)}%</Text>
          {model.unresolved.length ? (
            <Text style={[typography.caption, { color: colors.tbcForeground, marginTop: 3 }]}>{model.unresolved.length} unresolved relationship{model.unresolved.length === 1 ? '' : 's'} remain in Reconcile and are intentionally outside this diagram.</Text>
          ) : null}
        </View>
      </Card>

      <Card style={{ marginTop: spacing.md }} accessibilityRole="summary">
        <View style={styles.detailTitleRow}>
          {React.createElement(nodeIcon(selected), { color: selected.kind === 'BOARD' ? colors.diagramMeasure : selected.kind === 'SITE_ASSET' ? colors.success : colors.foreground, size: 22, strokeWidth: 2.1 })}
          <View style={{ flex: 1 }}>
            <Text style={[typography.subheading, { color: colors.foreground }]}>{selected.displayCode || selected.name}</Text>
            {selected.displayCode && selected.name !== selected.displayCode ? (
              <Text style={[typography.caption, { color: colors.mutedForeground, marginTop: 2 }]}>{selected.name}</Text>
            ) : null}
          </View>
          {selected.coverageState ? (
            <View style={[styles.detailCoverage, { backgroundColor: coverageColors(selected.coverageState, colors).backgroundColor }]}>
              <Text style={{ color: coverageColors(selected.coverageState, colors).color, fontWeight: '800', fontSize: 11 }}>{COVERAGE_LABELS[selected.coverageState].toUpperCase()}</Text>
            </View>
          ) : null}
        </View>
        <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 20 }}>{selected.typeLabel} · {selected.zoneName}{selected.zoneCode ? ` (${selected.zoneCode})` : ''}</Text>
        {selected.devices.map((device) => (
          <View key={device.id} style={[styles.deviceDetail, { borderColor: colors.border }]}>
            <Text style={{ color: colors.foreground, fontWeight: '800' }}>{device.name}</Text>
            <Text style={{ color: colors.mutedForeground, marginTop: 3 }}>{device.model}{device.serialNumber ? ` · Serial ${device.serialNumber}` : ''}{device.deviceNumber ? ` · Device ${device.deviceNumber}` : ''}</Text>
            {device.channels.map((channel) => (
              <Text key={channel.id} style={{ color: colors.mutedForeground, marginTop: 4, lineHeight: 19 }}>Ch {channel.ordinal} · {channel.purpose.replace('_', ' ').toLocaleLowerCase()}{channel.loadLabel ? ` · ${channel.loadLabel}` : ''}{channel.description ? ` · ${channel.description}` : ''}{channel.sensorRating ? ` · ${channel.sensorRating}` : ''}</Text>
            ))}
          </View>
        ))}
        {selectedIncomingMeasures.map((edge) => (
          <Text key={edge.id} style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 20 }}>Measured by {electricalDiagramMeasurementDeviceLabel(model, edge)} on {nodeName(edge.sourceNodeId)} · {compactChannelLabel(edge.channelOrdinals ?? [])} · {(edge.phaseMode ?? '').replace('_', ' ').toLocaleLowerCase()} · {(edge.direction ?? '').toLocaleLowerCase()}</Text>
        ))}
        {selectedOutgoingMeasures.length ? (
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 20 }}>Measures {selectedOutgoingMeasures.map((edge) => `${nodeName(edge.targetNodeId)} via ${electricalDiagramMeasurementDeviceLabel(model, edge)} (${compactChannelLabel(edge.channelOrdinals ?? [])})`).join('; ')}</Text>
        ) : null}
        {onOpenNode && (selected.kind === 'BOARD' || selected.kind === 'SITE_ASSET') ? (
          <Button
            title={selected.kind === 'BOARD' ? 'Open switchboard' : 'Open site asset'}
            variant="secondary"
            style={{ marginTop: spacing.md }}
            onPress={() => onOpenNode(selected)}
          />
        ) : null}
      </Card>

      <Card style={{ marginTop: spacing.md }} accessibilityLabel="Electrical diagram key">
        <Text style={[typography.subheading, { color: colors.foreground }]}>Diagram key</Text>
        <Text style={[styles.legendHeading, { color: colors.mutedForeground }]}>NODE SYMBOLS</Text>
        <View style={styles.legendWrap}>
          {[
            { icon: Zap, label: 'Incoming grid', color: colors.foreground },
            { icon: CircuitBoard, label: 'Switchboard', color: colors.diagramMeasure },
            { icon: Cable, label: 'Installed meter', color: colors.success },
            { icon: Activity, label: 'Virtual residual', color: colors.diagramResidual },
          ].map(({ icon: Icon, label, color }) => (
            <View key={label} style={styles.legendRow}>
              <Icon color={color} size={17} strokeWidth={2} />
              <Text style={[styles.legendText, { color: colors.foreground }]}>{label}</Text>
            </View>
          ))}
        </View>
        <Text style={[styles.legendHeading, { color: colors.mutedForeground }]}>LOAD SYMBOLS</Text>
        <View style={styles.legendWrap}>
          {LOAD_LEGEND.map(({ icon: Icon, label }) => (
            <View key={label} style={styles.legendRow}>
              <Icon color={colors.success} size={17} strokeWidth={2} />
              <Text style={[styles.legendText, { color: colors.foreground }]}>{label}</Text>
            </View>
          ))}
        </View>
        <Text style={[styles.legendHeading, { color: colors.mutedForeground }]}>CONNECTIONS</Text>
        <DiagramLegendLine color={colors.diagramSupply} label="Supply · confirmed FED_FROM cable path" />
        <DiagramLegendLine color={colors.diagramMeasure} dashed label="Measures · confirmed device channels; never changes supply" />
        <DiagramLegendLine color={colors.diagramResidual} dotted label="Residual · calculation, not a physical cable" />
        <Text style={[styles.legendHeading, { color: colors.mutedForeground }]}>COVERAGE</Text>
        <View style={styles.legendWrap}>
          {(Object.keys(COVERAGE_LABELS) as ElectricalDiagramCoverage[]).map((coverage) => {
            const presentation = coverageColors(coverage, colors);
            return (
              <View key={coverage} style={[styles.coverageLegend, { backgroundColor: presentation.backgroundColor }]}>
                <Text style={{ color: presentation.color, fontSize: 10, fontWeight: '800' }}>{COVERAGE_LABELS[coverage].toUpperCase()}</Text>
              </View>
            );
          })}
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    padding: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  zoomRow: { flexDirection: 'row', gap: 6, width: '100%' },
  zoomButton: { flex: 1, minWidth: 44, minHeight: 44, borderWidth: 1, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  zoomWideButton: { paddingHorizontal: 8 },
  zoomButtonText: { fontSize: 20, fontWeight: '700' },
  zoomLabel: { fontSize: 12, fontWeight: '800' },
  searchStatus: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, fontSize: 12 },
  nodeCard: { position: 'absolute', overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  compactNode: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  compactNodeLabel: { width: '100%', textAlign: 'center', fontSize: 6.5, lineHeight: 7, fontWeight: '800' },
  compactCoverageDot: { position: 'absolute', top: 0, right: 0, width: 7, height: 7, borderRadius: 4 },
  nodeHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nodeIcon: { alignItems: 'center', justifyContent: 'center' },
  nodeKind: { fontWeight: '800', letterSpacing: 0.35 },
  coveragePill: { alignSelf: 'flex-start', borderRadius: radii.full, paddingHorizontal: 5, paddingVertical: 2, marginTop: 2 },
  deviceModule: { borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  mapFooter: { borderTopWidth: StyleSheet.hairlineWidth, padding: spacing.md },
  detailTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  detailCoverage: { borderRadius: radii.full, paddingHorizontal: 8, paddingVertical: 5 },
  deviceDetail: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: spacing.md, paddingTop: spacing.md },
  legendHeading: { ...typography.label, marginTop: spacing.md, marginBottom: spacing.sm },
  legendWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  legendRow: { minHeight: 28, flexDirection: 'row', alignItems: 'center', gap: 7, marginRight: spacing.sm },
  legendText: { fontSize: 12, flexShrink: 1 },
  coverageLegend: { borderRadius: radii.full, paddingHorizontal: 8, paddingVertical: 5 },
});
