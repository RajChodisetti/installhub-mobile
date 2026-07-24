import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import * as Sharing from 'expo-sharing';
import {
  StackActions,
  usePreventRemove,
  type NavigationAction,
} from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  FORM_DEFINITION_BY_TYPE,
  answersAfterChange,
  isFieldVisible,
  isSectionVisible,
  meterAfterCommsReplacement,
  optionsForField,
  validateForm,
  type FormFieldDefinition,
} from '../forms/catalog';
import { BarcodeScanField } from '../components/BarcodeScanField';
import {
  electricalAssetsRepo,
  formsRepo,
  getInstallationBackupTree,
  getInstallationSyncMetadata,
  installationsRepo,
} from '../repositories';
import {
  FORM_PDF_TIERS,
  FormPdfGenerationError,
  RemoteFormEvidenceError,
  addFormPhoto,
  clearRememberedReportJob,
  deleteFormPhoto,
  downloadReportJob,
  formReportJobKey,
  hasIntactImportedSourceProvenance,
  importedSourceRevisionStillMatches,
  installationPackRevision,
  isInstallationTreeBackedUpCurrent,
  isRetryableFormPdfError,
  rememberReportJob,
  rememberedReportJob,
  resolveFormReportServerTarget,
  shareFormPdf,
  waitForReportJob,
} from '../services';
import type { FormAttachment, FormSubmission, FormValue, Meter } from '../types';
import { Badge, Button, Card, LoadingState, SectionHeader, TextArea, TextField } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { createId } from '../utils';
import { radii, spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { cachedThumbnailUri } from '../repositories/cloudSyncRepository';
import { apiClient } from '../api/apiClient';
import { useSyncStatus } from '../services/SyncStatusContext';
import {
  createDraftAutosaveCoordinator,
  type DraftAutosaveCoordinator,
} from '../services/draftAutosave';

type Props = NativeStackScreenProps<RootStackParamList, 'FormEditor'>;
type DraftSnapshot = Pick<FormSubmission, 'id' | 'answers' | 'attachments'>;

function ChoiceRow({
  options,
  value,
  onChange,
  disabled,
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.choices}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled }}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.choice,
              {
                borderColor: selected ? colors.primary : colors.border,
                backgroundColor: selected ? colors.primary : colors.card,
                opacity: pressed ? 0.82 : disabled ? 0.65 : 1,
              },
            ]}
          >
            <Text
              style={{
                color: selected ? colors.primaryForeground : colors.foreground,
                fontWeight: '600',
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function FormEditorScreen({ navigation, route }: Props) {
  const { formId } = route.params;
  const { colors } = useTheme();
  const { triggerSync } = useSyncStatus();
  const [form, setForm] = useState<FormSubmission | null>(null);
  const [answers, setAnswers] = useState<Record<string, FormValue>>({});
  const [attachments, setAttachments] = useState<FormAttachment[]>([]);
  const [saving, setSaving] = useState(false);
  const [addingSlot, setAddingSlot] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfStatus, setPdfStatus] = useState('');
  const [hasPendingSave, setHasPendingSave] = useState(false);
  const [releasedNavigationAction, setReleasedNavigationAction] =
    useState<NavigationAction | null>(null);
  const initialized = useRef(false);
  const mounted = useRef(true);
  const navigationFlushRunning = useRef(false);
  const autosaveRef = useRef<
    DraftAutosaveCoordinator<DraftSnapshot, FormSubmission> | null
  >(null);
  if (!autosaveRef.current) {
    autosaveRef.current = createDraftAutosaveCoordinator({
      delayMs: 650,
      persist: (snapshot) =>
        formsRepo.updateDraft(snapshot.id, {
          answers: snapshot.answers,
          attachments: snapshot.attachments,
        }),
      onPendingChange: (pending) => {
        if (mounted.current) setHasPendingSave(pending);
      },
      onSavingChange: (nextSaving) => {
        if (mounted.current) setSaving(nextSaving);
      },
      onPersisted: (savedForm) => {
        if (mounted.current) setForm(savedForm);
      },
    });
  }
  const autosave = autosaveRef.current;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void autosave.dispose();
    };
  }, [autosave]);

  useEffect(() => {
    let active = true;
    initialized.current = false;
    void formsRepo.getById(formId).then((item) => {
      if (!active || !mounted.current) return;
      setForm(item);
      setAnswers(item?.answers ?? {});
      setAttachments(item?.attachments ?? []);
      initialized.current = true;
    });
    return () => {
      active = false;
    };
  }, [formId]);

  useEffect(() => {
    if (!initialized.current || !form || form.status === 'Completed') return;
    autosave.schedule({ id: form.id, answers, attachments });
  }, [answers, attachments]);

  usePreventRemove(hasPendingSave && releasedNavigationAction === null, ({ data }) => {
    if (navigationFlushRunning.current) return;
    navigationFlushRunning.current = true;
    void autosave
      .flush()
      .then(() => {
        if (mounted.current) setReleasedNavigationAction(data.action);
      })
      .catch((error) => {
        if (!mounted.current) return;
        Alert.alert(
          'Could not save form',
          error instanceof Error
            ? error.message
            : 'The latest form changes could not be saved.',
        );
      })
      .finally(() => {
        navigationFlushRunning.current = false;
      });
  });

  useEffect(() => {
    if (!releasedNavigationAction) return;
    navigation.dispatch(releasedNavigationAction);
  }, [navigation, releasedNavigationAction]);

  const definition = form ? FORM_DEFINITION_BY_TYPE[form.form_type] : null;
  const progress = useMemo(() => {
    if (!form || !definition) return { done: 0, total: 0 };
    const required = definition.sections
      .filter((section) => isSectionVisible(section, answers))
      .flatMap((section) =>
        section.fields.filter((field) => field.required && isFieldVisible(field, answers)),
      );
    const done = required.filter((field) =>
      field.kind === 'photo'
        ? attachments.some((item) => item.slot === field.key)
        : !!String(answers[field.key] ?? '').trim(),
    ).length;
    return { done, total: required.length };
  }, [form, definition, answers, attachments]);

  if (!form || !definition) return <LoadingState />;
  const readOnly = form.status === 'Completed';

  const clearAttachmentSlots = (slots: string[]) => {
    if (!slots.length) return;
    const hiddenSlots = new Set(slots);
    setAttachments((current) => {
      const removed = current.filter((item) => hiddenSlots.has(item.slot));
      for (const item of removed) {
        if (!form.supersedes_id || item.captured_at >= form.created_at) {
          deleteFormPhoto(item);
        }
      }
      return current.filter((item) => !hiddenSlots.has(item.slot));
    });
  };

  const change = (key: string, value: string) => {
    setAnswers((current) => answersAfterChange(definition, current, key, value));

    const channelLoad = /^channel\.(\d+)\.load$/.exec(key);
    if (channelLoad && value === 'Not Used') {
      clearAttachmentSlots([`channel.${channelLoad[1]}.nameplate_photos`]);
    }
    if (key === 'device.type' && value === 'A3RM') {
      clearAttachmentSlots(
        [4, 5, 6].map((channel) => `channel.${channel}.nameplate_photos`),
      );
    }
    if (key === 'works.replace_device' && value !== 'yes') {
      clearAttachmentSlots([
        'commissioning.start_screenshot',
        'commissioning.energy_screenshot',
      ]);
    }
  };

  const addPhoto = async (field: FormFieldDefinition, source: 'camera' | 'library') => {
    setAddingSlot(field.key);
    try {
      const attachment = await addFormPhoto(form.id, field.key, source);
      if (attachment) setAttachments((current) => [...current, attachment]);
    } catch (error) {
      Alert.alert('Photo error', error instanceof Error ? error.message : 'Could not save photo');
    } finally {
      setAddingSlot(null);
    }
  };

  const renderField = (field: FormFieldDefinition) => {
    if (!isFieldVisible(field, answers)) return null;
    const label = `${field.label}${field.required ? ' *' : ''}`;
    const value = String(answers[field.key] ?? '');

    if (field.kind === 'yesno') {
      return (
        <View key={field.key} style={styles.fieldBlock}>
          <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
          <ChoiceRow
            value={value}
            disabled={readOnly}
            onChange={(next) => change(field.key, next)}
            options={[
              { label: 'Yes', value: 'yes' },
              { label: 'No', value: 'no' },
              ...(field.allowNotApplicable
                ? [{ label: 'N/A', value: 'not_applicable' }]
                : []),
            ]}
          />
        </View>
      );
    }
    if (field.kind === 'select') {
      return (
        <View key={field.key} style={styles.fieldBlock}>
          <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
          <ChoiceRow
            value={value}
            disabled={readOnly}
            onChange={(next) => change(field.key, next)}
            options={optionsForField(field, answers).map((option) => ({
              label: option,
              value: option,
            }))}
          />
        </View>
      );
    }
    if (field.kind === 'photo') {
      const items = attachments.filter((item) => item.slot === field.key);
      return (
        <View key={field.key} style={styles.fieldBlock}>
          <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.photoRow}>
              {items.map((item, index) => (
                <View key={item.id} style={styles.photoItem}>
                  <Pressable
                    disabled={readOnly}
                    accessibilityRole={readOnly ? 'image' : 'button'}
                    accessibilityLabel={`${field.label} photo ${index + 1}`}
                    accessibilityHint={readOnly ? undefined : 'Long-press to remove this photo'}
                    onLongPress={() => {
                      Alert.alert('Remove photo?', undefined, [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: () => {
                            if (!form.supersedes_id || item.captured_at >= form.created_at) {
                              deleteFormPhoto(item);
                            }
                            setAttachments((current) =>
                              current.filter((candidate) => candidate.id !== item.id),
                            );
                          },
                        },
                      ]);
                    }}
                  >
                    <Image
                      source={{ uri: cachedThumbnailUri(item.uri) ?? item.uri }}
                      style={styles.photo}
                    />
                  </Pressable>
                  {readOnly ? (
                    item.caption?.trim() ? (
                      <View style={styles.savedCaption}>
                        <Text style={[styles.savedCaptionLabel, { color: colors.mutedForeground }]}>
                          Caption
                        </Text>
                        <Text style={[styles.savedCaptionText, { color: colors.foreground }]}>
                          {item.caption.trim()}
                        </Text>
                      </View>
                    ) : null
                  ) : (
                    <TextArea
                      label={`Caption ${index + 1}`}
                      accessibilityLabel={`Caption for ${field.label} photo ${index + 1}`}
                      value={item.caption ?? ''}
                      placeholder="Add a caption or comment"
                      maxLength={120}
                      onChangeText={(caption) =>
                        setAttachments((current) =>
                          current.map((candidate) =>
                            candidate.id === item.id
                              ? {
                                  ...candidate,
                                  caption: caption === '' ? undefined : caption,
                                }
                              : candidate,
                          ),
                        )
                      }
                      style={styles.captionInput}
                    />
                  )}
                </View>
              ))}
            </View>
          </ScrollView>
          {!readOnly ? (
            <View style={styles.photoActions}>
              <Button
                title={addingSlot === field.key ? 'Opening…' : 'Take photo'}
                disabled={!!addingSlot}
                onPress={() => void addPhoto(field, 'camera')}
                style={{ flex: 1 }}
              />
              <Button
                title="Choose photo"
                variant="secondary"
                disabled={!!addingSlot}
                onPress={() => void addPhoto(field, 'library')}
                style={{ flex: 1 }}
              />
            </View>
          ) : null}
          {!readOnly && items.length ? (
            <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 6 }}>
              Long-press a photo to remove it.
            </Text>
          ) : null}
        </View>
      );
    }
    if (field.scanModes?.length) {
      return (
        <BarcodeScanField
          key={field.key}
          label={label}
          value={value}
          onChangeText={(next) => change(field.key, next)}
          placeholder={field.placeholder}
          modes={field.scanModes}
          editable={!readOnly}
        />
      );
    }
    const Input = field.kind === 'multiline' ? TextArea : TextField;
    return (
      <Input
        key={field.key}
        label={label}
        value={value}
        editable={!readOnly}
        keyboardType={field.kind === 'number' ? 'numbers-and-punctuation' : 'default'}
        placeholder={field.placeholder}
        onChangeText={(next) => change(field.key, next)}
      />
    );
  };

  const syncOperationalMeter = async (completed: FormSubmission) => {
    if (!completed.board_id) return;
    const board = await electricalAssetsRepo.getById(completed.board_id);
    if (!board) return;
    if (completed.form_type === 'comms-fault' && completed.meter_id) {
      if (completed.answers['works.replace_device'] !== 'yes') return;
      const meters = board.meters.map((meter) =>
        meter.id === completed.meter_id
          ? meterAfterCommsReplacement(meter, completed.answers)
          : meter,
      );
      await electricalAssetsRepo.update(board.id, { meters });
      return;
    }
    if (
      !['ww-installation', 'a3rm-installation', 'a6m-installation'].includes(
        completed.form_type,
      )
    ) return;
    const deviceType =
      completed.form_type === 'ww-installation'
        ? String(completed.answers['device.type']) as Meter['device_type']
        : completed.form_type === 'a3rm-installation'
          ? 'A3RM'
          : 'A6M';
    const deviceId = String(
      completed.answers[
        completed.form_type === 'ww-installation' ? 'device.id' : 'auditor.serial_number'
      ] ?? '',
    );
    const deviceNumber = String(completed.answers['device.number'] ?? '');
    const channelCount = deviceType === 'A3RM' ? 3 : 6;
    const meter: Meter = {
      id: completed.meter_id ?? createId('meter'),
      device_name: `${deviceType} Auditor`,
      device_type: deviceType,
      device_id: deviceId,
      device_number: deviceNumber,
      ww_channels: Array.from({ length: channelCount }, (_, i) => ({
        load_type: String(completed.answers[`channel.${i + 1}.load`] ?? ''),
        description: String(completed.answers[`channel.${i + 1}.description`] ?? ''),
        ...(deviceType === 'A3RM'
          ? { rogowski_size: String(completed.answers[`channel.${i + 1}.rating`] ?? '') }
          : { ct_ratio: String(completed.answers[`channel.${i + 1}.rating`] ?? '') }),
      })),
    };
    const existing = board.meters.findIndex((item) => item.id === meter.id);
    const meters = [...board.meters];
    if (existing >= 0) meters[existing] = { ...meters[existing], ...meter };
    else meters.push(meter);
    await electricalAssetsRepo.update(board.id, { meters, meter_present: true });
  };

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

  const shareDownloadedPdf = async (uri: string) => {
    if (!await Sharing.isAvailableAsync()) {
      throw new Error('Sharing is not available on this device.');
    }
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: `Share ${definition.shortTitle}`,
    });
  };

  const generateServerPdf = async () => {
    setPdfBusy(true);
    setPdfStatus('Checking Cloud Backup…');
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
        setPdfStatus('Queuing API server PDF…');
        const started = await apiClient.startFormPdfJob(
          target.installationId,
          target.formId,
        );
        jobId = started.jobId;
        await rememberReportJob(jobKey, jobId);
      }

      const ready = await waitForReportJob(jobId, (status) => {
        const progress =
          status.progressCurrent != null && status.progressTotal
            ? ` (${status.progressCurrent}/${status.progressTotal})`
            : '';
        setPdfStatus(`${status.phase || 'Generating PDF…'}${progress}`);
      });
      setPdfStatus('Downloading PDF securely…');
      const uri = await downloadReportJob(
        jobId,
        ready.filename || `${definition.shortTitle}.pdf`,
      );
      await clearRememberedReportJob(jobKey);
      setPdfStatus('');
      await shareDownloadedPdf(uri);
    } catch (error) {
      Alert.alert(
        'API Server PDF Error',
        error instanceof Error ? error.message : 'The server PDF could not be generated.',
      );
    } finally {
      setPdfBusy(false);
      setPdfStatus('');
    }
  };

  const generateLocalPdf = async (qualityTier = 0) => {
    setPdfBusy(true);
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
        { text: 'API Server', onPress: () => void generateServerPdf() },
      ];
      if (nextTier != null) {
        buttons.splice(1, 0, {
          text: 'Retry Reduced Quality',
          onPress: () => void generateLocalPdf(nextTier),
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
      setPdfBusy(false);
      setPdfStatus('');
    }
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.pad}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={[typography.title, { color: colors.foreground }]}>
            {definition.shortTitle}
          </Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 5 }}>
            {readOnly
              ? 'Completed record'
              : `${progress.done} of ${progress.total} required items · ${saving ? 'Saving…' : 'Saved automatically'}`}
          </Text>
        </View>
        <Badge label={form.status} tone={readOnly ? 'success' : 'default'} />
      </View>
      <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
        <View
          style={[
            styles.progressFill,
            {
              backgroundColor: colors.primary,
              width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
            },
          ]}
        />
      </View>
      {!readOnly ? (
        <Button
          title="Use Current Location"
          variant="secondary"
          style={{ marginBottom: spacing.md }}
          onPress={async () => {
            const permission = await Location.requestForegroundPermissionsAsync();
            if (!permission.granted) {
              Alert.alert('Location permission needed', 'Latitude and longitude can still be entered manually.');
              return;
            }
            const position = await Location.getCurrentPositionAsync({});
            setAnswers((current) => ({
              ...current,
              'site.latitude': String(position.coords.latitude),
              'site.longitude': String(position.coords.longitude),
            }));
          }}
        />
      ) : null}

      {definition.sections
        .filter((section) => isSectionVisible(section, answers))
        .map((section, index) => (
          <Card key={section.title} style={{ marginBottom: spacing.md }}>
            <SectionHeader title={`${index + 1}. ${section.title}`} />
            {section.fields.map(renderField)}
          </Card>
        ))}

      {readOnly ? (
        <>
          <Button
            title={pdfBusy ? 'Preparing PDF…' : 'Export / Share PDF'}
            disabled={pdfBusy}
            onPress={() => void generateLocalPdf()}
          />
          {pdfStatus ? (
            <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm }}>
              {pdfStatus}
            </Text>
          ) : null}
          <Button
            title="Create amendment"
            variant="secondary"
            style={{ marginTop: spacing.md }}
            onPress={() => {
              void formsRepo.cloneAmendment(form.id).then((draft) =>
                navigation.replace('FormEditor', { formId: draft.id }),
              );
            }}
          />
        </>
      ) : (
        <>
          <Button
            title="Complete Form"
            onPress={async () => {
              await autosave.flush();
              const latest = await formsRepo.getById(form.id);
              if (!latest) {
                Alert.alert('Form unavailable', 'This draft could not be found.');
                return;
              }
              const errors = validateForm(latest);
              if (errors.length) {
                Alert.alert(
                  'Required items missing',
                  `${errors.slice(0, 8).join('\n')}${errors.length > 8 ? `\n…and ${errors.length - 8} more` : ''}`,
                );
                return;
              }
              await autosave.cancelPending();
              const completed = await formsRepo.complete(form.id);
              await syncOperationalMeter(completed);
              setForm(completed);
              Alert.alert('Form completed', 'This record is now read-only and ready for PDF export.');
            }}
          />
          <Button
            title="Delete Draft"
            variant="danger"
            style={{ marginTop: spacing.md }}
            onPress={() => {
              Alert.alert('Delete draft?', 'This cannot be undone.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    await autosave.cancelPending();
                    for (const attachment of attachments) {
                      if (!form.supersedes_id || attachment.captured_at >= form.created_at) {
                        deleteFormPhoto(attachment);
                      }
                    }
                    await formsRepo.removeDraft(form.id);
                    setReleasedNavigationAction(StackActions.pop(1));
                  },
                },
              ]);
            }}
          />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 56 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start' },
  progressTrack: {
    height: 8,
    borderRadius: radii.full,
    overflow: 'hidden',
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  progressFill: { height: '100%', borderRadius: radii.full },
  fieldBlock: { marginBottom: spacing.lg },
  label: { fontSize: 15, lineHeight: 21, fontWeight: '600', marginBottom: spacing.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radii.full,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  photoRow: { flexDirection: 'row', gap: spacing.sm },
  photoItem: { width: 176 },
  photo: { width: 176, height: 132, borderRadius: radii.md },
  captionInput: { minHeight: 72 },
  savedCaption: { marginTop: spacing.sm },
  savedCaptionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  savedCaptionText: { fontSize: 14, lineHeight: 20, marginTop: 3 },
  photoActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
});
