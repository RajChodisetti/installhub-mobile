import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInstallation } from '../hooks';
import {
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
import { formatDate } from '../utils';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { recordCompletionRejection } from '../services/operationalDiagnostics';
import {
  partitionReadinessIssues,
  summarizeReadinessIssues,
} from '../domain/reconciliationWorkflow';
import {
  availableZoneCode,
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

type Props = NativeStackScreenProps<RootStackParamList, 'InstallationDetail'>;

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
    refresh,
  } = useInstallation(installationId);
  const [zoneModal, setZoneModal] = useState(false);
  const [zoneName, setZoneName] = useState('');
  const [zoneCode, setZoneCode] = useState('');
  const zoneCodeEdited = useRef(false);
  const [zoneDesc, setZoneDesc] = useState('');
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
  const canAcknowledgeAssignedSummary = Boolean(
    user?.id
    && assignedJobSummary?.actor_user_id === user.id
    && assignedJobSummary.assigned_inspector_user_id === user.id
    && item.assigned_work_actor_user_id === user.id,
  );
  const assignedJobDetailRows = [
    ['Client', assignedJobSummary?.client_name ?? 'Assigned job summary unavailable — refresh assigned work'],
    ['Site', assignedJobSummary?.site_name ?? 'Assigned job summary unavailable — refresh assigned work'],
    ['Address', assignedJobSummary?.site_address ?? 'Assigned job summary unavailable — refresh assigned work'],
    ['Scheduled date', assignedJobSummary?.audit_date
      ? formatDate(assignedJobSummary.audit_date)
      : 'Assigned job summary unavailable — refresh assigned work'],
    ['Technician', assignedJobSummary?.inspector_name ?? 'Assigned job summary unavailable — refresh assigned work'],
    ['Contact', 'Not supplied in this job contract'],
    ['Scope', 'Not supplied in this job contract'],
  ] as const;
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
        'Authoritative completion requires your prior, explicit Cloud Backup opt-in. Open More tools & reports, enable Cloud Backup, then complete again.',
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
          ...(clearResolvedConflict ? { backup_conflict: { kind: 'NONE' as const } } : {}),
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
      void (async () => {
        await installationsRepo.setCloudBackupEnabled(installationId, true);
        await refresh();
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
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={[typography.title, { color: colors.foreground }]}>{item.site_name}</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>{item.client_name}</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>{item.site_address}</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
            {item.inspector_name} · {formatDate(item.audit_date)}
          </Text>
        </View>
        <StatusChip status={item.status} />
      </View>
      {assignedPrestartRequired ? (
        <Card
          accessibilityRole={assignedPrestartAcknowledged ? 'summary' : 'alert'}
          accessibilityLiveRegion={assignedPrestartAcknowledged ? 'polite' : 'assertive'}
          style={{
            marginTop: spacing.md,
            borderWidth: 2,
            borderColor: assignedPrestartAcknowledged
              ? colors.success
              : colors.destructive,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm }}>
            <Text style={{ color: colors.foreground, fontWeight: '800', flex: 1 }}>
              {assignedWorkActionsLocked
                ? 'Work locked — assigned job review required'
                : 'Assigned job pre-start review'}
            </Text>
            <Badge
              label={assignedPrestartAcknowledged ? 'Acknowledged' : 'WORK LOCKED'}
              tone={assignedPrestartAcknowledged ? 'success' : 'danger'}
            />
          </View>
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 20 }}>
            {assignedPrestartAcknowledged
              ? 'The current pulled job summary has been acknowledged for this technician.'
              : 'All work controls and app-active tracking are locked until you review and acknowledge the current pulled job summary.'}
          </Text>
          <Text style={{ color: colors.destructive, marginTop: spacing.sm, fontWeight: '700', lineHeight: 20 }}>
            This is not the full Job Safety Analysis (JSA) and does not replace on-site safety checks.
          </Text>
          <Button
            title={assignedPrestartAcknowledged ? 'Review acknowledged details' : 'Review job details'}
            variant={assignedPrestartAcknowledged ? 'secondary' : 'danger'}
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
          <Text style={{ color: colors.destructive, fontWeight: '700', marginTop: spacing.sm }}>
            {unassignedActiveChannels} active meter channel{unassignedActiveChannels === 1 ? ' is' : 's are'} still unassigned and must be mapped or marked Spare / unused.
          </Text>
        ) : null}
        {meteringCounts.tbc || brokenAssetMappings || unassignedActiveChannels ? (
          <Button
            title="Resolve metering issues"
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
            Technician completion notes
          </Text>
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 20 }}>
            {item.completion_notes?.trim() || 'No completion notes were provided.'}
          </Text>
        </Card>
      )}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.lg }}>
        <Button
          title={assignedWorkActionsLocked ? 'Edit (locked)' : 'Edit'}
          variant="secondary"
          disabled={readOnly}
          onPress={() => requestAssignedWorkAction(() => {
            navigation.navigate('InstallationForm', { installationId });
          })}
          style={{ flexGrow: 1 }}
        />
        <Button
          title={assignedWorkActionsLocked ? 'Search devices (locked)' : 'Search devices'}
          variant="secondary"
          onPress={() => requestAssignedWorkAction(() => {
            navigation.navigate('DeviceSearch', { installationId });
          })}
          style={{ flexGrow: 1 }}
        />
        <Button
          title={authoritativeCompleted
            ? 'Reopen installation'
            : assignedWorkActionsLocked
              ? 'Complete installation (locked)'
              : completionBusy
                ? 'Completing…'
                : 'Complete installation'}
          disabled={completionBusy}
          accessibilityHint={authoritativeCompleted
            ? 'Requires an audited reason and preserves the completed version'
            : 'Requires local readiness, enabled Cloud Backup, successful sync, and server validation'}
          onPress={() => requestAssignedWorkAction(() => {
            if (authoritativeCompleted) setReopenModal(true);
            else void completeInstallation();
          })}
          style={{ flexGrow: 1 }}
        />
      </View>
      <Text
        accessibilityRole="summary"
        accessibilityLiveRegion="polite"
        style={{ color: colors.mutedForeground, fontSize: 12, marginTop: spacing.xs }}
      >
        {completionBusy
          ? 'Completion validation is in progress.'
          : authoritativeCompleted
            ? `Authoritative completion version ${item.record_version_number} is pinned.`
            : 'Installation remains a Draft.'}
      </Text>

      <Button
        title={assignedWorkActionsLocked
          ? 'More tools & reports (locked)'
          : secondaryOpen
            ? 'Hide tools & reports'
            : 'More tools & reports'}
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
            Open for Cloud Backup, incoming grid connection, forms, reports, metering, and administrator tools.
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
        {user?.role === 'admin' && item.cloud_backup_enabled ? (
          <Button
            title="Manage shared access"
            variant="secondary"
            style={{ marginTop: spacing.sm }}
            onPress={() => requestAssignedWorkAction(() => {
              navigation.navigate('InstallationAccess', { installationId });
            })}
          />
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
              {!grid.isDefault && gridSupplies.length > 1 ? (
                <Button
                  title="Remove"
                  variant="danger"
                  onPress={() => requestAssignedWorkAction(() => { void (async () => {
                  const impact = await gridSuppliesRepo.previewRemove(grid.id);
                  Alert.alert(
                    'Remove Grid supply?',
                    `This converts ${impact.boards} board source(s), ${impact.siteAssets} asset source(s), and ${impact.assignments} boundary assignment(s) to TBC. Historical versions are preserved.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Convert to TBC and remove',
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

      <SectionHeader title="Reports" />
      <View style={{ gap: 8 }}>
        <Button title="Field Forms / PDFs" onPress={() => requestAssignedWorkAction(() => navigation.navigate('FormsList', { installationId }))} />
        <Button title="Installation data & checks" variant="secondary" onPress={() => requestAssignedWorkAction(() => navigation.navigate('DataView', { installationId }))} />
        <Button title="Metering Table" variant="secondary" onPress={() => requestAssignedWorkAction(() => navigation.navigate('MeteringTable', { installationId }))} />
        <Button title="Full Installation Report" variant="secondary" onPress={() => requestAssignedWorkAction(() => navigation.navigate('InstallationReport', { installationId }))} />
      </View>
        </View>
      )}

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
            title={prestartAcknowledging ? 'Saving acknowledgement…' : 'Acknowledge current job details'}
            disabled={prestartAcknowledging || !canAcknowledgeAssignedSummary}
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

      <FormModal visible={zoneModal} title="New zone" onClose={() => setZoneModal(false)}>
        <TextField label="Zone name" value={zoneName} onChangeText={(value) => {
          setZoneName(value);
          if (!zoneCodeEdited.current) setZoneCode(availableZoneCode(zones, value));
        }} />
        <TextField
          label="Zone short code"
          value={zoneCode}
          autoCapitalize="characters"
          maxLength={ZONE_CODE_MAX_LENGTH}
          onChangeText={(value) => {
            zoneCodeEdited.current = true;
            setZoneCode(value.toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/-{2,}/g, '-'));
          }}
          error={zoneCode && !isValidZoneCode(zoneCode) ? 'Use uppercase letters/numbers with single internal hyphens.' : undefined}
        />
        <TextField label="Description" value={zoneDesc} onChangeText={setZoneDesc} />
        <Button
          title="Create zone"
          disabled={!zoneName.trim() || !isValidZoneCode(zoneCode)}
          onPress={() => { void requestAssignedWorkAction(async () => {
            await zonesRepo.create({
              audit_id: installationId,
              zone_code: zoneCode,
              zone_name: zoneName.trim(),
              zone_description: zoneDesc.trim(),
            });
            setZoneModal(false);
            setZoneName('');
            setZoneCode('');
            setZoneDesc('');
            await refresh();
          }); }}
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
        <TextField label="Supply name" value={gridName} onChangeText={setGridName} />
        <TextField label="NMI (optional)" value={gridNmi} onChangeText={setGridNmi} />
        <TextField label="External key (optional)" value={gridExternalKey} onChangeText={setGridExternalKey} />
        <Button
          title={gridDefault ? 'Default supply' : 'Set as default'}
          variant={gridDefault ? 'primary' : 'secondary'}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: gridDefault }}
          onPress={() => setGridDefault(true)}
        />
        <Button
          title="Save incoming grid connection"
          disabled={!gridName.trim()}
          style={{ marginTop: spacing.md }}
          onPress={() => { void requestAssignedWorkAction(async () => {
            if (editingGridId) {
              await gridSuppliesRepo.update(editingGridId, {
                name: gridName,
                nmi: gridNmi,
                externalKey: gridExternalKey,
                ...(gridDefault ? { isDefault: true } : {}),
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
          }); }}
        />
      </FormModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
