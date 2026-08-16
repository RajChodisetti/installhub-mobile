import React, { useRef, useState } from 'react';
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
import { Badge, Button, Card, EmptyState, LoadingState, SectionHeader, TextField } from '../components/ui';
import { FormModal } from '../components/forms';
import { useAuth, useTheme } from '../context/AppProviders';
import {
  ApiError,
  apiClient,
  cloudConnectionErrorMessage,
} from '../api/apiClient';
import {
  getInstallationSyncMetadata,
  getPendingCompleteBackupAttempt,
} from '../repositories/cloudSyncRepository';
import { useSyncStatus } from '../services/SyncStatusContext';
import { formatDate } from '../utils';
import { sha256 } from 'js-sha256';
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

  if (loading || !item) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  const boardCount = (zoneId: string) => boards.filter((b) => b.zone_id === zoneId).length;
  const assetCount = (zoneId: string) => siteAssets.filter((a) => a.zone_id === zoneId).length;
  const authoritativeCompleted = item.status === 'Completed' && Boolean(item.record_version_number);
  const readOnly = authoritativeCompleted;
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

  async function completeInstallation() {
    if (!item) return;
    let rejectionRecorded = false;
    let trackingSuspended = false;
    let completionAccepted = false;
    const recordRejection = (code: string) => {
      rejectionRecorded = true;
      void recordCompletionRejection(code);
    };
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
            onPress: () => navigation.navigate('DataView', {
              installationId,
              initialMode: readinessReviewMode,
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
      const latest = await installationsRepo.getById(installationId);
      if (!latest) throw new Error('Installation not found.');
      const serverReadiness = await apiClient.getInstallationReadiness(installationId);
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
      const baseTreeRevision = latest.server_tree_revision;
      if (baseTreeRevision === undefined) {
        throw new Error('Cloud Backup did not persist an authoritative server revision.');
      }
      if (baseTreeRevision !== serverReadiness.treeRevision) {
        throw new Error(
          'The portal changed this installation after backup. Sync and reconcile before completing.',
        );
      }
      const pendingCompletion = latest.pending_completion?.baseTreeRevision === baseTreeRevision
        ? latest.pending_completion
        : {
            baseTreeRevision,
            idempotencyKey: `complete-${sha256(`${installationId}:${baseTreeRevision}`).slice(0, 32)}`,
            createdAt: new Date().toISOString(),
          };
      await installationsRepo.applyServerState(installationId, {
        status: latest.status,
        record_version_number: latest.record_version_number,
        pending_completion: pendingCompletion,
      });
      await suspendAuditWorkForInstallation(installationId).catch(() => {});
      trackingSuspended = true;
      const response = await apiClient.completeInstallation(installationId, {
        baseTreeRevision,
        idempotencyKey: pendingCompletion.idempotencyKey,
      });
      completionAccepted = true;
      if (!response.completedAt || !response.recordVersionNumber) {
        recordRejection('AUDIT_METADATA_MISSING');
        throw new Error(
          'Completion was accepted without exact audit metadata. Retry to refresh the authoritative server result.',
        );
      }
      await installationsRepo.applyServerState(installationId, {
        status: 'Completed',
        server_tree_revision: response.treeRevision,
        record_version_number: response.recordVersionNumber,
        completed_at: response.completedAt,
        completed_from_revision: response.completedFromRevision ?? baseTreeRevision,
        backup_conflict: { kind: 'NONE' },
        pending_completion: undefined,
        legacy_completed_unpinned: false,
      });
      await resumeAuditWorkForInstallation(installationId).catch(() => {});
      await refresh();
      Alert.alert('Installation completed', `Authoritative version ${response.recordVersionNumber ?? 'created'} is pinned.`);
    } catch (error) {
      if (trackingSuspended && !completionAccepted) {
        await resumeAuditWorkForInstallation(installationId).catch(() => {});
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
    setCompletionBusy(true);
    try {
      if (await getPendingCompleteBackupAttempt(installationId)) {
        throw new Error(
          'Cloud backup confirmation is pending. Retry backup before reopening this installation.',
        );
      }
      const response = await apiClient.reopenInstallation(installationId, {
        baseTreeRevision: item.server_tree_revision,
        reason,
      });
      await installationsRepo.applyServerState(installationId, {
        status: 'Draft',
        server_tree_revision: response.treeRevision,
        record_version_number: response.recordVersionNumber ?? item.record_version_number,
        reopened_at: response.reopenedAt ?? new Date().toISOString(),
        reopen_reason: response.reopenReason ?? reason,
        backup_conflict: { kind: 'NONE' },
      });
      setReopenReason('');
      setReopenModal(false);
      await refresh();
    } catch (error) {
      Alert.alert('Could not reopen', cloudConnectionErrorMessage(error));
    } finally {
      setCompletionBusy(false);
    }
  }

  function openGridEditor(gridId?: string) {
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
    setBackupChanging(true);
    let disabledLocally = false;
    let serverCopyRemoved = false;
    try {
      if (await getPendingCompleteBackupAttempt(installationId)) {
        throw new Error(
          'Cloud backup confirmation is pending. Retry backup before changing this setting.',
        );
      }
      const syncMetadata = await getInstallationSyncMetadata(installationId);
      // Disable locally first. This atomic repository guard prevents a new
      // final attempt from being prepared before any destructive server call.
      await installationsRepo.setCloudBackupEnabled(installationId, false);
      disabledLocally = true;
      if (removeServerCopy) {
        try {
          await apiClient.deleteInstallationCloud(installationId, false);
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 404) throw error;
        }
        serverCopyRemoved = true;
      }
      await installationsRepo.update(installationId, {
        cloud_backup_retained: !removeServerCopy && Boolean(
          syncMetadata.syncedWatermark || syncMetadata.serverTreeRevision !== undefined,
        ),
        ...(clearResolvedConflict ? { backup_conflict: { kind: 'NONE' as const } } : {}),
      });
      await refresh();
    } catch (error) {
      if (disabledLocally && !serverCopyRemoved) {
        await installationsRepo.setCloudBackupEnabled(installationId, true).catch(() => {});
      }
      Alert.alert('Could not update Cloud Backup', cloudConnectionErrorMessage(error));
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
            onPress={() => navigation.navigate('DataView', {
              installationId,
              initialMode: readinessReviewMode,
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
            onPress={() => navigation.navigate('DataView', {
              installationId,
              initialMode: meteringCounts.tbc ? 'RECONCILIATION' : 'VALIDATION',
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
              onPress={() => { void triggerSync().then(refresh); }}
              style={{ flex: 1 }}
            />
            <Button
              title="Keep Local-Only"
              variant="secondary"
              disabled={syncing || backupChanging}
              onPress={confirmKeepDeviceCopyLocalOnly}
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

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: spacing.lg }}>
        <Button title="Edit" variant="secondary" disabled={readOnly} onPress={() => navigation.navigate('InstallationForm', { installationId })} style={{ flexGrow: 1 }} />
        <Button
          title="Search devices"
          variant="secondary"
          onPress={() => navigation.navigate('DeviceSearch', { installationId })}
          style={{ flexGrow: 1 }}
        />
        <Button
          title={authoritativeCompleted ? 'Reopen installation' : completionBusy ? 'Completing…' : 'Complete installation'}
          disabled={completionBusy}
          accessibilityHint={authoritativeCompleted
            ? 'Requires an audited reason and preserves the completed version'
            : 'Requires local readiness, enabled Cloud Backup, successful sync, and server validation'}
          onPress={() => authoritativeCompleted
            ? setReopenModal(true)
            : void completeInstallation()}
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
        title={secondaryOpen ? 'Hide tools & reports' : 'More tools & reports'}
        variant="secondary"
        style={{ marginTop: spacing.lg }}
        accessibilityState={{ expanded: secondaryOpen }}
        onPress={() => setSecondaryOpen((current) => !current)}
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
          onPress={handleBackupPreference}
        />
        {!item.cloud_backup_enabled && item.cloud_backup_retained ? (
          <Button
            title="Remove retained cloud copy"
            variant="danger"
            disabled={backupChanging || syncing}
            style={{ marginTop: spacing.sm }}
            onPress={confirmRemoveCloudCopy}
          />
        ) : null}
        {user?.role === 'admin' && item.cloud_backup_enabled ? (
          <Button
            title="Manage shared access"
            variant="secondary"
            style={{ marginTop: spacing.sm }}
            onPress={() =>
              navigation.navigate('InstallationAccess', { installationId })
            }
          />
        ) : null}
        {item.cloud_backup_enabled ||
        item.cloud_backup_retained ||
        item.import_source_server_id ? (
          <Button
            title="Cloud files & history"
            variant="secondary"
            style={{ marginTop: spacing.sm }}
            onPress={() =>
              navigation.navigate('CloudStorage', {
                installationId,
                serverInstallationId:
                  item.import_source_server_id ?? installationId,
              })
            }
          />
        ) : null}
      </Card>

      <SectionHeader
        title={`Incoming grid connections (${gridSupplies.length})`}
        actionLabel={readOnly ? undefined : '+ Add'}
        onAction={readOnly ? undefined : () => openGridEditor()}
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
              <Button title="Edit" variant="secondary" onPress={() => openGridEditor(grid.id)} />
              {!grid.isDefault ? (
                <Button
                  title="Set default"
                  variant="ghost"
                  onPress={async () => {
                    await gridSuppliesRepo.update(grid.id, { isDefault: true });
                    await refresh();
                  }}
                />
              ) : null}
              {!grid.isDefault && gridSupplies.length > 1 ? (
                <Button
                  title="Remove"
                  variant="danger"
                  onPress={() => { void (async () => {
                  const impact = await gridSuppliesRepo.previewRemove(grid.id);
                  Alert.alert(
                    'Remove Grid supply?',
                    `This converts ${impact.boards} board source(s), ${impact.siteAssets} asset source(s), and ${impact.assignments} boundary assignment(s) to TBC. Historical versions are preserved.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Convert to TBC and remove',
                        style: 'destructive',
                        onPress: async () => {
                          await gridSuppliesRepo.remove(grid.id, true);
                          await refresh();
                        },
                      },
                    ],
                  );
                  })(); }}
                />
              ) : null}
            </View>
          ) : null}
        </Card>
      ))}

      <SectionHeader title="Reports" />
      <View style={{ gap: 8 }}>
        <Button title="Field Forms / PDFs" onPress={() => navigation.navigate('FormsList', { installationId })} />
        <Button title="Installation data & checks" variant="secondary" onPress={() => navigation.navigate('DataView', { installationId })} />
        <Button title="Metering Table" variant="secondary" onPress={() => navigation.navigate('MeteringTable', { installationId })} />
        <Button title="Full Installation Report" variant="secondary" onPress={() => navigation.navigate('InstallationReport', { installationId })} />
      </View>
        </View>
      )}

      <SectionHeader
        title="Zones"
        actionLabel={readOnly ? undefined : '+ Add'}
        onAction={readOnly ? undefined : () => {
          setZoneName('');
          setZoneCode('');
          setZoneDesc('');
          zoneCodeEdited.current = false;
          setZoneModal(true);
        }}
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
            onPress={() =>
              navigation.navigate('ZoneWorkspace', { zoneId: z.id, installationId })
            }
          />
        ))
      )}

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
          onPress={async () => {
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
          }}
        />
      </FormModal>

      <Button
        title="Delete from this device"
        variant="danger"
        style={{ marginTop: spacing.xl }}
        onPress={() => { void (async () => {
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
                await suspendAuditWorkForInstallation(installationId).catch(() => {});
                try {
                  await installationsRepo.remove(installationId);
                  navigation.popToTop();
                } finally {
                  await resumeAuditWorkForInstallation(installationId).catch(() => {});
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
          onPress={async () => {
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
          }}
        />
      </FormModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
