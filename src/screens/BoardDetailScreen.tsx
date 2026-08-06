import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { electricalAssetsRepo, formsRepo, getLocalDeletionPreview } from '../repositories';
import { useInstallation } from '../hooks';
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
  const {
    item: installation,
    boards: installationBoards,
    gridSupplies,
    zones,
    siteAssets,
    measurementAssignments,
  } = useInstallation(installationId);
  const readOnly = installation?.status === 'Completed';

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
        {board.asset_type}
      </Text>
      {board.electrical_parent_tbc ? (
        <View style={{ marginTop: 8 }}>
          <Badge label="Parent TBC" tone="tbc" />
        </View>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 8, marginTop: spacing.lg, flexWrap: 'wrap' }}>
        <Button title="Edit board" variant="secondary" disabled={readOnly} onPress={() => setEditOpen(true)} />
        <Button
          title="Commission new device"
          disabled={readOnly}
          onPress={() =>
            navigation.navigate('FormTypePicker', {
              installationId,
              zoneId,
              boardId,
              formType: 'ww-installation',
            })
          }
        />
        <Button
          title="Add Other Meter"
          variant="secondary"
          disabled={readOnly}
          onPress={() => navigation.navigate('MeterForm', {
            boardId,
            deviceType: 'Other',
          })}
        />
      </View>

      <SectionHeader title={`Meters (${board.meters.length})`} />
      {board.meters.length === 0 ? (
        <Text style={{ color: colors.mutedForeground }}>No metering devices on this board.</Text>
      ) : (
        board.meters.map((m) => (
          <Card key={m.id} style={{ marginBottom: 8 }}>
            <Text style={[typography.subheading, { color: colors.foreground }]}>{m.device_name || 'Unnamed device'}</Text>
            <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
              {m.device_type} · {m.device_id || 'no serial'}
            </Text>
            <Button
              title="Edit meter and channels"
              variant="ghost"
              disabled={readOnly}
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
        disabled={readOnly}
        style={{ marginTop: spacing.xl }}
        onPress={() => { void (async () => {
          const preview = await getLocalDeletionPreview({ kind: 'electrical_asset', id: boardId });
          const impact = preview
            ? `\n\nDeletes ${preview.deletes.meters} meter(s), ${preview.deletes.assignments} assignment(s), and ${preview.deletes.forms} linked form(s). Converts ${preview.convertsToTbc.boards} board(s) and ${preview.convertsToTbc.siteAssets} asset(s) to TBC.`
            : '';
          Alert.alert(
            'Delete board?',
            `Forms linked to this board or its meters will also be removed from this device. Other links will be marked TBC.${impact}`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  await electricalAssetsRepo.remove(boardId);
                  navigation.goBack();
                },
              },
            ],
          );
        })(); }}
      />

      <FormModal visible={editOpen} title="Edit board" onClose={() => setEditOpen(false)}>
        <ElectricalAssetForm
          initial={board}
          sourceBoards={installationBoards}
          gridSupplies={gridSupplies}
          zones={zones}
          onSubmit={async (values, options) => {
            if (options.removeMeters) {
              const meterIds = new Set(board.meters.map((meter) => meter.id));
              const affectedAssignments = measurementAssignments.filter((assignment) => meterIds.has(assignment.meterId));
              const affectedAssetIds = new Set(affectedAssignments.flatMap((assignment) =>
                assignment.target.kind === 'SITE_ASSET' ? [assignment.target.siteAssetId] : []));
              const linkedForms = (await formsRepo.listByInstallation(installationId))
                .filter((form) => Boolean(form.meter_id && meterIds.has(form.meter_id)));
              const accepted = await new Promise<boolean>((resolve) => {
                Alert.alert(
                  'Remove all meter devices?',
                  [
                    `${board.meters.length} meter device(s):\n${board.meters.map((meter) => `${meter.device_name || meter.id} (${meter.id})`).join('\n')}`,
                    `${affectedAssignments.length} active assignment(s):${affectedAssignments.length ? `\n${affectedAssignments.map((assignment) => assignment.id).join('\n')}` : ' none'}`,
                    `${affectedAssetIds.size} affected asset(s) become TBC:${affectedAssetIds.size ? `\n${siteAssets.filter((asset) => affectedAssetIds.has(asset.id)).map((asset) => `${asset.asset_name} · ${asset.asset_type}`).join('\n')}` : ' none'}`,
                    `${linkedForms.length} linked form record(s) and ${linkedForms.reduce((count, form) => count + form.attachments.length, 0)} evidence attachment(s) remain retained for history.`,
                  ].join('\n\n'),
                  [
                    { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                    { text: 'Remove devices', style: 'destructive', onPress: () => resolve(true) },
                  ],
                  { cancelable: true, onDismiss: () => resolve(false) },
                );
              });
              if (!accepted) return;
            }
            await electricalAssetsRepo.update(boardId, {
              ...values,
              meters: options.removeMeters ? [] : board.meters,
            });
            setEditOpen(false);
            navigation.goBack();
          }}
        />
      </FormModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
