import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { InstallationForm } from '../components/forms';
import { LoadingState } from '../components/ui';
import { installationsRepo } from '../repositories';
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
  const [loading, setLoading] = useState(!!id);

  useEffect(() => {
    if (!id) return;
    void installationsRepo.getById(id).then((item) => {
      setInitial(item);
      setLoading(false);
    });
  }, [id]);

  if (loading) return <LoadingState />;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.heading, { color: colors.foreground, marginBottom: spacing.lg }]}>
        {id ? 'Edit installation' : 'New site installation'}
      </Text>
      <InstallationForm
        initial={initial ?? undefined}
        submitLabel={id ? 'Update' : 'Create Installation'}
        onSubmit={async (values) => {
          if (id) {
            await installationsRepo.update(id, values);
            navigation.goBack();
          } else {
            const created = await installationsRepo.create(values);
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
