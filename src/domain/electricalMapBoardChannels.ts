export type ElectricalMapBoardChannel = {
  id: string;
  ordinal: number;
  meterLabel?: string | null;
  phaseLabel?: string | null;
  purpose?: string | null;
  assigned?: boolean;
};

export type ElectricalMapBoardChannelLayoutItem = {
  channel: ElectricalMapBoardChannel;
  cellHeight: number;
  columnWidth: number;
  label: string;
  portSide: 'left' | 'right';
  portX: number;
  portY: number;
  state: 'assigned' | 'spare' | 'available';
  x: number;
  y: number;
};

export type ElectricalMapBoardChannelConnectorSlot = {
  channelId: string;
  portX: number;
  portY: number;
};

export const ELECTRICAL_MAP_MAX_VISIBLE_BOARD_CHANNELS = 12;

function channelState(
  channel: ElectricalMapBoardChannel,
): ElectricalMapBoardChannelLayoutItem['state'] {
  if (channel.purpose?.trim().toUpperCase() === 'SPARE') return 'spare';
  return channel.assigned ? 'assigned' : 'available';
}

/** Same 64-unit channel cabinet layout used by the portal schematic. */
export function electricalMapBoardChannelLayout(
  channels: readonly ElectricalMapBoardChannel[],
): ElectricalMapBoardChannelLayoutItem[] {
  const visibleChannels = channels.slice().sort((left, right) => (
    (left.meterLabel || '').localeCompare(right.meterLabel || '')
    || left.ordinal - right.ordinal
    || left.id.localeCompare(right.id)
  )).slice(0, ELECTRICAL_MAP_MAX_VISIBLE_BOARD_CHANNELS);
  const twoColumns = visibleChannels.length > 6;
  const rowCount = Math.max(1, Math.ceil(visibleChannels.length / (twoColumns ? 2 : 1)));
  const rowHeight = Math.min(5.4, 31 / rowCount);
  const cellHeight = Math.max(3.8, rowHeight - 0.8);
  const columnWidth = twoColumns ? 19 : 36;
  const leftByColumn = twoColumns ? [11, 34] : [14];

  return visibleChannels.map((channel, index) => {
    const column = twoColumns ? Math.floor(index / rowCount) : 0;
    const row = twoColumns ? index % rowCount : index;
    const x = leftByColumn[column]!;
    const y = 21 + row * rowHeight;
    const portSide = twoColumns && column === 0 ? 'left' : 'right';
    const phaseLabel = channel.phaseLabel?.trim().slice(0, 5) || '';
    const meterLabel = channel.meterLabel?.trim().slice(0, 4) || '';
    return {
      channel,
      cellHeight,
      columnWidth,
      label: [meterLabel, `CH ${channel.ordinal}`, phaseLabel].filter(Boolean).join(' · '),
      portSide,
      portX: portSide === 'left' ? 9 : 55,
      portY: y + cellHeight / 2,
      state: channelState(channel),
      x,
      y,
    };
  });
}

/** Stable visible connector origins shared with the portal channel cabinet. */
export function electricalMapBoardChannelConnectorSlots(
  channels: readonly ElectricalMapBoardChannel[],
  mappedChannelIds: readonly string[],
): ElectricalMapBoardChannelConnectorSlot[] {
  const layoutByChannelId = new Map(
    electricalMapBoardChannelLayout(channels).map((item) => [item.channel.id, item] as const),
  );
  const seen = new Set<string>();
  return mappedChannelIds.flatMap((channelId) => {
    if (seen.has(channelId)) return [];
    seen.add(channelId);
    const slot = layoutByChannelId.get(channelId);
    return slot ? [{ channelId, portX: slot.portX, portY: slot.portY }] : [];
  });
}

/** Synthetic ids keep same-board channel stubs distinct from their board. */
export function electricalMapChannelConnectorNodeId(
  boardNodeId: string,
  channelId: string,
): string {
  return `${boardNodeId}:channel-port:${channelId}`;
}
