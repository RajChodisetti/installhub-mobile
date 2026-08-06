import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FORM_DEFINITIONS } from '../forms/catalog';
import {
  electricalAssetsRepo,
  formsRepo,
  siteAssetsRepo,
} from '../repositories';
import { useAuth, useTheme } from '../context/AppProviders';
import { Badge, Button, Card, LoadingState, SearchBar } from '../components/ui';
import { spacing, typography } from '../theme';
import type { FormType } from '../types';
import type { RootStackParamList } from '../navigation/types';
import { createInitialFormAnswers } from '../forms/catalog';
import { useInstallation } from '../hooks';
import { ElectricalAssetForm, FormModal, SelectChips } from '../components/forms';
import { SOURCE_BOARD_RESULT_LIMIT, searchSourceBoards } from '../domain/sourcePicker';
import {
  isFormTypeAvailableForContext,
  needsWattwatchersSwitchboard,
} from '../domain/formPickerContext';
import {
  commsFaultIdentityAnswersForMeter,
  installationFormAnswersForMeter,
} from '../domain/formMeterPrefill';

type Props = NativeStackScreenProps<RootStackParamList, 'FormTypePicker'>;

export function FormTypePickerScreen({ navigation, route }: Props) {
  const { installationId, boardId, meterId, siteAssetId, zoneId, formType } = route.params;
  const { user } = useAuth();
  const { colors } = useTheme();
  const {
    item: installation,
    boards,
    zones,
    gridSupplies,
    meterDevices,
    loading,
  } = useInstallation(installationId);
  const [busy, setBusy] = useState<FormType | null>(null);
  const [selectedBoardId, setSelectedBoardId] = useState(boardId ?? '');
  const [boardSearch, setBoardSearch] = useState('');
  const [newBoardOpen, setNewBoardOpen] = useState(false);
  const [newBoardZoneId, setNewBoardZoneId] = useState(zoneId ?? '');
  const [switchboardPickerRequested, setSwitchboardPickerRequested] = useState(false);

  useEffect(() => {
    if (!newBoardZoneId && zones.length) setNewBoardZoneId(zoneId ?? zones[0].id);
  }, [newBoardZoneId, zoneId, zones]);

  const boardResults = useMemo(
    () => searchSourceBoards(boards, zones, boardSearch, SOURCE_BOARD_RESULT_LIMIT, selectedBoardId),
    [boardSearch, boards, selectedBoardId, zones],
  );

  if (loading || !installation || !user) return <LoadingState />;

  const allowed = FORM_DEFINITIONS.filter((definition) => {
    if (definition.availableForNew === false) return false;
    if (formType && definition.type !== formType) return false;
    return isFormTypeAvailableForContext(definition.type, { boardId, meterId, siteAssetId });
  });
  const showSwitchboardPicker = !boardId && (
    needsWattwatchersSwitchboard(formType) || switchboardPickerRequested
  );

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.pad}
    >
      <Text style={[typography.title, { color: colors.foreground }]}>New field form</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 6, marginBottom: spacing.lg }}>
        Choose the work record. Site and installer details will be prefilled.
      </Text>
      {showSwitchboardPicker ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={[typography.subheading, { color: colors.foreground }]}>Wattwatchers switchboard</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: 5, marginBottom: spacing.md, lineHeight: 20 }}>
            A WW installation form belongs to one canonical switchboard. Select it now or add it without losing this screen.
          </Text>
          <SearchBar
            value={boardSearch}
            onChangeText={setBoardSearch}
            placeholder="Search name, type, or zone"
          />
          <Text style={{ color: colors.mutedForeground, marginBottom: spacing.sm }}>
            {boardResults.total > SOURCE_BOARD_RESULT_LIMIT
              ? `Showing ${SOURCE_BOARD_RESULT_LIMIT} of ${boardResults.total} matches. Refine the search to choose another board.`
              : `${boardResults.total} matching switchboard${boardResults.total === 1 ? '' : 's'}.`}
            {boardResults.selectedPinned ? ' The selected switchboard remains pinned.' : ''}
          </Text>
          <View accessibilityRole="radiogroup" accessibilityLabel="WW switchboard">
            {boardResults.visible.map((board) => {
              const selected = selectedBoardId === board.id;
              const zone = zones.find((item) => item.id === board.zone_id);
              return (
                <Pressable
                  key={board.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={`${board.asset_name}, ${board.asset_type}, ${zone?.zone_name ?? 'unknown zone'}`}
                  onPress={() => setSelectedBoardId(board.id)}
                  style={[
                    styles.boardChoice,
                    {
                      borderColor: selected ? colors.primary : colors.border,
                      backgroundColor: selected ? colors.muted : colors.card,
                    },
                  ]}
                >
                  <Text style={{ color: colors.foreground, fontWeight: '700' }}>
                    {selected ? '✓ ' : ''}{board.asset_name}
                  </Text>
                  <Text style={{ color: colors.mutedForeground, marginTop: 4 }}>
                    {board.asset_type} · {zone?.zone_name ?? 'Unknown zone'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {!boardResults.visible.length ? (
            <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>
              No matching switchboards.
            </Text>
          ) : null}
          <Button
            title="Add a new switchboard"
            variant="secondary"
            disabled={!zones.length}
            onPress={() => setNewBoardOpen(true)}
          />
          {!zones.length ? (
            <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm }}>
              Add a physical zone before creating its first switchboard.
            </Text>
          ) : null}
        </Card>
      ) : null}
      {allowed.map((definition) => (
        <Card key={definition.type} style={{ marginBottom: spacing.md }}>
          <View style={styles.row}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={[typography.subheading, { color: colors.foreground }]}>
                {definition.shortTitle}
              </Text>
              <Text style={{ color: colors.mutedForeground, marginTop: 5, lineHeight: 20 }}>
                {definition.description}
              </Text>
            </View>
            <Badge label={`${definition.sections.length} sections`} />
          </View>
          <Button
            title={busy === definition.type
              ? 'Creating…'
              : needsWattwatchersSwitchboard(definition.type) && !selectedBoardId
                ? showSwitchboardPicker
                  ? 'Select a switchboard to start'
                  : 'Choose switchboard'
                : 'Start form'}
            disabled={!!busy || (
              needsWattwatchersSwitchboard(definition.type)
              && !selectedBoardId
              && showSwitchboardPicker
            )}
            style={{ marginTop: spacing.md }}
            onPress={async () => {
              if (needsWattwatchersSwitchboard(definition.type) && !selectedBoardId) {
                setSwitchboardPickerRequested(true);
                return;
              }
              setBusy(definition.type);
              try {
                const formBoardId = ['ww-installation', 'ace-switchboard'].includes(definition.type)
                  ? selectedBoardId || boardId
                  : boardId;
                const answers = createInitialFormAnswers(installation, user);
                const canonicalMeter = meterId
                  ? meterDevices.find(
                      (item) => item.id === meterId && item.installedOnBoardId === formBoardId,
                    )
                  : undefined;
                if (formBoardId) {
                  const board = await electricalAssetsRepo.getById(formBoardId);
                  if (board) {
                    answers['auditor.switchboard_name'] = board.asset_name;
                    answers['auditor.switchboard_location'] = board.location_description ?? '';
                    answers['auditor.switchboard_type'] = board.asset_type;
                    answers['auditor.site_nmi'] = board.site_nmi ?? '';
                    answers['existing.switchboard_location'] = board.location_description ?? '';
                    answers['existing.switchboard_type'] = board.asset_type;
                    answers['existing.site_nmi'] = board.site_nmi ?? '';
                    const meter = meterId
                      ? board.meters.find((item) => item.id === meterId)
                      : undefined;
                    if (canonicalMeter) {
                      Object.assign(answers, commsFaultIdentityAnswersForMeter(canonicalMeter));
                    } else if (meter) {
                      answers['existing.device_id'] = meter.device_id;
                      answers['existing.device_number'] = meter.device_number?.trim() || meter.device_id;
                      answers['existing.device_type'] = meter.device_type;
                    }
                  }
                }
                if (definition.type === 'ww-installation' && meterId) {
                  if (canonicalMeter) {
                    Object.assign(answers, installationFormAnswersForMeter(canonicalMeter));
                  }
                }
                if (siteAssetId) {
                  const asset = await siteAssetsRepo.getById(siteAssetId);
                  if (asset) {
                    answers['water.physical_location'] = asset.location_description ?? '';
                    answers['captis.physical_location'] = asset.location_description ?? '';
                    answers['captis.supply_description'] = asset.asset_name;
                  }
                }
                const form = await formsRepo.create({
                  form_type: definition.type,
                  schema_version: definition.schemaVersion,
                  installation_id: installationId,
                  zone_id: formBoardId
                    ? boards.find((item) => item.id === formBoardId)?.zone_id ?? zoneId
                    : zoneId,
                  board_id: formBoardId,
                  meter_id: meterId,
                  site_asset_id: siteAssetId,
                  answers,
                });
                navigation.replace('FormEditor', { formId: form.id });
              } catch (error) {
                Alert.alert(
                  'Form not started',
                  error instanceof Error ? error.message : 'The form could not be created.',
                );
              } finally {
                setBusy(null);
              }
            }}
          />
        </Card>
      ))}
      <FormModal
        visible={newBoardOpen}
        title="Add switchboard for WW form"
        onClose={() => setNewBoardOpen(false)}
      >
        <SelectChips
          label="Physical zone"
          value={newBoardZoneId}
          options={zones.map((item) => item.id)}
          getLabel={(value) => zones.find((item) => item.id === value)?.zone_name ?? value}
          onChange={setNewBoardZoneId}
        />
        <ElectricalAssetForm
          initial={{ audit_id: installationId, zone_id: newBoardZoneId }}
          sourceBoards={boards}
          gridSupplies={gridSupplies}
          zones={zones}
          onSubmit={async (values) => {
            if (!newBoardZoneId) throw new Error('Choose the physical zone.');
            const created = await electricalAssetsRepo.create({
              ...values,
              audit_id: installationId,
              zone_id: newBoardZoneId,
            });
            setSelectedBoardId(created.id);
            setNewBoardOpen(false);
          }}
        />
      </FormModal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  boardChoice: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 58,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
});
