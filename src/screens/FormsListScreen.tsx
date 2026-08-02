import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Sharing from 'expo-sharing';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useForms } from '../hooks';
import { FORM_DEFINITION_BY_TYPE } from '../forms/catalog';
import {
  formsRepo,
  getInstallationBackupTree,
  getInstallationSyncMetadata,
  installationsRepo,
} from '../repositories';
import {
  FORM_PDF_TIERS,
  FormPdfGenerationError,
  RemoteFormEvidenceError,
  clearRememberedReportJob,
  downloadReportJob,
  formReportJobKey,
  hasIntactImportedSourceProvenance,
  importedSourceRevisionStillMatches,
  installationPackRevision,
  isInstallationTreeBackedUpCurrent,
  isRetryableFormPdfError,
  rememberReportJob,
  rememberedReportJob,
  reportJobMatchesSelection,
  resolveFormReportServerTarget,
  shareFormPdf,
  waitForReportJob,
} from '../services';
import { Badge, Button, Card, EmptyState, LoadingState, SectionHeader } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { formatDate } from '../utils';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import type { FormSubmission } from '../types';
import { apiClient } from '../api/apiClient';
import { useSyncStatus } from '../services/SyncStatusContext';

type Props = NativeStackScreenProps<RootStackParamList, 'FormsList'>;

