import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { apiClient, cloudConnectionErrorMessage } from '../api/apiClient';
import { Badge, Button, Card, LoadingState } from '../components/ui';
import { SYNC_API_URL } from '../constants/syncConfig';
import { useTheme } from '../context/AppProviders';
import { useSyncStatus } from '../services/SyncStatusContext';
import {
  clearGeneratedReportCache,
  clearImportedThumbnailCache,
  formatBytes,
  getStorageDiagnostics,
  type StorageDiagnostics,
} from '../services/storageDiagnostics';
import { spacing, typography } from '../theme';

type HealthState =
  | { status: 'checking'; detail: string }
  | { status: 'healthy'; detail: string }
  | { status: 'unreachable'; detail: string };

function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Health check timed out.')),
      milliseconds,
    );
    operation.then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

export function DiagnosticsScreen() {
  const { colors } = useTheme();
  const {
    syncing,
    progress,
    lastSyncedAt,
    triggerSync,
    retrySync,
  } = useSyncStatus();
  const [diagnostics, setDiagnostics] = useState<StorageDiagnostics>();
  const [refreshing, setRefreshing] = useState(true);
  const [cacheAction, setCacheAction] = useState<'reports' | 'thumbnails'>();
  const [health, setHealth] = useState<HealthState>({
    status: 'checking',
    detail: 'Checking…',
  });

  const refreshHealth = useCallback(async () => {
    setHealth({ status: 'checking', detail: 'Checking…' });
    try {
      const result = await withTimeout(apiClient.health(), 8_000);
      setHealth({
        status: 'healthy',
        detail: result.status || 'Connected',
      });
    } catch (error) {
      setHealth({
        status: 'unreachable',
        detail: cloudConnectionErrorMessage(error),
      });
    }
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    void refreshHealth();
    try {
      setDiagnostics(await getStorageDiagnostics());
    } catch (error) {
      Alert.alert(
        'Could not inspect local storage',
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      setRefreshing(false);
    }
  }, [refreshHealth]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runSync = async (retry: boolean) => {
    try {
      const result = retry ? await retrySync() : await triggerSync();
      if (result.phase === 'done') {
        Alert.alert('Backup complete', 'InstallHub Cloud Backup is up to date.');
      } else if (result.phase === 'offline') {
        Alert.alert('Still offline', result.lastError || 'The API could not be reached.');
      } else if (result.phase === 'error') {
        Alert.alert('Backup needs attention', result.lastError || 'Cloud Backup failed.');
      } else if (result.phase === 'idle') {
        Alert.alert('Cloud Backup not connected', 'Sign in to run a backup.');
      }
    } catch (error) {
      Alert.alert('Backup failed', cloudConnectionErrorMessage(error));
    } finally {
      await refresh();
    }
  };

  const clearReports = () => {
    Alert.alert(
      'Clear generated reports?',
      'This removes only locally cached PDFs. Forms and original evidence are retained and reports can be generated again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear reports',
          style: 'destructive',
          onPress: () => {
            setCacheAction('reports');
            void clearGeneratedReportCache()
              .then(async (result) => {
                Alert.alert(
                  'Report cache cleared',
                  `${formatBytes(result.previousBytes)} was removed.`,
                );
                await refresh();
              })
              .catch((error) => {
                Alert.alert(
                  'Could not clear reports',
                  error instanceof Error ? error.message : String(error),
                );
              })
              .finally(() => setCacheAction(undefined));
          },
        },
      ],
    );
  };

  const clearThumbnails = () => {
    Alert.alert(
      'Clear imported previews?',
      'This removes only downloaded thumbnail copies. Remote originals and locally captured form evidence are retained.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear previews',
          style: 'destructive',
          onPress: () => {
            setCacheAction('thumbnails');
            void clearImportedThumbnailCache()
              .then(async (result) => {
                Alert.alert(
                  'Preview cache cleared',
                  `${formatBytes(result.previousBytes)} was removed. ${result.repairedQueueItems} preview queue item(s) will be downloaded again when needed.`,
                );
                await refresh();
              })
              .catch((error) => {
                Alert.alert(
                  'Could not clear previews',
                  error instanceof Error ? error.message : String(error),
                );
              })
              .finally(() => setCacheAction(undefined));
          },
        },
      ],
    );
  };

  if (!diagnostics && refreshing) return <LoadingState />;

  const row = (label: string, value: string | number) => (
    <View style={styles.row} key={label}>
      <Text style={[typography.body, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[typography.body, styles.value, { color: colors.foreground }]}>
        {value}
      </Text>
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={colors.primary}
        />
      }
    >
      <Card>
        <View style={styles.headingRow}>
          <Text style={[typography.heading, { color: colors.foreground }]}>
            API connection
          </Text>
          <Badge
            label={
              health.status === 'healthy'
                ? 'Healthy'
                : health.status === 'checking'
                  ? 'Checking'
                  : 'Unavailable'
            }
            tone={
              health.status === 'healthy'
                ? 'success'
                : health.status === 'unreachable'
                  ? 'danger'
                  : 'default'
            }
          />
        </View>
        <Text selectable style={[styles.apiUrl, { color: colors.mutedForeground }]}>
          {SYNC_API_URL}
        </Text>
        <Text
          style={[
            styles.healthDetail,
            {
              color:
                health.status === 'unreachable'
                  ? colors.destructive
                  : colors.mutedForeground,
            },
          ]}
        >
          {health.detail}
        </Text>
        <Button
          title="Refresh diagnostics"
          variant="secondary"
          disabled={refreshing}
          onPress={() => void refresh()}
          style={{ marginTop: spacing.md }}
        />
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <Text style={[typography.heading, { color: colors.foreground }]}>
          Cloud Backup
        </Text>
        {row(
          'Last successful sync',
          lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : 'Not yet',
        )}
        {row('Current phase', progress.phase)}
        {row('Current progress', `${progress.uploaded} / ${progress.total}`)}
        {row('Failed this run', progress.failedCount)}
        {progress.lastError ? (
          <Text style={[styles.errorText, { color: colors.destructive }]}>
            {progress.lastError}
          </Text>
        ) : null}
        <View style={styles.buttonStack}>
          <Button
            title={syncing ? 'Syncing…' : 'Run sync'}
            disabled={syncing}
            onPress={() => void runSync(false)}
          />
          <Button
            title="Retry failed items"
            variant="secondary"
            disabled={syncing}
            onPress={() => void runSync(true)}
          />
        </View>
      </Card>

      {diagnostics ? (
        <>
          <Card style={{ marginTop: spacing.md }}>
            <Text style={[typography.heading, { color: colors.foreground }]}>
              Local entities
            </Text>
            {row('Installations', diagnostics.entities.installations)}
            {row('Zones', diagnostics.entities.zones)}
            {row('Switchboards', diagnostics.entities.electricalAssets)}
            {row('Site assets', diagnostics.entities.siteAssets)}
            {row('Meters', diagnostics.entities.meters)}
            {row('Forms', diagnostics.entities.formSubmissions)}
            {row('Form attachments', diagnostics.entities.attachments)}
          </Card>

          <Card style={{ marginTop: spacing.md }}>
            <Text style={[typography.heading, { color: colors.foreground }]}>
              Backup queues
            </Text>
            {row('Evidence queue total', diagnostics.queues.backup.total)}
            {row('Evidence pending', diagnostics.queues.backup.pending)}
            {row('Evidence uploading', diagnostics.queues.backup.uploading)}
            {row('Evidence failed', diagnostics.queues.backup.failed)}
            {row('Evidence backed up', diagnostics.queues.backup.cleared)}
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            {row('Preview queue total', diagnostics.queues.thumbnails.total)}
            {row('Preview pending', diagnostics.queues.thumbnails.pending)}
            {row('Preview downloading', diagnostics.queues.thumbnails.downloading)}
            {row('Preview failed', diagnostics.queues.thumbnails.failed)}
            {row('Preview ready', diagnostics.queues.thumbnails.ready)}
          </Card>

          <Card style={{ marginTop: spacing.md }}>
            <Text style={[typography.heading, { color: colors.foreground }]}>
              Storage
            </Text>
            {row('App data', formatBytes(diagnostics.storage.asyncStorageBytes))}
            {row(
              'Original form evidence',
              formatBytes(diagnostics.storage.originalEvidenceBytes),
            )}
            {row(
              'Generated report cache',
              formatBytes(diagnostics.storage.generatedReportBytes),
            )}
            {row(
              'Imported preview cache',
              formatBytes(diagnostics.storage.importedThumbnailBytes),
            )}
            {row('Tracked total', formatBytes(diagnostics.storage.totalTrackedBytes))}
            <Text style={[styles.protectedText, { color: colors.mutedForeground }]}>
              Original form evidence is protected and cannot be cleared here.
            </Text>
            <View style={styles.buttonStack}>
              <Button
                title={
                  cacheAction === 'reports'
                    ? 'Clearing reports…'
                    : 'Clear generated reports'
                }
                variant="danger"
                disabled={Boolean(cacheAction)}
                onPress={clearReports}
              />
              <Button
                title={
                  cacheAction === 'thumbnails'
                    ? 'Clearing previews…'
                    : 'Clear imported previews'
                }
                variant="secondary"
                disabled={Boolean(cacheAction)}
                onPress={clearThumbnails}
              />
            </View>
          </Card>

          {diagnostics.warnings.length ? (
            <Card style={{ marginTop: spacing.md }}>
              <Text style={[typography.heading, { color: colors.foreground }]}>
                Inspection warnings
              </Text>
              {diagnostics.warnings.map((warning) => (
                <Text
                  key={warning}
                  style={[styles.warning, { color: colors.destructive }]}
                >
                  {warning}
                </Text>
              ))}
            </Card>
          ) : null}

          <Text style={[styles.generatedAt, { color: colors.mutedForeground }]}>
            Snapshot: {new Date(diagnostics.generatedAt).toLocaleString()}
          </Text>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: 40 },
  headingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  apiUrl: { marginTop: spacing.md, fontSize: 13 },
  healthDetail: { marginTop: spacing.xs },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  value: { flexShrink: 1, textAlign: 'right', fontWeight: '600' },
  buttonStack: { gap: spacing.sm, marginTop: spacing.lg },
  divider: { height: StyleSheet.hairlineWidth, marginTop: spacing.lg },
  errorText: { marginTop: spacing.md, lineHeight: 20 },
  protectedText: { marginTop: spacing.lg, lineHeight: 20 },
  warning: { marginTop: spacing.sm, lineHeight: 20 },
  generatedAt: { marginTop: spacing.lg, textAlign: 'center' },
});
