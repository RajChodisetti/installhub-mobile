import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  canonicalInstallationRepo,
  electricalAssetsRepo,
  formsRepo,
  installationsRepo,
  siteAssetsRepo,
} from '../repositories';
import type { Meter } from '../types';
import { WattwatcherForm, createEmptyMeter } from '../components/forms';
import { Button, LoadingState } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'MeterForm'>;

export function MeterFormScreen({ navigation, route }: Props) {
  const { boardId, meterId, deviceType = 'A3RM' } = route.params;
  const { colors } = useTheme();
  const [meter, setMeter] = useState<Meter | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [lockedByCompletedForm, setLockedByCompletedForm] = useState(false);
  const [completedFormId, setCompletedFormId] = useState<string | null>(null);
  const [deletionPreview, setDeletionPreview] = useState({
    assignmentIds: [] as string[],
    tbcAssetLabels: [] as string[],
    retainedCompletedFormIds: [] as string[],
    retainedEvidenceCount: 0,
  });

  useEffect(() => {
    (async () => {
      const board = await electricalAssetsRepo.getById(boardId);
      if (!board) {
        setLoading(false);
        return;
      }
      const [installation, forms, assignments, assets] = await Promise.all([
        installationsRepo.getById(board.audit_id),
        formsRepo.listByInstallation(board.audit_id),
        canonicalInstallationRepo.measurementAssignments(board.audit_id),
        siteAssetsRepo.listByInstallation(board.audit_id),
      ]);
      setReadOnly(installation?.status === 'Completed');
      const completedForm = meterId
        ? forms.find((form) => form.meter_id === meterId && form.status === 'Completed')
        : undefined;
      setLockedByCompletedForm(Boolean(completedForm));
      setCompletedFormId(completedForm?.id ?? null);
      const deletedAssignments = meterId
        ? assignments.filter((assignment) => assignment.meterId === meterId)
        : [];
      const deletedAssignmentIds = new Set(deletedAssignments.map((assignment) => assignment.id));
      const retainedForms = meterId ? forms.filter((form) => form.meter_id === meterId) : [];
      setDeletionPreview({
        assignmentIds: [...deletedAssignmentIds].sort(),
        tbcAssetLabels: assets
          .filter((asset) => asset.metering_state?.kind === 'METERED' &&
            asset.metering_state.measurementAssignmentIds.some((id) => deletedAssignmentIds.has(id)) &&
            !asset.metering_state.measurementAssignmentIds.some((id) => !deletedAssignmentIds.has(id)))
          .map((asset) => `${asset.display_code ?? asset.id} (${asset.id})`)
          .sort(),
        retainedCompletedFormIds: retainedForms
          .filter((form) => form.status === 'Completed')
          .map((form) => form.id)
          .sort(),
        retainedEvidenceCount: retainedForms.reduce(
          (count, form) => count + form.attachments.length,
          0,
        ),
      });
      if (meterId) {
        setMeter(board.meters.find((m) => m.id === meterId) ?? createEmptyMeter(deviceType));
      } else {
        setMeter(createEmptyMeter(deviceType));
      }
      setLoading(false);
    })();
  }, [boardId, meterId, deviceType]);

  if (loading || !meter) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.heading, { color: colors.foreground, marginBottom: spacing.lg }]}>
        Wattwatcher {meter.device_type}
      </Text>
      {lockedByCompletedForm ? (
        <View style={{ marginBottom: spacing.md }}>
          <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm, lineHeight: 20 }}>
            Identity and channel commissioning are pinned by a completed form. Create an amendment before changing them. Draft meter deletion remains available and retains completed form history and evidence.
          </Text>
          <Button
            title="Create commissioning amendment"
            variant="secondary"
            disabled={readOnly || !completedFormId}
            onPress={async () => {
              if (!completedFormId) return;
              const amendment = await formsRepo.cloneAmendment(completedFormId);
              navigation.replace('FormEditor', { formId: amendment.id });
            }}
          />
        </View>
      ) : null}
      <WattwatcherForm deviceType={meter.device_type} data={meter} onChange={(next) => setMeter({ ...meter, ...next })} />
      <Button
        title={busy ? 'Saving…' : 'Save meter'}
        disabled={busy || readOnly || lockedByCompletedForm}
        style={{ marginTop: spacing.lg }}
        onPress={async () => {
          setBusy(true);
          try {
            if (meter.device_type === 'Other') {
              if (!meter.custom_manufacturer_name?.trim() || !meter.custom_model_name?.trim()) {
                throw new Error('Custom meters require manufacturer and model.');
              }
              if (!(meter.ww_channels?.length)) {
                throw new Error('Declare at least one channel for this custom meter.');
              }
              const missingCapabilities = meter.ww_channels.findIndex(
                (channel) => !channel.capabilities || Object.keys(channel.capabilities).length === 0,
              );
              if (missingCapabilities >= 0) {
                throw new Error(`Declare capabilities for custom meter channel ${missingCapabilities + 1}.`);
              }
              const invalidOrdinal = meter.ww_channels.findIndex(
                (channel) => !Number.isSafeInteger(channel.ordinal) || (channel.ordinal ?? 0) < 1,
              );
              if (invalidOrdinal >= 0) {
                throw new Error(`Custom meter channel ${invalidOrdinal + 1} requires a stable positive ordinal.`);
              }
            }
            const board = await electricalAssetsRepo.getById(boardId);
            if (!board) throw new Error('Board not found');
            let meters = [...board.meters];
            if (meterId) {
              meters = meters.map((m) => (m.id === meterId ? meter : m));
            } else {
              meters.push(meter);
            }
            await electricalAssetsRepo.update(boardId, { meters, meter_present: true });
            navigation.goBack();
          } catch (e) {
            Alert.alert('Error', e instanceof Error ? e.message : 'Save failed');
          } finally {
            setBusy(false);
          }
        }}
      />
      {meterId ? (
        <Button
          title="Delete meter"
          variant="danger"
          disabled={readOnly || busy}
          style={{ marginTop: spacing.md }}
          onPress={() => {
            Alert.alert(
              'Delete meter?',
              [
                deletionPreview.assignmentIds.length
                  ? `${deletionPreview.assignmentIds.length} active assignment(s) will be removed:\n${deletionPreview.assignmentIds.join('\n')}`
                  : 'No active assignments depend on this meter.',
                deletionPreview.tbcAssetLabels.length
                  ? `${deletionPreview.tbcAssetLabels.length} affected asset(s) will become TBC:\n${deletionPreview.tbcAssetLabels.join('\n')}`
                  : 'No asset will become TBC.',
                deletionPreview.retainedCompletedFormIds.length
                  ? `${deletionPreview.retainedCompletedFormIds.length} completed form version(s) stay retained:\n${deletionPreview.retainedCompletedFormIds.join('\n')}\n${deletionPreview.retainedEvidenceCount} evidence attachment(s) stay retained.`
                  : `No completed form version is linked. ${deletionPreview.retainedEvidenceCount} evidence attachment(s) stay retained.`,
              ].join('\n\n'),
              [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  setBusy(true);
                  try {
                    const board = await electricalAssetsRepo.getById(boardId);
                    if (!board) throw new Error('Board not found');
                    const installation = await installationsRepo.getById(board.audit_id);
                    if (installation?.status === 'Completed') {
                      throw new Error('Reopen this completed installation before deleting its meter.');
                    }
                    const meters = board.meters.filter((m) => m.id !== meterId);
                    await electricalAssetsRepo.update(boardId, {
                      meters,
                      meter_present: meters.length > 0,
                    });
                    navigation.goBack();
                  } catch (error) {
                    Alert.alert('Meter not deleted', error instanceof Error ? error.message : String(error));
                  } finally {
                    setBusy(false);
                  }
                },
              },
              ],
            );
          }}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
