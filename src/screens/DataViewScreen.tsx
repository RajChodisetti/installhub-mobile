import React, { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInstallation } from '../hooks';
import { electricalAssetsRepo, siteAssetsRepo } from '../repositories';
import { Badge, Button, Card, LoadingState, SectionHeader } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'DataView'>;

export function DataViewScreen({ route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { item, zones, boards, siteAssets, loading, refresh } = useInstallation(installationId);

  const tbcBoards = useMemo(() => boards.filter((b) => b.electrical_parent_tbc), [boards]);
  const tbcAssets = useMemo(
    () => siteAssets.filter((a) => a.electrical_board_tbc || a.meter_switchboard_tbc),
    [siteAssets],
  );

  if (loading || !item) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.title, { color: colors.foreground }]}>Data View</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>{item.site_name}</Text>

      <SectionHeader title={`Location tree · ${zones.length} zones`} />
      {zones.map((z) => (
        <Card key={z.id} style={{ marginBottom: 8 }}>
          <Text style={[typography.subheading, { color: colors.foreground }]}>{z.zone_name}</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
            {boards.filter((b) => b.zone_id === z.id).length} boards ·{' '}
            {siteAssets.filter((a) => a.zone_id === z.id).length} assets
          </Text>
        </Card>
      ))}

      <SectionHeader title="Wattwatcher registry" />
      {boards.flatMap((b) =>
        b.meters.map((m) => (
          <Card key={m.id} style={{ marginBottom: 8 }}>
            <Text style={[typography.subheading, { color: colors.foreground }]}>
              {m.device_name || m.device_id || 'Meter'}
            </Text>
            <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
              {b.display_code} · {m.device_type} · {m.device_id}
            </Text>
          </Card>
        )),
      )}

      <SectionHeader title={`TBC resolver (${tbcBoards.length + tbcAssets.length})`} />
      {tbcBoards.length + tbcAssets.length === 0 ? (
        <Text style={{ color: colors.mutedForeground }}>No open TBC items.</Text>
      ) : null}

      {tbcBoards.map((b) => (
        <Card key={b.id} style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[typography.subheading, { color: colors.foreground, flex: 1 }]}>
              Board {b.asset_name}
            </Text>
            <Badge label="TBC" tone="tbc" />
          </View>
          <Text style={{ color: colors.mutedForeground, marginTop: 6 }}>Electrical parent unknown</Text>
          <Button
            title="Resolve: link to first MSB"
            variant="secondary"
            style={{ marginTop: 10 }}
            onPress={async () => {
              const parent =
                boards.find((x) => x.asset_type === 'MSB' && x.id !== b.id) ||
                boards.find((x) => x.id !== b.id);
              if (!parent) {
                Alert.alert('No parent board available');
                return;
              }
              await electricalAssetsRepo.update(b.id, {
                electrical_parent_id: parent.id,
                electrical_parent_tbc: false,
              });
              await refresh();
            }}
          />
        </Card>
      ))}

      {tbcAssets.map((a) => (
        <Card key={a.id} style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[typography.subheading, { color: colors.foreground, flex: 1 }]}>
              Asset {a.asset_name}
            </Text>
            <Badge label="TBC" tone="tbc" />
          </View>
          <Button
            title="Resolve: link to first board in zone"
            variant="secondary"
            style={{ marginTop: 10 }}
            onPress={async () => {
              const parent = boards.find((b) => b.zone_id === a.zone_id) || boards[0];
              if (!parent) {
                Alert.alert('No board available');
                return;
              }
              await siteAssetsRepo.update(a.id, {
                electrical_board_id: parent.id,
                electrical_board_tbc: false,
                meter_switchboard_id: a.meter_present ? parent.id : a.meter_switchboard_id,
                meter_switchboard_tbc: false,
              });
              await refresh();
            }}
          />
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
