import { resolveOwnedMediaUri } from '../services/ownedMediaPaths';
import React from 'react';
import { Image, Modal, ScrollView, Text, View } from 'react-native';
import type { AssignedWorkRecoveryCheckout } from '../types';
import { useTheme } from '../context/AppProviders';
import { Button, Card } from './ui';
import { assignedWorkRecoveryLocalMediaReferences } from '../services/assignedWorkRecovery';
import { spacing, typography } from '../theme';

/** Recovery arrays are never inserted into live repositories or editable screens. */
export function RecoveryCopyViewer({ copy, onClose }: { copy: AssignedWorkRecoveryCheckout | null; onClose: () => void }) {
  const { colors } = useTheme();
  return <Modal visible={Boolean(copy)} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
    <View style={{ flex: 1, backgroundColor: colors.background, padding: spacing.lg }}>
      <Button title="Close recovery copy" onPress={onClose} />
      {copy ? <ScrollView contentContainerStyle={{ paddingVertical: spacing.lg }}>
        <Text style={[typography.title, { color: colors.foreground }]}>{copy.installation.site_name}</Text>
        <Text style={{ color: colors.mutedForeground, marginVertical: spacing.md }}>Read-only device recovery copy · {copy.quarantined_at}. This capture has not been merged or uploaded. Original identifiers and captured values are retained below.</Text>
        {(['installation', 'gridSupplies', 'zones', 'electricalAssets', 'siteAssets', 'meterDevices', 'measurementAssignments', 'formSubmissions', 'siteAssetEditorDrafts', 'cloudSync', 'reconciliation'] as const).map((key) => (
          <Card key={key} style={{ marginBottom: spacing.md }}>
            <Text style={{ color: colors.foreground, fontWeight: '700' }}>{key}</Text>
            <Text selectable style={{ color: colors.foreground, marginTop: spacing.sm }}>{JSON.stringify(copy[key], null, 2) ?? 'Not recorded'}</Text>
          </Card>
        ))}
        {assignedWorkRecoveryLocalMediaReferences(copy).map((uri) => <Card key={uri} style={{ marginBottom: spacing.md }}>
          <Text selectable style={{ color: colors.mutedForeground }}>Preserved original: {uri}</Text>
          <Image source={{ uri: resolveOwnedMediaUri(uri) }} accessibilityLabel="Preserved recovery evidence" resizeMode="contain" style={{ width: '100%', height: 260 }} />
        </Card>)}
      </ScrollView> : null}
    </View>
  </Modal>;
}
