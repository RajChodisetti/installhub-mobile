import React, { useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInstallation } from '../hooks';
import { Button, Card, LoadingState, SectionHeader } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { cachedThumbnailUri } from '../repositories/cloudSyncRepository';

type Props = NativeStackScreenProps<RootStackParamList, 'PhotoPreview'>;

type PhotoItem = { id: string; label: string; uri?: string };

export function PhotoPreviewScreen({ navigation, route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { item, zones, boards, siteAssets, loading } = useInstallation(installationId);

  const photoItems = useMemo(() => {
    const items: PhotoItem[] = [];
    zones.forEach((z) => {
      if (z.photos.length === 0) {
        items.push({ id: `zone-${z.id}`, label: `Zone · ${z.zone_name} (no photos)` });
      } else {
        z.photos.forEach((uri, idx) => {
          items.push({ id: `zone-${z.id}-${idx}`, label: `Zone · ${z.zone_name}`, uri });
        });
      }
    });
    boards.forEach((b) => {
      const uris = [b.photo, ...(b.extra_photos ?? [])].filter(Boolean) as string[];
      if (uris.length === 0) {
        items.push({ id: `board-${b.id}`, label: `Board · ${b.display_code} (no photos)` });
      } else {
        uris.forEach((uri, idx) => {
          items.push({ id: `board-${b.id}-${idx}`, label: `Board · ${b.display_code}`, uri });
        });
      }
    });
    siteAssets.forEach((a) => {
      const uris = [a.location_photo, ...(a.extra_photos ?? [])].filter(Boolean) as string[];
      if (uris.length === 0) {
        items.push({ id: `asset-${a.id}`, label: `Asset · ${a.asset_name} (no photos)` });
      } else {
        uris.forEach((uri, idx) => {
          items.push({ id: `asset-${a.id}-${idx}`, label: `Asset · ${a.asset_name}`, uri });
        });
      }
    });
    return items;
  }, [zones, boards, siteAssets]);

  const [included, setIncluded] = useState<Record<string, boolean>>({});

  if (loading || !item) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.title, { color: colors.foreground }]}>Photo Preview</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 4, marginBottom: spacing.lg }}>
        Toggle items for client report PDF. Local file:// URIs until cloud upload is wired.
      </Text>

      <SectionHeader title={`${photoItems.length} items`} />
      {photoItems.map((p) => {
        const on = included[p.id] ?? true;
        return (
          <Card key={p.id} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ flex: 1, paddingRight: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                {p.uri ? (
                  <Image source={{ uri: cachedThumbnailUri(p.uri) ?? p.uri }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, { backgroundColor: colors.muted }]} />
                )}
                <Text style={{ color: colors.foreground, flex: 1 }}>{p.label}</Text>
              </View>
              <Switch
                value={on}
                onValueChange={(v) => setIncluded((prev) => ({ ...prev, [p.id]: v }))}
              />
            </View>
          </Card>
        );
      })}

      <Button
        title="Back to Client Report"
        variant="secondary"
        style={{ marginTop: spacing.lg }}
        onPress={() => navigation.navigate('ClientReport', { installationId })}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
  thumb: { width: 48, height: 48, borderRadius: 8 },
});
