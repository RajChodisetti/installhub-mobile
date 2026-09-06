import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { InstallationForm } from '../components/forms';
import { Button, LoadingState } from '../components/ui';
import { canonicalInstallationRepo, installationsRepo } from '../repositories';
import type { Installation } from '../types';
import { useAuth, useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import {
  resumeAuditWorkForInstallation,
  suspendAuditWorkForInstallation,
} from '../services/auditWorkTrackingBridge';
import { captureAuditWorkResumeAuthority } from '../services/assignedWorkMutationGuard';

type Props = NativeStackScreenProps<RootStackParamList, 'InstallationForm'>;

export function InstallationFormScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const id = route.params?.installationId;
  const [initial, setInitial] = useState<Installation | null>(null);
  const [initialElectricityNmi, setInitialElectricityNmi] = useState('');
  const [loading, setLoading] = useState(!!id);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    setLoadError(null);
    void Promise.all([
      installationsRepo.getById(id),
      canonicalInstallationRepo.gridSupplies(id),
    ]).then(([item, gridSupplies]) => {
      if (!active) return;
      if (!item) throw new Error('This installation is unavailable or you no longer have access.');
      const defaultGrid = gridSupplies.find((grid) => grid.isDefault)
        ?? [...gridSupplies].sort((a, b) => a.id.localeCompare(b.id))[0];
      setInitial(item);
      setInitialElectricityNmi(defaultGrid?.nmi ?? '');
    }).catch((error) => {
      if (active) setLoadError(error instanceof Error ? error.message : 'Could not load installation details.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, loadAttempt]);

  if (loading) return <LoadingState />;
  if (loadError || (id && initial?.status === 'Completed')) {
    return (
      <View style={[styles.pad, { flex: 1, backgroundColor: colors.background, gap: spacing.md }]}>
        <Text accessibilityRole="alert" style={{ color: colors.foreground }}>
          {loadError || 'Reopen this completed installation before editing its details.'}
        </Text>
        {loadError ? <Button title="Retry" onPress={() => setLoadAttempt((value) => value + 1)} /> : null}
        <Button title="Back" variant="secondary" onPress={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.pad}
      automaticallyAdjustKeyboardInsets
      keyboardShouldPersistTaps="handled"
    >
      <Text style={[typography.heading, { color: colors.foreground, marginBottom: spacing.lg }]}>
        {id ? 'Edit installation' : 'New site installation'}
      </Text>
      <InstallationForm
        initial={initial ?? undefined}
        initialElectricityNmi={initialElectricityNmi}
        submitLabel={id ? 'Update' : 'Create Installation'}
        onSubmit={async (values, planning) => {
          if (id) {
            await installationsRepo.update(id, values, undefined, planning);
            navigation.goBack();
          } else {
            const created = await installationsRepo.create(values, planning);
            navigation.replace('InstallationDetail', { installationId: created.id });
          }
        }}
      />
      {id ? (
        <View style={{ marginTop: spacing.xl }}>
          <Text
            style={{ color: colors.destructive, textAlign: 'center', fontWeight: '700' }}
            onPress={() => {
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
              Alert.alert('Delete installation?', 'Zones, boards and assets will also be removed.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    const suspension = await suspendAuditWorkForInstallation(
                      id,
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
                      await installationsRepo.remove(id);
                      navigation.popToTop();
                    } catch (error) {
                      Alert.alert('Installation not deleted', error instanceof Error ? error.message : 'Please try again.');
                    } finally {
                      await resumeAuditWorkForInstallation(
                        suspension,
                        resumeAuthority,
                      ).catch(() => false);
                    }
                  },
                },
              ]);
            }}
          >
            Delete installation
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
