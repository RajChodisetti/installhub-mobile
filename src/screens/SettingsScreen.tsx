import React, { useCallback, useState } from 'react';
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import appConfig from '../../app.json';
import { useAuth, useTheme } from '../context/AppProviders';
import { Badge, Button, Card, SectionHeader } from '../components/ui';
import { getCloudBackupStats, resetDemoData } from '../repositories';
import { spacing, typography, type ThemeMode } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { useSyncStatus } from '../services/SyncStatusContext';
import {
  clearGeneratedReportCache,
  clearImportedThumbnailCache,
  formatStorageBytes,
  getStorageDiagnostics,
  type StorageDiagnostics,
} from '../services/storageDiagnostics';
import { apiClient } from '../api/apiClient';
import { SYNC_API_URL } from '../constants/syncConfig';
import {
  passwordChangeSessionNotice,
  sourceAppDisplayName,
  sourceUserDisplayEmail,
} from '../utils/sourceManagedUsers';

type Props = NativeStackScreenProps<RootStackParamList, 'MainTabs'> | any;

const emptyBackupStats = {
  pending: 0,
  uploading: 0,
  failed: 0,
  backedUp: 0,
};

export function SettingsScreen({ navigation }: Props) {
  const { user, logout } = useAuth();
  const { colors, mode, resolvedMode, setMode } = useTheme();
  const { syncing, progress, lastSyncedAt, triggerSync, retrySync } = useSyncStatus();
  const [backupStats, setBackupStats] = useState(emptyBackupStats);
  const [storage, setStorage] = useState<StorageDiagnostics>();
  const [clearing, setClearing] = useState<'reports' | 'previews'>();
  const sourceManaged = user?.source_managed === true;
  const sourceUnavailable = user?.source_state === 'orphaned';
  const sourceAppName = sourceAppDisplayName(user?.source_app);
  const sessionNotice = passwordChangeSessionNotice(
    user?.source_app,
    sourceManaged,
  );

  const refreshLocalStats = useCallback(async () => {
    const [nextBackupStats, nextStorage] = await Promise.all([
      getCloudBackupStats(),
      getStorageDiagnostics(),
    ]);
    setBackupStats(nextBackupStats);
    setStorage(nextStorage);
  }, []);

  useFocusEffect(useCallback(() => {
    void refreshLocalStats().catch(() => {
      // Diagnostics provides the detailed recovery path if storage inspection fails.
    });
  }, [refreshLocalStats, progress, syncing]));

  const clearReports = () => {
    Alert.alert(
      'Clear generated reports?',
      'Only locally generated PDF copies will be removed. Forms and original evidence remain protected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear reports',
          style: 'destructive',
          onPress: () => {
            setClearing('reports');
            void clearGeneratedReportCache()
              .then(async (result) => {
                await refreshLocalStats();
                Alert.alert(
                  'Reports cleared',
                  `${formatStorageBytes(result.previousBytes)} was removed. Reports can be generated again.`,
                );
              })
              .catch((error) => Alert.alert(
                'Could not clear reports',
                error instanceof Error ? error.message : String(error),
              ))
              .finally(() => setClearing(undefined));
          },
        },
      ],
    );
  };

  const clearPreviews = () => {
    Alert.alert(
      'Clear imported previews?',
      'Only downloaded thumbnail copies will be removed. Cloud originals and locally captured evidence remain protected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear previews',
          style: 'destructive',
          onPress: () => {
            setClearing('previews');
            void clearImportedThumbnailCache()
              .then(async (result) => {
                await refreshLocalStats();
                Alert.alert(
                  'Previews cleared',
                  `${formatStorageBytes(result.previousBytes)} was removed. ${result.repairedQueueItems} preview(s) will be downloaded again when needed.`,
                );
              })
              .catch((error) => Alert.alert(
                'Could not clear previews',
                error instanceof Error ? error.message : String(error),
              ))
              .finally(() => setClearing(undefined));
          },
        },
      ],
    );
  };

  const storageRow = (label: string, bytes: number) => (
    <View style={styles.row} key={label}>
      <Text style={{ color: colors.mutedForeground }}>{label}</Text>
      <Text style={[styles.value, { color: colors.foreground }]}>
        {formatStorageBytes(bytes)}
      </Text>
    </View>
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.pad}
    >
      <Text style={[typography.title, { color: colors.foreground }]}>Settings</Text>

      <Card style={{ marginTop: spacing.lg }}>
        <SectionHeader title="Profile" />
        <Text style={{ color: colors.foreground, fontWeight: '600' }}>
          {user?.full_name}
        </Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
          {sourceUserDisplayEmail(user?.email)}
        </Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
          Role: {user?.role === 'admin' ? 'Administrator' : 'Inspector'}
        </Text>
        {sourceManaged ? (
          <>
            <View style={{ marginTop: spacing.md, alignSelf: 'flex-start' }}>
              <Badge
                label={
                  sourceUnavailable
                    ? 'Source unavailable · read only'
                    : `${sourceAppName} managed`
                }
              />
            </View>
            <Text
              style={[
                styles.note,
                { color: colors.mutedForeground, marginTop: spacing.sm },
              ]}
            >
              {sourceUnavailable
                ? `The ${sourceAppName} source account is unavailable. This retained Field App Complete record is read-only and no future source synchronization is expected.`
                : `Your Field App Complete account uses the same credential as ${sourceAppName}. ${sessionNotice}`}
            </Text>
          </>
        ) : null}
        {!sourceUnavailable ? (
          <Button
            title="Change password"
            variant="secondary"
            style={{ marginTop: spacing.md }}
            accessibilityHint={
              sourceManaged
                ? `Updates the shared ${sourceAppName} credential.`
                : 'Opens the password change form.'
            }
            onPress={() => navigation.navigate('ChangePassword')}
          />
        ) : null}
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <SectionHeader title="Cloud Backup" />
        <Text style={{ color: colors.mutedForeground, marginBottom: 4 }}>
          Server: {SYNC_API_URL}
        </Text>
        <Text style={{ color: colors.mutedForeground, marginBottom: 4 }}>
          Last successful backup:{' '}
          {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : 'Not yet'}
        </Text>
        <Text style={{ color: colors.mutedForeground, marginBottom: 12 }}>
          Pending {backupStats.pending + backupStats.uploading} · Failed{' '}
          {backupStats.failed} · Evidence backed up {backupStats.backedUp}
        </Text>
        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          Backup is opt-in for each installation. Cloud forms shared with you
          stay separate until you import a local cp1, cp2, … copy.
        </Text>
        {progress.lastError ? (
          <Text style={{ color: colors.destructive, marginBottom: 12 }}>
            {progress.lastError}
          </Text>
        ) : null}
        <Button
          title={syncing ? 'Backing up…' : 'Back up opted-in installations'}
          disabled={syncing}
          onPress={() => void (backupStats.failed ? retrySync() : triggerSync())}
        />
        <Button
          title="Browse cloud backups"
          variant="secondary"
          style={{ marginTop: spacing.sm }}
          onPress={() => navigation.navigate('RemoteInstallations')}
        />
        <Button
          title="Test server connection"
          variant="secondary"
          style={{ marginTop: spacing.sm }}
          onPress={() => {
            void apiClient.health()
              .then(() => Alert.alert(
                'Connected',
                'Field App Complete reached the Sustainability Wise API.',
              ))
              .catch((error) => Alert.alert(
                'Connection failed',
                error instanceof Error ? error.message : String(error),
              ));
          }}
        />
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <SectionHeader title="Appearance" />
        <Text style={{ color: colors.mutedForeground, marginBottom: 12 }}>
          Current: {mode === 'system' ? `System (${resolvedMode})` : mode}
        </Text>
        <View style={styles.themeRow}>
          {(['light', 'dark', 'system'] as ThemeMode[]).map((option) => (
            <Button
              key={option}
              title={option[0].toUpperCase() + option.slice(1)}
              variant={mode === option ? 'primary' : 'secondary'}
              style={styles.themeButton}
              onPress={() => void setMode(option)}
            />
          ))}
        </View>
      </Card>

      <Card style={{ marginTop: spacing.md }}>
        <SectionHeader title="Local storage" />
        {storage ? (
          <>
            {storageRow('Original form evidence', storage.formMediaBytes)}
            {storageRow('Generated PDFs', storage.generatedReportBytes)}
            {storageRow('Imported previews', storage.thumbnailCacheBytes)}
            {storageRow('App data', storage.asyncStorageBytes)}
            {storageRow('Tracked total', storage.totalBytes)}
          </>
        ) : (
          <Text style={{ color: colors.mutedForeground }}>
            Storage details are being calculated…
          </Text>
        )}
        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          Original evidence is protected. Only reproducible reports and preview
          caches can be cleared.
        </Text>
        <Button
          title={clearing === 'reports' ? 'Clearing reports…' : 'Clear generated reports'}
          variant="danger"
          disabled={Boolean(clearing)}
          onPress={clearReports}
        />
        <Button
          title={clearing === 'previews' ? 'Clearing previews…' : 'Clear imported previews'}
          variant="secondary"
          disabled={Boolean(clearing)}
          style={{ marginTop: spacing.sm }}
          onPress={clearPreviews}
        />
      </Card>

      {user?.role === 'admin' ? (
        <>
          <Card style={{ marginTop: spacing.md }}>
            <SectionHeader title="Administration" />
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              Create users, control roles, reset passwords, and assign access to
              backed-up installations.
            </Text>
            <Button
              title="Manage users"
              onPress={() => navigation.navigate('UserManagement')}
            />
            <Button
              title="Diagnostics"
              variant="secondary"
              style={{ marginTop: spacing.sm }}
              onPress={() => navigation.navigate('Diagnostics')}
            />
          </Card>

          <Card style={{ marginTop: spacing.md }}>
            <SectionHeader title="Demo data" />
            <Button
              title="Reset fixture data"
              variant="secondary"
              onPress={() => {
                Alert.alert(
                  'Reset local fixture data?',
                  'This replaces local demo records. Cloud backups are not deleted.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Reset',
                      style: 'destructive',
                      onPress: () => {
                        void resetDemoData().then(async () => {
                          await refreshLocalStats();
                          Alert.alert('Done', 'Demo fixtures restored.');
                        });
                      },
                    },
                  ],
                );
              }}
            />
          </Card>
        </>
      ) : null}

      <Card style={{ marginTop: spacing.md }}>
        <SectionHeader title="About" />
        <Text style={{ color: colors.foreground, fontWeight: '600' }}>
          Field App Complete {appConfig.expo.version}
        </Text>
        <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs }}>
          {Platform.OS === 'ios' ? 'iOS' : Platform.OS} · Offline-first field forms
        </Text>
        <Text style={[styles.note, { color: colors.mutedForeground }]}>
          Sustainability Wise report styling and secure Cloud Backup use the
          same service pattern as the other mobile apps.
        </Text>
      </Card>

      <View style={{ marginTop: spacing.xl }}>
        <Button title="Log out" variant="danger" onPress={() => void logout()} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 40 },
  note: { lineHeight: 20, marginBottom: spacing.md },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.lg,
    marginBottom: spacing.sm,
  },
  value: { fontWeight: '600', textAlign: 'right' },
  themeRow: { flexDirection: 'row', gap: spacing.sm },
  themeButton: { flex: 1, paddingHorizontal: spacing.xs },
});
