import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { InstallationForm } from '../components/forms';
import { LoadingState } from '../components/ui';
import { installationsRepo } from '../repositories';
import type { Installation } from '../types';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'InstallationForm'>;

export function InstallationFormScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
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
              Alert.alert('Delete installation?', 'Zones, boards and assets will also be removed.', [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete',
                  style: 'destructive',
                  onPress: async () => {
                    await installationsRepo.remove(id);
                    navigation.popToTop();
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
