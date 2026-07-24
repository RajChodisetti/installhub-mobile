import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { FORM_DEFINITIONS } from '../forms/catalog';
import {
  electricalAssetsRepo,
  formsRepo,
  installationsRepo,
  siteAssetsRepo,
} from '../repositories';
import { useAuth, useTheme } from '../context/AppProviders';
import { Badge, Button, Card, LoadingState } from '../components/ui';
import { spacing, typography } from '../theme';
import type { Installation, FormType } from '../types';
import type { RootStackParamList } from '../navigation/types';
import { createInitialFormAnswers } from '../forms/catalog';

type Props = NativeStackScreenProps<RootStackParamList, 'FormTypePicker'>;

export function FormTypePickerScreen({ navigation, route }: Props) {
  const { installationId, boardId, meterId, siteAssetId, zoneId } = route.params;
  const { user } = useAuth();
  const { colors } = useTheme();
  const [installation, setInstallation] = useState<Installation | null>(null);
  const [busy, setBusy] = useState<FormType | null>(null);

  useEffect(() => {
    void installationsRepo.getById(installationId).then(setInstallation);
  }, [installationId]);

  if (!installation || !user) return <LoadingState />;

  const allowed = FORM_DEFINITIONS.filter((definition) => {
    if (definition.availableForNew === false) return false;
    if (meterId) return definition.type === 'comms-fault';
    if (boardId) {
      return ['ww-installation', 'ace-switchboard'].includes(
        definition.type,
      );
    }
    if (siteAssetId) {
      return ['honeywell-q400', 'captis-logger', 'sums-logger'].includes(
        definition.type,
      );
    }
    return true;
  });

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={styles.pad}
    >
      <Text style={[typography.title, { color: colors.foreground }]}>New field form</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: 6, marginBottom: spacing.lg }}>
        Choose the work record. Site and installer details will be prefilled.
      </Text>
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
            title={busy === definition.type ? 'Creating…' : 'Start form'}
            disabled={!!busy}
            style={{ marginTop: spacing.md }}
            onPress={async () => {
              setBusy(definition.type);
              try {
                const answers = createInitialFormAnswers(installation, user);
                if (boardId) {
                  const board = await electricalAssetsRepo.getById(boardId);
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
                    if (meter) {
                      answers['existing.device_id'] = meter.device_id;
                      answers['existing.device_number'] = meter.device_number ?? '';
                      answers['existing.device_type'] = meter.device_type;
                    }
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
                  zone_id: zoneId,
                  board_id: boardId,
                  meter_id: meterId,
                  site_asset_id: siteAssetId,
                  answers,
                });
                navigation.replace('FormEditor', { formId: form.id });
              } finally {
                setBusy(null);
              }
            }}
          />
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pad: { padding: spacing.lg, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
});
