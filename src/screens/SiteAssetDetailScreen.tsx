import React, { useCallback, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  canonicalInstallationRepo,
  electricalAssetsRepo,
  getLocalDeletionPreview,
  siteAssetsRepo,
} from '../repositories';
import { useInstallation } from '../hooks';
import type { ElectricalSource, SiteAsset } from '../types';
import type { AllAssetMeteringRow } from '../domain/installationV2';
import { FormModal, QuickSwitchboardForm, SiteAssetForm } from '../components/forms';
import { Badge, Button, Card, LoadingState } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { quickSwitchboardCreateValues } from '../domain/sourcePicker';
import { wwCommissioningPickerParams } from '../domain/formPickerContext';

type Props = NativeStackScreenProps<RootStackParamList, 'SiteAssetDetail'>;

export function SiteAssetDetailScreen({ navigation, route }: Props) {
  const { assetId, installationId, zoneId } = route.params;
  const { colors } = useTheme();
  const [asset, setAsset] = useState<SiteAsset | null>(null);
  const [meteringRow, setMeteringRow] = useState<AllAssetMeteringRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [sourceBoardOpen, setSourceBoardOpen] = useState(false);
  const [sourceBoardInheritedSource, setSourceBoardInheritedSource] = useState<ElectricalSource>({ kind: 'TBC' });
  const [newSourceBoardId, setNewSourceBoardId] = useState<string | undefined>();
  const [sourceBoardReturnToken, setSourceBoardReturnToken] = useState(0);
  const [assetFormKey, setAssetFormKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const {
    item: installation,
    boards: installationBoards,
    gridSupplies,
    zones,
    meterDevices,
    measurementAssignments,
    refresh: refreshInstallation,
  } = useInstallation(installationId);
  const readOnly = installation?.status === 'Completed';
  const deviceDetourActive = useRef(false);
  const [deviceDetourReturnToken, setDeviceDetourReturnToken] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [nextAsset, meteringRows] = await Promise.all([
      siteAssetsRepo.getById(assetId),
      canonicalInstallationRepo.allAssetMetering(installationId),
    ]);
    setAsset(nextAsset);
    setMeteringRow(meteringRows.find((row) => row.id === assetId) ?? null);
    setLoading(false);
  }, [assetId, installationId]);

  useFocusEffect(useCallback(() => {
    const returningFromDeviceDetour = deviceDetourActive.current;
    deviceDetourActive.current = false;
    void (async () => {
      if (returningFromDeviceDetour) await refreshInstallation();
      await refresh();
      if (returningFromDeviceDetour) {
        setEditOpen(true);
        setDeviceDetourReturnToken((current) => current + 1);
      }
    })();
  }, [refresh, refreshInstallation]));

  if (loading || !asset) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <LoadingState />
      </View>
    );
  }

  const meteringState = asset.metering_state?.kind ?? 'TBC';
  const displayedMeteringState = meteringRow?.state
    ?? (meteringState === 'METERED' ? 'MAPPING_ISSUE' : meteringState);
  const confirmedUnmetered = displayedMeteringState === 'UNMETERED' || displayedMeteringState === 'VIRTUAL';
  const mappingIssue = displayedMeteringState === 'MAPPING_ISSUE';
  const directAssignments = measurementAssignments.filter((assignment) => (
    assignment.target.kind === 'SITE_ASSET' && assignment.target.siteAssetId === asset.id
  ));

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={styles.pad}>
      <Text style={[typography.title, { color: colors.foreground }]}>{asset.asset_name}</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 6 }}>
        {asset.asset_type}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
        {asset.electrical_source?.kind === 'TBC' ? <Badge label="Supply TBC" tone="tbc" /> : null}
        <Badge
          label={mappingIssue ? 'Metering mapping issue' : confirmedUnmetered ? 'Confirmed unmetered' : displayedMeteringState === 'DIRECT' ? 'Directly metered' : 'Metering TBC'}
          tone={mappingIssue ? 'danger' : displayedMeteringState === 'DIRECT' ? 'success' : displayedMeteringState === 'TBC' ? 'tbc' : 'default'}
        />
      </View>
      <Card style={{ marginTop: spacing.md }} accessibilityRole={mappingIssue || displayedMeteringState === 'TBC' ? 'alert' : 'summary'}>
        <Text style={{ color: colors.foreground, fontWeight: '700' }}>
          {mappingIssue
            ? 'Metering mapping needs attention'
            : confirmedUnmetered
            ? 'No direct device/channel connection'
            : displayedMeteringState === 'TBC'
              ? 'Metering connection is unresolved'
              : 'Direct meter connection'}
        </Text>
        <Text style={{ color: colors.mutedForeground, marginTop: 6, lineHeight: 20 }}>
          {mappingIssue
            ? `The declared metering state and exact device/channel relationship are not readiness-valid. Resolve this before completion.${meteringRow?.meteringIssueCodes.length ? ` Issues: ${meteringRow.meteringIssueCodes.join(', ')}.` : ''}`
            : confirmedUnmetered
              ? 'This is confirmed-unmetered inventory. It remains in the full asset register, and this metering state alone does not block completion.'
            : displayedMeteringState === 'TBC'
              ? 'Confirm whether this asset is metered or unmetered before completing the installation.'
              : directAssignments.map((assignment) => {
                  const meter = meterDevices.find((candidate) => candidate.id === assignment.meterId);
                  const channels = assignment.channelIds.map((channelId) => (
                    `Ch ${meter?.channels.find((channel) => channel.id === channelId)?.ordinal ?? channelId}`
                  ));
                  return `${meter?.displayName.value ?? assignment.meterId} · ${channels.join(', ')}`;
                }).join('\n')}
        </Text>
      </Card>
      {asset.location_description ? (
        <Text style={{ color: colors.mutedForeground, marginTop: 12 }}>{asset.location_description}</Text>
      ) : null}
      {asset.comments ? (
        <Text style={{ color: colors.foreground, marginTop: 12 }}>{asset.comments}</Text>
      ) : null}

      <Button title="Edit asset" disabled={readOnly} style={{ marginTop: spacing.lg }} onPress={() => setEditOpen(true)} />
      <Button
        title="Reconcile meter and channels"
        variant="secondary"
        disabled={readOnly}
        style={{ marginTop: spacing.md }}
        onPress={() => navigation.navigate('DataView', {
          installationId,
          initialMode: displayedMeteringState === 'TBC' ? 'RECONCILIATION' : 'VALIDATION',
        })}
      />
      <Button
        title="Delete asset"
        variant="danger"
        disabled={readOnly}
        style={{ marginTop: spacing.md }}
        onPress={() => { void (async () => {
          const preview = await getLocalDeletionPreview({ kind: 'site_asset', id: assetId });
          const impact = preview
            ? `\n\nDeletes ${preview.deletes.assignments} assignment(s) and ${preview.deletes.forms} linked form(s).`
            : '';
          Alert.alert(
            'Delete asset?',
            `Forms linked to this site asset and their on-device evidence will also be removed.${impact}`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  await siteAssetsRepo.remove(assetId);
                  navigation.goBack();
                },
              },
            ],
          );
        })(); }}
      />

      <FormModal visible={editOpen} title="Edit asset" onClose={() => setEditOpen(false)}>
        <SiteAssetForm
          key={assetFormKey}
          active={editOpen}
          initial={asset}
          sourceBoards={installationBoards}
          gridSupplies={gridSupplies}
          zones={zones}
          meterDevices={meterDevices}
          measurementAssignments={measurementAssignments}
          onAddSourceBoard={(inheritedSource) => {
            setSourceBoardInheritedSource(inheritedSource);
            setEditOpen(false);
            setSourceBoardOpen(true);
          }}
          newSourceBoardId={newSourceBoardId}
          sourceBoardReturnToken={sourceBoardReturnToken}
          deviceDetourReturnToken={deviceDetourReturnToken}
          onDraftRestored={() => {
            if (!readOnly) setEditOpen(true);
          }}
          onDiscardDraft={() => {
            setEditOpen(false);
            setAssetFormKey((current) => current + 1);
          }}
          onAddDevice={(sourceBoardId) => {
            deviceDetourActive.current = true;
            setEditOpen(false);
            const sourceBoard = installationBoards.find((item) => item.id === sourceBoardId);
            navigation.navigate('FormTypePicker', wwCommissioningPickerParams({
              installationId,
              zoneId: sourceBoard?.zone_id ?? zoneId,
              boardId: sourceBoardId,
            }));
          }}
          onSubmit={async (values, metering) => {
            await siteAssetsRepo.saveEditor(assetId, values, metering);
            setEditOpen(false);
            navigation.goBack();
          }}
        />
      </FormModal>

      <FormModal
        visible={sourceBoardOpen}
        title="Add source switchboard"
        onClose={() => {
          setSourceBoardOpen(false);
          setEditOpen(true);
        }}
      >
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
            setSourceBoardOpen(false);
            await refreshInstallation();
            setNewSourceBoardId(created.id);
            setSourceBoardReturnToken((current) => current + 1);
            setEditOpen(true);
          }}
        />
      </FormModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
});
