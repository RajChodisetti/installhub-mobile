import { FormScrollView } from '../components/ui';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInstallation } from '../hooks';
import {
  acceptAssignedWorkServerChanges,
  getLocalDeletionPreview,
  gridSuppliesRepo,
  installationsRepo,
  zonesRepo,
} from '../repositories';
import { StatusChip, ZoneCard } from '../components/domain';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingState,
  SectionHeader,
  TextArea,
  TextField,
} from '../components/ui';
import { FormModal } from '../components/forms';
import { useAuth, useTheme } from '../context/AppProviders';
import {
  ApiError,
  apiClient,
  assertCurrentCloudSessionAuthority,
  captureCloudSessionAuthority,
  cloudConnectionErrorMessage,
} from '../api/apiClient';
import {
  getInstallationBackupTree,
  getInstallationSyncMetadata,
  getPendingCompleteBackupAttempt,
} from '../repositories/cloudSyncRepository';
import { useSyncStatus } from '../services/SyncStatusContext';
import { formatDate, formatDateTime } from '../utils';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { recordCompletionRejection } from '../services/operationalDiagnostics';
import {
  partitionReadinessIssues,
  summarizeReadinessIssues,
} from '../domain/reconciliationWorkflow';
import {
  availableZoneCode,
  isZoneCodeAvailable,
  isValidZoneCode,
  ZONE_CODE_MAX_LENGTH,
} from '../domain/namingV2';
import {
  resumeAuditWorkForInstallation,
  suspendAuditWorkForInstallation,
} from '../services/auditWorkTrackingBridge';
import {
  assignedWorkPrestartActionIsLocked,
  assignedWorkPrestartIsAcknowledged,
  assignedWorkPrestartIsRequired,
  assignedWorkSummarySha256,
} from '../services/assignedWorkPrestart';
import {
  COMPLETION_NOTES_MAX_LENGTH,
  captureCompletionTreeSnapshot,
  completionFailureIsDefinitiveRejection,
  completionFailureAllowsTrackingResume,
  completionIdempotencyKey,
  normalizeCompletionNotes,
  pendingCompletionNotesRequestField,
} from '../services/installationCompletion';
import {
  assignedWorkActionIsLocked,
  assertCurrentAssignedWorkAuthority,
  captureAuditWorkResumeAuthority,
  captureAssignedWorkMutationAuthority,
} from '../services/assignedWorkMutationGuard';
import {
  captureAuthenticatedCloudActionLease,
  type AuthenticatedCloudActionLease,
} from '../services/authenticatedCloudAction';
import {
  applyLeasedCloudActionState,
  runLeasedCloudActionStep,
} from '../services/cloudActionLease';
import { replacementMeterNumbersFromStored } from '../domain/replacementMeterPlanning';

type Props = NativeStackScreenProps<RootStackParamList, 'InstallationDetail'>;

const assignedWorkChangeLabels: Record<string, string> = {
  client_name: 'client name',
  customer_name: 'client name',
  inspector_name: 'assigned technician',
  audit_date: 'scheduled date',
  job_end_date: 'job end date',
  job_end_time: 'job end time',
  existing_device_id: 'existing device ID',
  job_comments: 'job comments',
  schedule_event_id: 'Scheduler assignment',
  schedule_title: 'title',
  scheduled_start_at: 'scheduled start',
  scheduled_end_at: 'scheduled finish',
  deadline_at: 'deadline',
  schedule_status: 'job status',
};

