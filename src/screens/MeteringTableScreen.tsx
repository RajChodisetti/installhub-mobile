import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInstallation } from '../hooks';
import { canonicalInstallationRepo } from '../repositories';
import type { AllAssetMeteringRow } from '../domain/installationV2';
import { Badge, Card, EmptyState, LoadingState, SearchBar } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'MeteringTable'>;

export function MeteringTableScreen({ route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { item, boards, meterDevices, loading } = useInstallation(installationId);
  const [rows, setRows] = useState<AllAssetMeteringRow[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!item) return;
    void canonicalInstallationRepo.allAssetMetering(installationId).then(setRows);
  }, [installationId, item?.tree_revision]);

  const query = search.trim().toLocaleLowerCase();
  const visible = useMemo(() => rows.filter((row) =>
    !query || `${row.displayCode} ${row.name} ${row.typeLabel} ${row.supplyLabel} ${row.state} ${row.channelLabels.join(' ')}`
      .toLocaleLowerCase().includes(query)), [query, rows]);

  if (loading || !item) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.pad}
      data={visible}
      keyExtractor={(row) => row.id}
      ListHeaderComponent={(
        <View>
          <Text style={[typography.title, { color: colors.foreground }]}>All-asset metering</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
            {item.site_name} · {rows.length} assets · {meterDevices.length} physical meters
          </Text>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search assets, supply, meter, or channel…" />
          <Text style={[typography.subheading, { color: colors.foreground, marginBottom: spacing.sm }]}>Meter registry</Text>
          {meterDevices.map((meter) => {
            const board = boards.find((candidate) => candidate.id === meter.installedOnBoardId);
            return (
              <Card key={meter.id} style={{ marginBottom: 8 }}>
                <Text style={[typography.subheading, { color: colors.foreground }]}>{meter.displayName.value}</Text>
                <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
                  {meter.deviceModel} · {meter.serialNumber || 'no serial'} · installed on {board?.display_code ?? 'missing board'}
                </Text>
                <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>{meter.channels.length} declared channels</Text>
              </Card>
            );
          })}
          <Text style={[typography.subheading, { color: colors.foreground, marginTop: spacing.md, marginBottom: spacing.sm }]}>Asset coverage</Text>
        </View>
      )}
      renderItem={({ item: row }) => (
        <Card style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={[typography.subheading, { color: colors.foreground }]}>{row.displayCode} · {row.name}</Text>
              <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>{row.typeLabel} · Fed from {row.supplyLabel}</Text>
            </View>
            <Badge
              label={row.virtualPreview ? `${row.state} · preview` : row.state}
              tone={row.state === 'DIRECT' ? 'success' : row.state === 'TBC' ? 'tbc' : 'default'}
            />
          </View>
          <Text style={{ color: colors.mutedForeground, marginTop: 6 }}>
            {row.channelLabels.length ? row.channelLabels.join(', ') : 'No direct measurement assignment'}
          </Text>
        </Card>
      )}
      ListEmptyComponent={<EmptyState title="No matching assets" />}
    />
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
