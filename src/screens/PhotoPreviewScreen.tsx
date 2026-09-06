import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useForms, useInstallation } from '../hooks';
import { Button, Card, EmptyState, LoadingState, SectionHeader } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { ReportEvidencePreview } from '../components/ReportEvidencePreview';
import { RecordLoadState } from '../components/RecordLoadState';
import { cachedThumbnailUri } from '../repositories/cloudSyncRepository';
import { clientReportModel } from '../domain/clientReport';
import { useClientReportPhotoSelection } from '../hooks/useClientReportPhotoSelection';

type Props = NativeStackScreenProps<RootStackParamList, 'PhotoPreview'>;

export function PhotoPreviewScreen({ navigation, route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { item, zones, boards, siteAssets, meterDevices, loading, error: installationError, refresh: refreshInstallation } = useInstallation(installationId);
  const { items: forms, loading: formsLoading, loaded: formsLoaded, error: formsError, refresh: refreshForms } = useForms(installationId);

  const selection = useClientReportPhotoSelection(installationId);
  const report = useMemo(() => item ? clientReportModel({
    installation: item, zones, electricalAssets: boards, siteAssets, meterDevices,
    formSubmissions: forms,
  }, selection.excluded) : null, [item, boards, forms, meterDevices, siteAssets, zones, selection.excluded]);
  const photoItems = report?.photos ?? [];
  const missingItems = report?.missingEvidence ?? [];

  const readError = installationError || formsError || selection.readError;
  const retry = () => { void Promise.all([refreshInstallation(), refreshForms(), selection.refresh()]).catch(() => undefined); };
  if ((loading && !item) || (formsLoading && !formsLoaded) || (selection.loading && !selection.loaded)) return <LoadingState />;
  if (!item || (!formsLoaded && formsError) || !selection.loaded) return <RecordLoadState
    title="Photo gallery unavailable" message={readError || 'This installation is no longer available. Return to My jobs and refresh assigned work.'}
    onRetry={retry} onBack={() => navigation.goBack()} />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.title, { color: colors.foreground }]}>Photo gallery</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 4, marginBottom: spacing.lg }}>
        Choose the evidence included in the client report preview.
      </Text>

      {readError ? <RecordLoadState inline title="Could not refresh photo gallery" message={`${readError} The previously loaded evidence remains visible. Retry before changing the selection.`}
        onRetry={retry} onBack={() => navigation.goBack()} /> : null}
      <Button title="Open client report" variant="secondary" onPress={() => navigation.navigate('ClientReport', { installationId })} />
      <Text style={{ color: colors.mutedForeground, marginVertical: spacing.md }}>{report?.includedPhotos.length ?? 0} of {photoItems.length} photos included</Text>
      {selection.writeError ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{selection.writeError}</Text> : null}
      <SectionHeader title={`${photoItems.length} evidence file${photoItems.length === 1 ? '' : 's'}`} />
      {photoItems.length === 0 ? (
        <EmptyState
          title="No photos captured"
          subtitle="Evidence added in zones, switchboards, devices, assets, and field forms appears here."
        />
      ) : photoItems.map((p) => (
          <Card key={p.key} style={{ marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <ReportEvidencePreview
                label={p.label}
                uri={cachedThumbnailUri(p.uri) ?? p.uri}
                style={styles.thumb}
              />
              <Text style={{ color: colors.foreground, flex: 1, fontWeight: '600' }}>{p.label}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.md }}>
              <Text style={{ flex: 1, color: colors.foreground }}>Include in client report preview</Text>
              <Switch disabled={loading || formsLoading || selection.loading || !selection.loaded || Boolean(readError)} accessibilityLabel={`Include ${p.label} in client report preview`} value={selection.excluded[p.key] !== p.uri} onValueChange={(included) => void selection.toggle(p, included)} trackColor={{ true: colors.primary }} />
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
