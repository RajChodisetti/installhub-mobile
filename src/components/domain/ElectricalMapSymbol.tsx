import React from 'react';
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Polyline,
  Rect,
  Text as SvgText,
} from 'react-native-svg';
import {
  electricalMapSymbolDefinition,
  type ElectricalMapSymbolName,
  type ElectricalMapSymbolPrimitive,
} from '../../domain/electricalMapSymbols';
import {
  electricalMapBoardChannelLayout,
  type ElectricalMapBoardChannel,
} from '../../domain/electricalMapBoardChannels';

const STROKE_WIDTH = 2.4;

function Primitive({ primitive, accent }: { primitive: ElectricalMapSymbolPrimitive; accent: string }) {
  const shared = {
    fill: 'fill' in primitive && primitive.fill ? accent : 'none',
    fillOpacity: 'fill' in primitive && primitive.fill ? 0.14 : 1,
    stroke: accent,
    strokeDasharray: primitive.dashed ? '4 3' : undefined,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeWidth: STROKE_WIDTH,
  };
  if (primitive.kind === 'path') return <Path d={primitive.d} {...shared} />;
  if (primitive.kind === 'rect') return <Rect x={primitive.x} y={primitive.y} width={primitive.width} height={primitive.height} rx={primitive.rx} {...shared} />;
  if (primitive.kind === 'circle') return <Circle cx={primitive.cx} cy={primitive.cy} r={primitive.r} {...shared} />;
  if (primitive.kind === 'line') return <Line x1={primitive.x1} y1={primitive.y1} x2={primitive.x2} y2={primitive.y2} {...shared} />;
  return <Polyline points={primitive.points} {...shared} />;
}

function BoardChannels({ channels, accent }: { channels: readonly ElectricalMapBoardChannel[]; accent: string }) {
  const layout = electricalMapBoardChannelLayout(channels);
  const twoColumns = layout.some((item) => item.portSide === 'left');
  return (
    <G>
      {layout.map((item) => (
        <G key={item.channel.id}>
          <Rect
            x={item.x}
            y={item.y}
            width={item.columnWidth}
            height={item.cellHeight}
            rx={1.2}
            fill={item.state === 'assigned' ? accent : '#FFFFFF'}
            fillOpacity={item.state === 'assigned' ? 0.17 : 0.92}
            stroke={accent}
            strokeDasharray={item.state === 'spare' ? '2 1.5' : undefined}
            strokeWidth={0.9}
          />
          <SvgText
            x={item.x + 2}
            y={item.y + item.cellHeight / 2 + 1.15}
            fill={accent}
            fontFamily="Arial"
            fontSize={twoColumns ? 2.45 : 3.05}
            fontWeight="800"
            letterSpacing={0.08}
          >
            {item.label}
          </SvgText>
          <Circle
            cx={item.portX}
            cy={item.portY}
            r={1.65}
            fill={item.state === 'spare' ? '#FFFFFF' : accent}
            stroke={accent}
            strokeWidth={0.9}
          />
        </G>
      ))}
      {channels.length > layout.length ? (
        <SvgText x={32} y={54} fill={accent} fontFamily="Arial" fontSize={3} fontWeight="800" textAnchor="middle">
          +{channels.length - layout.length} channels
        </SvgText>
      ) : null}
    </G>
  );
}

function DefaultBoardPhases({ accent }: { accent: string }) {
  return (
    <G>
      {(['L1', 'L2', 'L3'] as const).map((phase, index) => {
        const y = 27 + index * 10;
        return (
          <G key={phase}>
            <SvgText x={14} y={y + 1.7} fill={accent} fontFamily="Arial" fontSize={4.4} fontWeight="900">{phase}</SvgText>
            <Line x1={23} y1={y} x2={50} y2={y} stroke={accent} strokeWidth={1.4} />
            <Rect x={31} y={y - 3} width={8} height={6} rx={1.2} fill="#DBEAFE" stroke={accent} strokeWidth={0.9} />
            <Circle cx={51} cy={y} r={1.6} fill={accent} />
          </G>
        );
      })}
    </G>
  );
}

/** Native renderer for the portal's canonical 64-unit schematic registry. */
export function ElectricalMapSymbol({
  name,
  size,
  channels,
}: {
  name: ElectricalMapSymbolName;
  size: number;
  channels?: readonly ElectricalMapBoardChannel[];
}) {
  const definition = electricalMapSymbolDefinition(name);
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Rect x={3} y={3} width={58} height={58} rx={15} fill={definition.tint} />
      {definition.category === 'board' ? (
        <>
          <Rect x={9} y={7} width={46} height={50} rx={4} fill="#FFFFFF" fillOpacity={0.94} stroke={definition.accent} strokeWidth={STROKE_WIDTH} />
          <Path d="M9 18h46" fill="none" stroke={definition.accent} strokeWidth={1.4} />
          <Circle cx={49} cy={12.5} r={1.7} fill={definition.accent} opacity={0.88} />
          <SvgText x={14} y={14.8} fill={definition.accent} fontFamily="Arial" fontSize={5.2} fontWeight="900" letterSpacing={0.18}>
            {definition.boardCode}
          </SvgText>
          {channels?.length
            ? <BoardChannels channels={channels} accent={definition.accent} />
            : <DefaultBoardPhases accent={definition.accent} />}
        </>
      ) : definition.primitives.map((primitive, index) => (
        <Primitive key={`${name}-${index}`} primitive={primitive} accent={definition.accent} />
      ))}
    </Svg>
  );
}

