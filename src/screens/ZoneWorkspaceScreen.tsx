import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInstallation, useZoneWorkspace } from '../hooks';
import { electricalAssetsRepo, getLocalDeletionPreview, siteAssetsRepo, zonesRepo } from '../repositories';
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
  const {
    item: installation,
    boards: installationBoards,
    gridSupplies,
  } = useInstallation(installationId);
  const readOnly = installation?.status === 'Completed';
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
          disabled={readOnly}
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
        onAction={readOnly ? undefined : () => void addPhoto('library')}
      />
      <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 8 }}>
        Use the named Remove control below a photo to delete it.
      </Text>
      {zone.photos.length === 0 ? (
        <EmptyState title="No photos yet" subtitle="Attach switchboard or site context photos." />
      ) : (
        <PhotoThumbnailGrid
          uris={zone.photos}
          onAdd={readOnly ? undefined : () => void addPhoto('library')}
          onRemove={readOnly ? undefined : (uri) => {
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
        disabled={readOnly}
        style={{ marginTop: spacing.sm, marginBottom: spacing.md }}
        onPress={() => void addPhoto('camera')}
      />

      <SectionHeader title="Electrical boards" actionLabel={readOnly ? undefined : '+ Add'} onAction={readOnly ? undefined : () => setBoardModal(true)} />
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

      <SectionHeader title="Site assets" actionLabel={readOnly ? undefined : '+ Add'} onAction={readOnly ? undefined : () => setAssetModal(true)} />
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
          sourceBoards={installationBoards}
          gridSupplies={gridSupplies}
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
          sourceBoards={installationBoards}
          gridSupplies={gridSupplies}
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
          disabled={readOnly}
          onPress={() => { void (async () => {
            const preview = await getLocalDeletionPreview({ kind: 'zone', id: zoneId });
            const impact = preview
              ? `\n\nDeletes ${preview.deletes.boards} board(s), ${preview.deletes.siteAssets} asset(s), ${preview.deletes.meters} meter(s), ${preview.deletes.assignments} assignment(s), and ${preview.deletes.forms} form(s).`
              : '';
            Alert.alert(
              'Delete zone?',
              `Boards, site assets, linked forms, and form evidence in this zone will be removed from this device. References from other zones will be marked TBC.${impact}`,
              [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  await zonesRepo.remove(zoneId);
                  navigation.goBack();
                },
              },
              ],
            );
          })(); }}
        />
      </FormModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
