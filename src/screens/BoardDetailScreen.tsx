import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { electricalAssetsRepo, formsRepo, getLocalDeletionPreview } from '../repositories';
import { useInstallation } from '../hooks';
import { ElectricalAssetForm, FormModal } from '../components/forms';
import { Badge, Button, Card, LoadingState, PhotoThumbnailGrid, SectionHeader } from '../components/ui';
import { RecordLoadState } from '../components/RecordLoadState';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { photoNote } from '../domain/photoNotes';

type Props = NativeStackScreenProps<RootStackParamList, 'BoardDetail'>;

export function BoardDetailScreen({ navigation, route }: Props) {
  const { boardId, installationId } = route.params;
  const { colors } = useTheme();
  const [editOpen, setEditOpen] = useState(false);
  const {
    item: installation,
    boards: installationBoards,
    gridSupplies,
    zones,
    siteAssets,
    measurementAssignments,
    loading,
    error,
    refresh,
  } = useInstallation(installationId);
  const readOnly = installation?.status === 'Completed';

  const board = installationBoards.find((candidate) => candidate.id === boardId);
  const retry = () => { void refresh().catch(() => undefined); };
  useFocusEffect(useCallback(() => { void refresh().catch(() => undefined); }, [refresh]));

  if (loading && !installation) return <LoadingState />;
  if (!installation || !board) return (
    <RecordLoadState title="Switchboard unavailable"
      message={error ?? 'This switchboard is no longer available in this installation.'}
      onRetry={retry} onBack={() => navigation.goBack()} />
  );
  const electricalSource = board.electrical_source;
  const parent = electricalSource?.kind === 'BOARD'
    ? installationBoards.find((candidate) => candidate.id === electricalSource.boardId) : undefined;
  const downstreamBoards = installationBoards.filter((candidate) => candidate.electrical_source?.kind === 'BOARD' && candidate.electrical_source.boardId === board.id);
  const suppliedAssets = siteAssets.filter((asset) => asset.electrical_source?.kind === 'BOARD' && asset.electrical_source.boardId === board.id);
  const evidence = [board.photo, ...(board.extra_photos ?? [])].filter((uri): uri is string => Boolean(uri));
  const evidenceLabels = [
    ...(board.photo ? [photoNote(board.photo_notes, 'photo') || undefined] : []),
    ...(board.extra_photos ?? []).map((_, index) => (
      photoNote(board.photo_notes, `extraPhotos[${index}]`) || undefined
    )),
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      {error ? <RecordLoadState inline title="Could not refresh switchboard" message={error}
        onRetry={retry} onBack={() => navigation.goBack()} /> : null}
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
        <Button title="Edit switchboard" variant="secondary" disabled={readOnly} onPress={() => setEditOpen(true)} />
        <Button
          title="Add meter"
          disabled={readOnly}
          onPress={() => navigation.navigate('MeterForm', {
            installationId,
            boardId,
          })}
        />
      </View>

      <Card style={{ marginTop: spacing.lg }}>
        <SectionHeader title="Switchboard details" />
        <Text style={{ color: colors.mutedForeground }}>Generated asset ID: {board.display_code_meta?.value || board.display_code || 'Not recorded'}</Text>
        <Text style={{ color: colors.foreground, marginTop: 8 }}>Location description: {board.location_description || 'Not recorded'}</Text>
        <Text style={{ color: colors.foreground, marginTop: 8 }}>Amperage rating: {board.amperage_rating || 'Not recorded'}</Text>
        <Text style={{ color: colors.foreground, marginTop: 8 }}>Sub-circuits description: {board.sub_circuits_description || 'Not recorded'}</Text>
        <Text style={{ color: colors.foreground, marginTop: 8 }}>Comments: {board.comments || 'Not recorded'}</Text>
        {parent ? <Button title={`Electrical parent: ${parent.asset_name}`} variant="ghost" onPress={() => navigation.push('BoardDetail', { installationId, zoneId: parent.zone_id, boardId: parent.id })} />
          : <Text style={{ color: colors.foreground, marginTop: 8 }}>Supply: {electricalSource?.kind === 'GRID' ? gridSupplies.find((grid) => grid.id === electricalSource.gridSupplyId)?.name || 'Unavailable grid connection' : 'To be confirmed'}</Text>}
      </Card>
      <Card style={{ marginTop: spacing.md }}>
        <SectionHeader title="Electrical children" />
        {downstreamBoards.map((child) => <Button key={child.id} title={`${child.asset_name} · ${zones.find((zone) => zone.id === child.zone_id)?.zone_name || 'Unknown zone'}`} variant="ghost" onPress={() => navigation.push('BoardDetail', { installationId, zoneId: child.zone_id, boardId: child.id })} />)}
        {suppliedAssets.map((asset) => <Button key={asset.id} title={`${asset.asset_name} · ${zones.find((zone) => zone.id === asset.zone_id)?.zone_name || 'Unknown zone'}`} variant="ghost" onPress={() => navigation.navigate('SiteAssetDetail', { installationId, zoneId: asset.zone_id, assetId: asset.id })} />)}
        {!downstreamBoards.length && !suppliedAssets.length ? <Text style={{ color: colors.mutedForeground }}>No downstream switchboards or supplied assets.</Text> : null}
      </Card>
      <SectionHeader title={`Switchboard evidence (${evidence.length})`} />
      {evidence.length ? <PhotoThumbnailGrid uris={evidence} labels={evidenceLabels} /> : <Text style={{ color: colors.mutedForeground }}>No switchboard evidence recorded.</Text>}

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
            <Button title="Device version history" variant="ghost" onPress={() => navigation.navigate('MeterHistory', { installationId, meterId: m.id })} />
            <Button
              title="Edit meter and channels"
              variant="ghost"
              disabled={readOnly}
              style={{ marginTop: 10 }}
              onPress={() =>
                navigation.navigate('MeterForm', {
                  installationId,
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
        title="Delete switchboard"
        variant="danger"
        disabled={readOnly}
        style={{ marginTop: spacing.xl }}
        onPress={() => { void (async () => {
          const preview = await getLocalDeletionPreview({ kind: 'electrical_asset', id: boardId });
          const impact = preview
            ? `\n\nDeletes ${preview.deletes.meters} meter(s) and ${preview.deletes.assignments} assignment(s). Converts ${preview.convertsToTbc.boards} board(s) and ${preview.convertsToTbc.siteAssets} asset(s) to TBC.`
            : '';
          Alert.alert(
            'Delete switchboard?',
            `Completed forms and their evidence are retained. Draft forms remain available with their board and meter links cleared. Other affected supply links will be marked TBC.${impact}`,
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

      <FormModal visible={editOpen} title="Edit switchboard" onClose={() => setEditOpen(false)}>
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
