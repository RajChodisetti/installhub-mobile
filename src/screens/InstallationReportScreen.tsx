import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  CheckCircle2,
  Circle,
  Cloud,
  FileText,
  Server,
  Smartphone,
} from 'lucide-react-native';
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
  installationReportJobMatchesSelection,
  installationReportWeight,
  importedSourceRevisionStillMatches,
  isInstallationTreeBackedUpCurrent,
  isRetryableFormPdfError,
  rememberReportJob,
  rememberedReportJob,
  resolveInstallationPackServerTarget,
  shareInstallationPackPdf,
  waitForReportJob,
  type InstallationReportWeight,
} from '../services';
import { Button, Card, LoadingState, SectionHeader } from '../components/ui';
import { SelectChips } from '../components/forms';
import { useTheme } from '../context/AppProviders';
import { radii, spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import type {
  FormSubmission,
  InstallationReportDetailMode,
} from '../types';
import {
  formsRepo,
  getInstallationBackupTree,
  getInstallationSyncMetadata,
  installationsRepo,
} from '../repositories';
import { useSyncStatus } from '../services/SyncStatusContext';
import { apiClient } from '../api/apiClient';
import { FORM_DEFINITION_BY_TYPE } from '../forms/catalog';

type Props = NativeStackScreenProps<RootStackParamList, 'InstallationReport'>;

const DETAIL_MODES: InstallationReportDetailMode[] = [
  'by-electrical-hierarchy',
  'by-zone',
];

function detailModeLabel(mode: InstallationReportDetailMode): string {
  return mode === 'by-zone' ? 'By physical zone' : 'By electrical hierarchy';
}

function reportPathCopy(weight: InstallationReportWeight): {
  title: string;
  detail: string;
} {
  if (weight.path === 'API_REQUIRED') {
    return {
      title: 'API server required for original evidence',
      detail: weight.reasons.join('; '),
    };
  }
  if (weight.path === 'API_RECOMMENDED') {
    return {
      title: 'API server recommended for this heavier pack',
      detail: weight.reasons.join('; '),
    };
  }
  return {
    title: 'Suitable for on-device generation',
    detail: 'The API server remains available if you prefer background generation.',
  };
}

export function InstallationReportScreen({ route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { triggerSync } = useSyncStatus();
  const { item, zones, boards, siteAssets, loading } =
    useInstallation(installationId);
  const [busy, setBusy] = useState(false);
  const [pdfStatus, setPdfStatus] = useState('');
  const [forms, setForms] = useState<FormSubmission[]>([]);
  const [selectedFormIds, setSelectedFormIds] = useState<string[]>([]);
  const [detailMode, setDetailMode] =
    useState<InstallationReportDetailMode>('by-electrical-hierarchy');
  const [weight, setWeight] = useState<InstallationReportWeight | null>(null);

  useEffect(() => {
    let cancelled = false;
    setForms([]);
    setSelectedFormIds([]);
    void formsRepo.listByInstallation(installationId).then((loaded) => {
      if (cancelled) return;
      setForms(loaded);
      setSelectedFormIds(
        loaded
          .filter((form) => form.status === 'Completed')
          .map((form) => form.id),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [installationId]);

  const completedForms = useMemo(
    () => forms.filter((form) => form.status === 'Completed'),
    [forms],
  );
  const selectedFormIdSet = useMemo(
    () => new Set(selectedFormIds),
    [selectedFormIds],
  );
  const formSelectionInvalid =
    completedForms.length > 0 && selectedFormIds.length === 0;

  useEffect(() => {
    let cancelled = false;
    if (formSelectionInvalid) {
      setWeight(null);
      return () => {
        cancelled = true;
      };
    }
    void getInstallationBackupTree(installationId).then((tree) => {
      if (cancelled || !tree) return;
      try {
        setWeight(installationReportWeight(tree, selectedFormIds));
      } catch {
        setWeight(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [formSelectionInvalid, installationId, selectedFormIds]);

  const toggleForm = (formId: string) => {
    setSelectedFormIds((current) =>
      current.includes(formId)
        ? current.filter((id) => id !== formId)
        : [...current, formId],
    );
  };

  const confirmCloudBackupOptIn = (
    isImportedLocalCopy: boolean,
  ): Promise<boolean> =>
    new Promise((resolve) => {
      Alert.alert(
        isImportedLocalCopy ? 'Back Up This Copy' : 'Cloud Backup Required',
        isImportedLocalCopy
          ? 'This cpN copy has local changes or incomplete import provenance, so its original cloud installation cannot safely represent it. Enable Cloud Backup to save this copy under its own ID before generating the pack.'
          : 'API server pack generation needs an up-to-date secure backup of this installation and its original evidence.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          {
            text: isImportedLocalCopy
              ? 'Back Up This Copy'
              : 'Enable Cloud Backup',
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
      dialogTitle: `Share ${item?.site_name ?? 'installation'} installation pack`,
    });
  };

  const generateServerPack = async () => {
    if (!item || formSelectionInvalid) return;
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
        selectedFormIds,
      );

      if (!target.usesOriginalImportedRecord) {
        if (!latest.cloud_backup_enabled) {
          if (!await confirmCloudBackupOptIn(Boolean(latest.is_imported_copy))) {
            return;
          }
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
        if (!tree) {
          throw new Error('Installation tree not found after Cloud Backup.');
        }
        syncMetadata = await getInstallationSyncMetadata(latest.id);
        if (!isInstallationTreeBackedUpCurrent(tree, syncMetadata)) {
          throw new Error(
            'Cloud Backup changed or remained pending while the pack was prepared. Run backup again before generating the server pack.',
          );
        }
        target = resolveInstallationPackServerTarget(
          tree,
          syncMetadata,
          false,
          selectedFormIds,
        );
        if (target.usesOriginalImportedRecord) {
          throw new Error('The local backup target could not be verified.');
        }
      }

      const legacyJobKey = installationReportJobKey(latest.id);
      const jobKey = installationReportJobKey(
        latest.id,
        target.installationId,
        installationPackRevision(tree, syncMetadata),
        target.recordVersionNumber,
        detailMode,
        target.formSubmissionIds,
      );
      await clearRememberedReportJob(legacyJobKey);
      const remembered = await rememberedReportJob(jobKey);
      let jobId = remembered?.jobId ?? null;
      let expectedPayloadHash = remembered?.recordVersionPayloadHash;
      let expectedVariantKey = remembered?.reportVariantKey;
      if (jobId) {
        try {
          const existing = await apiClient.getExportJobStatus(jobId);
          if (
            existing.status === 'failed' ||
            !installationReportJobMatchesSelection(
              existing,
              target,
              detailMode,
              expectedPayloadHash,
              expectedVariantKey,
            )
          ) {
            await clearRememberedReportJob(jobKey);
            jobId = null;
          } else {
            expectedPayloadHash = existing.recordVersionPayloadHash;
            expectedVariantKey = existing.reportVariantKey;
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
          target,
          detailMode,
        );
        if (
          !installationReportJobMatchesSelection(started, target, detailMode)
        ) {
          throw new Error(
            'The report job did not preserve the requested grouping and record version.',
          );
        }
        jobId = started.jobId;
        expectedPayloadHash = started.recordVersionPayloadHash;
        expectedVariantKey = started.reportVariantKey;
        await rememberReportJob(jobKey, jobId, started);
      }

      const ready = await waitForReportJob(jobId, (status) => {
        const progress =
          status.progressCurrent != null && status.progressTotal
            ? ` (${status.progressCurrent}/${status.progressTotal})`
            : '';
        setPdfStatus(`${status.phase || 'Generating pack…'}${progress}`);
      });
      if (
        !installationReportJobMatchesSelection(
          ready,
          target,
          detailMode,
          expectedPayloadHash,
          expectedVariantKey,
        )
      ) {
        throw new Error(
          'The completed report no longer matches the selected grouping or record version.',
        );
      }
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
        error instanceof Error
          ? error.message
          : 'The installation pack could not be generated.',
      );
    } finally {
      setBusy(false);
      setPdfStatus('');
    }
  };

  const generateLocalPack = async (qualityTier = 0) => {
    if (!item || formSelectionInvalid) return;
    setBusy(true);
    setPdfStatus(
      `Preparing ${FORM_PDF_TIERS[qualityTier]?.label.toLowerCase() || 'pack'}…`,
    );
    try {
      const tree = await getInstallationBackupTree(item.id);
      if (!tree) throw new Error('Installation tree not found.');
      await shareInstallationPackPdf(
        {
          tree,
          selectedFormIds,
          detailMode,
        },
        qualityTier,
        setPdfStatus,
      );
    } catch (error) {
      if (!isRetryableFormPdfError(error)) {
        Alert.alert(
          'PDF Error',
          error instanceof Error
            ? error.message
            : 'The installation pack could not be generated.',
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
            : [
                {
                  text: 'Retry Reduced Quality',
                  onPress: () => void generateLocalPack(nextTier),
                },
              ]),
          { text: 'API Server', onPress: () => void generateServerPack() },
        ],
      );
    } finally {
      setBusy(false);
      setPdfStatus('');
    }
  };

  if (loading || !item) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  const weightCopy = weight ? reportPathCopy(weight) : null;
  const preferServer =
    weight?.path === 'API_RECOMMENDED' || weight?.path === 'API_REQUIRED';

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.pad}
    >
      <Text style={[typography.title, { color: colors.reportNavy }]}>FIELD APP COMPLETE</Text>
      <Text style={{ color: colors.mutedForeground, marginBottom: spacing.lg }}>
        Installation Report
      </Text>

      <Card>
        <Text style={[typography.heading, { color: colors.foreground }]}>
          {item.site_name}
        </Text>
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

      <SectionHeader title="Report contents" />
      <Card>
        <View style={styles.contentsTitle}>
          <FileText color={colors.primary} size={22} />
          <Text style={[typography.subheading, { color: colors.foreground, flex: 1 }]}>
            Map, details and selected forms
          </Text>
        </View>
        <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 20 }}>
          Every PDF includes the Sustainability Wise logo, the generated electrical single-line map, its complete symbol key, and exact load, asset, device and channel details.
        </Text>
        <SelectChips
          label="Organise details"
          value={detailMode}
          options={DETAIL_MODES}
          onChange={setDetailMode}
          getLabel={detailModeLabel}
        />
      </Card>

      <SectionHeader
        title={`Completed forms (${selectedFormIds.length}/${completedForms.length})`}
      />
      <Card>
        {completedForms.length ? (
          <>
            <View style={styles.formActions}>
              <Button
                title="Select all"
                variant="ghost"
                style={styles.smallAction}
                disabled={busy || selectedFormIds.length === completedForms.length}
                onPress={() => setSelectedFormIds(completedForms.map((form) => form.id))}
              />
              <Button
                title="Clear"
                variant="ghost"
                style={styles.smallAction}
                disabled={busy || selectedFormIds.length === 0}
                onPress={() => setSelectedFormIds([])}
              />
            </View>
            {completedForms.map((form) => {
              const selected = selectedFormIdSet.has(form.id);
              const label =
                FORM_DEFINITION_BY_TYPE[form.form_type]?.shortTitle ?? form.form_type;
              return (
                <Pressable
                  key={form.id}
                  onPress={() => toggleForm(form.id)}
                  disabled={busy}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected, disabled: busy }}
                  accessibilityLabel={`${label}, completed form`}
                  style={({ pressed }) => [
                    styles.formRow,
                    { borderColor: colors.border, opacity: pressed ? 0.82 : 1 },
                  ]}
                >
                  {selected ? (
                    <CheckCircle2 color={colors.primary} size={22} />
                  ) : (
                    <Circle color={colors.mutedForeground} size={22} />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                      {label}
                    </Text>
                    <Text style={{ color: colors.mutedForeground, marginTop: 3, fontSize: 12 }}>
                      {form.attachments.length} evidence image{form.attachments.length === 1 ? '' : 's'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
            {formSelectionInvalid ? (
              <Text style={{ color: colors.destructive, marginTop: spacing.sm }}>
                Select at least one completed form to generate this installation pack.
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={{ color: colors.mutedForeground }}>
            No completed forms are available. You can still generate the electrical map and installation details.
          </Text>
        )}
      </Card>

      <SectionHeader title="Generation method" />
      <Card>
        <View style={styles.contentsTitle}>
          {preferServer ? (
            <Server color={colors.primary} size={23} />
          ) : (
            <Smartphone color={colors.primary} size={23} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={[typography.subheading, { color: colors.foreground }]}>
              {weightCopy?.title ?? 'Checking report size…'}
            </Text>
            {weight ? (
              <Text style={{ color: colors.mutedForeground, marginTop: 4, lineHeight: 19 }}>
                About {weight.estimatedPages} pages · {weight.nodeCount} map symbols · {weight.formCount} forms · {weight.attachmentCount} evidence images
              </Text>
            ) : null}
          </View>
        </View>
        {weightCopy?.detail ? (
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 20 }}>
            {weightCopy.detail}
          </Text>
        ) : null}

        <Button
          title={busy ? 'Preparing PDF…' : 'Generate on this iPhone'}
          variant={preferServer ? 'secondary' : 'primary'}
          style={{ marginTop: spacing.lg }}
          disabled={
            busy || formSelectionInvalid || weight?.path === 'API_REQUIRED'
          }
          accessibilityHint="Generates and shares the PDF locally using the current installation snapshot."
          onPress={() => void generateLocalPack()}
        />
        <Button
          title={busy ? 'Preparing PDF…' : 'Generate through API server'}
          variant={preferServer ? 'primary' : 'secondary'}
          style={{ marginTop: spacing.sm }}
          disabled={busy || formSelectionInvalid}
          accessibilityHint="Backs up current data when needed, generates the PDF in the background, then securely downloads it."
          onPress={() => void generateServerPack()}
        />
        <View style={styles.serverNote}>
          <Cloud color={colors.mutedForeground} size={17} />
          <Text style={{ color: colors.mutedForeground, flex: 1, lineHeight: 19, fontSize: 12 }}>
            API generation follows the same report grouping and selected forms. Completed records stay version-pinned; drafts use the latest backed-up snapshot.
          </Text>
        </View>
      </Card>

      <SectionHeader title="Summary" />
      <Card>
        <Text style={{ color: colors.foreground }}>
          Zones: {zones.length}
          {'\n'}
          Boards: {boards.length}
          {'\n'}
          Meters: {boards.reduce((total, board) => total + board.meters.length, 0)}
          {'\n'}
          Site assets: {siteAssets.length}
          {'\n'}
          Completed forms: {completedForms.length}
        </Text>
      </Card>

      {pdfStatus ? (
        <Text
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
          style={{ color: colors.mutedForeground, marginTop: spacing.md }}
        >
          {pdfStatus}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
  contentsTitle: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  formActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  smallAction: {
    minWidth: 108,
  },
  formRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.sm,
  },
  serverNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    borderRadius: radii.sm,
    marginTop: spacing.md,
  },
});
