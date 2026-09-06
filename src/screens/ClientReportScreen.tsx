import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useForms, useInstallation } from '../hooks';
import { Badge, Button, Card, EmptyState, LoadingState, SectionHeader } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { clientReportModel } from '../domain/clientReport';
import { useClientReportPhotoSelection } from '../hooks/useClientReportPhotoSelection';
import { ReportEvidencePreview } from '../components/ReportEvidencePreview';
import { RecordLoadState } from '../components/RecordLoadState';
import { cachedThumbnailUri } from '../repositories/cloudSyncRepository';
import { captureAssignedWorkMutationAuthority, actorForCurrentAssignedWorkAuthority, assertCurrentAssignedWorkAuthority } from '../services/assignedWorkMutationGuard';
import { shareClientReportPdf } from '../services/clientReport';

type Props = NativeStackScreenProps<RootStackParamList, 'ClientReport'>;

export function ClientReportScreen({ navigation, route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { item, zones, boards, siteAssets, meterDevices, loading, error: installationError, refresh: refreshInstallation } = useInstallation(installationId);
  const { items: forms, loading: formsLoading, loaded: formsLoaded, error: formsError, refresh: refreshForms } = useForms(installationId);
  const selection = useClientReportPhotoSelection(installationId);
  const [exporting, setExporting] = useState(false);
  const mounted = useRef(true);
  const currentInstallationId = useRef(installationId);
  currentInstallationId.current = installationId;
  const exportVersion = useRef(0);
  const exportActive = useRef(false);
  useEffect(() => {
    mounted.current = true; exportActive.current = false; setExporting(false);
    return () => { mounted.current = false; exportVersion.current += 1; };
  }, [installationId]);
  const data = useMemo(() => item ? {
    installation: item, zones, electricalAssets: boards, siteAssets, meterDevices, formSubmissions: forms,
  } : null, [item, zones, boards, siteAssets, meterDevices, forms]);
  const report = useMemo(() => data ? clientReportModel(data, selection.excluded) : null, [data, selection.excluded]);

  const readError = installationError || formsError || selection.readError;
  const retry = () => { void Promise.all([refreshInstallation(), refreshForms(), selection.refresh()]).catch(() => undefined); };
  if ((loading && !item) || (formsLoading && !formsLoaded) || (selection.loading && !selection.loaded)) return <LoadingState />;
  if (!item || !data || !report || (!formsLoaded && formsError) || !selection.loaded) return <RecordLoadState
    title="Client report unavailable" message={readError || 'This installation is no longer available. Return to My jobs and refresh assigned work.'}
    onRetry={retry} onBack={() => navigation.goBack()} />;
  const exportBlocked = exporting || loading || formsLoading || selection.loading || !selection.loaded || Boolean(readError);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.title, { color: colors.foreground }]}>Client report</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 4, marginBottom: spacing.lg }}>
        A client summary derived from this installation record.
      </Text>
      {readError ? <RecordLoadState inline title="Could not refresh client report" message={`${readError} The previously loaded report remains visible. Retry before exporting.`}
        onRetry={retry} onBack={() => navigation.goBack()} /> : null}
      <Button title={exporting ? 'Preparing PDF…' : 'Export / Share PDF'} disabled={exportBlocked} onPress={() => {
        if (exportBlocked || exportActive.current) return;
        const authority = captureAssignedWorkMutationAuthority();
        const actorUserId = actorForCurrentAssignedWorkAuthority(authority);
        if (!actorUserId) { Alert.alert('Client report unavailable', 'Sign in before exporting the client report.'); return; }
        const version = ++exportVersion.current;
        const assertCurrent = () => {
          if (!mounted.current || currentInstallationId.current !== installationId || exportVersion.current !== version) {
            throw new Error('The client report screen changed. Open the report again to export.');
          }
          assertCurrentAssignedWorkAuthority(authority, actorUserId);
        };
        exportActive.current = true; setExporting(true);
        void shareClientReportPdf(data, { ...selection.excluded }, assertCurrent)
          .catch((error: unknown) => {
            try { assertCurrent(); } catch { return; }
            Alert.alert('Client report unavailable', error instanceof Error ? error.message : 'The PDF could not be created.');
          })
          .finally(() => {
            try { assertCurrent(); exportActive.current = false; setExporting(false); } catch { /* A newer screen or session owns the UI. */ }
          });
      }} />
      <Button title="Choose photos" variant="secondary" style={{ marginVertical: spacing.md }} onPress={() => navigation.navigate('PhotoPreview', { installationId })} />
      {selection.writeError ? <Text accessibilityRole="alert" style={{ color: colors.destructive, marginBottom: spacing.md }}>{selection.writeError}</Text> : null}
      <Card>
        <Text style={[typography.subheading, { color: colors.foreground }]}>Installation summary</Text>
        <Text style={[typography.title, { color: colors.foreground, marginTop: spacing.md }]}>{item.site_name}</Text>
        <Text style={{ color: colors.mutedForeground, marginVertical: spacing.sm }}>{item.client_name} · {item.site_address}</Text>
        <Text style={{ color: colors.foreground, lineHeight: 24 }}>Installer: {item.inspector_name || 'Not recorded'}{'\n'}Date: {item.audit_date || 'Not recorded'}</Text>
        <Badge label={item.status} tone={item.status === 'Completed' ? 'success' : 'default'} />
        <Text style={{ color: colors.mutedForeground, marginTop: spacing.md }}>{zones.length} zones · {boards.length} switchboards · {report.meterCount} meters</Text>
      </Card>
      <SectionHeader title="Electrical overview" />
      <Text style={{ color: colors.foreground, lineHeight: 22, marginBottom: spacing.md }}>{boards.length} switchboards and {report.meterCount} installed meter devices were documented across {zones.length} site zones.</Text>
      {report.zones.map((zone) => <Card key={zone.id} style={{ marginBottom: spacing.sm }}>
        <Text style={{ color: colors.foreground, fontWeight: '700' }}>{zone.name}</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs }}>{zone.boards} switchboards · {zone.assets} site assets</Text>
      </Card>)}
      <SectionHeader title="Loads and site assets" />
      <Text style={{ color: colors.foreground, marginBottom: spacing.md }}>{siteAssets.length} site assets were recorded; {report.meteredAssetCount} have confirmed direct metering.</Text>
      {siteAssets.slice(0, 250).map((asset) => <Card key={asset.id} style={{ marginBottom: spacing.sm }}>
        <Text style={{ color: colors.foreground, fontWeight: '700' }}>{asset.asset_name}</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs }}>{asset.asset_type} · {asset.metering_state?.kind === 'METERED' ? 'Metered' : asset.metering_state?.kind === 'UNMETERED' ? 'Unmetered' : 'To be confirmed'}</Text>
      </Card>)}
      {siteAssets.length > 250 ? <Text style={{ color: colors.mutedForeground }}>First 250 assets shown in this preview. The formal report pack contains the authoritative dataset.</Text> : null}
      <SectionHeader title="Commissioning records" />
      <Card>
        <Text style={{ color: colors.foreground, lineHeight: 22 }}>{report.completedFormCount} completed field forms{report.completedFormNames.length ? `: ${report.completedFormNames.join(', ')}.` : '.'}</Text>
        <Text style={{ color: report.openTbcCount ? colors.destructive : colors.primary, marginTop: spacing.md }}>{report.openTbcCount ? `${report.openTbcCount} relationships remain to be confirmed.` : 'All recorded relationships are confirmed.'}</Text>
      </Card>
      <SectionHeader title="Selected evidence" />
      <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>{report.includedPhotos.length} of {report.photos.length} available photos included.</Text>
      {report.includedPhotos.length ? report.includedPhotos.map((photo) => <Card key={photo.key} style={{ marginBottom: spacing.md }}>
        <ReportEvidencePreview label={photo.label} uri={cachedThumbnailUri(photo.uri) ?? photo.uri} style={styles.photo} resizeMode="contain" />
        <Text style={{ color: colors.foreground, marginTop: spacing.sm }}>{photo.label}</Text>
      </Card>) : <Text style={{ color: colors.mutedForeground }}>No evidence selected for this preview.</Text>}
      <Button title="Generate formal report pack" variant="secondary" style={{ marginTop: spacing.lg }} onPress={() => navigation.navigate('InstallationReport', { installationId })} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
  photo: { width: '100%', height: 200, borderRadius: 10 },
});
