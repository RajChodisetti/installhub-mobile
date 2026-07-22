import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInstallation } from '../hooks';
import { buildInstallationReportHtml, shareInstallationReportHtml } from '../services';
import { Button, Card, LoadingState, SectionHeader } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'InstallationReport'>;

export function InstallationReportScreen({ route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { item, zones, boards, siteAssets, loading } = useInstallation(installationId);
  const [busy, setBusy] = useState(false);

  if (loading || !item) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.title, { color: colors.reportNavy }]}>INSTALLHUB</Text>
      <Text style={{ color: colors.mutedForeground, marginBottom: spacing.lg }}>Installation Report</Text>

      <Card>
        <Text style={[typography.heading, { color: colors.foreground }]}>{item.site_name}</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>
          {item.client_name}
          {'\n'}
          {item.site_address}
          {'\n'}
          Inspector: {item.inspector_name}
          {'\n'}
          Date: {item.audit_date}
        </Text>
      </Card>

      <SectionHeader title="Summary" />
      <Card>
        <Text style={{ color: colors.foreground }}>
          Zones: {zones.length}
          {'\n'}
          Boards: {boards.length}
          {'\n'}
          Meters: {boards.reduce((n, b) => n + b.meters.length, 0)}
          {'\n'}
          Site assets: {siteAssets.length}
        </Text>
      </Card>

      <Button
        title={busy ? 'Preparing PDF…' : 'Export / Share PDF'}
        style={{ marginTop: spacing.xl }}
        disabled={busy}
        onPress={async () => {
          setBusy(true);
          try {
            const html = buildInstallationReportHtml({
              installation: item,
              zones,
              boards,
              siteAssets,
            });
            await shareInstallationReportHtml(html);
          } catch (e) {
            Alert.alert('PDF error', e instanceof Error ? e.message : 'Failed to export');
          } finally {
            setBusy(false);
          }
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
