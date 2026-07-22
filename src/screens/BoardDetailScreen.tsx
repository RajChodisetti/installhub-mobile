import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { electricalAssetsRepo } from '../repositories';
import type { ElectricalAsset } from '../types';
import { ElectricalAssetForm, FormModal } from '../components/forms';
import { Badge, Button, Card, LoadingState, SectionHeader } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<RootStackParamList, 'BoardDetail'>;

export function BoardDetailScreen({ navigation, route }: Props) {
  const { boardId, installationId, zoneId } = route.params;
  const { colors } = useTheme();
  const [board, setBoard] = useState<ElectricalAsset | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    setBoard(await electricalAssetsRepo.getById(boardId));
    setLoading(false);
  };

  useEffect(() => {
    void refresh();
  }, [boardId]);

  if (loading || !board) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.title, { color: colors.foreground }]}>{board.asset_name}</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 6 }}>
        {board.display_code} · {board.asset_type}
      </Text>
      {board.electrical_parent_tbc ? (
        <View style={{ marginTop: 8 }}>
          <Badge label="Parent TBC" tone="tbc" />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8, marginTop: spacing.lg, flexWrap: 'wrap' }}>
        <Button title="Edit board" variant="secondary" onPress={() => setEditOpen(true)} />
        <Button
          title="Add A3RM"
          onPress={() =>
            navigation.navigate('MeterForm', { boardId, deviceType: 'A3RM' })
          }
        />
        <Button
          title="Add A6M"
          variant="secondary"
          onPress={() =>
            navigation.navigate('MeterForm', { boardId, deviceType: 'A6M' })
          }
        />
      </View>

      <SectionHeader title={`Meters (${board.meters.length})`} />
      {board.meters.length === 0 ? (
        <Text style={{ color: colors.mutedForeground }}>No Wattwatcher devices on this board.</Text>
      ) : (
        board.meters.map((m) => (
          <Card key={m.id} style={{ marginBottom: 8 }}>
            <Text style={[typography.subheading, { color: colors.foreground }]}>{m.device_name || 'Unnamed device'}</Text>
            <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
              {m.device_type} · {m.device_id || 'no serial'}
            </Text>
            <Button
              title="Edit Wattwatcher form"
              variant="ghost"
              style={{ marginTop: 10 }}
              onPress={() =>
                navigation.navigate('MeterForm', {
                  boardId,
                  meterId: m.id,
                  deviceType: m.device_type,
                })
              }
            />
          </Card>
        ))
      )}

      <Button
        title="Delete board"
        variant="danger"
        style={{ marginTop: spacing.xl }}
        onPress={() => {
          Alert.alert('Delete board?', undefined, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: async () => {
                await electricalAssetsRepo.remove(boardId);
                navigation.goBack();
              },
            },
          ]);
        }}
      />

      <FormModal visible={editOpen} title="Edit board" onClose={() => setEditOpen(false)}>
        <ElectricalAssetForm
          initial={board}
          onSubmit={async (values) => {
            await electricalAssetsRepo.update(boardId, {
              ...values,
              meters: board.meters,
            });
            setEditOpen(false);
            await refresh();
          }}
        />
      </FormModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
