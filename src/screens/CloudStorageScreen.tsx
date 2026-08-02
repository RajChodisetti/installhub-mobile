import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  apiClient,
  cloudConnectionErrorMessage,
  type CloudStoredFile,
  type InstallationVersionSummary,
} from '../api/apiClient';
import { Badge, Button, Card, EmptyState, LoadingState, SectionHeader } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import type { RootStackParamList } from '../navigation/types';
import { shareCloudFile } from '../services/cloudFiles';
import { formatStorageBytes } from '../services/storageDiagnostics';
import { spacing, typography } from '../theme';

type Props = NativeStackScreenProps<RootStackParamList, 'CloudStorage'>;

function fileTitle(file: CloudStoredFile): string {
  return (
    file.originalFilename ||
    file.fieldName ||
    file.storageKey.split('/').pop() ||
    'Stored file'
  );
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function CloudStorageScreen({ route }: Props) {
  const { serverInstallationId } = route.params;
  const { colors } = useTheme();
  const [files, setFiles] = useState<CloudStoredFile[]>([]);
  const [versions, setVersions] = useState<InstallationVersionSummary[]>([]);
  const [installationName, setInstallationName] = useState('');
  const [loading, setLoading] = useState(true);
  const [sharingKey, setSharingKey] = useState<string>();
  const [inspectingVersion, setInspectingVersion] = useState<number>();
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [fileResult, versionResult] = await Promise.all([
        apiClient.listInstallationFiles(serverInstallationId),
        apiClient.listInstallationVersions(serverInstallationId),
      ]);
      setFiles(fileResult.files);
      setInstallationName(fileResult.installationName);
      setVersions(versionResult.versions);
    } catch (loadError) {
      setError(cloudConnectionErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [serverInstallationId]);

  useEffect(() => {
    void load();
  }, [load]);

  const inspectVersion = async (version: InstallationVersionSummary) => {
    setInspectingVersion(version.versionNumber);
    try {
      const record = await apiClient.getInstallationVersion(
        serverInstallationId,
        version.versionNumber,
      );
      const snapshot = record.snapshot;
      Alert.alert(
        `Cloud version ${version.versionNumber}`,
        [
          `Saved: ${formatTimestamp(record.createdAt)}`,
          `Zones: ${snapshot.zones?.length ?? 0}`,
          `Boards: ${snapshot.electricalAssets?.length ?? 0}`,
          `Site assets: ${snapshot.siteAssets?.length ?? 0}`,
          `Forms: ${snapshot.formSubmissions?.length ?? 0}`,
          '',
          'Versions are read-only here. Import the current cloud installation from Cloud Backups to create a cpN local copy.',
        ].join('\n'),
      );
    } catch (inspectError) {
      Alert.alert('Could not load version', cloudConnectionErrorMessage(inspectError));
    } finally {
      setInspectingVersion(undefined);
    }
  };

  if (loading && !files.length && !versions.length) return <LoadingState />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={load}
          tintColor={colors.primary}
        />
      }
    >
      <Text style={[typography.title, { color: colors.foreground }]}>
        Cloud files & history
      </Text>
      <Text style={[styles.intro, { color: colors.mutedForeground }]}>
        {installationName || 'Field App Complete installation'} · Server
        originals are read-only. Sharing downloads a temporary local copy.
      </Text>

      {error ? (
        <Card>
          <Text style={{ color: colors.destructive }}>{error}</Text>
          <Button
            title="Try again"
            variant="secondary"
            style={{ marginTop: spacing.md }}
            onPress={() => void load()}
          />
        </Card>
      ) : (
        <>
          <SectionHeader title={`Stored files (${files.length})`} />
          {files.length ? files.map((file) => (
            <Card key={file.storageKey} style={styles.card}>
              <View style={styles.headingRow}>
                <Text
                  style={[typography.subheading, { color: colors.foreground, flex: 1 }]}
                >
                  {fileTitle(file)}
                </Text>
                <Badge
                  label={file.source === 'report_pdf' ? 'PDF' : 'Evidence'}
                  tone={file.source === 'report_pdf' ? 'default' : 'success'}
                />
              </View>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {formatStorageBytes(file.sizeBytes)} ·{' '}
                {formatTimestamp(file.uploadedAt || file.lastModified || file.createdAt)}
              </Text>
              <Text
                selectable
                style={[styles.field, { color: colors.mutedForeground }]}
              >
                {file.fieldName || file.storageKey}
              </Text>
              <Button
                title={sharingKey === file.storageKey ? 'Downloading…' : 'Download / Share'}
                variant="secondary"
                disabled={Boolean(sharingKey)}
                style={{ marginTop: spacing.md }}
                onPress={() => {
                  setSharingKey(file.storageKey);
                  void shareCloudFile(file)
                    .catch((shareError) => Alert.alert(
                      'Could not share file',
                      cloudConnectionErrorMessage(shareError),
                    ))
                    .finally(() => setSharingKey(undefined));
                }}
              />
            </Card>
          )) : (
            <Card>
              <EmptyState
                title="No stored files"
                subtitle="Backed-up evidence and API-generated reports will appear here."
              />
            </Card>
          )}

          <SectionHeader title={`Backup versions (${versions.length})`} />
          {versions.length ? versions.map((version) => (
            <Card key={version.id} style={styles.card}>
              <Text style={[typography.subheading, { color: colors.foreground }]}>
                Version {version.versionNumber}
              </Text>
              <Text style={[styles.meta, { color: colors.mutedForeground }]}>
                {formatTimestamp(version.createdAt)}
              </Text>
              <Button
                title={
                  inspectingVersion === version.versionNumber
                    ? 'Loading snapshot…'
                    : 'Inspect snapshot'
                }
                variant="secondary"
                disabled={Boolean(inspectingVersion)}
                style={{ marginTop: spacing.md }}
                onPress={() => void inspectVersion(version)}
              />
            </Card>
          )) : (
            <Card>
              <EmptyState
                title="No finalized versions"
                subtitle="A version is created after a Cloud Backup completes."
              />
            </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  intro: { marginTop: spacing.sm, marginBottom: spacing.md, lineHeight: 20 },
  card: { marginBottom: spacing.sm },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  meta: { marginTop: spacing.sm },
  field: { marginTop: spacing.xs, fontSize: 12 },
});
