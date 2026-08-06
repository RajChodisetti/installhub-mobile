import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { ElectricalAsset, Installation, SiteAsset, Zone } from '../../types';
import { formatDate } from '../../utils';
import { useTheme } from '../../context/AppProviders';
import { Badge, Card, ListRow } from '../ui';
import { typography } from '../../theme';

export function InstallationCard({
  item,
  onPress,
  onDelete,
  deleteDisabled = false,
}: {
  item: Installation;
  onPress?: () => void;
  onDelete?: () => void;
  deleteDisabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <ListRow
      title={item.site_name}
      subtitle={`${item.client_name} · ${formatDate(item.audit_date)}`}
      onPress={onPress}
      right={(
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Badge label={item.status} tone={item.status === 'Completed' ? 'success' : 'default'} />
          {onDelete ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Delete ${item.site_name} from this device`}
              accessibilityHint="Opens a confirmation showing all local records that will be removed"
              accessibilityState={{ disabled: deleteDisabled }}
              disabled={deleteDisabled}
              onPress={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              style={({ pressed }) => ({
                minHeight: 44,
                minWidth: 64,
                justifyContent: 'center',
                alignItems: 'flex-end',
                opacity: deleteDisabled ? 0.45 : pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: colors.destructive, fontWeight: '700' }}>Delete</Text>
            </Pressable>
          ) : null}
        </View>
      )}
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
      subtitle={`${item.zone_code ?? 'ZONE'} · ${item.zone_description || 'No description'} · ${boardCount} boards · ${assetCount} assets`}
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
          {item.display_code ? (
            <Text style={{ color: colors.primary, fontWeight: '700', marginTop: 4 }}>
              {item.display_code}
            </Text>
          ) : null}
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
          {item.display_code ? (
            <Text style={{ color: colors.primary, fontWeight: '700', marginTop: 4 }}>
              {item.display_code}
            </Text>
          ) : null}
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
