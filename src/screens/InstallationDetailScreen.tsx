import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInstallation } from '../hooks';
import { installationsRepo, zonesRepo } from '../repositories';
import { StatusChip, ZoneCard } from '../components/domain';
import { Button, EmptyState, LoadingState, SectionHeader, TextField } from '../components/ui';
import { FormModal } from '../components/forms';
import { useTheme } from '../context/AppProviders';
import { formatDate } from '../utils';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'InstallationDetail'>;

export function InstallationDetailScreen({ navigation, route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { item, zones, boards, siteAssets, loading, refresh } = useInstallation(installationId);
  const [zoneModal, setZoneModal] = useState(false);
  const [zoneName, setZoneName] = useState('');
  const [zoneDesc, setZoneDesc] = useState('');

  if (loading || !item) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  const boardCount = (zoneId: string) => boards.filter((b) => b.zone_id === zoneId).length;
  const assetCount = (zoneId: string) => siteAssets.filter((a) => a.zone_id === zoneId).length;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={[typography.title, { color: colors.foreground }]}>{item.site_name}</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>{item.client_name}</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>{item.site_address}</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
            {item.inspector_name} · {formatDate(item.audit_date)}
          </Text>
        </View>
        <StatusChip status={item.status} />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.lg }}>
        <Button title="Edit" variant="secondary" onPress={() => navigation.navigate('InstallationForm', { installationId })} style={{ flexGrow: 1 }} />
        <Button
          title={item.status === 'Completed' ? 'Mark Draft' : 'Mark Completed'}
          onPress={async () => {
            await installationsRepo.update(installationId, {
              status: item.status === 'Completed' ? 'Draft' : 'Completed',
            });
            await refresh();
          }}
          style={{ flexGrow: 1 }}
        />
      </View>

      <SectionHeader title="Reports" />
      <View style={{ gap: 8 }}>
        <Button title="Data View / TBC" variant="secondary" onPress={() => navigation.navigate('DataView', { installationId })} />
        <Button title="Metering Table" variant="secondary" onPress={() => navigation.navigate('MeteringTable', { installationId })} />
        <Button title="Full Installation Report" variant="secondary" onPress={() => navigation.navigate('InstallationReport', { installationId })} />
        <Button title="Client Report" variant="ghost" onPress={() => navigation.navigate('ClientReport', { installationId })} />
        <Button title="Photo Preview" variant="ghost" onPress={() => navigation.navigate('PhotoPreview', { installationId })} />
      </View>

      <SectionHeader title="Zones" actionLabel="+ Add" onAction={() => setZoneModal(true)} />
      {zones.length === 0 ? (
        <EmptyState title="No zones yet" subtitle="Add a zone to capture boards and assets." />
      ) : (
        zones.map((z) => (
          <ZoneCard
            key={z.id}
            item={z}
            boardCount={boardCount(z.id)}
            assetCount={assetCount(z.id)}
            onPress={() =>
              navigation.navigate('ZoneWorkspace', { zoneId: z.id, installationId })
            }
          />
        ))
      )}

      <FormModal visible={zoneModal} title="New zone" onClose={() => setZoneModal(false)}>
        <TextField label="Zone name" value={zoneName} onChangeText={setZoneName} />
        <TextField label="Description" value={zoneDesc} onChangeText={setZoneDesc} />
        <Button
          title="Create zone"
          disabled={!zoneName.trim()}
          onPress={async () => {
            const z = await zonesRepo.create({
              audit_id: installationId,
              zone_name: zoneName.trim(),
              zone_description: zoneDesc.trim(),
            });
            setZoneModal(false);
            setZoneName('');
            setZoneDesc('');
            navigation.navigate('ZoneWorkspace', { zoneId: z.id, installationId });
          }}
        />
      </FormModal>

      <Button
        title="Delete installation"
        variant="danger"
        style={{ marginTop: spacing.xl }}
        onPress={() => {
          Alert.alert('Delete installation?', 'Zones, boards, and assets will be removed.', [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: async () => {
                await installationsRepo.remove(installationId);
                navigation.popToTop();
              },
            },
          ]);
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
