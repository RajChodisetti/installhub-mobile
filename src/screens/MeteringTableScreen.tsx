import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInstallation } from '../hooks';
import { Card, LoadingState, SectionHeader } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'MeteringTable'>;

export function MeteringTableScreen({ route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { item, boards, siteAssets, loading } = useInstallation(installationId);

  if (loading || !item) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  const rows = [
    ...boards.flatMap((b) =>
      b.meters.map((m) => ({
        key: m.id,
        board: b.display_code,
        name: m.device_name || m.device_id,
        type: m.device_type,
        coverage: m.coverage || m.classification || '—',
        kind: 'Board meter' as const,
      })),
    ),
    ...siteAssets
      .filter((a) => a.meter_present)
      .map((a) => ({
        key: a.id,
        board: a.display_code || a.asset_name,
        name: a.asset_name,
        type: a.asset_type,
        coverage: (a.meter_channels || []).map((c) => `Ch ${c.channel}`).join(', ') || '—',
        kind: 'Site asset' as const,
      })),
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.title, { color: colors.foreground }]}>Metering assets</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 4, marginBottom: spacing.lg }}>
        {item.site_name}
      </Text>
      <SectionHeader title={`${rows.length} rows`} />
      {rows.map((r) => (
        <Card key={r.key} style={{ marginBottom: 8 }}>
          <Text style={[typography.subheading, { color: colors.foreground }]}>{r.name}</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
            {r.kind} · {r.board} · {r.type}
          </Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>Coverage: {r.coverage}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
