import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { siteAssetsRepo } from '../repositories';
import type { SiteAsset } from '../types';
import { FormModal, SiteAssetForm } from '../components/forms';
import { Badge, Button, LoadingState } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'SiteAssetDetail'>;

export function SiteAssetDetailScreen({ navigation, route }: Props) {
  const { assetId } = route.params;
  const { colors } = useTheme();
  const [asset, setAsset] = useState<SiteAsset | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    setAsset(await siteAssetsRepo.getById(assetId));
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, [assetId]);

  if (loading || !asset) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.title, { color: colors.foreground }]}>{asset.asset_name}</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 6 }}>
        {asset.asset_type}
        {asset.display_code ? ` · ${asset.display_code}` : ''}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {asset.electrical_board_tbc ? <Badge label="Board TBC" tone="tbc" /> : null}
        {asset.meter_present ? <Badge label="Metered" tone="success" /> : null}
      </View>
      {asset.location_description ? (
        <Text style={{ color: colors.mutedForeground, marginTop: 12 }}>{asset.location_description}</Text>
      ) : null}
      {asset.comments ? (
        <Text style={{ color: colors.foreground, marginTop: 12 }}>{asset.comments}</Text>
      ) : null}

      <Button title="Edit asset" style={{ marginTop: spacing.lg }} onPress={() => setEditOpen(true)} />
      <Button
        title="Delete asset"
        variant="danger"
        style={{ marginTop: spacing.md }}
        onPress={() => {
          Alert.alert('Delete asset?', undefined, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: async () => {
                await siteAssetsRepo.remove(assetId);
                navigation.goBack();
              },
            },
          ]);
        }}
      />

      <FormModal visible={editOpen} title="Edit asset" onClose={() => setEditOpen(false)}>
        <SiteAssetForm
          initial={asset}
          onSubmit={async (values) => {
            await siteAssetsRepo.update(assetId, values);
            setEditOpen(false);
            await refresh();
          }}
        />
      </FormModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
