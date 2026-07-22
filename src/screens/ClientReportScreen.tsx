import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInstallation } from '../hooks';
import { Button, Card, LoadingState, SectionHeader } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ClientReport'>;

export function ClientReportScreen({ navigation, route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { item, zones, boards, siteAssets, loading } = useInstallation(installationId);

  if (loading || !item) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.title, { color: colors.foreground }]}>Client Report</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 4, marginBottom: spacing.lg }}>
        Legacy energy-audit style summary (demo content from installation data)
      </Text>

      <Card>
        <Text style={[typography.subheading, { color: colors.foreground }]}>{item.site_name}</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>{item.client_name}</Text>
      </Card>

      <SectionHeader title="Sections" />
      <Card style={{ marginBottom: 8 }}>
        <Text style={{ color: colors.foreground }}>Electrical overview</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>{boards.length} boards documented</Text>
      </Card>
      <Card style={{ marginBottom: 8 }}>
        <Text style={{ color: colors.foreground }}>Zones</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>{zones.map((z) => z.zone_name).join(', ')}</Text>
      </Card>
      <Card style={{ marginBottom: 8 }}>
        <Text style={{ color: colors.foreground }}>Loads / site assets</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>{siteAssets.length} assets</Text>
      </Card>

      <Button
        title="Open Photo Preview"
        variant="secondary"
        style={{ marginTop: spacing.lg }}
        onPress={() => navigation.navigate('PhotoPreview', { installationId })}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