export function InstallationDetailScreen({ navigation, route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { user } = useAuth();
  const { syncing, triggerSync } = useSyncStatus();
  const {
    item,
    zones,
    boards,
    siteAssets,
    gridSupplies,
    meterDevices,
    measurementAssignments,
    readiness,
    loading,
    error: loadError,
    refresh,
  } = useInstallation(installationId);
  const [zoneModal, setZoneModal] = useState(false);
  const [zoneName, setZoneName] = useState('');
  const [zoneCode, setZoneCode] = useState('');
  const zoneCodeEdited = useRef(false);
  const [zoneDesc, setZoneDesc] = useState('');
  const [zoneBusy, setZoneBusy] = useState(false);
  const zoneCreating = useRef(false);
  const [backupChanging, setBackupChanging] = useState(false);
  const [completionBusy, setCompletionBusy] = useState(false);
  const [completionNotes, setCompletionNotes] = useState('');
  const completionNotesInstallationId = useRef<string | null>(null);
  const [prestartModal, setPrestartModal] = useState(false);
  const [prestartAcknowledging, setPrestartAcknowledging] = useState(false);
  const promptedPrestartKey = useRef<string | null>(null);
  const [reopenModal, setReopenModal] = useState(false);
  const [reopenReason, setReopenReason] = useState('');
  const [gridModal, setGridModal] = useState(false);
  const [editingGridId, setEditingGridId] = useState<string | null>(null);
  const [gridName, setGridName] = useState('');
  const [gridNmi, setGridNmi] = useState('');
  const [gridExternalKey, setGridExternalKey] = useState('');
  const [gridDefault, setGridDefault] = useState(false);
  const [gridBusy, setGridBusy] = useState(false);
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const [finalizedNamesOpen, setFinalizedNamesOpen] = useState(false);

  useEffect(() => {
    if (!item) return;
    if (completionNotesInstallationId.current !== item.id) {
      completionNotesInstallationId.current = item.id;
      setCompletionNotes(item.completion_notes ?? '');
    } else if (item.status === 'Completed') {
      setCompletionNotes(item.completion_notes ?? '');
    }

    const actorUserId = user?.id;
    if (item.assigned_work_state === 'inactive') {
      promptedPrestartKey.current = null;
      setPrestartModal(false);
      setZoneModal(false);
      setGridModal(false);
      setSecondaryOpen(false);
      setReopenModal(false);
      return;
    }
    if (!assignedWorkPrestartIsRequired(item)) {
      promptedPrestartKey.current = null;
      setPrestartModal(false);
      return;
    }
    const summary = item.assigned_work_job_summary;
    const promptKey = [
      item.id,
      actorUserId,
      summary ? assignedWorkSummarySha256(summary) : 'summary-missing',
    ].join(':');
    if (assignedWorkPrestartActionIsLocked(item, actorUserId)) {
      setZoneModal(false);
      setGridModal(false);
      setSecondaryOpen(false);
    }
    if (assignedWorkPrestartActionIsLocked(item, actorUserId)
      && promptedPrestartKey.current !== promptKey) {
      promptedPrestartKey.current = promptKey;
      setPrestartModal(true);
    }
  }, [item, user?.id]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }
  if (loadError) {
    return (
      <View style={{ flex: 1, padding: spacing.lg, backgroundColor: colors.background }}>
        <EmptyState title="Could not load installation" subtitle={loadError} />
        <Button
          title="Try again"
          style={{ marginTop: spacing.md }}
          onPress={() => { void refresh().catch(() => undefined); }}
        />
        <Button
          title="Return to installations"
          variant="secondary"
          style={{ marginTop: spacing.sm }}
          onPress={() => navigation.popToTop()}
        />
      </View>
    );
  }
  if (!item) {
    return (
      <View style={{ flex: 1, padding: spacing.lg, backgroundColor: colors.background }}>
        <EmptyState
          title="Installation unavailable"
          subtitle="This local checkout is no longer available to the signed-in account. Refresh assigned work, or open Settings to access an actor-owned recovery copy."
        />
        <Button
          title="Return to installations"
          style={{ marginTop: spacing.md }}
          onPress={() => navigation.popToTop()}
        />
      </View>
    );
  }

  const boardCount = (zoneId: string) => boards.filter((b) => b.zone_id === zoneId).length;
  const assetCount = (zoneId: string) => siteAssets.filter((a) => a.zone_id === zoneId).length;
  const authoritativeCompleted = item.status === 'Completed' && Boolean(item.record_version_number);
  const readOnly = authoritativeCompleted;
  const assignedPrestartRequired = assignedWorkPrestartIsRequired(item);
  const assignedPrestartAcknowledged = assignedWorkPrestartIsAcknowledged(
    item,
    user?.id,
  );
  const assignedWorkInactive = item.assigned_work_state === 'inactive';
  const assignedWorkActionsLocked = assignedWorkActionIsLocked(
    item,
    user?.id,
  );
  const assignedJobSummary = item.assigned_work_job_summary;
  const jobStatusLabel = authoritativeCompleted
    ? 'Completed'
    : assignedJobSummary?.schedule_status === 'in_progress'
      ? 'In progress'
      : assignedJobSummary
        ? 'Scheduled'
        : 'Draft';
  const jobStatusDescription = authoritativeCompleted
    ? 'This job is complete. Its Scheduler calendar entry is highlighted green.'
    : assignedJobSummary?.schedule_status === 'in_progress'
      ? 'Field work has started. Its Scheduler calendar entry is highlighted blue until completion.'
      : assignedJobSummary
        ? 'Opening acknowledged job work starts active tracking. Scheduler changes the entry to blue after the first active-time checkpoint syncs.'
        : 'This local installation remains a Draft until it is marked complete.';
  const canAcknowledgeAssignedSummary = Boolean(
    user?.id
    && assignedJobSummary?.actor_user_id === user.id
    && assignedJobSummary.assigned_inspector_user_id === user.id
    && item.assigned_work_actor_user_id === user.id,
  );
  const yesNoLabel = (value: boolean | null | undefined): string => (
    value === true ? 'Yes' : value === false ? 'No' : 'Not recorded'
  );
  const contactSummary = [
    assignedJobSummary?.site_contact_name,
    assignedJobSummary?.site_contact_phone,
    assignedJobSummary?.site_contact_email,
  ].filter(Boolean).join(' · ');
  const scopeSummary = [
    assignedJobSummary?.service_type,
    assignedJobSummary?.metering_solution_type,
    assignedJobSummary?.job_comments,
  ].filter(Boolean).join(' · ');
  const primaryGridSupply = gridSupplies.find((supply) => supply.isDefault) ?? gridSupplies[0];
  const electricityNmi = primaryGridSupply?.nmi?.trim() ?? '';
  const hasElectricityNmi = electricityNmi.length > 0;
  const replacementMeterNumbers = replacementMeterNumbersFromStored(item.existing_device_id);
  const recordedMeterTypes = [...new Set(meterDevices.map((meter) => (
    meter.deviceModel === 'OTHER'
      ? [meter.customManufacturerName, meter.customModelName].filter(Boolean).join(' ') || 'Other'
      : meter.deviceModel
  )))];
  const meterType = recordedMeterTypes.join(', ') || item.planned_meter_type || 'Not recorded';
  const recordedValue = (value: string | null | undefined): string => value?.trim() || 'Not recorded';
  const assignedJobDetailRows = [
    ['Title', assignedJobSummary?.schedule_title
      ?? 'Assigned job title unavailable — refresh assigned work'],
    ['Scheduled start', assignedJobSummary?.scheduled_start_at
      ? formatDateTime(assignedJobSummary.scheduled_start_at)
      : 'Not scheduled'],
    ['Scheduled finish', assignedJobSummary?.scheduled_end_at
      ? formatDateTime(assignedJobSummary.scheduled_end_at)
      : assignedJobSummary?.job_end_time || 'Not recorded'],
    ['Deadline', assignedJobSummary?.deadline_at
      ? formatDateTime(assignedJobSummary.deadline_at)
      : 'Not recorded'],
    ['Schedule status', assignedJobSummary?.schedule_status === 'in_progress'
      ? 'In progress'
      : assignedJobSummary?.schedule_status === 'planned'
        ? 'Planned'
        : 'Not scheduled'],
    ['Client', assignedJobSummary?.client_name ?? 'Assigned job summary unavailable — refresh assigned work'],
    ['Site', assignedJobSummary?.site_name ?? 'Assigned job summary unavailable — refresh assigned work'],
    ['Address', assignedJobSummary?.site_address ?? 'Assigned job summary unavailable — refresh assigned work'],
    ['Scheduled date', assignedJobSummary?.audit_date
      ? formatDate(assignedJobSummary.audit_date)
      : 'Assigned job summary unavailable — refresh assigned work'],
    ['Technician', assignedJobSummary?.inspector_name ?? 'Assigned job summary unavailable — refresh assigned work'],
    ['MaaS', yesNoLabel(assignedJobSummary?.maas)],
    ['Electricity NMI', electricityNmi],
    ['Meters to replace', replacementMeterNumbersFromStored(assignedJobSummary?.existing_device_id).join('\n')],
    ['Contact', contactSummary],
    ['Scope', scopeSummary],
    ['Custom job number', assignedJobSummary?.custom_job_number ?? ''],
    ['Access information', assignedJobSummary?.access_information ?? ''],
  ] as const;
  const installationDetailSections: Array<{
    key: 'site' | 'client' | 'job' | 'metering';
    title: string;
    rows: Array<readonly [string, string]>;
  }> = [
    {
      key: 'site',
      title: 'Site & address',
      rows: [
        ['Site Name', recordedValue(item.site_name)],
        ['Site Address', recordedValue(item.site_address)],
        ['Suburb', recordedValue(item.site_locality)],
        ['State', recordedValue(item.site_state)],
        ['Postcode', recordedValue(item.site_postcode)],
      ],
    },
    {
      key: 'client',
      title: 'Client & contact',
      rows: [
        ['Client Name', recordedValue(item.client_name)],
        ['Site Contact Name', recordedValue(item.site_contact_name)],
        ['Site Contact Number', recordedValue(item.site_contact_phone)],
        ['Site Contact Email', recordedValue(item.site_contact_email)],
      ],
    },
    {
      key: 'job',
      title: 'Job & schedule',
      rows: [
        ['Title', recordedValue(assignedJobSummary?.schedule_title)],
        ['Job Number #', recordedValue(item.custom_job_number)],
        ['Job Type', recordedValue(item.service_type)],
        ['Scheduled date', item.audit_date ? formatDate(item.audit_date) : 'Not recorded'],
        ['Job end date', item.job_end_date ? formatDate(item.job_end_date) : 'Not recorded'],
        ['Job end time', item.job_end_time || 'Not recorded'],
        ['Technician', recordedValue(item.inspector_name)],
        ['Scheduled start', assignedJobSummary?.scheduled_start_at
          ? formatDateTime(assignedJobSummary.scheduled_start_at)
          : 'Not recorded'],
        ['Deadline', assignedJobSummary?.deadline_at
          ? formatDateTime(assignedJobSummary.deadline_at)
          : 'Not recorded'],
        ['Scope Notes', recordedValue(item.job_comments)],
        ['Access information', recordedValue(item.access_information)],
      ],
    },
    {
      key: 'metering',
      title: 'Metering & supply',
      rows: [
        ['MaaS (Yes/No)', yesNoLabel(item.maas)],
        ['MAAS Type', recordedValue(item.metering_solution_type)],
        ['Meter Type', meterType],
        ['Electricity NMI', recordedValue(electricityNmi)],
        ['Meters to replace', replacementMeterNumbers.length ? replacementMeterNumbers.join('\n') : 'Not recorded'],
      ],
    },
  ];
  const showAddNmi = !readOnly && !hasElectricityNmi;
  const showReplacementActions = item.status === 'Draft' && replacementMeterNumbers.length > 0;
  const assignedWorkChangedFields = item.assigned_work_change_notice?.changed_fields
    .map((field) => assignedWorkChangeLabels[field] ?? field.replaceAll('_', ' '))
    .filter((field, index, fields) => fields.indexOf(field) === index)
    ?? [];
  const readinessSummary = summarizeReadinessIssues(readiness?.issues ?? []);
  const readinessIssueCount = readinessSummary.reduce((count, group) => count + group.count, 0);
  const readinessPartition = partitionReadinessIssues(readiness?.issues ?? [], {
    siteAssets,
    measurementAssignments,
  });
  const reconciliationIssueCount = readinessPartition.reconciliation.length;
  const readinessReviewMode = reconciliationIssueCount ? 'RECONCILIATION' : 'VALIDATION';
  const meteringCounts = {
    metered: siteAssets.filter((asset) => asset.metering_state?.kind === 'METERED').length,
    unmetered: siteAssets.filter((asset) => asset.metering_state?.kind === 'UNMETERED').length,
    tbc: siteAssets.filter((asset) => !asset.metering_state || asset.metering_state.kind === 'TBC').length,
  };
  const unassignedActiveChannels = meterDevices.flatMap((meter) => (
    (() => {
      const assignedChannelIds = new Set(
        measurementAssignments
          .filter((assignment) => assignment.meterId === meter.id)
          .flatMap((assignment) => assignment.channelIds),
      );
      return meter.channels.filter((channel) => channel.purpose !== 'SPARE' && !assignedChannelIds.has(channel.id));
    })()
  )).length;
  const brokenAssetMappings = new Set(
    readiness?.issues.filter((issue) => (
      (issue.entityType === 'site_asset'
        && (issue.code === 'METERING_STATE_INVALID' || issue.code === 'METER_PRESENT_MISMATCH'))
      || issue.entityType === 'measurement_assignment'
    )).map((issue) => `${issue.entityType}:${issue.entityId}`) ?? [],
  ).size;

  async function requestAssignedWorkAction(
    action: () => void | Promise<void>,
  ): Promise<void> {
    if (completionBusy) {
      Alert.alert(
        'Completion validation in progress',
        'Wait for the current completion attempt to finish before changing installation work.',
      );
      return;
    }
    const latest = await installationsRepo.getById(installationId);
    if (!latest) return;
    if (latest.assigned_work_state === 'inactive') {
      Alert.alert(
        'Assignment no longer active',
        'This checkout is retained for recovery, but work is locked because it is no longer assigned to this account.',
      );
      return;
    }
    if (assignedWorkActionIsLocked(latest, user?.id)) {
      setPrestartModal(true);
      return;
    }
    await action();
  }

  async function acknowledgeAssignedWorkPrestart() {
    if (!item || !user?.id) return;
    const displayedSummary = item.assigned_work_job_summary;
    if (!displayedSummary) {
      Alert.alert(
        'Could not acknowledge job details',
        'Refresh assigned work while online before acknowledging this job summary.',
      );
      return;
    }
    setPrestartAcknowledging(true);
    try {
      const latest = await installationsRepo.getById(installationId);
      if (latest?.assigned_work_refresh_conflict) {
        await acceptAssignedWorkServerChanges(installationId);
      }
      await installationsRepo.acknowledgeAssignedWorkPrestart(
        installationId,
        assignedWorkSummarySha256(displayedSummary),
      );
      await refresh();
      setPrestartModal(false);
    } catch (error) {
      Alert.alert(
        'Could not acknowledge job details',
        error instanceof Error ? error.message : 'The acknowledgement could not be saved.',
      );
    } finally {
      setPrestartAcknowledging(false);
    }
  }

  async function acceptAssignedServerJobChanges() {
    setBackupChanging(true);
    try {
      await acceptAssignedWorkServerChanges(installationId);
      await refresh();
      Alert.alert(
        'Server job changes accepted',
        'Only server-changed job fields were updated. Other device edits remain in place.',
      );
    } catch (error) {
      Alert.alert(
        'Could not accept server changes',
        error instanceof Error ? error.message : 'The server changes could not be accepted.',
      );
    } finally {
      setBackupChanging(false);
    }
  }

  async function completeInstallation() {
    if (!item) return;
    const completionActorUserId = user?.id;
    if (!completionActorUserId) {
      Alert.alert('Could not complete', 'Sign in again before completing this installation.');
      return;
    }
    const completionAuthority = captureAssignedWorkMutationAuthority();
    const completionTrackingAuthority = captureAuditWorkResumeAuthority(
      completionActorUserId,
    );
    if (item.assigned_work_state === 'inactive') {
      Alert.alert(
        'Assignment no longer active',
        'Refresh assigned work or ask the scheduler to reassign this job before completing it.',
      );
      return;
    }
    if (assignedWorkActionIsLocked(item, user?.id)) {
      setPrestartModal(true);
      return;
    }
    let rejectionRecorded = false;
    let trackingSuspended = false;
    let trackingSuspension: Awaited<ReturnType<
      typeof suspendAuditWorkForInstallation
    >> = null;
    let completionAccepted = false;
    let completionDispatchStarted = false;
    let preparedCompletionAttempt: Parameters<
      typeof installationsRepo.discardPreparedCompletionAttempt
    >[1] | null = null;
    let completionCloudAuthority: Awaited<ReturnType<
      typeof captureCloudSessionAuthority
    >> = null;
    const assertCompletionAuthority = () => {
      assertCurrentAssignedWorkAuthority(
        completionAuthority,
        completionActorUserId,
      );
      if (!completionCloudAuthority) {
        throw new Error('Cloud Backup is not connected.');
      }
      assertCurrentCloudSessionAuthority(
        completionCloudAuthority,
        completionActorUserId,
      );
    };
    const recordRejection = (code: string) => {
      rejectionRecorded = true;
      void recordCompletionRejection(code);
    };
    let enteredCompletionNotes: string | null;
    try {
      enteredCompletionNotes = normalizeCompletionNotes(completionNotes);
    } catch (error) {
      Alert.alert(
        'Could not save completion notes',
        error instanceof Error ? error.message : 'The completion notes could not be saved.',
      );
      return;
    }
    if (!readiness?.readyToComplete) {
      recordRejection(
        readiness?.issues.find((issue) => issue.severity === 'ERROR')?.code ?? 'LOCAL_READINESS',
      );
      Alert.alert(
        reconciliationIssueCount ? 'Reconciliation required' : 'Completion checks required',
        reconciliationIssueCount
          ? 'Confirm every explicitly deferred choice and resolve the remaining completion checks.'
          : 'Resolve every blocking completion check before completion.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: reconciliationIssueCount ? 'Open reconciliation' : 'Open checks',
            onPress: () => requestAssignedWorkAction(() => {
              navigation.navigate('DataView', {
                installationId,
                initialMode: readinessReviewMode,
              });
            }),
          },
        ],
      );
      return;
    }
    if (!item.cloud_backup_enabled) {
      recordRejection('CLOUD_BACKUP_DISABLED');
      Alert.alert(
        'Cloud Backup must be enabled first',
        'Authoritative completion requires your prior, explicit Cloud Backup opt-in. Open More tools, enable Cloud Backup, then complete again.',
      );
      return;
    }
    setCompletionBusy(true);
    try {
      const syncResult = await triggerSync();
      if (syncResult.phase !== 'done') {
        recordRejection(`SYNC_${syncResult.phase.toUpperCase()}`);
        throw new Error(syncResult.lastError || 'Cloud Backup did not finish successfully.');
      }
      completionCloudAuthority = await captureCloudSessionAuthority();
      if (!completionCloudAuthority) {
        throw new Error('Cloud Backup is not connected.');
      }
      const exactCompletionCloudAuthority = completionCloudAuthority;
      assertCompletionAuthority();
      const completionTree = await getInstallationBackupTree(installationId);
      assertCompletionAuthority();
      if (!completionTree) throw new Error('Installation not found.');
      const initialLatest = completionTree.installation;
      const completionSnapshot = captureCompletionTreeSnapshot(completionTree);
      if (initialLatest.assigned_work_state === 'inactive') {
        throw new Error('This job is no longer assigned to this account.');
      }
      if (assignedWorkActionIsLocked(initialLatest, completionActorUserId)) {
        setPrestartModal(true);
        return;
      }
      const serverReadiness = await apiClient.getInstallationReadiness(
        installationId,
        undefined,
        exactCompletionCloudAuthority,
      );
      assertCompletionAuthority();
      if (!serverReadiness.readyToComplete) {
        recordRejection(
          serverReadiness.issues.find((issue) => issue.severity === 'ERROR')?.code ?? 'SERVER_READINESS',
        );
        Alert.alert(
          'Cloud validation found issues',
          summarizeReadinessIssues(serverReadiness.issues)
            .map((group) => `${group.label}: ${group.count}`)
            .join('\n'),
        );
        return;
      }
      const currentAfterReadiness = await installationsRepo.getById(installationId);
      assertCompletionAuthority();
      if (!currentAfterReadiness) throw new Error('Installation not found.');
      if (
        currentAfterReadiness.assigned_work_state === 'inactive'
        || assignedWorkActionIsLocked(currentAfterReadiness, completionActorUserId)
      ) {
        throw new Error('This job is no longer available to this account.');
      }
      // The completion snapshot remains the exact post-sync tree captured
      // before the awaited server-readiness request. The serialized prepare
      // below rejects if any local edit won while readiness was in flight.
      const baseTreeRevision = completionSnapshot.baseTreeRevision;
      if (baseTreeRevision === undefined) {
        throw new Error('Cloud Backup did not persist an authoritative server revision.');
      }
      const localTreeRevision = completionSnapshot.localTreeRevision;
      if (localTreeRevision === undefined) {
        throw new Error('Local installation revision is unavailable. Sync and retry.');
      }
      if (baseTreeRevision !== serverReadiness.treeRevision) {
        throw new Error(
          'The portal changed this installation after backup. Sync and reconcile before completing.',
        );
      }
      const reusablePendingCompletion =
        completionSnapshot.pendingCompletion?.baseTreeRevision === baseTreeRevision
          && completionSnapshot.pendingCompletion.localTreeRevision === localTreeRevision
          && completionSnapshot.pendingCompletion.treeWatermark
            === completionSnapshot.treeWatermark
          ? completionSnapshot.pendingCompletion
          : null;
      const pendingCompletion = reusablePendingCompletion ?? {
        baseTreeRevision,
        localTreeRevision,
        treeWatermark: completionSnapshot.treeWatermark,
        idempotencyKey: completionIdempotencyKey(
          installationId,
          baseTreeRevision,
          enteredCompletionNotes,
        ),
        createdAt: new Date().toISOString(),
        completionNotes: enteredCompletionNotes,
      };
      const completionAttempt = {
        actorUserId: completionActorUserId,
        authority: completionAuthority,
        pendingCompletion,
      };
      const prepared = await installationsRepo.prepareCompletionAttempt(
        installationId,
        completionAttempt,
      );
      preparedCompletionAttempt = completionAttempt;
      trackingSuspension = await suspendAuditWorkForInstallation(
        installationId,
        completionTrackingAuthority,
        'completion',
      );
      trackingSuspended = Boolean(trackingSuspension);
      await installationsRepo.assertCompletionAttemptCanDispatch(
        installationId,
        completionAttempt,
      );
      assertCompletionAuthority();
      completionDispatchStarted = true;
      const response = await apiClient.completeInstallation(installationId, {
        baseTreeRevision,
        idempotencyKey: pendingCompletion.idempotencyKey,
        ...pendingCompletionNotesRequestField(pendingCompletion),
      }, exactCompletionCloudAuthority);
      assertCompletionAuthority();
      completionAccepted = true;
      if (!response.completedAt || !response.recordVersionNumber) {
        recordRejection('AUDIT_METADATA_MISSING');
        throw new Error(
          'Completion was accepted without exact audit metadata. Retry to refresh the authoritative server result.',
        );
      }
      const responseHasCompletionNotes =
        Object.prototype.hasOwnProperty.call(response, 'completionNotes')
        || Object.prototype.hasOwnProperty.call(response, 'completion_notes');
      const acceptedCompletionNotes = responseHasCompletionNotes
        ? normalizeCompletionNotes(
            response.completionNotes ?? response.completion_notes ?? null,
          )
        : Object.prototype.hasOwnProperty.call(pendingCompletion, 'completionNotes')
          ? pendingCompletion.completionNotes ?? null
          : prepared.completion_notes ?? null;
      await installationsRepo.applyServerState(installationId, {
        status: 'Completed',
        server_tree_revision: response.treeRevision,
        record_version_number: response.recordVersionNumber,
        completed_at: response.completedAt,
        completed_by_user_id: response.completedByUserId ?? user?.id,
        completed_from_revision: response.completedFromRevision ?? baseTreeRevision,
        completion_notes: acceptedCompletionNotes,
        backup_conflict: { kind: 'NONE' },
        pending_completion: undefined,
        legacy_completed_unpinned: false,
      }, {
        actorUserId: completionActorUserId,
        expectedLocalTreeRevision: localTreeRevision,
        expectedTreeWatermark: completionSnapshot.treeWatermark,
        assertCurrent: assertCompletionAuthority,
      });
      if (trackingSuspension) {
        await resumeAuditWorkForInstallation(
          trackingSuspension,
          completionTrackingAuthority,
        ).catch(() => {});
      }
      setCompletionNotes(acceptedCompletionNotes ?? '');
      await refresh();
      Alert.alert('Installation completed', `Authoritative version ${response.recordVersionNumber ?? 'created'} is pinned.`);
    } catch (error) {
      const completionWasDefinitivelyRejected =
        completionFailureIsDefinitiveRejection(error);
      let pendingCompletionClearedForResume = preparedCompletionAttempt === null;
      if (
        (!completionDispatchStarted || completionWasDefinitivelyRejected)
        && preparedCompletionAttempt
      ) {
        try {
          assertCompletionAuthority();
          await installationsRepo.discardPreparedCompletionAttempt(
            installationId,
            preparedCompletionAttempt,
          );
          assertCompletionAuthority();
          pendingCompletionClearedForResume = true;
          preparedCompletionAttempt = null;
        } catch {
          // A changed attempt or authority remains durably ineligible for
          // tracking until the next authoritative reconciliation.
          pendingCompletionClearedForResume = false;
        }
      }
      if (
        trackingSuspended
        && !completionAccepted
        && pendingCompletionClearedForResume
        && completionFailureAllowsTrackingResume(completionDispatchStarted, error)
      ) {
        try {
          assertCompletionAuthority();
          const current = await installationsRepo.getById(installationId);
          assertCompletionAuthority();
          if (
            current?.status === 'Draft'
            && !assignedWorkActionIsLocked(current, completionActorUserId)
          ) {
            if (trackingSuspension) {
              await resumeAuditWorkForInstallation(
                trackingSuspension,
                completionTrackingAuthority,
              ).catch(() => {});
            }
          }
        } catch {
          // Ambiguous or replaced authority keeps tracking suspended until the
          // authoritative lifecycle is reconciled.
        }
      }
      if (!rejectionRecorded) {
        recordRejection(
          error instanceof ApiError ? `COMPLETION_HTTP_${error.status}` : 'COMPLETION_FAILED',
        );
      }
      Alert.alert('Could not complete', cloudConnectionErrorMessage(error));
    } finally {
      setCompletionBusy(false);
    }
  }

  async function reopenInstallation() {
    if (!item) return;
    if (syncing) {
      Alert.alert('Backup in progress', 'Wait for Cloud Backup to finish before reopening.');
      return;
    }
    const reason = reopenReason.trim();
    if (!reason) return;
    if (item.server_tree_revision === undefined) {
      Alert.alert('Could not reopen', 'Sync this installation before reopening it.');
      return;
    }
    const actionLeasePromise = captureAuthenticatedCloudActionLease();
    let actionLease: AuthenticatedCloudActionLease | null = null;
    setCompletionBusy(true);
    try {
      actionLease = await actionLeasePromise;
      if (await runLeasedCloudActionStep(
        actionLease,
        () => getPendingCompleteBackupAttempt(installationId),
      )) {
        throw new Error(
          'Cloud backup confirmation is pending. Retry backup before reopening this installation.',
        );
      }
      const current = await runLeasedCloudActionStep(
        actionLease,
        () => installationsRepo.getById(installationId),
      );
      if (!current || current.status !== 'Completed') {
        throw new Error('This installation is no longer available to reopen.');
      }
      if (current.server_tree_revision === undefined) {
        throw new Error('Sync this installation before reopening it.');
      }
      const reopenTree = await runLeasedCloudActionStep(
        actionLease,
        () => getInstallationBackupTree(installationId),
      );
      if (!reopenTree) throw new Error('This installation is no longer available to reopen.');
      const reopenLocalTreeRevision = reopenTree.installation.tree_revision ?? 0;
      const reopenTreeWatermark = reopenTree.watermark;
      const reopenServerTreeRevision = current.server_tree_revision;
      if (
        reopenTree.installation.status !== 'Completed'
        || reopenTree.installation.server_tree_revision !== reopenServerTreeRevision
      ) {
        throw new Error('This installation changed before reopen validation finished.');
      }
      const response = await runLeasedCloudActionStep(
        actionLease,
        () => apiClient.reopenInstallation(installationId, {
          baseTreeRevision: reopenServerTreeRevision,
          reason,
        }, actionLease!.cloudAuthority),
      );
      await runLeasedCloudActionStep(
        actionLease,
        () => installationsRepo.applyServerState(installationId, {
          status: 'Draft',
          server_tree_revision: response.treeRevision,
          record_version_number:
            response.recordVersionNumber ?? current.record_version_number,
          reopened_at: response.reopenedAt ?? new Date().toISOString(),
          reopen_reason: response.reopenReason ?? reason,
          completion_notes: undefined,
          backup_conflict: { kind: 'NONE' },
        }, {
          actorUserId: actionLease!.actorUserId,
          expectedLocalTreeRevision: reopenLocalTreeRevision,
          expectedTreeWatermark: reopenTreeWatermark,
          expectedServerTreeRevision: reopenServerTreeRevision,
          assertCurrent: actionLease!.assertCurrent,
        }),
      );
      applyLeasedCloudActionState(actionLease, () => {
        setCompletionNotes('');
        setReopenReason('');
        setReopenModal(false);
      });
      await runLeasedCloudActionStep(actionLease, refresh);
    } catch (error) {
      let canReport = true;
      if (actionLease) {
        try {
          actionLease.assertCurrent();
        } catch {
          canReport = false;
        }
      }
      if (canReport) {
        Alert.alert('Could not reopen', cloudConnectionErrorMessage(error));
      }
    } finally {
      setCompletionBusy(false);
    }
  }

  function openGridEditor(gridId?: string) {
    if (assignedWorkActionsLocked) {
      if (assignedWorkInactive) {
        Alert.alert(
          'Assignment no longer active',
          'This checkout is retained for recovery, but work is locked until it is reassigned.',
        );
      } else {
        setPrestartModal(true);
      }
      return;
    }
    const grid = gridSupplies.find((item) => item.id === gridId);
    setEditingGridId(grid?.id ?? null);
    setGridName(grid?.name ?? '');
    setGridNmi(grid?.nmi ?? '');
    setGridExternalKey(grid?.externalKey ?? '');
    setGridDefault(grid?.isDefault ?? gridSupplies.length === 0);
    setGridModal(true);
  }

  async function disableCloudBackup(
    removeServerCopy: boolean,
    clearResolvedConflict = false,
  ) {
    if (syncing) {
      Alert.alert('Backup in progress', 'Wait for the current Cloud Backup to finish, then try again.');
      return;
    }
    const actionLeasePromise = captureAuthenticatedCloudActionLease();
    let actionLease: AuthenticatedCloudActionLease | null = null;
    setBackupChanging(true);
    let disabledLocally = false;
    let serverCopyRemoved = false;
    try {
      actionLease = await actionLeasePromise;
      if (await runLeasedCloudActionStep(
        actionLease,
        () => getPendingCompleteBackupAttempt(installationId),
      )) {
        throw new Error(
          'Cloud backup confirmation is pending. Retry backup before changing this setting.',
        );
      }
      const syncMetadata = await runLeasedCloudActionStep(
        actionLease,
        () => getInstallationSyncMetadata(installationId),
      );
      // Disable locally first. This atomic repository guard prevents a new
      // final attempt from being prepared before any destructive server call.
      await runLeasedCloudActionStep(
        actionLease,
        () => installationsRepo.setCloudBackupEnabled(
          installationId,
          false,
          actionLease!.processAuthority,
        ),
      );
      disabledLocally = true;
      if (removeServerCopy) {
        try {
          await runLeasedCloudActionStep(
            actionLease,
            () => apiClient.deleteInstallationCloud(
              installationId,
              false,
              actionLease!.cloudAuthority,
            ),
          );
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
          actionLease.assertCurrent();
        }
        serverCopyRemoved = true;
      }
      await runLeasedCloudActionStep(
        actionLease,
        () => installationsRepo.update(installationId, {
          cloud_backup_retained: !removeServerCopy && Boolean(
            syncMetadata.syncedWatermark || syncMetadata.serverTreeRevision !== undefined,
          ),
          ...(clearResolvedConflict
            ? {
                backup_conflict: { kind: 'NONE' as const },
                assigned_work_refresh_conflict: undefined,
              }
            : {}),
        }, actionLease!.processAuthority),
      );
      await runLeasedCloudActionStep(actionLease, refresh);
    } catch (error) {
      if (disabledLocally && !serverCopyRemoved && actionLease) {
        await runLeasedCloudActionStep(
          actionLease,
          () => installationsRepo.setCloudBackupEnabled(
            installationId,
            true,
            actionLease!.processAuthority,
          ),
        ).catch(() => {});
      }
      let canReport = true;
      if (actionLease) {
        try {
          actionLease.assertCurrent();
        } catch {
          canReport = false;
        }
      }
      if (canReport) {
        Alert.alert('Could not update Cloud Backup', cloudConnectionErrorMessage(error));
      }
    } finally {
      setBackupChanging(false);
    }
  }

  function confirmRemoveCloudCopy() {
    Alert.alert(
      'Remove retained cloud copy?',
      'The server copy will be hidden and future uploads will stay off. Locally captured evidence remains on this device. Re-enabling Cloud Backup restores the same record.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove Cloud Copy',
          style: 'destructive',
          onPress: () => { void disableCloudBackup(true); },
        },
      ],
    );
  }

  function handleBackupPreference() {
    if (!item?.cloud_backup_enabled) {
      if (backupChanging) return;
      setBackupChanging(true);
      void (async () => {
        try {
          await installationsRepo.setCloudBackupEnabled(installationId, true);
          await refresh();
        } catch (error) {
          Alert.alert('Could not enable Cloud Backup', cloudConnectionErrorMessage(error));
        } finally {
          setBackupChanging(false);
        }
      })();
      return;
    }
    Alert.alert(
      'Turn off Cloud Backup?',
      'Choose whether the existing server copy should remain available to authorised users.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Keep Cloud Copy',
          onPress: () => { void disableCloudBackup(false); },
        },
        {
          text: 'Remove Cloud Copy',
          style: 'destructive',
          onPress: () => { void disableCloudBackup(true); },
        },
      ],
    );
  }

  function confirmKeepDeviceCopyLocalOnly() {
    Alert.alert(
      'Keep this device copy local-only?',
      'Cloud Backup will turn off. All local installation data and evidence stay on this device, and the archived conflict proof is retained for support review.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Keep Local-Only',
          style: 'destructive',
          onPress: () => { void disableCloudBackup(false, true); },
        },
      ],
    );
  }

  return (
    <FormScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.pad}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={[typography.title, { color: colors.foreground }]}>{item.site_name}</Text>
          {assignedJobSummary?.schedule_title ? (
            <Text style={{ color: colors.primary, fontWeight: '800', marginTop: 4 }}>
              Title · {assignedJobSummary.schedule_title}
            </Text>
          ) : null}
          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
            {recordedValue(item.client_name || item.customer_name)}
          </Text>
        </View>
        <StatusChip status={item.status} />
      </View>
      {assignedPrestartRequired ? (
        <Card
          accessibilityRole={item.assigned_work_change_notice ? 'summary' : assignedPrestartAcknowledged ? 'summary' : 'alert'}
          accessibilityLiveRegion={item.assigned_work_change_notice || assignedPrestartAcknowledged ? 'polite' : 'assertive'}
          style={{
            marginTop: spacing.md,
            borderWidth: 2,
            borderColor: item.assigned_work_change_notice
              ? colors.primary
              : assignedPrestartAcknowledged
              ? colors.success
              : colors.destructive,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
            <Text style={{ color: colors.foreground, fontWeight: '800', flex: 1 }}>
              {item.assigned_work_change_notice
                ? 'Scheduler updated this job'
                : assignedWorkActionsLocked
                ? 'Work locked — assigned job review required'
                : 'Assigned job pre-start review'}
            </Text>
            <Badge
              label={item.assigned_work_change_notice
                ? 'UPDATE READY'
                : assignedPrestartAcknowledged
                  ? 'Acknowledged'
                  : 'WORK LOCKED'}
              tone={item.assigned_work_change_notice
                ? 'default'
                : assignedPrestartAcknowledged
                  ? 'success'
                  : 'danger'}
            />
          </View>
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 20 }}>
            {item.assigned_work_change_notice
              ? `The latest Scheduler details are synced to this device. Updated: ${assignedWorkChangedFields.join(', ') || 'job details'}. Review and acknowledge them before continuing.`
              : assignedPrestartAcknowledged
              ? 'The current pulled job summary has been acknowledged for this technician.'
              : 'All work controls and app-active tracking are locked until you review and acknowledge the current pulled job summary.'}
          </Text>
          <Text style={{ color: colors.destructive, marginTop: spacing.sm, fontWeight: '700', lineHeight: 20 }}>
            This is not the full Job Safety Analysis (JSA) and does not replace on-site safety checks.
          </Text>
          <Button
            title={item.assigned_work_change_notice
              ? 'Review updated job details'
              : assignedPrestartAcknowledged
                ? 'Review acknowledged details'
                : 'Review job details'}
            variant={item.assigned_work_change_notice || assignedPrestartAcknowledged ? 'secondary' : 'danger'}
            style={{ marginTop: spacing.md }}
            onPress={() => setPrestartModal(true)}
          />
        </Card>
      ) : null}
      {assignedWorkInactive ? (
        <Card
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          style={{
            marginTop: spacing.md,
            borderWidth: 2,
            borderColor: colors.destructive,
          }}
        >
          <Text style={{ color: colors.destructive, fontWeight: '800' }}>
            Work locked — assignment no longer active
          </Text>
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 20 }}>
            This local checkout and unsent work are retained for recovery. Refresh assigned work or ask the scheduler to reassign the job before continuing.
          </Text>
        </Card>
      ) : null}
      <Card
        accessibilityRole="summary"
        accessibilityLabel={`Job status: ${jobStatusLabel}`}
        style={{
          marginTop: spacing.md,
          borderWidth: 2,
          borderColor: authoritativeCompleted ? colors.success : colors.primary,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
          <Text accessibilityRole="header" style={{ color: colors.foreground, fontWeight: '800' }}>
            Job status
          </Text>
          <Badge
            label={jobStatusLabel}
            tone={authoritativeCompleted ? 'success' : 'default'}
          />
        </View>
        <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 20 }}>
          {jobStatusDescription}
        </Text>
        {authoritativeCompleted ? (
          <>
            <Button
              testID="completed-installation-report-action"
              title="Download / share installation report"
              accessibilityHint="Opens the version-pinned completed report. After creating the PDF, choose Save to Files or another iOS destination."
              style={{ marginTop: spacing.md }}
              onPress={() => navigation.navigate('InstallationReport', { installationId })}
            />
            <Button
              testID="job-completion-action"
              title="Reopen completed job"
              variant="secondary"
              disabled={completionBusy}
              accessibilityHint="Requires an audited reason and preserves the completed version"
              accessibilityState={{ busy: completionBusy }}
              style={{ marginTop: spacing.sm }}
              onPress={() => requestAssignedWorkAction(() => setReopenModal(true))}
            />
          </>
        ) : (
          <Button
            testID="job-completion-action"
            title={assignedWorkActionsLocked
              ? 'Mark job complete (locked)'
              : completionBusy
                ? 'Marking job complete…'
                : 'Mark job complete'}
            disabled={completionBusy}
            accessibilityHint="Validates, backs up, and marks this job complete in Scheduler"
            accessibilityState={{ busy: completionBusy }}
            style={{ marginTop: spacing.md }}
            onPress={() => requestAssignedWorkAction(() => {
              void completeInstallation();
            })}
          />
        )}
      </Card>
      <SectionHeader
        title="Installation details"
        actionLabel={readOnly ? undefined : 'Edit'}
        onAction={readOnly ? undefined : () => requestAssignedWorkAction(() => {
          navigation.navigate('InstallationForm', { installationId });
        })}
      />
      <View style={styles.detailSectionList}>
        {installationDetailSections.map((section) => (
          <Card
            key={section.key}
            accessibilityRole="summary"
            accessibilityLabel={`${section.title} details`}
          >
            <Text
              accessibilityRole="header"
              style={[typography.subheading, { color: colors.foreground }]}
            >
              {section.title}
            </Text>
            <View style={styles.detailRows}>
              {section.rows.map(([label, value], index) => (
                <View
                  key={label}
                  style={[
                    styles.detailRow,
                    index > 0 && {
                      borderTopColor: colors.border,
                      borderTopWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <Text style={[typography.label, { color: colors.mutedForeground }]}>
                    {label}
                  </Text>
                  <Text
                    selectable
                    style={[typography.body, styles.detailValue, { color: colors.foreground }]}
                  >
                    {value}
                  </Text>
                </View>
              ))}
            </View>
            {section.key === 'metering' && (showAddNmi || showReplacementActions) ? (
              <View
                style={[
                  styles.detailActions,
                  { borderTopColor: colors.border },
                ]}
              >
                {showAddNmi ? (
                  <Button
                    title="Add NMI"
                    variant="secondary"
                    accessibilityHint="Adds the missing NMI to the default incoming grid connection"
                    onPress={() => requestAssignedWorkAction(() => openGridEditor(primaryGridSupply?.id))}
                  />
                ) : null}
                {showReplacementActions ? replacementMeterNumbers.map((meterNumber) => (
                  <Button
                    key={meterNumber.toLocaleLowerCase('en-AU')}
                    title={`Replace ${meterNumber}`}
                    variant="secondary"
                    onPress={() => requestAssignedWorkAction(() => {
                      navigation.navigate('DeviceSearch', {
                        installationId,
                        initialQuery: meterNumber,
                      });
                    })}
                  />
                )) : null}
              </View>
            ) : null}
          </Card>
        ))}
      </View>

      <View>
        <SectionHeader
          title="Zones"
          actionLabel={readOnly ? undefined : '+ Add'}
          onAction={readOnly ? undefined : () => requestAssignedWorkAction(() => {
            setZoneName('');
            setZoneCode('');
            setZoneDesc('');
            zoneCodeEdited.current = false;
            setZoneModal(true);
          })}
        />
        {zones.length === 0 ? (
          <EmptyState title="No zones yet" subtitle="Add a zone to capture boards and assets." />
        ) : (
          zones.map((z) => (
            <ZoneCard
              key={z.id}
              item={z}
              boardCount={boardCount(z.id)}
              assetCount={assetCount(z.id)}
              onPress={() => requestAssignedWorkAction(() => {
                navigation.navigate('ZoneWorkspace', { zoneId: z.id, installationId });
              })}
            />
          ))
        )}
      </View>

      <SectionHeader
        title={`Incoming grid connections (${gridSupplies.length})`}
        actionLabel={readOnly ? undefined : '+ Add'}
        onAction={readOnly ? undefined : () => {
          requestAssignedWorkAction(() => openGridEditor());
        }}
      />
      <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm, lineHeight: 20 }}>
        The default incoming grid connection is the electrical starting point for this installation. Keep it unless the site genuinely has another incoming supply.
      </Text>
      {gridSupplies.map((grid) => (
        <Card key={grid.id} style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontWeight: '700' }}>{grid.name}</Text>
              <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
                {grid.nmi ? `NMI ${grid.nmi}` : 'No NMI'}{grid.externalKey ? ` · ${grid.externalKey}` : ''}
              </Text>
            </View>
            {grid.isDefault ? <Badge label="DEFAULT" tone="success" /> : null}
          </View>
          {!readOnly ? (
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              <Button
                title="Edit"
                variant="secondary"
                onPress={() => requestAssignedWorkAction(() => openGridEditor(grid.id))}
              />
              {!grid.isDefault ? (
                <Button
                  title="Set default"
                  variant="ghost"
                  onPress={() => requestAssignedWorkAction(() => { void (async () => {
                    await gridSuppliesRepo.update(grid.id, { isDefault: true });
                    await refresh();
                  })(); })}
                />
              ) : null}
              {gridSupplies.length > 1 ? (
                <Button
                  title="Remove"
                  variant="danger"
                  onPress={() => requestAssignedWorkAction(() => { void (async () => {
                  const impact = await gridSuppliesRepo.previewRemove(grid.id);
                  Alert.alert(
                    'Remove Grid supply?',
                    impact.boards + impact.siteAssets + impact.assignments
                      ? `This converts ${impact.boards} board source(s), ${impact.siteAssets} asset source(s), and ${impact.assignments} boundary assignment(s) to TBC. Historical versions are preserved.`
                      : `This connection has no references.${grid.isDefault ? ' A remaining connection will become the default.' : ''} Historical versions are preserved.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: impact.boards + impact.siteAssets + impact.assignments ? 'Convert to TBC and remove' : 'Remove connection',
                        style: 'destructive',
                        onPress: () => { void requestAssignedWorkAction(async () => {
                          await gridSuppliesRepo.remove(grid.id, true);
                          await refresh();
                        }); },
                      },
                    ],
                  );
                  })(); })}
                />
              ) : null}
            </View>
          ) : null}
        </Card>
      ))}

      <SectionHeader title="Installation workspace" />
      <Card accessibilityRole="summary">
        <Text style={{ color: colors.foreground, fontWeight: '800' }}>
          Field work
        </Text>
        <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs, lineHeight: 20 }}>
          All core installation tools are available here without opening the secondary tools drawer.
        </Text>
        <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
          <Button
            title="Open Electrical Map"
            variant="secondary"
            onPress={() => requestAssignedWorkAction(() => {
              navigation.navigate('DataView', { installationId, initialMode: 'ELECTRICAL' });
            })}
          />
          <Button
            title="Field forms & PDFs"
            variant="secondary"
            onPress={() => requestAssignedWorkAction(() => {
              navigation.navigate('FormsList', { installationId });
            })}
          />
          <Button
            title={`Find devices · ${meterDevices.length}`}
            variant="secondary"
            onPress={() => requestAssignedWorkAction(() => {
              navigation.navigate('DeviceSearch', { installationId });
            })}
          />
          <Button
            title="Photo gallery"
            variant="secondary"
            onPress={() => requestAssignedWorkAction(() => {
              navigation.navigate('PhotoPreview', { installationId });
            })}
          />
          <Button
            title="Installation report pack"
            variant="secondary"
            onPress={() => requestAssignedWorkAction(() => {
              navigation.navigate('InstallationReport', { installationId });
            })}
          />
        </View>
      </Card>
      {item.status === 'Draft' && readiness && !readiness.readyToComplete ? (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          accessibilityLabel={reconciliationIssueCount
            ? 'Reconciliation required before completion'
            : 'Completion checks required before completion'}
          style={{ marginTop: 8 }}
        >
          <Badge
            label={reconciliationIssueCount ? 'Reconciliation required' : 'Completion checks required'}
            tone={reconciliationIssueCount ? 'tbc' : 'danger'}
          />
        </View>
      ) : null}
      {item.status === 'Draft' && readinessIssueCount ? (
        <Card style={{ marginTop: spacing.md }} accessibilityRole="summary">
          <Text style={{ color: colors.foreground, fontWeight: '700' }}>Before completion</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 5, lineHeight: 20 }}>
            {readinessIssueCount} check{readinessIssueCount === 1 ? '' : 's'} need attention across {readinessSummary.length} area{readinessSummary.length === 1 ? '' : 's'}.
          </Text>
          {readinessSummary.map((group) => (
            <View
              key={group.id}
              style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm }}
            >
              <Text style={{ color: colors.foreground, flex: 1 }}>{group.label}</Text>
              <Badge
                label={`${group.count}`}
                tone={group.blocking ? 'danger' : 'tbc'}
              />
            </View>
          ))}
          <Button
            title="Review details"
            variant="ghost"
            style={{ marginTop: spacing.sm }}
            onPress={() => requestAssignedWorkAction(() => {
              navigation.navigate('DataView', {
                installationId,
                initialMode: readinessReviewMode,
              });
            })}
          />
        </Card>
      ) : null}
      <Card style={{ marginTop: spacing.md }} accessibilityRole="summary">
        <Text style={{ color: colors.foreground, fontWeight: '700' }}>Asset metering status</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm }}>
          <Badge label={`${meteringCounts.metered} declared metered`} tone="success" />
          <Badge label={`${meteringCounts.unmetered} confirmed unmetered`} />
          <Badge label={`${meteringCounts.tbc} metering TBC`} tone={meteringCounts.tbc ? 'tbc' : 'default'} />
          {brokenAssetMappings ? <Badge label={`${brokenAssetMappings} mapping issue${brokenAssetMappings === 1 ? '' : 's'}`} tone="danger" /> : null}
        </View>
        {unassignedActiveChannels ? (
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm }}>
            {unassignedActiveChannels} active meter channel{unassignedActiveChannels === 1 ? ' is' : 's are'} unassigned. Review channel measurements when available; unassigned channels do not block completion.
          </Text>
        ) : null}
        {meteringCounts.tbc || brokenAssetMappings || unassignedActiveChannels ? (
          <Button
            title={meteringCounts.tbc || brokenAssetMappings ? 'Resolve metering issues' : 'Review channel measurements'}
            variant="ghost"
            style={{ marginTop: spacing.sm }}
            onPress={() => requestAssignedWorkAction(() => {
              navigation.navigate('DataView', {
                installationId,
                initialMode: meteringCounts.tbc ? 'RECONCILIATION' : 'VALIDATION',
              });
            })}
          />
        ) : null}
      </Card>
      {item.backup_conflict?.kind === 'CONFLICT' ? (
        <Card
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          accessibilityLabel="Cloud Backup conflict. Reconcile the local and server installation revisions."
          style={{ marginTop: spacing.md }}
        >
          <Text style={{ color: colors.destructive, fontWeight: '700' }}>Cloud Backup conflict</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
            Local revision {item.backup_conflict.localBaseTreeRevision}
            {item.backup_conflict.remoteTreeRevision !== undefined
              ? ` · server revision ${item.backup_conflict.remoteTreeRevision}`
              : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
            <Button
              title="Retry Backup"
              disabled={syncing || backupChanging}
              onPress={() => requestAssignedWorkAction(() => {
                void triggerSync().then(refresh);
              })}
              style={{ flex: 1 }}
            />
            <Button
              title="Keep Local-Only"
              variant="secondary"
              disabled={syncing || backupChanging}
              onPress={() => requestAssignedWorkAction(confirmKeepDeviceCopyLocalOnly)}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
      ) : null}
      {item.assigned_work_refresh_conflict ? (
        <Card
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
          accessibilityLabel={item.assigned_work_refresh_conflict.remote_tree_changed
            ? 'Assigned work tree changed on the server. Cloud Backup is paused.'
            : 'Scheduler and device job details both changed. Review is required.'}
          style={{
            marginTop: spacing.md,
            borderWidth: 2,
            borderColor: item.assigned_work_refresh_conflict.remote_tree_changed
              ? colors.destructive
              : colors.tbc,
          }}
        >
          <Text style={{
            color: item.assigned_work_refresh_conflict.remote_tree_changed
              ? colors.destructive
              : colors.foreground,
            fontWeight: '700',
          }}>
            {item.assigned_work_refresh_conflict.remote_tree_changed
              ? 'Assigned work needs reconciliation'
              : 'Review Scheduler job changes'}
          </Text>
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs, lineHeight: 20 }}>
            {item.assigned_work_refresh_conflict.remote_tree_changed
              ? 'The server tree changed or this device has no trusted baseline, so it did not advance its Cloud Backup revision or replace local forms and capture.'
              : `${item.assigned_work_refresh_conflict.conflicting_fields.length} job field${item.assigned_work_refresh_conflict.conflicting_fields.length === 1 ? '' : 's'} changed both on the server and on this device. Cloud Backup is paused until you choose.`}
          </Text>
          {!item.assigned_work_refresh_conflict.remote_tree_changed ? (
            <Button
              title="Accept server job changes"
              disabled={backupChanging || syncing}
              style={{ marginTop: spacing.md }}
              onPress={() => { void acceptAssignedServerJobChanges(); }}
            />
          ) : null}
          <Button
            title="Keep Local-Only"
            variant="secondary"
            disabled={backupChanging || syncing}
            style={{ marginTop: spacing.sm }}
            onPress={confirmKeepDeviceCopyLocalOnly}
          />
        </Card>
      ) : null}
      {item.legacy_completed_unpinned ? (
        <View style={{ marginTop: 8 }}>
          <Badge label="Legacy local completion · Cloud validation required" tone="tbc" />
        </View>
      ) : null}
      {item.resolved_display_code_changes?.length ? (
        <Card style={{ marginTop: spacing.md }}>
          <Text style={{ color: colors.foreground, fontWeight: '700' }}>
            Names finalized by Cloud Backup
          </Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 5 }}>
            {item.resolved_display_code_changes.length} switchboard, asset, or device name{item.resolved_display_code_changes.length === 1 ? '' : 's'} were confirmed during backup.
          </Text>
          {finalizedNamesOpen ? item.resolved_display_code_changes.map((change) => (
            <Text key={`${change.entityType}:${change.entityId}`} style={{ color: colors.mutedForeground, marginTop: 6 }}>
              {change.entityType === 'board'
                ? 'Switchboard'
                : change.entityType === 'site_asset'
                  ? 'Asset'
                  : 'Device'}: {change.previousValue || 'Unassigned'} → {change.resolvedValue}
            </Text>
          )) : null}
          <Button
            title={finalizedNamesOpen ? 'Hide finalized names' : 'Show finalized names'}
            variant="ghost"
            style={{ marginTop: spacing.sm }}
            accessibilityState={{ expanded: finalizedNamesOpen }}
            onPress={() => setFinalizedNamesOpen((current) => !current)}
          />
        </Card>
      ) : null}

      {item.status === 'Draft' ? (
        <Card style={{ marginTop: spacing.md }}>
          <Text style={{ color: colors.foreground, fontWeight: '700' }}>
            Technician completion notes
          </Text>
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs, lineHeight: 20 }}>
            Optional sign-off notes are submitted with the authoritative completion request.
          </Text>
          {item.pending_completion ? (
            <View
              accessibilityRole="alert"
              style={{
                marginTop: spacing.sm,
                borderWidth: 1,
                borderColor: colors.tbc,
                borderRadius: 10,
                padding: spacing.sm,
                backgroundColor: `${colors.tbc}14`,
              }}
            >
              <Text style={{ color: colors.foreground, fontWeight: '700', lineHeight: 20 }}>
                A completion attempt is pending. Retry will send the exact note saved with that attempt; editing is locked until it succeeds or the server revision changes.
              </Text>
            </View>
          ) : null}
          <TextArea
            label="Completion notes (optional)"
            value={completionNotes}
            maxLength={COMPLETION_NOTES_MAX_LENGTH}
            editable={
              !assignedWorkActionsLocked
              && !completionBusy
              && !item.pending_completion
            }
            onPressIn={() => {
              if (assignedWorkActionsLocked) {
                if (assignedWorkInactive) {
                  Alert.alert(
                    'Assignment no longer active',
                    'Completion notes are locked until this job is reassigned.',
                  );
                } else {
                  setPrestartModal(true);
                }
              }
            }}
            onChangeText={setCompletionNotes}
            style={{ marginTop: spacing.sm, minHeight: 112 }}
          />
          <Text style={{ color: colors.mutedForeground, fontSize: 12, textAlign: 'right' }}>
            {completionNotes.length}/{COMPLETION_NOTES_MAX_LENGTH}
          </Text>
        </Card>
      ) : (
        <Card style={{ marginTop: spacing.md }} accessibilityRole="summary">
          <Text style={{ color: colors.foreground, fontWeight: '700' }}>
            Completion record
          </Text>
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 20 }}>
            Completed {item.completed_at ? formatDate(item.completed_at) : 'at an unavailable time'}
            {item.completed_by_user_id ? ` by user ${item.completed_by_user_id}` : ''}.
          </Text>
          <Text style={{ color: colors.foreground, fontWeight: '700', marginTop: spacing.md }}>
            Technician completion notes
          </Text>
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 20 }}>
            {item.completion_notes?.trim() || 'No completion notes were provided.'}
          </Text>
        </Card>
      )}

      <Text
        accessibilityRole="summary"
        accessibilityLiveRegion="polite"
        style={{ color: colors.mutedForeground, fontSize: 12, marginTop: spacing.md }}
      >
        {completionBusy
          ? 'Completion validation is in progress.'
          : authoritativeCompleted
            ? `Authoritative completion version ${item.record_version_number} is pinned.`
            : 'Installation remains a Draft.'}
      </Text>

      <Button
        title={assignedWorkActionsLocked
          ? 'More tools (locked)'
          : secondaryOpen
            ? 'Hide more tools'
            : 'More tools'}
        variant="secondary"
        style={{ marginTop: spacing.lg }}
        accessibilityState={{ expanded: secondaryOpen }}
        onPress={() => requestAssignedWorkAction(() => {
          setSecondaryOpen((current) => !current);
        })}
      />
      {!secondaryOpen ? (
        <Card style={{ marginTop: spacing.sm }}>
          <Text style={{ color: colors.foreground, fontWeight: '700' }}>
            {item.cloud_backup_enabled ? 'Cloud Backup enabled' : 'Local-only installation'}
          </Text>
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs, lineHeight: 20 }}>
            Open for Cloud Backup, cloud files, access, finance, and other administrator tools.
          </Text>
        </Card>
      ) : (
        <View>
      <SectionHeader title="Cloud Backup" />
      <Card>
        <Text style={{ color: colors.foreground, fontWeight: '600' }}>
          {item.cloud_backup_enabled
            ? 'Backup enabled'
            : item.cloud_backup_retained
              ? 'Future backup off · server copy retained'
              : 'Local only'}
        </Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 4, marginBottom: spacing.md }}>
          {item.is_imported_copy
            ? 'Imported copies stay local unless you explicitly opt in.'
            : 'Opt in to back up this installation tree and its evidence.'}
        </Text>
        <Button
          title={item.cloud_backup_enabled ? 'Turn off backup' : 'Back up this installation'}
          variant={item.cloud_backup_enabled ? 'ghost' : 'secondary'}
          disabled={backupChanging || syncing}
          onPress={() => requestAssignedWorkAction(handleBackupPreference)}
        />
        {!item.cloud_backup_enabled && item.cloud_backup_retained ? (
          <Button
            title="Remove retained cloud copy"
            variant="danger"
            disabled={backupChanging || syncing}
            style={{ marginTop: spacing.sm }}
            onPress={() => requestAssignedWorkAction(confirmRemoveCloudCopy)}
          />
        ) : null}
        {item.cloud_backup_enabled ? (
          <Button
            title={user?.role === 'admin' ? 'Manage shared access' : 'View shared access'}
            variant="secondary"
            style={{ marginTop: spacing.sm }}
            onPress={() => requestAssignedWorkAction(() => {
              navigation.navigate('InstallationAccess', { installationId });
            })}
          />
        ) : null}
        {user?.role === 'admin' && item.server_tree_revision !== undefined && (item.cloud_backup_enabled || item.cloud_backup_retained) ? (
          <>
            <Button
              title="Financial summary"
              variant="secondary"
              style={{ marginTop: spacing.sm }}
              onPress={() => requestAssignedWorkAction(() => navigation.navigate('FinancialSummary', { installationId }))}
            />
            <Button
              title="Invoices"
              variant="secondary"
              style={{ marginTop: spacing.sm }}
              onPress={() => requestAssignedWorkAction(() => navigation.navigate('Invoices', { installationId }))}
            />
          </>
        ) : null}
        {item.cloud_backup_enabled ||
        item.cloud_backup_retained ||
        item.import_source_server_id ? (
          <Button
            title="Cloud files & history"
            variant="secondary"
            style={{ marginTop: spacing.sm }}
            onPress={() => requestAssignedWorkAction(() => {
              navigation.navigate('CloudStorage', {
                installationId,
                serverInstallationId:
                  item.import_source_server_id ?? installationId,
              });
            })}
          />
        ) : null}
      </Card>

        </View>
      )}

      <FormModal
        visible={prestartModal}
        title="Review assigned job details"
        onClose={() => setPrestartModal(false)}
      >
        {assignedJobDetailRows.map(([label, value]) => (
          <View
            key={label}
            style={{
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              paddingVertical: spacing.sm,
            }}
          >
            <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: '700' }}>
              {label}
            </Text>
            <Text style={{ color: colors.foreground, marginTop: 3, lineHeight: 20 }}>
              {value || 'Not supplied in this job contract'}
            </Text>
          </View>
        ))}
        <View
          accessibilityRole="alert"
          style={{
            marginTop: spacing.md,
            borderWidth: 2,
            borderColor: colors.destructive,
            borderRadius: 12,
            padding: spacing.md,
            backgroundColor: `${colors.destructive}14`,
          }}
        >
          <Text style={{ color: colors.destructive, fontWeight: '800', lineHeight: 20 }}>
            This acknowledgement covers only the currently available job details above. It is not the full JSA and does not replace site induction, hazard checks, isolation controls, or the form’s “Safe to proceed?” gate.
          </Text>
        </View>
        {assignedPrestartAcknowledged ? (
          <Button
            title="Close"
            variant="secondary"
            style={{ marginTop: spacing.md }}
            onPress={() => setPrestartModal(false)}
          />
        ) : (
          <Button
            title={prestartAcknowledging
              ? 'Saving acknowledgement…'
              : item.assigned_work_refresh_conflict?.remote_tree_changed
                ? 'Server tree reconciliation required'
                : item.assigned_work_refresh_conflict
                  ? 'Accept server changes and acknowledge'
                  : 'Acknowledge current job details'}
            disabled={
              prestartAcknowledging
              || !canAcknowledgeAssignedSummary
              || item.assigned_work_refresh_conflict?.remote_tree_changed
            }
            style={{ marginTop: spacing.md }}
            onPress={() => { void acknowledgeAssignedWorkPrestart(); }}
          />
        )}
        {!canAcknowledgeAssignedSummary ? (
          <Text style={{ color: colors.destructive, marginTop: spacing.sm }}>
            Refresh assigned work while online before acknowledging this job summary.
          </Text>
        ) : null}
      </FormModal>

      <FormModal visible={zoneModal} title="New zone" onClose={() => { if (!zoneBusy) setZoneModal(false); }}>
        <TextField label="Zone name" value={zoneName} editable={!zoneBusy} onChangeText={(value) => {
          setZoneName(value);
          if (!zoneCodeEdited.current) {
            setZoneCode(availableZoneCode(zones, item.site_code || item.site_name, value));
          }
        }} />
        <TextField
          label="Zone short code"
          value={zoneCode}
          editable={!zoneBusy}
          autoCapitalize="characters"
          maxLength={ZONE_CODE_MAX_LENGTH}
          onChangeText={(value) => {
            zoneCodeEdited.current = true;
            setZoneCode(value.toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/-{2,}/g, '-'));
          }}
          error={zoneCode && !isValidZoneCode(zoneCode) ? 'Use uppercase letters/numbers with single internal hyphens.' : undefined}
        />
        <Text style={{ color: colors.mutedForeground, marginTop: -spacing.sm, marginBottom: spacing.md, lineHeight: 20 }}>
          Generated from the first three zone letters, the site code, and a two-character sequence. You can still enter a unique code.
        </Text>
        <TextField label="Description" value={zoneDesc} editable={!zoneBusy} onChangeText={setZoneDesc} />
        <Button
          title={zoneBusy ? 'Creating zone…' : 'Create zone'}
          disabled={zoneBusy || Boolean(zoneCode.trim() && !isValidZoneCode(zoneCode.trim()))}
          onPress={() => {
            if (zoneCreating.current) return;
            const normalizedName = zoneName.trim() || 'Zone';
            const normalizedCode = zoneCode.trim().toUpperCase()
              || availableZoneCode(zones, item.site_code || item.site_name, normalizedName);
            const normalizedDescription = zoneDesc.trim();
            if (!isValidZoneCode(normalizedCode)) {
              Alert.alert('Invalid zone short code', 'Use uppercase letters/numbers with single internal hyphens.');
              return;
            }
            if (!isZoneCodeAvailable(
              zones,
              item.site_code || item.site_name,
              normalizedCode,
            )) {
              Alert.alert('Zone short code already used', 'Choose a unique short code or leave it blank to generate one.');
              return;
            }
            zoneCreating.current = true;
            setZoneBusy(true);
            void requestAssignedWorkAction(async () => {
              await zonesRepo.create({
                audit_id: installationId,
                zone_code: normalizedCode,
                zone_name: normalizedName,
                zone_description: normalizedDescription,
              });
              setZoneModal(false);
              setZoneName('');
              setZoneCode('');
              setZoneDesc('');
              await refresh().catch(() => undefined);
            }).catch((error) => {
              Alert.alert('Could not create zone', cloudConnectionErrorMessage(error));
            }).finally(() => {
              zoneCreating.current = false;
              setZoneBusy(false);
            });
          }}
        />
      </FormModal>

      <Button
        title="Delete from this device"
        variant="danger"
        style={{ marginTop: spacing.xl }}
        onPress={() => { void (async () => {
          const actorUserId = user?.id;
          if (!actorUserId) {
            Alert.alert('Installation not deleted', 'Sign in again before deleting local work.');
            return;
          }
          let resumeAuthority: ReturnType<typeof captureAuditWorkResumeAuthority>;
          try {
            resumeAuthority = captureAuditWorkResumeAuthority(actorUserId);
          } catch (error) {
            Alert.alert(
              'Installation not deleted',
              error instanceof Error ? error.message : 'Your authenticated session changed.',
            );
            return;
          }
          const preview = await getLocalDeletionPreview({ kind: 'installation', id: installationId });
          const impact = preview
            ? `\n\nDeletes ${preview.deletes.zones} zone(s), ${preview.deletes.boards} board(s), ${preview.deletes.siteAssets} asset(s), ${preview.deletes.meters} meter(s), ${preview.deletes.assignments} assignment(s), and ${preview.deletes.forms} form(s) locally.`
            : '';
          Alert.alert(
            'Delete from this device?',
            `Local records and on-device evidence will be removed. Any Cloud Backup remains available to authorized users.${impact}`,
            [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete local copy',
              style: 'destructive',
              onPress: async () => {
                const suspension = await suspendAuditWorkForInstallation(
                  installationId,
                  resumeAuthority,
                );
                if (!suspension) {
                  Alert.alert(
                    'Installation not deleted',
                    'Your authenticated session changed before deletion started.',
                  );
                  return;
                }
                try {
                  await installationsRepo.remove(installationId);
                  navigation.popToTop();
                } finally {
                  await resumeAuditWorkForInstallation(
                    suspension,
                    resumeAuthority,
                  ).catch(() => false);
                }
              },
            },
            ],
          );
        })(); }}
      />

      <FormModal visible={reopenModal} title="Reopen installation" onClose={() => setReopenModal(false)}>
        <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>
          The completed version remains immutable. Reopening creates an audited Draft lineage.
        </Text>
        <TextField label="Reason for reopening" value={reopenReason} onChangeText={setReopenReason} />
        <Button
          title={completionBusy ? 'Reopening…' : 'Reopen as Draft'}
          disabled={completionBusy || !reopenReason.trim()}
          onPress={() => { void reopenInstallation(); }}
        />
      </FormModal>

      <FormModal visible={gridModal} title={editingGridId ? 'Edit incoming grid connection' : 'Add incoming grid connection'} onClose={() => setGridModal(false)}>
        <TextField label="Connection name" placeholder="Defaults to Incoming grid connection" value={gridName} onChangeText={setGridName} />
        <TextField label="NMI (optional)" value={gridNmi} maxLength={100} onChangeText={setGridNmi} />
        <TextField label="External key (optional)" value={gridExternalKey} onChangeText={setGridExternalKey} />
        <Button
          title={gridDefault ? 'Default supply' : 'Set as default'}
          variant={gridDefault ? 'primary' : 'secondary'}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: gridDefault }}
          onPress={() => setGridDefault((value) => !value)}
        />
        <Button
          title={gridBusy ? 'Saving…' : 'Save incoming grid connection'}
          disabled={gridBusy}
          style={{ marginTop: spacing.md }}
          onPress={() => { void requestAssignedWorkAction(async () => {
            setGridBusy(true);
            try {
            if (editingGridId) {
              await gridSuppliesRepo.update(editingGridId, {
                name: gridName,
                nmi: gridNmi,
                externalKey: gridExternalKey,
                isDefault: gridDefault,
              });
            } else {
              await gridSuppliesRepo.create({
                installationId,
                name: gridName,
                nmi: gridNmi || undefined,
                externalKey: gridExternalKey || undefined,
                isDefault: gridDefault,
              });
            }
            setGridModal(false);
            await refresh();
            } catch (error) {
              Alert.alert('Connection not saved', error instanceof Error ? error.message : 'Please try again.');
            } finally {
              setGridBusy(false);
            }
          }); }}
        />
      </FormModal>
    </FormScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
  detailSectionList: { gap: spacing.sm },
  detailRows: { marginTop: spacing.xs },
  detailRow: { paddingVertical: spacing.sm },
  detailValue: { lineHeight: 21, marginTop: 3 },
  detailActions: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
});
