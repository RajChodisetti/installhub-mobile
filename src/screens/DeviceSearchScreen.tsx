import React, { useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useDeviceSearchRecords } from '../hooks';
import { useAuth, useTheme } from '../context/AppProviders';
import {
  deviceRecordBelongsToInstallation,
  INSTALLATION_DEVICE_RESULT_LIMIT,
  searchInstallationDevices,
  type DeviceSearchRecord,
} from '../domain/meterSearch';
import { FORM_DEFINITION_BY_TYPE, createInitialFormAnswers } from '../forms/catalog';
import { formsRepo } from '../repositories';
import { Button, Card, EmptyState, LoadingState, SearchBar } from '../components/ui';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { commsFaultIdentityAnswersForMeter } from '../domain/formMeterPrefill';

type Props = NativeStackScreenProps<RootStackParamList, 'DeviceSearch'>;

export function DeviceSearchScreen({ navigation, route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { user } = useAuth();
  const { items, loading } = useDeviceSearchRecords(installationId);
  const [query, setQuery] = useState('');
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const results = useMemo(
    () => searchInstallationDevices(items, installationId, query),
    [installationId, items, query],
  );

  const replaceDevice = async (record: DeviceSearchRecord) => {
    if (!user) return;
    if (!deviceRecordBelongsToInstallation(record, installationId)) {
      Alert.alert('Device unavailable', 'This device does not belong to the current installation.');
      return;
    }
    if (record.installation.status === 'Completed') {
      Alert.alert(
        'Reopen installation first',
        'The completed version is read-only. Reopen this installation before replacing its device.',
      );
      return;
    }
    setReplacingId(record.meter.id);
    try {
      const answers = createInitialFormAnswers(record.installation, user);
      answers['existing.switchboard_location'] = record.board.location_description ?? '';
      answers['existing.switchboard_type'] = record.board.asset_type;
      answers['existing.site_nmi'] = record.board.site_nmi ?? '';
      Object.assign(answers, commsFaultIdentityAnswersForMeter(record.meter));
      const sensorRating = record.meter.channels.find((channel) =>
        channel.purpose !== 'SPARE' && Boolean(channel.sensorRating?.trim()))?.sensorRating;
      if (sensorRating) answers['existing.sensor_rating'] = sensorRating;
      answers['works.replace_device'] = 'yes';
      const definition = FORM_DEFINITION_BY_TYPE['comms-fault'];
      const form = await formsRepo.create({
        form_type: definition.type,
        schema_version: definition.schemaVersion,
        installation_id: record.installation.id,
        zone_id: record.zone.id,
        board_id: record.board.id,
        meter_id: record.meter.id,
        answers,
      });
      navigation.navigate('FormEditor', {
        formId: form.id,
        installationId: record.installation.id,
      });
    } catch (error) {
      Alert.alert(
        'Replacement form not started',
        error instanceof Error ? error.message : 'The replacement form could not be created.',
      );
    } finally {
      setReplacingId(null);
    }
  };

  if (loading && !items.length) {
    return <LoadingState />;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[typography.title, { color: colors.foreground }]}>Find a device</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs, marginBottom: spacing.md, lineHeight: 20 }}>
        Search every zone in this installation by Device ID, optional site / asset tag, name, board, zone, or type.
      </Text>
      <SearchBar
        value={query}
        onChangeText={setQuery}
        placeholder="Device ID, site / asset tag, name, zone, board, or type"
      />
      <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>
        {results.total > INSTALLATION_DEVICE_RESULT_LIMIT
          ? `Showing ${INSTALLATION_DEVICE_RESULT_LIMIT} of ${results.total} matches. Refine the search.`
          : `${results.total} matching device${results.total === 1 ? '' : 's'}.`}
      </Text>
      <FlatList
        data={results.visible}
        keyExtractor={(record) => record.meter.id}
        ListEmptyComponent={(
          <EmptyState
            title="No matching devices"
            subtitle={query.trim() ? 'Try a device ID, site, zone, board, or device type.' : 'Commission a device to make it searchable here.'}
          />
        )}
        renderItem={({ item: record }) => (
          <Card style={{ marginBottom: spacing.md }}>
            <Text style={[typography.subheading, { color: colors.foreground }]}>
              {record.meter.displayName.value}
            </Text>
            <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs, lineHeight: 20 }}>
              {record.meter.deviceModel} · ID {record.meter.serialNumber || 'not recorded'}{record.meter.deviceNumber && record.meter.deviceNumber !== record.meter.serialNumber ? ` · site tag ${record.meter.deviceNumber}` : ''}{'\n'}
              {record.installation.site_name} · {record.zone.zone_name}{'\n'}
              {record.board.asset_name} · {record.board.asset_type}
            </Text>
            <View style={styles.actions}>
              <Button
                title="Open device"
                variant="secondary"
                style={styles.action}
                onPress={() => navigation.navigate('MeterForm', {
                  installationId: record.installation.id,
                  boardId: record.board.id,
                  meterId: record.meter.id,
                  deviceType: record.meter.deviceModel === 'OTHER' ? 'Other' : record.meter.deviceModel,
                })}
              />
              <Button
                title={replacingId === record.meter.id ? 'Opening…' : 'Replace device'}
                disabled={Boolean(replacingId) || record.installation.status === 'Completed'}
                style={styles.action}
                onPress={() => { void replaceDevice(record); }}
              />
            </View>
          </Card>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
});