export function FormsListScreen({ navigation, route }: Props) {
  const { installationId } = route.params;
  const { items, loading } = useForms(installationId);
  const { colors } = useTheme();
  const { triggerSync } = useSyncStatus();
  const [pdfBusyFormId, setPdfBusyFormId] = useState<string | null>(null);
  const [pdfStatus, setPdfStatus] = useState('');

  const confirmCloudBackupOptIn = (): Promise<boolean> =>
    new Promise((resolve) => {
      Alert.alert(
        'Cloud Backup Required',
        'API server PDF generation needs an up-to-date secure backup of this installation and its original evidence.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Enable Cloud Backup', onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });

  const shareDownloadedPdf = async (form: FormSubmission, uri: string) => {
    if (!await Sharing.isAvailableAsync()) {
      throw new Error('Sharing is not available on this device.');
    }
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: `Share ${FORM_DEFINITION_BY_TYPE[form.form_type].shortTitle}`,
    });
  };

  const generateServerPdf = async (form: FormSubmission) => {
    setPdfBusyFormId(form.id);
    setPdfStatus('Checking Cloud Backup…');
    const definition = FORM_DEFINITION_BY_TYPE[form.form_type];
    try {
      const installation = await installationsRepo.getById(form.installation_id);
      if (!installation) throw new Error('Installation not found.');
      let tree = await getInstallationBackupTree(installation.id);
      if (!tree) throw new Error('Installation tree not found.');
      let syncMetadata = await getInstallationSyncMetadata(installation.id);
      let currentForm = tree.formSubmissions.find((item) => item.id === form.id);
      if (!currentForm) throw new Error('Form submission not found.');
      const localImportProvenanceIsIntact =
        hasIntactImportedSourceProvenance(tree, syncMetadata);
      const remoteSourceRevisionMatches =
        localImportProvenanceIsIntact &&
        await importedSourceRevisionStillMatches(tree.installation);
      let target = resolveFormReportServerTarget(
        tree.installation,
        currentForm,
        localImportProvenanceIsIntact && remoteSourceRevisionMatches,
      );
      if (!target.usesOriginalImportedRecord) {
        if (!installation.cloud_backup_enabled) {
          if (!await confirmCloudBackupOptIn()) return;
          await installationsRepo.setCloudBackupEnabled(installation.id, true);
        }
        setPdfStatus('Backing up the latest form and original evidence…');
        const sync = await triggerSync();
        if (sync.phase !== 'done') {
          throw new Error(
            sync.lastError ||
              'Cloud Backup did not complete. The server PDF was not started with stale data.',
          );
        }
        tree = await getInstallationBackupTree(installation.id);
        if (!tree) throw new Error('Installation tree not found after Cloud Backup.');
        syncMetadata = await getInstallationSyncMetadata(installation.id);
        if (!isInstallationTreeBackedUpCurrent(tree, syncMetadata)) {
          throw new Error(
            'Cloud Backup changed or remained pending while the PDF was prepared. Run backup again before generating the server PDF.',
          );
        }
        currentForm = tree.formSubmissions.find((item) => item.id === form.id);
        if (!currentForm) throw new Error('Form submission not found after Cloud Backup.');
        target = resolveFormReportServerTarget(
          tree.installation,
          currentForm,
          hasIntactImportedSourceProvenance(tree, syncMetadata),
        );
        if (target.usesOriginalImportedRecord) {
          throw new Error('The local backup target could not be verified.');
        }
      }

      const legacyJobKey = formReportJobKey(form.id);
      const jobKey = formReportJobKey(
        form.id,
        target.installationId,
        target.formId,
        installationPackRevision(tree, syncMetadata),
        target.recordVersionNumber,
      );
      await clearRememberedReportJob(legacyJobKey);
      const remembered = await rememberedReportJob(jobKey);
      let jobId = remembered?.jobId ?? null;
      let expectedPayloadHash = remembered?.recordVersionPayloadHash;
      if (jobId) {
        try {
          const existing = await apiClient.getExportJobStatus(jobId);
          if (
            existing.status === 'failed' ||
            !reportJobMatchesSelection(existing, target, expectedPayloadHash)
          ) {
            await clearRememberedReportJob(jobKey);
            jobId = null;
          } else {
            expectedPayloadHash = existing.recordVersionPayloadHash;
          }
        } catch {
          await clearRememberedReportJob(jobKey);
          jobId = null;
        }
      }
      if (!jobId) {
        setPdfStatus('Queuing API server PDF…');
        const started = await apiClient.startFormPdfJob(
          target.installationId,
          target.formId,
          target,
        );
        if (!reportJobMatchesSelection(started, target)) {
          throw new Error('The report job did not preserve the requested record version.');
        }
        jobId = started.jobId;
        expectedPayloadHash = started.recordVersionPayloadHash;
        await rememberReportJob(jobKey, jobId, started);
      }

      const ready = await waitForReportJob(jobId, (status) => {
        const progress =
          status.progressCurrent != null && status.progressTotal
            ? ` (${status.progressCurrent}/${status.progressTotal})`
            : '';
        setPdfStatus(`${status.phase || 'Generating PDF…'}${progress}`);
      });
      if (!reportJobMatchesSelection(ready, target, expectedPayloadHash)) {
        throw new Error('The completed report job no longer matches the requested version.');
      }
      setPdfStatus('Downloading PDF securely…');
      const uri = await downloadReportJob(
        jobId,
        ready.filename || `${definition.shortTitle}.pdf`,
      );
      await clearRememberedReportJob(jobKey);
      setPdfStatus('');
      await shareDownloadedPdf(form, uri);
    } catch (error) {
      Alert.alert(
        'API Server PDF Error',
        error instanceof Error ? error.message : 'The server PDF could not be generated.',
      );
    } finally {
      setPdfBusyFormId(null);
      setPdfStatus('');
    }
  };

  const generateLocalPdf = async (form: FormSubmission, qualityTier = 0) => {
    setPdfBusyFormId(form.id);
    setPdfStatus(`Preparing ${FORM_PDF_TIERS[qualityTier]?.label.toLowerCase() || 'PDF'}…`);
    try {
      await shareFormPdf(form, qualityTier);
      setPdfStatus('');
    } catch (error) {
      if (!isRetryableFormPdfError(error)) {
        Alert.alert(
          'PDF Error',
          error instanceof Error ? error.message : 'The device could not generate the PDF.',
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
      const buttons: Parameters<typeof Alert.alert>[2] = [
        { text: 'Cancel', style: 'cancel' },
        { text: 'API Server', onPress: () => void generateServerPdf(form) },
      ];
      if (nextTier != null) {
        buttons.splice(1, 0, {
          text: 'Retry Reduced Quality',
          onPress: () => void generateLocalPdf(form, nextTier),
        });
      }
      Alert.alert(
        error instanceof RemoteFormEvidenceError
          ? 'Original Evidence Is In Cloud Backup'
          : 'This PDF Is Too Large For The Device',
        `${error instanceof Error ? error.message : 'Local PDF generation failed.'}\n\nUse the API server for the original-quality report${nextTier != null ? ', or retry with smaller images' : ''}.`,
        buttons,
      );
    } finally {
      setPdfBusyFormId(null);
      setPdfStatus('');
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.pad}
    >
      <Text style={[typography.title, { color: colors.foreground }]}>Field forms</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 5 }}>
        Draft, complete, export and amend installation records.
      </Text>
      <Button
        title="Start New Form"
        style={{ marginTop: spacing.lg }}
        onPress={() => navigation.navigate('FormTypePicker', { installationId })}
      />
      <SectionHeader title={`${items.length} forms`} />
      {loading && !items.length ? <LoadingState /> : null}
      {!loading && !items.length ? (
        <EmptyState title="No forms yet" subtitle="Start the first field record for this site." />
      ) : null}
      {items.map((form) => {
        const definition = FORM_DEFINITION_BY_TYPE[form.form_type];
        const thisPdfIsBusy = pdfBusyFormId === form.id;
        const anotherPdfIsBusy = pdfBusyFormId != null && !thisPdfIsBusy;
        return (
          <Card key={form.id} style={{ marginBottom: spacing.md }}>
            <View style={styles.row}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[typography.subheading, { color: colors.foreground }]}>
                  {definition.shortTitle}
                </Text>
                <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
                  Updated {formatDate(form.updated_at)}
                  {form.supersedes_id ? ' · Amendment' : ''}
                </Text>
              </View>
              <Badge
                label={form.status}
                tone={form.status === 'Completed' ? 'success' : 'default'}
              />
            </View>
            <View style={{ gap: 8, marginTop: spacing.md }}>
              <Button
                title={form.status === 'Completed' ? 'View record' : 'Continue draft'}
                variant="secondary"
                onPress={() => navigation.navigate('FormEditor', { formId: form.id })}
              />
              {form.status === 'Completed' ? (
                <>
                  <Button
                    title={thisPdfIsBusy ? 'Preparing PDF…' : 'Export / Share PDF'}
                    disabled={pdfBusyFormId != null}
                    onPress={() => void generateLocalPdf(form)}
                  />
                  {thisPdfIsBusy && pdfStatus ? (
                    <Text style={{ color: colors.mutedForeground }}>
                      {pdfStatus}
                    </Text>
                  ) : null}
                  <Button
                    title="Create amendment"
                    variant="ghost"
                    disabled={anotherPdfIsBusy || thisPdfIsBusy}
                    onPress={() => {
                      void formsRepo.cloneAmendment(form.id).then((draft) =>
                        navigation.navigate('FormEditor', { formId: draft.id }),
                      );
                    }}
                  />
                </>
              ) : null}
            </View>
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
});
