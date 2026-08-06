import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useInstallation, useZoneWorkspace } from '../hooks';
import { electricalAssetsRepo, getLocalDeletionPreview, siteAssetsRepo, zonesRepo } from '../repositories';
import { ElectricalAssetCard, SiteAssetCard } from '../components/domain';
import {
  Button,
  Card,
  EmptyState,
  LoadingState,
  PhotoThumbnailGrid,
  SearchBar,
  SectionHeader,
  TextArea,
  TextField,
} from '../components/ui';
import {
  ElectricalAssetForm,
  FormModal,
  QuickSwitchboardForm,
  SiteAssetForm,
} from '../components/forms';
import { deleteLocalPhoto, pickLocalPhoto, takeLocalPhoto } from '../services';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import {
  pagedPickerResults,
  quickSwitchboardCreateValues,
} from '../domain/sourcePicker';
import type { ElectricalSource } from '../types';
import { wwCommissioningPickerParams } from '../domain/formPickerContext';
import { isValidZoneCode, ZONE_CODE_MAX_LENGTH } from '../domain/namingV2';

type Props = NativeStackScreenProps<RootStackParamList, 'ZoneWorkspace'>;
const ZONE_PAGE_SIZE = 100;

export function ZoneWorkspaceScreen({ navigation, route }: Props) {
  const { zoneId, installationId } = route.params;
  const { colors } = useTheme();
  const { zone, boards, siteAssets, loading, refresh } = useZoneWorkspace(zoneId);
  const {
    item: installation,
    boards: installationBoards,
    gridSupplies,
    zones,
    meterDevices,
    measurementAssignments,
    readiness,
    refresh: refreshInstallation,
  } = useInstallation(installationId);
  const readOnly = installation?.status === 'Completed';
  const zoneMeterIds = new Set(
    meterDevices
      .filter((meter) => boards.some((board) => board.id === meter.installedOnBoardId))
      .map((meter) => meter.id),
  );
  const zoneChannelIds = new Set(
    meterDevices
      .filter((meter) => zoneMeterIds.has(meter.id))
      .flatMap((meter) => meter.channels.map((channel) => channel.id)),
  );
  const zoneAssignmentIds = new Set(
    measurementAssignments
      .filter((assignment) => {
        if (zoneMeterIds.has(assignment.meterId)) return true;
        if (assignment.target.kind === 'BOARD') {
          const targetBoardId = assignment.target.boardId;
          return boards.some((board) => board.id === targetBoardId);
        }
        if (assignment.target.kind === 'SITE_ASSET') {
          const targetAssetId = assignment.target.siteAssetId;
          return siteAssets.some((asset) => asset.id === targetAssetId);
        }
        return false;
      })
      .map((assignment) => assignment.id),
  );
  const zoneEntityIds = new Set([
    zoneId,
    ...boards.map((board) => board.id),
    ...siteAssets.map((asset) => asset.id),
    ...zoneMeterIds,
    ...zoneChannelIds,
    ...zoneAssignmentIds,
  ]);
  const zoneIssueCount = readiness?.issues.filter((issue) => zoneEntityIds.has(issue.entityId)).length ?? 0;
  const unresolvedSupplyCount = boards.filter((item) => item.electrical_source?.kind === 'TBC').length +
    siteAssets.filter((item) => item.electrical_source?.kind === 'TBC').length;
  const meteringCounts = {
    metered: siteAssets.filter((item) => item.metering_state?.kind === 'METERED').length,
    unmetered: siteAssets.filter((item) => item.metering_state?.kind === 'UNMETERED').length,
    tbc: siteAssets.filter((item) => !item.metering_state || item.metering_state.kind === 'TBC').length,
  };
  const [boardModal, setBoardModal] = useState(false);
  const [boardDetourForAsset, setBoardDetourForAsset] = useState(false);
  const [sourceBoardInheritedSource, setSourceBoardInheritedSource] = useState<ElectricalSource>({ kind: 'TBC' });
  const [newSourceBoardId, setNewSourceBoardId] = useState<string | undefined>();
  const [sourceBoardReturnToken, setSourceBoardReturnToken] = useState(0);
  const [assetModal, setAssetModal] = useState(false);
  const [assetFormKey, setAssetFormKey] = useState(0);
  const [editZone, setEditZone] = useState(false);
  const [zoneName, setZoneName] = useState('');
  const [zoneCode, setZoneCode] = useState('');
  const [zoneDesc, setZoneDesc] = useState('');
  const [inventorySearch, setInventorySearch] = useState('');
  const [boardPage, setBoardPage] = useState(0);
  const [assetPage, setAssetPage] = useState(0);
  const deviceDetourActive = useRef(false);
  const [deviceDetourReturnToken, setDeviceDetourReturnToken] = useState(0);
  const inventoryNeedle = inventorySearch.trim().toLocaleLowerCase();
  const matchingBoards = useMemo(() => boards.filter((board) =>
    !inventoryNeedle || `${board.display_code} ${board.asset_name} ${board.asset_type}`
      .toLocaleLowerCase().includes(inventoryNeedle)), [boards, inventoryNeedle]);
  const matchingAssets = useMemo(() => siteAssets.filter((asset) =>
    !inventoryNeedle || `${asset.display_code ?? ''} ${asset.asset_name} ${asset.asset_type}`
      .toLocaleLowerCase().includes(inventoryNeedle)), [inventoryNeedle, siteAssets]);
  const boardResults = pagedPickerResults(matchingBoards, boardPage, ZONE_PAGE_SIZE);
  const assetResults = pagedPickerResults(matchingAssets, assetPage, ZONE_PAGE_SIZE);
  const visibleZoneBoards = boardResults.visible;
  const visibleZoneAssets = assetResults.visible;

  useFocusEffect(useCallback(() => {
    if (!deviceDetourActive.current) return;
    deviceDetourActive.current = false;
    void refreshInstallation().then(() => {
      setAssetModal(true);
      setDeviceDetourReturnToken((current) => current + 1);
    });
  }, [refreshInstallation]));

  const addPhoto = async (source: 'library' | 'camera') => {
    const uri = source === 'camera' ? await takeLocalPhoto() : await pickLocalPhoto();
    if (!uri || !zone) return;
    try {
      await zonesRepo.update(zoneId, { photos: [...zone.photos, uri] });
      await refresh();
    } catch (error) {
      deleteLocalPhoto(uri);
      Alert.alert(
        'Photo not added',
        error instanceof Error ? error.message : 'The photo could not be saved.',
      );
    }
  };

  if (loading || !zone) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.title, { color: colors.foreground }]}>{zone.zone_name}</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
        Zone code: {zone.zone_code ?? 'Not set'}
      </Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 6 }}>
        {zone.zone_description || 'No description'}
      </Text>

      <Card style={{ marginTop: spacing.lg }}>
        <Text accessibilityRole="summary" style={[typography.subheading, { color: colors.foreground }]}>Zone mapping summary</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 21 }}>
          {boards.length} switchboard{boards.length === 1 ? '' : 's'} · {siteAssets.length} site asset{siteAssets.length === 1 ? '' : 's'}{'\n'}
          Declared metered {meteringCounts.metered} · Declared unmetered {meteringCounts.unmetered} · TBC {meteringCounts.tbc}{'\n'}
          Unresolved supply links {unresolvedSupplyCount} · Readiness issues {zoneIssueCount}
        </Text>
      </Card>

      <View style={{ flexDirection: 'row', gap: 8, marginTop: spacing.lg, flexWrap: 'wrap' }}>
        <Button
          title="Edit zone"
          variant="secondary"
          disabled={readOnly}
          onPress={() => {
            setZoneName(zone.zone_name);
            setZoneCode(zone.zone_code ?? '');
            setZoneDesc(zone.zone_description);
            setEditZone(true);
          }}
        />
      </View>

      <SectionHeader
        title={`Photos (${zone.photos.length})`}
        actionLabel="+ Library"
        onAction={readOnly ? undefined : () => void addPhoto('library')}
      />
      <Text style={{ color: colors.mutedForeground, fontSize: 12, marginBottom: 8 }}>
        Use the named Remove control below a photo to delete it.
      </Text>
      {zone.photos.length === 0 ? (
        <EmptyState title="No photos yet" subtitle="Attach switchboard or site context photos." />
      ) : (
        <PhotoThumbnailGrid
          uris={zone.photos}
          onAdd={readOnly ? undefined : () => void addPhoto('library')}
          onRemove={readOnly ? undefined : (uri) => {
            Alert.alert('Remove photo?', undefined, [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Remove',
                style: 'destructive',
                onPress: async () => {
                  await zonesRepo.update(zoneId, {
                    photos: zone.photos.filter((p) => p !== uri),
                  });
                  deleteLocalPhoto(uri);
                  await refresh();
                },
              },
            ]);
          }}
        />
      )}
      <Button
        title="Take photo"
        variant="ghost"
        disabled={readOnly}
        style={{ marginTop: spacing.sm, marginBottom: spacing.md }}
        onPress={() => void addPhoto('camera')}
      />

      <SearchBar
        value={inventorySearch}
        onChangeText={(value) => {
          setInventorySearch(value);
          setBoardPage(0);
          setAssetPage(0);
        }}
        placeholder="Search this zone's boards and assets"
      />

      <SectionHeader
        title="Electrical boards"
        actionLabel={readOnly ? undefined : '+ Add'}
        onAction={readOnly ? undefined : () => {
          setBoardDetourForAsset(false);
          setBoardModal(true);
        }}
      />
      <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm }}>
        {boardResults.total === 0
          ? 'Showing 0 matching boards.'
          : `Showing boards ${boardResults.start}–${boardResults.end} of ${boardResults.total} · Page ${boardResults.page + 1} of ${boardResults.totalPages}.`}
      </Text>
      {matchingBoards.length === 0 ? (
        <EmptyState title="No boards" subtitle="Add MSB/DB boards for this zone." />
      ) : (
        visibleZoneBoards.map((b) => (
          <ElectricalAssetCard
            key={b.id}
            item={b}
            onPress={() =>
              navigation.navigate('BoardDetail', { boardId: b.id, installationId, zoneId })
            }
          />
        ))
      )}
      {boardResults.totalPages > 1 ? (
        <View style={styles.pageControls}>
          <Button
            title="Previous boards"
            variant="secondary"
            disabled={!boardResults.hasPrevious}
            accessibilityHint="Shows the previous page of up to 100 boards."
            style={styles.pageButton}
            onPress={() => setBoardPage(boardResults.page - 1)}
          />
          <Button
            title="Next boards"
            variant="secondary"
            disabled={!boardResults.hasNext}
            accessibilityHint="Replaces this page with the next page of up to 100 boards."
            style={styles.pageButton}
            onPress={() => setBoardPage(boardResults.page + 1)}
          />
        </View>
      ) : null}

      <SectionHeader title="Site assets" actionLabel={readOnly ? undefined : '+ Add'} onAction={readOnly ? undefined : () => setAssetModal(true)} />
      <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm }}>
        {assetResults.total === 0
          ? 'Showing 0 matching assets.'
          : `Showing assets ${assetResults.start}–${assetResults.end} of ${assetResults.total} · Page ${assetResults.page + 1} of ${assetResults.totalPages}.`}
      </Text>
      {matchingAssets.length === 0 ? (
        <EmptyState title="No site assets" subtitle="Add HVAC, lighting, EV, etc." />
      ) : (
        visibleZoneAssets.map((a) => (
          <SiteAssetCard
            key={a.id}
            item={a}
            onPress={() =>
              navigation.navigate('SiteAssetDetail', { assetId: a.id, installationId, zoneId })
            }
          />
        ))
      )}
      {assetResults.totalPages > 1 ? (
        <View style={styles.pageControls}>
          <Button
            title="Previous assets"
            variant="secondary"
            disabled={!assetResults.hasPrevious}
            accessibilityHint="Shows the previous page of up to 100 assets."
            style={styles.pageButton}
            onPress={() => setAssetPage(assetResults.page - 1)}
          />
          <Button
            title="Next assets"
            variant="secondary"
            disabled={!assetResults.hasNext}
            accessibilityHint="Replaces this page with the next page of up to 100 assets."
            style={styles.pageButton}
            onPress={() => setAssetPage(assetResults.page + 1)}
          />
        </View>
      ) : null}

      <FormModal
        visible={boardModal}
        title={boardDetourForAsset ? 'Add source switchboard' : 'Add board'}
        onClose={() => {
          setBoardModal(false);
          if (boardDetourForAsset) {
            setBoardDetourForAsset(false);
            setAssetModal(true);
          }
        }}
      >
        {boardDetourForAsset ? (
          <QuickSwitchboardForm
            inheritedSource={sourceBoardInheritedSource}
            sourceBoards={installationBoards}
            gridSupplies={gridSupplies}
            onSubmit={async (details) => {
              const created = await electricalAssetsRepo.create(quickSwitchboardCreateValues({
                installationId,
                zoneId,
                inheritedSource: sourceBoardInheritedSource,
                details,
              }));
              setBoardModal(false);
              setBoardDetourForAsset(false);
              await Promise.all([refresh(), refreshInstallation()]);
              setNewSourceBoardId(created.id);
              setSourceBoardReturnToken((current) => current + 1);
              setAssetModal(true);
            }}
          />
        ) : (
          <ElectricalAssetForm
            initial={{ audit_id: installationId, zone_id: zoneId }}
            sourceBoards={installationBoards}
            gridSupplies={gridSupplies}
            zones={zones}
            onSubmit={async (values) => {
              await electricalAssetsRepo.create({
                ...values,
                audit_id: installationId,
                zone_id: zoneId,
              });
              setBoardModal(false);
              await Promise.all([refresh(), refreshInstallation()]);
            }}
          />
        )}
      </FormModal>

      <FormModal visible={assetModal} title="Add site asset" onClose={() => setAssetModal(false)}>
        <SiteAssetForm
          key={assetFormKey}
          active={assetModal}
          initial={{ audit_id: installationId, zone_id: zoneId }}
          sourceBoards={installationBoards}
          gridSupplies={gridSupplies}
          zones={zones}
          meterDevices={meterDevices}
          measurementAssignments={measurementAssignments}
          onAddSourceBoard={(inheritedSource) => {
            setSourceBoardInheritedSource(inheritedSource);
            setBoardDetourForAsset(true);
            setAssetModal(false);
            setBoardModal(true);
          }}
          newSourceBoardId={newSourceBoardId}
          sourceBoardReturnToken={sourceBoardReturnToken}
          deviceDetourReturnToken={deviceDetourReturnToken}
          onDraftRestored={() => {
            if (!readOnly) setAssetModal(true);
          }}
          onDiscardDraft={() => {
            setAssetModal(false);
            setAssetFormKey((current) => current + 1);
          }}
          onAddDevice={(sourceBoardId) => {
            deviceDetourActive.current = true;
            setAssetModal(false);
            const sourceBoard = installationBoards.find((item) => item.id === sourceBoardId);
            navigation.navigate('FormTypePicker', wwCommissioningPickerParams({
              installationId,
              zoneId: sourceBoard?.zone_id ?? zoneId,
              boardId: sourceBoardId,
            }));
          }}
          onSubmit={async (values, metering) => {
            await siteAssetsRepo.saveEditor(null, {
              ...values,
              audit_id: installationId,
              zone_id: zoneId,
            }, metering);
            setAssetModal(false);
            setAssetFormKey((current) => current + 1);
            await Promise.all([refresh(), refreshInstallation()]);
          }}
        />
      </FormModal>

      <FormModal visible={editZone} title="Edit zone" onClose={() => setEditZone(false)}>
        <TextField label="Zone name" value={zoneName} onChangeText={setZoneName} />
        <TextField
          label="Zone short code"
          value={zoneCode}
          autoCapitalize="characters"
          maxLength={ZONE_CODE_MAX_LENGTH}
          onChangeText={(value) => setZoneCode(
            value.toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/-{2,}/g, '-'),
          )}
          error={zoneCode && !isValidZoneCode(zoneCode) ? 'Use uppercase letters/numbers with single internal hyphens.' : undefined}
        />
        <TextArea label="Description" value={zoneDesc} onChangeText={setZoneDesc} />
        <Button
          title="Save"
          disabled={!zoneName.trim() || !isValidZoneCode(zoneCode)}
          onPress={async () => {
            await zonesRepo.update(zoneId, {
              zone_name: zoneName.trim(),
              zone_code: zoneCode,
              zone_description: zoneDesc.trim(),
            });
            setEditZone(false);
            navigation.goBack();
          }}
        />
        <View style={{ height: 12 }} />
        <Button
          title="Delete zone"
          variant="danger"
          disabled={readOnly}
          onPress={() => { void (async () => {
            const preview = await getLocalDeletionPreview({ kind: 'zone', id: zoneId });
            const impact = preview
              ? `\n\nDeletes ${preview.deletes.boards} board(s), ${preview.deletes.siteAssets} asset(s), ${preview.deletes.meters} meter(s), ${preview.deletes.assignments} assignment(s), and ${preview.deletes.forms} form(s).`
              : '';
            Alert.alert(
              'Delete zone?',
              `Boards, site assets, linked forms, and form evidence in this zone will be removed from this device. References from other zones will be marked TBC.${impact}`,
              [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  await zonesRepo.remove(zoneId);
                  navigation.goBack();
                },
              },
              ],
            );
          })(); }}
        />
      </FormModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
  pageControls: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  pageButton: { flex: 1 },
});
