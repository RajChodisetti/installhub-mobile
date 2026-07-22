import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useZoneWorkspace } from '../hooks';
import { electricalAssetsRepo, siteAssetsRepo, zonesRepo } from '../repositories';
import { ElectricalAssetCard, SiteAssetCard } from '../components/domain';
import {
  Button,
  EmptyState,
  LoadingState,
  PhotoThumbnailGrid,
  SectionHeader,
  TextArea,
  TextField,
} from '../components/ui';
import { ElectricalAssetForm, FormModal, SiteAssetForm } from '../components/forms';
import { pickLocalPhoto, sendZoneSummaryStub, takeLocalPhoto } from '../services';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'ZoneWorkspace'>;

export function ZoneWorkspaceScreen({ navigation, route }: Props) {
  const { zoneId, installationId } = route.params;
  const { colors } = useTheme();
  const { zone, boards, siteAssets, loading, refresh } = useZoneWorkspace(zoneId);
  const [boardModal, setBoardModal] = useState(false);
  const [assetModal, setAssetModal] = useState(false);
  const [editZone, setEditZone] = useState(false);
  const [zoneName, setZoneName] = useState('');
  const [zoneDesc, setZoneDesc] = useState('');

  const addPhoto = async (source: 'library' | 'camera') => {
    const uri = source === 'camera' ? await takeLocalPhoto() : await pickLocalPhoto();
    if (!uri || !zone) return;
    await zonesRepo.update(zoneId, { photos: [...zone.photos, uri] });
    await refresh();
  };

  if (loading || !zone) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.title, { color: colors.foreground }]}>{zone.zone_name}</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 6 }}>
        {zone.zone_description || 'No description'}
      </Text>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: spacing.lg, flexWrap: 'wrap' }}>
        <Button
          title="Edit zone"
          variant="secondary"
          onPress={() => {
            setZoneName(zone.zone_name);
            setZoneDesc(zone.zone_description);
            setEditZone(true);
          }}
        />
        <Button
          title="Send Summary"
          variant="secondary"
          onPress={async () => {
            const res = await sendZoneSummaryStub({
              installationId,
              zoneId,
              zoneName: zone.zone_name,
              boardCount: boards.length,
              assetCount: siteAssets.length,
            });
            Alert.alert('Summary', res.message);
          }}
        />
      </View>

      <SectionHeader
        title={`Photos (${zone.photos.length})`}
        actionLabel="+ Library"
        onAction={() => void addPhoto('library')}
      />
      <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 8 }}>
        Long-press a thumbnail to remove
      </Text>
      {zone.photos.length === 0 ? (
        <EmptyState title="No photos yet" subtitle="Attach switchboard or site context photos." />
      ) : (
        <PhotoThumbnailGrid
          uris={zone.photos}
          onAdd={() => void addPhoto('library')}
          onRemove={(uri) => {
            Alert.alert('Remove photo?', undefined, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Remove',
                style: 'destructive',
                onPress: async () => {
                  await zonesRepo.update(zoneId, {
                    photos: zone.photos.filter((p) => p !== uri),
                  });
                  await refresh();
                },
              },
            ]);
          }}
        />
      )}
      <Button
        title="Take photo"
        variant="ghost"
        style={{ marginTop: spacing.sm, marginBottom: spacing.md }}
        onPress={() => void addPhoto('camera')}
      />

      <SectionHeader title="Electrical boards" actionLabel="+ Add" onAction={() => setBoardModal(true)} />
      {boards.length === 0 ? (
        <EmptyState title="No boards" subtitle="Add MSB/DB boards for this zone." />
      ) : (
        boards.map((b) => (
          <ElectricalAssetCard
            key={b.id}
            item={b}
            onPress={() =>
              navigation.navigate('BoardDetail', { boardId: b.id, installationId, zoneId })
            }
          />
        ))
      )}

      <SectionHeader title="Site assets" actionLabel="+ Add" onAction={() => setAssetModal(true)} />
      {siteAssets.length === 0 ? (
        <EmptyState title="No site assets" subtitle="Add HVAC, lighting, EV, etc." />
      ) : (
        siteAssets.map((a) => (
          <SiteAssetCard
            key={a.id}
            item={a}
            onPress={() =>
              navigation.navigate('SiteAssetDetail', { assetId: a.id, installationId, zoneId })
            }
          />
        ))
      )}

      <FormModal visible={boardModal} title="Add board" onClose={() => setBoardModal(false)}>
        <ElectricalAssetForm
          initial={{ audit_id: installationId, zone_id: zoneId }}
          onSubmit={async (values) => {
            const created = await electricalAssetsRepo.create({
              ...values,
              audit_id: installationId,
              zone_id: zoneId,
            });
            setBoardModal(false);
            navigation.navigate('BoardDetail', {
              boardId: created.id,
              installationId,
              zoneId,
            });
          }}
        />
      </FormModal>

      <FormModal visible={assetModal} title="Add site asset" onClose={() => setAssetModal(false)}>
        <SiteAssetForm
          initial={{ audit_id: installationId, zone_id: zoneId }}
          onSubmit={async (values) => {
            const created = await siteAssetsRepo.create({
              ...values,
              audit_id: installationId,
              zone_id: zoneId,
            });
            setAssetModal(false);
            navigation.navigate('SiteAssetDetail', {
              assetId: created.id,
              installationId,
              zoneId,
            });
          }}
        />
      </FormModal>

      <FormModal visible={editZone} title="Edit zone" onClose={() => setEditZone(false)}>
        <TextField label="Zone name" value={zoneName} onChangeText={setZoneName} />
        <TextArea label="Description" value={zoneDesc} onChangeText={setZoneDesc} />
        <Button
          title="Save"
          onPress={async () => {
            await zonesRepo.update(zoneId, {
              zone_name: zoneName.trim(),
              zone_description: zoneDesc.trim(),
            });
            setEditZone(false);
            await refresh();
          }}
        />
        <View style={{ height: 12 }} />
        <Button
          title="Delete zone"
          variant="danger"
          onPress={() => {
            Alert.alert('Delete zone?', 'Boards and assets in this zone will be removed.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  await zonesRepo.remove(zoneId);
                  navigation.goBack();
                },
              },
            ]);
          }}
        />
      </FormModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
