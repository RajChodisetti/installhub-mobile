import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { electricalAssetsRepo } from '../repositories';
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

  useEffect(() => {
    (async () => {
      const board = await electricalAssetsRepo.getById(boardId);
      if (!board) {
        setLoading(false);
        return;
      }
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
      <WattwatcherForm deviceType={meter.device_type} data={meter} onChange={(next) => setMeter({ ...meter, ...next })} />
      <Button
        title={busy ? 'Saving…' : 'Save meter'}
        disabled={busy}
        style={{ marginTop: spacing.lg }}
        onPress={async () => {
          setBusy(true);
          try {
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
          style={{ marginTop: spacing.md }}
          onPress={() => {
            Alert.alert('Delete meter?', undefined, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  const board = await electricalAssetsRepo.getById(boardId);
                  if (!board) return;
                  const meters = board.meters.filter((m) => m.id !== meterId);
                  await electricalAssetsRepo.update(boardId, {
                    meters,
                    meter_present: meters.length > 0,
                  });
                  navigation.goBack();
                },
              },
            ]);
          }}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
