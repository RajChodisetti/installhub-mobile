import React, { useMemo } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useForms, useInstallation } from '../hooks';
import { Card, EmptyState, LoadingState, SectionHeader } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { cachedThumbnailUri } from '../repositories/cloudSyncRepository';

type Props = NativeStackScreenProps<RootStackParamList, 'PhotoPreview'>;

type PhotoItem = { id: string; label: string; uri: string };

export function PhotoPreviewScreen({ route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { item, zones, boards, siteAssets, meterDevices, loading } = useInstallation(installationId);
  const { items: forms, loading: formsLoading } = useForms(installationId);

  const photoItems = useMemo(() => {
    const items: PhotoItem[] = [];
    zones.forEach((z) => {
      z.photos.forEach((uri, idx) => {
        items.push({ id: `zone-${z.id}-${idx}`, label: `Zone · ${z.zone_name}`, uri });
      });
    });
    boards.forEach((b) => {
      const uris = [b.photo, ...(b.extra_photos ?? [])].filter(Boolean) as string[];
      uris.forEach((uri, idx) => {
        items.push({ id: `board-${b.id}-${idx}`, label: `Switchboard · ${b.asset_name}`, uri });
      });
    });
    siteAssets.forEach((a) => {
      const uris = [a.location_photo, ...(a.extra_photos ?? [])].filter(Boolean) as string[];
      uris.forEach((uri, idx) => {
        items.push({ id: `asset-${a.id}-${idx}`, label: `Site asset · ${a.asset_name}`, uri });
      });
    });
    meterDevices.forEach((meter) => {
      const uris = [
        meter.wwPhotos?.deviceInstalled,
        meter.wwPhotos?.switchboardOverview,
        meter.wwPhotos?.labeling,
        ...(meter.wwPhotos?.extra ?? []),
      ].filter(Boolean) as string[];
      uris.forEach((uri, index) => {
        items.push({
          id: `meter-${meter.id}-${index}`,
          label: `Device · ${meter.displayName.value || meter.serialNumber}`,
          uri,
        });
      });
    });
    forms.forEach((form) => {
      form.attachments.forEach((attachment) => {
        items.push({
          id: `form-${form.id}-${attachment.id}`,
          label: `Field form · ${attachment.caption?.trim() || attachment.slot}`,
          uri: attachment.uri,
        });
      });
    });
    return items;
  }, [boards, forms, meterDevices, siteAssets, zones]);

  const missingItems = useMemo(() => [
    ...zones.filter((zone) => zone.photos.length === 0)
      .map((zone) => `Zone · ${zone.zone_name}`),
    ...boards.filter((board) => !board.photo && !(board.extra_photos ?? []).length)
      .map((board) => `Switchboard · ${board.asset_name}`),
    ...siteAssets.filter((asset) => !asset.location_photo && !(asset.extra_photos ?? []).length)
      .map((asset) => `Site asset · ${asset.asset_name}`),
  ], [boards, siteAssets, zones]);

  if (loading || formsLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }
  if (!item) {
    return (
      <View style={{ flex: 1, padding: spacing.lg, backgroundColor: colors.background }}>
        <EmptyState
          title="Installation unavailable"
          subtitle="Return to My jobs and refresh assigned work before opening the photo gallery."
        />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.title, { color: colors.foreground }]}>Photo gallery</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 4, marginBottom: spacing.lg }}>
        Review captured zone, switchboard, device, site-asset, and field-form evidence in one place.
      </Text>

      <SectionHeader title={`${photoItems.length} evidence file${photoItems.length === 1 ? '' : 's'}`} />
      {photoItems.length === 0 ? (
        <EmptyState
          title="No photos captured"
          subtitle="Evidence added in zones, switchboards, devices, assets, and field forms appears here."
        />
      ) : photoItems.map((p) => (
          <Card key={p.id} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Image
                accessibilityLabel={p.label}
                source={{ uri: cachedThumbnailUri(p.uri) ?? p.uri }}
                style={styles.thumb}
              />
              <Text style={{ color: colors.foreground, flex: 1, fontWeight: '600' }}>{p.label}</Text>
            </View>
          </Card>
        ))}

      {missingItems.length ? (
        <>
          <SectionHeader title={`Items without evidence · ${missingItems.length}`} />
          <Card>
            {missingItems.map((label, index) => (
              <Text
                key={`${label}:${index}`}
                style={{ color: colors.mutedForeground, marginBottom: spacing.xs }}
              >
                {label}
              </Text>
            ))}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
  thumb: { width: 88, height: 72, borderRadius: 10 },
});
