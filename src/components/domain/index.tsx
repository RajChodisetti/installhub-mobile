import React from 'react';
import { Text, View } from 'react-native';
import type { ElectricalAsset, Installation, SiteAsset, Zone } from '../../types';
import { formatDate } from '../../utils';
import { useTheme } from '../../context/AppProviders';
import { Badge, Card, ListRow } from '../ui';
import { typography } from '../../theme';

export function InstallationCard({
  item,
  onPress,
}: {
  item: Installation;
  onPress?: () => void;
}) {
  return (
    <ListRow
      title={item.site_name}
      subtitle={`${item.client_name} · ${formatDate(item.audit_date)}`}
      onPress={onPress}
      right={<Badge label={item.status} tone={item.status === 'Completed' ? 'success' : 'default'} />}
    />
  );
}

export function ZoneCard({
  item,
  boardCount,
  assetCount,
  onPress,
}: {
  item: Zone;
  boardCount: number;
  assetCount: number;
  onPress?: () => void;
}) {
  return (
    <ListRow
      title={item.zone_name}
      subtitle={`${item.zone_description || 'No description'} · ${boardCount} boards · ${assetCount} assets`}
      onPress={onPress}
    />
  );
}

export function ElectricalAssetCard({
  item,
  onPress,
}: {
  item: ElectricalAsset;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Card style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={[typography.subheading, { color: colors.foreground }]}>{item.asset_name}</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
            {item.asset_type}
            {item.amperage_rating ? ` · ${item.amperage_rating}` : ''}
          </Text>
          {item.location_description ? (
            <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>{item.location_description}</Text>
          ) : null}
        </View>
        <View style={{ gap: 6, alignItems: 'flex-end' }}>
          {item.electrical_parent_tbc ? <Badge label="TBC" tone="tbc" /> : null}
          {item.meter_present ? <Badge label={`${item.meters.length} meter(s)`} /> : null}
        </View>
      </View>
      {onPress ? (
        <Text onPress={onPress} style={{ color: colors.primary, fontWeight: '700', marginTop: 12 }}>
          Open board
        </Text>
      ) : null}
    </Card>
  );
}

export function SiteAssetCard({
  item,
  onPress,
}: {
  item: SiteAsset;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const meteringState = item.metering_state?.kind ?? 'TBC';
  return (
    <Card style={{ marginBottom: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={[typography.subheading, { color: colors.foreground }]}>{item.asset_name}</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
            {item.asset_type}
          </Text>
        </View>
        <View style={{ gap: 6, alignItems: 'flex-end' }}>
          {item.electrical_source?.kind === 'TBC' || item.electrical_board_tbc ? (
            <Badge label="Supply TBC" tone="tbc" />
          ) : null}
          <Badge
            label={meteringState === 'UNMETERED'
              ? 'Declared unmetered'
              : meteringState === 'METERED'
                ? 'Declared metered'
                : 'Metering TBC'}
            tone={meteringState === 'TBC' ? 'tbc' : 'default'}
          />
        </View>
      </View>
      {onPress ? (
        <Text onPress={onPress} style={{ color: colors.primary, fontWeight: '700', marginTop: 12 }}>
          Open asset
        </Text>
      ) : null}
    </Card>
  );
}

export function StatusChip({ status }: { status: Installation['status'] }) {
  return <Badge label={status} tone={status === 'Completed' ? 'success' : 'default'} />;
}
