import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInstallation } from '../hooks';
import {
  FORM_PDF_TIERS,
  FormPdfGenerationError,
  RemoteFormEvidenceError,
  clearRememberedReportJob,
  downloadReportJob,
  hasIntactImportedSourceProvenance,
  installationPackRevision,
  installationReportJobKey,
  importedSourceRevisionStillMatches,
  isInstallationTreeBackedUpCurrent,
  isRetryableFormPdfError,
  rememberReportJob,
  rememberedReportJob,
  resolveInstallationPackServerTarget,
  shareInstallationPackPdf,
  waitForReportJob,
} from '../services';
import { Button, Card, LoadingState, SectionHeader } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import type { FormSubmission } from '../types';
import {
  formsRepo,
  getInstallationBackupTree,
  getInstallationSyncMetadata,
  installationsRepo,
} from '../repositories';
import { useSyncStatus } from '../services/SyncStatusContext';
import { apiClient } from '../api/apiClient';

type Props = NativeStackScreenProps<RootStackParamList, 'InstallationReport'>;

export function InstallationReportScreen({ route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { triggerSync } = useSyncStatus();
  const { item, zones, boards, siteAssets, loading } = useInstallation(installationId);
  const [busy, setBusy] = useState(false);
  const [pdfStatus, setPdfStatus] = useState('');
  const [forms, setForms] = useState<FormSubmission[]>([]);

  useEffect(() => {
    void formsRepo.listByInstallation(installationId).then(setForms);
  }, [installationId]);

  if (loading || !item) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }
  const completedForms = forms.filter((form) => form.status === 'Completed');

  const confirmCloudBackupOptIn = (isImportedLocalCopy: boolean): Promise<boolean> =>
    new Promise((resolve) => {
      Alert.alert(
        isImportedLocalCopy ? 'Back Up This Copy' : 'Cloud Backup Required',
        isImportedLocalCopy
          ? 'This cpN copy has local changes or incomplete import provenance, so its original cloud installation cannot safely represent it. Enable Cloud Backup to save this copy under its own ID before generating the pack.'
          : 'API server pack generation needs an up-to-date secure backup of this installation and its original evidence.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          {
            text: isImportedLocalCopy ? 'Back Up This Copy' : 'Enable Cloud Backup',
            onPress: () => resolve(true),
          },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });

  const shareDownloaded = async (uri: string) => {
    if (!await Sharing.isAvailableAsync()) {
      throw new Error('Sharing is not available on this device.');
    }
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: `Share ${item.site_name} installation pack`,
    });
  };

  const generateServerPack = async () => {
    setBusy(true);
    setPdfStatus('Checking report provenance…');
    try {
      const latest = await installationsRepo.getById(item.id);
      if (!latest) throw new Error('Installation not found.');
      let tree = await getInstallationBackupTree(latest.id);
      if (!tree) throw new Error('Installation tree not found.');
      let syncMetadata = await getInstallationSyncMetadata(latest.id);
      const localImportProvenanceIsIntact =
        hasIntactImportedSourceProvenance(tree, syncMetadata);
      const remoteSourceRevisionMatches =
        localImportProvenanceIsIntact &&
        await importedSourceRevisionStillMatches(tree.installation);
      let target = resolveInstallationPackServerTarget(
        tree,
        syncMetadata,
        remoteSourceRevisionMatches,
      );

      if (!target.usesOriginalImportedRecord) {
        if (!latest.cloud_backup_enabled) {
          if (!await confirmCloudBackupOptIn(Boolean(latest.is_imported_copy))) return;
          await installationsRepo.setCloudBackupEnabled(latest.id, true);
        }
        setPdfStatus('Backing up the latest installation and original evidence…');
        const sync = await triggerSync();
        if (sync.phase !== 'done') {
          throw new Error(
            sync.lastError ||
              'Cloud Backup did not complete. The server pack was not started with stale data.',
          );
        }
        tree = await getInstallationBackupTree(latest.id);
        if (!tree) throw new Error('Installation tree not found after Cloud Backup.');
        syncMetadata = await getInstallationSyncMetadata(latest.id);
        if (!isInstallationTreeBackedUpCurrent(tree, syncMetadata)) {
          throw new Error(
            'Cloud Backup changed or remained pending while the pack was prepared. Run backup again before generating the server pack.',
          );
        }
        target = resolveInstallationPackServerTarget(tree, syncMetadata);
        if (target.usesOriginalImportedRecord) {
          throw new Error('The local backup target could not be verified.');
        }
      }

      const legacyJobKey = installationReportJobKey(latest.id);
      const jobKey = installationReportJobKey(
        latest.id,
        target.installationId,
        installationPackRevision(tree, syncMetadata),
      );
      await clearRememberedReportJob(legacyJobKey);
      let jobId = await rememberedReportJob(jobKey);
      if (jobId) {
        try {
          const existing = await apiClient.getExportJobStatus(jobId);
          if (existing.status === 'failed') {
            await clearRememberedReportJob(jobKey);
            jobId = null;
          }
        } catch {
          await clearRememberedReportJob(jobKey);
          jobId = null;
        }
      }
      if (!jobId) {
        setPdfStatus('Queuing installation pack on the API server…');
        const started = await apiClient.startInstallationPdfJob(
          target.installationId,
          target.formSubmissionIds,
        );
        jobId = started.jobId;
        await rememberReportJob(jobKey, jobId);
      }

      const ready = await waitForReportJob(jobId, (status) => {
        const progress =
          status.progressCurrent != null && status.progressTotal
            ? ` (${status.progressCurrent}/${status.progressTotal})`
            : '';
        setPdfStatus(`${status.phase || 'Generating pack…'}${progress}`);
      });
      setPdfStatus('Downloading installation pack securely…');
      const uri = await downloadReportJob(
        jobId,
        ready.filename || `${item.site_name}-installation-pack.pdf`,
      );
      await clearRememberedReportJob(jobKey);
      await shareDownloaded(uri);
    } catch (error) {
      Alert.alert(
        'API Server PDF Error',
        error instanceof Error ? error.message : 'The installation pack could not be generated.',
      );
    } finally {
      setBusy(false);
      setPdfStatus('');
    }
  };

  const generateLocalPack = async (qualityTier = 0) => {
    setBusy(true);
    setPdfStatus(`Preparing ${FORM_PDF_TIERS[qualityTier]?.label.toLowerCase() || 'pack'}…`);
    try {
      await shareInstallationPackPdf(
        {
          installation: item,
          zones,
          boards,
          siteAssets,
          completedForms,
        },
        qualityTier,
        setPdfStatus,
      );
    } catch (error) {
      if (!isRetryableFormPdfError(error)) {
        Alert.alert(
          'PDF Error',
          error instanceof Error ? error.message : 'The installation pack could not be generated.',
        );
        return;
      }
      const nextTier =
        error instanceof FormPdfGenerationError
          ? error.nextTier
          : error instanceof RemoteFormEvidenceError
            ? null
            : qualityTier + 1 < FORM_PDF_TIERS.length
              ? qualityTier + 1
              : null;
      Alert.alert(
        error instanceof RemoteFormEvidenceError
          ? 'Original Evidence Is In Cloud Backup'
          : 'This Pack Is Too Large For The Device',
        `${error instanceof Error ? error.message : 'Local PDF generation failed.'}\n\nUse the API server for the complete original-quality installation pack.`,
        [
          { text: 'Cancel', style: 'cancel' },
          ...(nextTier == null
            ? []
            : [{
                text: 'Retry Reduced Quality',
                onPress: () => void generateLocalPack(nextTier),
              }]),
          { text: 'API Server', onPress: () => void generateServerPack() },
        ],
      );
    } finally {
      setBusy(false);
      setPdfStatus('');
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.title, { color: colors.reportNavy }]}>INSTALLHUB</Text>
      <Text style={{ color: colors.mutedForeground, marginBottom: spacing.lg }}>Installation Report</Text>

      <Card>
        <Text style={[typography.heading, { color: colors.foreground }]}>{item.site_name}</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>
          {item.client_name}
          {'\n'}
          {item.site_address}
          {'\n'}
          Inspector: {item.inspector_name}
          {'\n'}
          Date: {item.audit_date}
        </Text>
      </Card>

      <SectionHeader title="Summary" />
      <Card>
        <Text style={{ color: colors.foreground }}>
          Zones: {zones.length}
          {'\n'}
          Boards: {boards.length}
          {'\n'}
          Meters: {boards.reduce((n, b) => n + b.meters.length, 0)}
          {'\n'}
          Site assets: {siteAssets.length}
          {'\n'}
          Completed forms: {completedForms.length}
        </Text>
      </Card>

      <Button
        title={busy ? 'Preparing PDF…' : 'Export / Share PDF'}
        style={{ marginTop: spacing.xl }}
        disabled={busy}
        onPress={() => void generateLocalPack()}
      />
      {pdfStatus ? (
        <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm }}>
          {pdfStatus}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
