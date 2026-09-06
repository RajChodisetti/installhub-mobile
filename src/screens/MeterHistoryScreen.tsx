import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { apiClient } from '../api/apiClient';
import type { MeterHistoryVersion } from '../api/meterHistoryTypes';
import { useInstallation } from '../hooks';
import { useTheme } from '../context/AppProviders';
import { Badge, Button, Card, LoadingState, TextArea } from '../components/ui';
import { RecordLoadState } from '../components/RecordLoadState';
import { FormModal } from '../components/forms';
import { spacing, typography } from '../theme';
import { createId } from '../utils';
import { captureAuthenticatedCloudActionLease } from '../services/authenticatedCloudAction';
import { runLeasedCloudActionStep } from '../services/cloudActionLease';
import { executeMeterRestoreAttempt, prepareMeterRestoreAttempt, type MeterRestoreAttempt } from '../repositories/meterHistoryRepository';

type Props = NativeStackScreenProps<RootStackParamList, 'MeterHistory'>;

export function MeterHistoryScreen({ route, navigation }: Props) {
  const { installationId, meterId } = route.params;
  const { colors } = useTheme();
  const { item: installation, refresh, loading: installationLoading, error: installationError } = useInstallation(installationId);
  const scope = `${installationId}:${meterId}`;
  const [loadedScope, setLoadedScope] = useState(scope);
  const [versions, setVersions] = useState<MeterHistoryVersion[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [target, setTarget] = useState<MeterHistoryVersion | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const attempt = useRef<MeterRestoreAttempt | null>(null);
  const requestGeneration = useRef(0);
  const idempotencyKey = useRef('');
  const currentInstallation = installation?.id === installationId ? installation : null;
  const hasCloudRecord = currentInstallation?.server_tree_revision !== undefined;
  const visibleVersions = loadedScope === scope ? versions : [];
  const visibleNextOffset = loadedScope === scope ? nextOffset : null;

  const load = useCallback(async (offset = 0) => {
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError('');
    try {
      const lease = await captureAuthenticatedCloudActionLease();
      const response = await runLeasedCloudActionStep(lease, () => apiClient.getMeterHistory(installationId, meterId, offset, lease.cloudAuthority));
      if (response.installationId !== installationId || response.meterId !== meterId) throw new Error('Cloud history belongs to another device.');
      if (generation !== requestGeneration.current) return;
      lease.assertCurrent();
      setLoadedScope(scope);
      setVersions((current) => offset === 0 ? response.versions : [...current, ...response.versions.filter((version) => !current.some((existing) => existing.id === version.id))]);
      setNextOffset(response.page.nextOffset);
    } catch (cause) {
      if (generation === requestGeneration.current) setError(cause instanceof Error ? cause.message : 'Could not load device history.');
    } finally {
      if (generation === requestGeneration.current) setLoading(false);
    }
  }, [installationId, meterId, scope]);

  useEffect(() => {
    setVersions([]);
    setNextOffset(null);
    setLoadedScope(scope);
    setError('');
    setTarget(null);
    attempt.current = null;
    if (hasCloudRecord) void load();
    return () => { requestGeneration.current += 1; };
  }, [hasCloudRecord, load, scope]);

  const restore = async () => {
    if (!target || busy) return;
    setBusy(true);
    setError('');
    try {
      if (!attempt.current) {
        attempt.current = await prepareMeterRestoreAttempt(installationId, meterId, target.recordVersionNumber, reason, idempotencyKey.current);
      }
      const result = await executeMeterRestoreAttempt(attempt.current);
      attempt.current = null;
      setTarget(null);
      setReason('');
      await refresh();
      await load();
      Alert.alert('Device restored', `Restored version ${result.meterHistory.restoredFromRecordVersionNumber}. New version ${result.meterHistory.recordVersionNumber} records this change.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restore this version. Retry uses the same restore request.');
    } finally {
      setBusy(false);
    }
  };

  const retryInstallation = () => { void refresh().catch(() => undefined); };
  if (installationLoading && !currentInstallation) return <LoadingState />;
  if (!currentInstallation) return <RecordLoadState title="Installation unavailable"
    message={installationError ?? 'The installation is no longer available.'}
    onRetry={retryInstallation} onBack={() => navigation.goBack()} />;

  return <>
    <FlatList
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: 48 }}
      data={visibleVersions}
      keyExtractor={(version) => version.id}
      ListHeaderComponent={<View>
        {installationError ? <RecordLoadState inline title="Could not refresh installation"
          message={installationError} onRetry={retryInstallation} onBack={() => navigation.goBack()} /> : null}
        <Text style={[typography.title, { color: colors.foreground }]}>Device version history</Text>
        <Text style={{ color: colors.mutedForeground, marginVertical: spacing.md }}>Completed replacements keep immutable cloud versions. Restore changes this device while keeping current forms, switchboard placement, generated ID and compatible channel assignments.</Text>
        {!hasCloudRecord ? <Text style={{ color: colors.mutedForeground }}>This local device has no confirmed cloud history yet. Enable Cloud Backup and finish a backup to create a saved version.</Text> : <Button title={loading ? 'Refreshing…' : 'Refresh history'} disabled={loading || busy} variant="secondary" onPress={() => void load()} />}
        {error && !target ? <Text accessibilityRole="alert" style={{ color: colors.destructive, marginTop: spacing.md }}>{error}</Text> : null}
      </View>}
      ListEmptyComponent={loading ? <LoadingState /> : hasCloudRecord && !error ? <Text style={{ color: colors.mutedForeground, marginTop: spacing.lg }}>No finalized device version exists yet.</Text> : null}
      renderItem={({ item: version }) => <Card style={{ marginTop: spacing.md }}>
        <Text style={[typography.subheading, { color: colors.foreground }]}>{version.device.name || `${version.device.model} device`}</Text>
        <Badge label={version.isCurrentState ? 'Current device state' : version.operation === 'REPLACEMENT' ? 'Replacement' : version.operation === 'ROLLBACK' ? 'Rollback' : 'Saved device state'} tone={version.isCurrentState ? 'success' : 'default'} />
        <Text style={{ color: colors.foreground, marginTop: 8 }}>Version {version.recordVersionNumber} · {version.device.model} · Serial {version.device.serialNumber || 'Not recorded'}</Text>
        {version.device.deviceNumber ? <Text style={{ color: colors.mutedForeground }}>Asset tag: {version.device.deviceNumber}</Text> : null}
        <Text style={{ color: colors.mutedForeground }}>{version.device.switchboardName} · {version.device.channelCount} channels · {new Date(version.createdAt).toLocaleString()}</Text>
        {version.reason ? <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>Reason: {version.reason}</Text> : null}
        {version.rollbackBlockedReason ? <Text style={{ color: colors.mutedForeground, marginTop: 8 }}>{version.rollbackBlockedReason}</Text> : null}
        {!version.isCurrentState ? <Button title="Restore this version" variant="secondary" disabled={!version.canRollback || busy || installation?.status === 'Completed'} style={{ marginTop: spacing.md }} onPress={() => {
          attempt.current = null;
          idempotencyKey.current = createId('meter-rollback');
          setReason(''); setError(''); setTarget(version);
        }} /> : null}
      </Card>}
      ListFooterComponent={visibleNextOffset !== null ? <Button title={loading ? 'Loading…' : 'Load older versions'} disabled={loading || busy} style={{ marginTop: spacing.lg }} variant="ghost" onPress={() => void load(visibleNextOffset)} /> : null}
    />
    <FormModal visible={Boolean(target)} title={`Restore version ${target?.recordVersionNumber ?? ''}`} onClose={() => { if (!busy) setTarget(null); }}>
      <Text style={{ color: colors.foreground, marginBottom: spacing.md }}>Restore {target?.device.name || target?.device.model} ({target?.device.serialNumber || 'serial not recorded'}). Current forms and evidence history remain unchanged. The server checks compatibility with current channel assignments and records a new immutable version.</Text>
      <TextArea label="Reason for restore" value={reason} editable={!busy && !attempt.current} maxLength={1000} onChangeText={setReason} />
      {attempt.current ? <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>This request is prepared. Retry keeps its original version, reason and request ID.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive, marginBottom: spacing.md }}>{error}</Text> : null}
      <Button title={busy ? 'Restoring…' : attempt.current ? 'Retry restore' : 'Confirm restore'} disabled={busy || reason.trim().length < 3} onPress={() => void restore()} />
    </FormModal>
  </>;
}
