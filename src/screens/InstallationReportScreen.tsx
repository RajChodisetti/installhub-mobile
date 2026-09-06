import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { useForms, useInstallation } from '../hooks';
import { RecordLoadState } from '../components/RecordLoadState';
import { captureAuthenticatedCloudActionLease, type AuthenticatedCloudActionLease } from '../services/authenticatedCloudAction';
import { runLeasedCloudActionStep } from '../services/cloudActionLease';
import { captureAssignedWorkMutationAuthority, actorForCurrentAssignedWorkAuthority, assertCurrentAssignedWorkAuthority } from '../services/assignedWorkMutationGuard';
import { resolveHistoricalInstallationPackServerTarget } from '../services/installationPackHistory';
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
  InstallationReportDetailMode,
} from '../types';
import {
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

export function InstallationReportScreen({ navigation, route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { triggerSync } = useSyncStatus();
  const { item, zones, boards, siteAssets, loading, error: installationError, refresh: refreshInstallation } =
    useInstallation(installationId);
  const mounted = useRef(true);
  const currentInstallationId = useRef(installationId);
  currentInstallationId.current = installationId;
  const serverActionVersion = useRef(0);
  const serverActionAbort = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    setBusy(false);
    setPdfStatus('');
    return () => {
      mounted.current = false; serverActionVersion.current += 1; serverActionAbort.current?.abort();
    };
  }, [installationId]);
  const [busy, setBusy] = useState(false);
  const [pdfStatus, setPdfStatus] = useState('');
  const { items: forms, loading: formsLoading, loaded: formsLoaded, error: formsError, refresh: refreshForms } = useForms(installationId);
  const [selection, setSelection] = useState<{ installationId: string; ids: string[] } | null>(null);
  const [detailMode, setDetailMode] =
    useState<InstallationReportDetailMode>('by-electrical-hierarchy');
  const [weight, setWeight] = useState<InstallationReportWeight | null>(null);

  const [weightError, setWeightError] = useState<string | null>(null);
  const [weightLoading, setWeightLoading] = useState(false);
  const [weightRetry, setWeightRetry] = useState(0);

  const completedForms = useMemo(
    () => forms.filter((form) => form.status === 'Completed'),
    [forms],
  );
  const selectedFormIds = useMemo(() => selection?.installationId === installationId
    ? selection.ids : completedForms.map((form) => form.id), [selection, installationId, completedForms]);
  const setSelectedFormIds = (ids: string[]) => setSelection({ installationId, ids });
  const selectedFormIdSet = useMemo(
    () => new Set(selectedFormIds),
    [selectedFormIds],
  );
  const formSelectionInvalid =
    completedForms.length > 0 && selectedFormIds.length === 0;

  useEffect(() => {
    let cancelled = false;
    if (formSelectionInvalid || loading || formsLoading || installationError || formsError) {
      setWeightLoading(false);
      return () => { cancelled = true; };
    }
    setWeightLoading(true);
    setWeightError(null);
    void getInstallationBackupTree(installationId).then((tree) => {
      if (cancelled) return;
      if (!tree) throw new Error('The installation report data is no longer available.');
      setWeight(installationReportWeight(tree, selectedFormIds));
    }).catch((caught: unknown) => {
      if (!cancelled) setWeightError(caught instanceof Error ? caught.message : 'The installation report could not be loaded.');
    }).finally(() => { if (!cancelled) setWeightLoading(false); });
    return () => { cancelled = true; };
  }, [formSelectionInvalid, loading, formsLoading, installationError, formsError, installationId, selectedFormIds, weightRetry]);

  const readError = installationError ?? formsError ?? weightError;
  const readPending = loading || formsLoading || weightLoading;
  const retry = () => {
    setWeightRetry((current) => current + 1);
    void Promise.all([refreshInstallation(), refreshForms()]).catch(() => undefined);
  };
  const toggleForm = (formId: string) => setSelectedFormIds(
    selectedFormIds.includes(formId)
      ? selectedFormIds.filter((id) => id !== formId)
      : [...selectedFormIds, formId],
  );

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

  const shareDownloaded = async (uri: string, assertCurrent: () => void) => {
    assertCurrent();
    const available = await Sharing.isAvailableAsync();
    assertCurrent();
    if (!available) {
      throw new Error('Sharing is not available on this device.');
    }
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: `Share ${item?.site_name ?? 'installation'} installation pack`,
    });
  };

  const generateServerPack = async () => {
    if (!item || formSelectionInvalid || readError || readPending) return;
    const actionVersion = ++serverActionVersion.current;
    const controller = new AbortController();
    serverActionAbort.current?.abort();
    serverActionAbort.current = controller;
    const processAuthority = captureAssignedWorkMutationAuthority();
    const actorUserId = actorForCurrentAssignedWorkAuthority(processAuthority);
    let lease: AuthenticatedCloudActionLease | undefined;
    const assertCurrent = () => {
      if (!mounted.current || currentInstallationId.current !== installationId
        || serverActionVersion.current !== actionVersion || controller.signal.aborted) {
        throw new Error('The report screen changed. Open the report again to continue.');
      }
      if (!actorUserId) throw new Error('Sign in before generating a server report.');
      assertCurrentAssignedWorkAuthority(processAuthority, actorUserId);
      lease?.assertCurrent();
    };
    const step = async <T,>(operation: () => Promise<T>): Promise<T> => {
      assertCurrent();
      const result = await runLeasedCloudActionStep(lease!, operation);
      assertCurrent();
      return result;
    };
    const progress = (message: string) => { assertCurrent(); setPdfStatus(message); };
    setBusy(true);
    setPdfStatus('Checking report provenance…');
    try {
      assertCurrent();
      lease = await captureAuthenticatedCloudActionLease();
      assertCurrent();
      const latest = await step(() => installationsRepo.getById(item.id));
      if (!latest) throw new Error('Installation not found.');
      let tree = await step(() => getInstallationBackupTree(latest.id));
      if (!tree) throw new Error('Installation tree not found.');
      let syncMetadata = await step(() => getInstallationSyncMetadata(latest.id));
      const localImportProvenanceIsIntact =
        hasIntactImportedSourceProvenance(tree, syncMetadata);
      const remoteSourceRevisionMatches =
        localImportProvenanceIsIntact &&
        await step(() => importedSourceRevisionStillMatches(tree!.installation));
      let target = resolveInstallationPackServerTarget(
        tree,
        syncMetadata,
        remoteSourceRevisionMatches,
        selectedFormIds,
      );

      if (!target.usesOriginalImportedRecord) {
        if (!latest.cloud_backup_enabled) {
          if (!await step(() => confirmCloudBackupOptIn(Boolean(latest.is_imported_copy)))) {
            return;
          }
          await step(() => installationsRepo.setCloudBackupEnabled(latest.id, true, lease!.processAuthority));
        }
        progress('Backing up the latest installation and original evidence…');
        const sync = await step(() => triggerSync());
        if (sync.phase !== 'done') {
          throw new Error(
            sync.lastError ||
              'Cloud Backup did not complete. The server pack was not started with stale data.',
          );
        }
        tree = await step(() => getInstallationBackupTree(latest.id));
        if (!tree) {
          throw new Error('Installation tree not found after Cloud Backup.');
        }
        syncMetadata = await step(() => getInstallationSyncMetadata(latest.id));
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

      const selectedIncludesHistoricalForm = tree.formSubmissions.some((form) =>
        selectedFormIds.includes(form.id) && form.historical_meter_removed);
      if (target.recordVersionNumber !== undefined && selectedIncludesHistoricalForm) {
        progress('Finding the retained version for the selected forms…');
        target = await step(() => resolveHistoricalInstallationPackServerTarget(target, {
          list: (id) => step(() => apiClient.listInstallationVersions(id, lease!.cloudAuthority, controller.signal)),
          get: (id, version) => step(() => apiClient.getInstallationVersion(id, version, lease!.cloudAuthority, controller.signal)),
        }));
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
      await step(() => clearRememberedReportJob(legacyJobKey));
      const remembered = await step(() => rememberedReportJob(jobKey));
      let jobId = remembered?.jobId ?? null;
      let expectedPayloadHash = target.recordVersionPayloadHash ?? remembered?.recordVersionPayloadHash;
      let expectedVariantKey = remembered?.reportVariantKey;
      if (jobId) {
        try {
          const existing = await step(() => apiClient.getExportJobStatus(jobId!, lease!.cloudAuthority, controller.signal));
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
            await step(() => clearRememberedReportJob(jobKey));
            jobId = null;
          } else {
            expectedPayloadHash = existing.recordVersionPayloadHash;
            expectedVariantKey = existing.reportVariantKey;
          }
        } catch {
          await step(() => clearRememberedReportJob(jobKey));
          jobId = null;
        }
      }
      if (!jobId) {
        progress('Queuing installation pack on the API server…');
        const started = await step(() => apiClient.startInstallationPdfJob(
          target.installationId,
          target.formSubmissionIds,
          target,
          detailMode,
          lease!.cloudAuthority,
          controller.signal,
        ));
        if (
          !installationReportJobMatchesSelection(started, target, detailMode, expectedPayloadHash)
        ) {
          throw new Error(
            'The report job did not preserve the requested grouping and record version.',
          );
        }
        jobId = started.jobId;
        expectedPayloadHash = started.recordVersionPayloadHash;
        expectedVariantKey = started.reportVariantKey;
        await step(() => rememberReportJob(jobKey, jobId!, started));
      }

      const ready = await step(() => waitForReportJob(jobId!, (status) => {
        const progress =
          status.progressCurrent != null && status.progressTotal
            ? ` (${status.progressCurrent}/${status.progressTotal})`
            : '';
        assertCurrent();
        setPdfStatus(`${status.phase || 'Generating pack…'}${progress}`);
      }, controller.signal, { authority: lease!.cloudAuthority, assertCurrent }));
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
      progress('Downloading installation pack securely…');
      const uri = await step(() => downloadReportJob(
        jobId,
        ready.filename || `${item.site_name}-installation-pack.pdf`,
        { authority: lease!.cloudAuthority, assertCurrent },
      ));
      await step(() => clearRememberedReportJob(jobKey));
      await step(() => shareDownloaded(uri, assertCurrent));
    } catch (error) {
      try { assertCurrent(); } catch { return; }
      Alert.alert(
        'API Server PDF Error',
        error instanceof Error
          ? error.message
          : 'The installation pack could not be generated.',
      );
    } finally {
      try { assertCurrent(); setBusy(false); setPdfStatus(''); } catch { /* The originating screen or session is no longer current. */ }
      if (serverActionAbort.current === controller) serverActionAbort.current = null;
    }
  };

  const generateLocalPack = async (qualityTier = 0) => {
    if (!item || formSelectionInvalid || readError || readPending) return;
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

  if ((loading && !item) || (formsLoading && !formsLoaded)) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  if (!item || (!formsLoaded && formsError)) return <RecordLoadState
    title="Installation report unavailable" message={readError ?? 'This installation is no longer available. Return to My jobs and refresh assigned work.'}
    onRetry={retry} onBack={() => navigation.goBack()} />;

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

      {readError ? <RecordLoadState inline title="Could not refresh installation report" message={`${readError} Previously loaded information remains visible. Retry before generating a report.`}
        onRetry={retry} onBack={() => navigation.goBack()} /> : null}
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
            busy || formSelectionInvalid || readPending || Boolean(readError) || weight?.path === 'API_REQUIRED'
          }
          accessibilityHint="Generates and shares the PDF locally using the current installation snapshot."
          onPress={() => void generateLocalPack()}
        />
        <Button
          title={busy ? 'Preparing PDF…' : 'Generate through API server'}
          variant={preferServer ? 'primary' : 'secondary'}
          style={{ marginTop: spacing.sm }}
          disabled={busy || formSelectionInvalid || readPending || Boolean(readError)}
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
