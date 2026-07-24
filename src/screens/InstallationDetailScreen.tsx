import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInstallation } from '../hooks';
import { installationsRepo, zonesRepo } from '../repositories';
import { StatusChip, ZoneCard } from '../components/domain';
import { Button, Card, EmptyState, LoadingState, SectionHeader, TextField } from '../components/ui';
import { FormModal } from '../components/forms';
import { useAuth, useTheme } from '../context/AppProviders';
import {
  ApiError,
  apiClient,
  cloudConnectionErrorMessage,
} from '../api/apiClient';
import { getInstallationSyncMetadata } from '../repositories/cloudSyncRepository';
import { useSyncStatus } from '../services/SyncStatusContext';
import { formatDate } from '../utils';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'InstallationDetail'>;

export function InstallationDetailScreen({ navigation, route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { user } = useAuth();
  const { syncing } = useSyncStatus();
  const { item, zones, boards, siteAssets, loading, refresh } = useInstallation(installationId);
  const [zoneModal, setZoneModal] = useState(false);
  const [zoneName, setZoneName] = useState('');
  const [zoneDesc, setZoneDesc] = useState('');
  const [backupChanging, setBackupChanging] = useState(false);

  if (loading || !item) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  const boardCount = (zoneId: string) => boards.filter((b) => b.zone_id === zoneId).length;
  const assetCount = (zoneId: string) => siteAssets.filter((a) => a.zone_id === zoneId).length;

  async function disableCloudBackup(removeServerCopy: boolean) {
    if (syncing) {
      Alert.alert('Backup in progress', 'Wait for the current Cloud Backup to finish, then try again.');
      return;
    }
    setBackupChanging(true);
    try {
      if (removeServerCopy) {
        try {
          await apiClient.deleteInstallationCloud(installationId, false);
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
      }
      const syncMetadata = await getInstallationSyncMetadata(installationId);
      await installationsRepo.update(installationId, {
        cloud_backup_enabled: false,
        cloud_backup_retained: !removeServerCopy && Boolean(syncMetadata.syncedWatermark),
      });
      await refresh();
    } catch (error) {
      Alert.alert('Could not update Cloud Backup', cloudConnectionErrorMessage(error));
    } finally {
      setBackupChanging(false);
    }
  }

  function confirmRemoveCloudCopy() {
    Alert.alert(
      'Remove retained cloud copy?',
      'The server copy will be hidden and future uploads will stay off. Locally captured evidence remains on this device. Re-enabling Cloud Backup restores the same record.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove Cloud Copy',
          style: 'destructive',
          onPress: () => { void disableCloudBackup(true); },
        },
      ],
    );
  }

  function handleBackupPreference() {
    if (!item?.cloud_backup_enabled) {
      void (async () => {
        await installationsRepo.setCloudBackupEnabled(installationId, true);
        await refresh();
      })();
      return;
    }
    Alert.alert(
      'Turn off Cloud Backup?',
      'Choose whether the existing server copy should remain available to authorised users.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Keep Cloud Copy',
          onPress: () => { void disableCloudBackup(false); },
        },
        {
          text: 'Remove Cloud Copy',
          style: 'destructive',
          onPress: () => { void disableCloudBackup(true); },
        },
      ],
    );
  }

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

      <SectionHeader title="Cloud Backup" />
      <Card>
        <Text style={{ color: colors.foreground, fontWeight: '600' }}>
          {item.cloud_backup_enabled
            ? 'Backup enabled'
            : item.cloud_backup_retained
              ? 'Future backup off · server copy retained'
              : 'Local only'}
        </Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 4, marginBottom: spacing.md }}>
          {item.is_imported_copy
            ? 'Imported copies stay local unless you explicitly opt in.'
            : 'Opt in to back up this installation tree and its evidence.'}
        </Text>
        <Button
          title={item.cloud_backup_enabled ? 'Turn off backup' : 'Back up this installation'}
          variant={item.cloud_backup_enabled ? 'ghost' : 'secondary'}
          disabled={backupChanging}
          onPress={handleBackupPreference}
        />
        {!item.cloud_backup_enabled && item.cloud_backup_retained ? (
          <Button
            title="Remove retained cloud copy"
            variant="danger"
            disabled={backupChanging}
            style={{ marginTop: spacing.sm }}
            onPress={confirmRemoveCloudCopy}
          />
        ) : null}
        {user?.role === 'admin' && item.cloud_backup_enabled ? (
          <Button
            title="Manage shared access"
            variant="secondary"
            style={{ marginTop: spacing.sm }}
            onPress={() =>
              navigation.navigate('InstallationAccess', { installationId })
            }
          />
        ) : null}
        {item.cloud_backup_enabled ||
        item.cloud_backup_retained ||
        item.import_source_server_id ? (
          <Button
            title="Cloud files & history"
            variant="secondary"
            style={{ marginTop: spacing.sm }}
            onPress={() =>
              navigation.navigate('CloudStorage', {
                installationId,
                serverInstallationId:
                  item.import_source_server_id ?? installationId,
              })
            }
          />
        ) : null}
      </Card>

      <SectionHeader title="Reports" />
      <View style={{ gap: 8 }}>
        <Button title="Field Forms / PDFs" onPress={() => navigation.navigate('FormsList', { installationId })} />
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
        title="Delete from this device"
        variant="danger"
        style={{ marginTop: spacing.xl }}
        onPress={() => {
          Alert.alert(
            'Delete from this device?',
            'Local zones, boards, forms, and their on-device evidence will be removed. Any Cloud Backup remains available to authorized users.',
            [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete local copy',
              style: 'destructive',
              onPress: async () => {
                await installationsRepo.remove(installationId);
                navigation.popToTop();
              },
            },
            ],
          );
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
