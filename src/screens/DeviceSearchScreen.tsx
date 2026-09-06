import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useIsFocused } from '@react-navigation/native';
import { useDeviceSearchRecords } from '../hooks';
import { useAuth, useTheme } from '../context/AppProviders';
import {
  deviceRecordBelongsToInstallation,
  deviceSearchIdentity,
  INSTALLATION_DEVICE_RESULT_LIMIT,
  searchInstallationDevices,
  supportsCommsReplacement,
  type DeviceSearchRecord,
} from '../domain/meterSearch';
import { FORM_DEFINITION_BY_TYPE, createInitialFormAnswers } from '../forms/catalog';
import { canonicalInstallationRepo, formsRepo } from '../repositories';
import { Button, Card, EmptyState, LoadingState, SearchBar } from '../components/ui';
import { spacing, typography } from '../theme';
import type { RootStackParamList } from '../navigation/types';
import { commsFaultIdentityAnswersForMeter } from '../domain/formMeterPrefill';
import { canonicalNmiForBoard } from '../domain/gridSupplyContext';
import { RecordLoadState } from '../components/RecordLoadState';
import { captureAssignedWorkMutationGuard } from '../services/assignedWorkMutationGuard';

type Props = NativeStackScreenProps<RootStackParamList, 'DeviceSearch'>;

export function DeviceSearchScreen({ navigation, route }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const { user } = useAuth();
  const { items, installation, loading, loaded, error, refresh } = useDeviceSearchRecords(installationId);
  const focused = useIsFocused();
  const [query, setQuery] = useState('');
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const actionVersion = useRef(0);
  useEffect(() => {
    setReplacingId(null);
    return () => { actionVersion.current += 1; };
  }, [installationId, user, focused]);
  const results = useMemo(
    () => searchInstallationDevices(items, installationId, query),
    [installationId, items, query],
  );

  const replaceDevice = async (record: DeviceSearchRecord) => {
    if (!user || !focused || error || replacingId) return;
    if (!deviceRecordBelongsToInstallation(record, installationId)) {
      Alert.alert('Device unavailable', 'This device does not belong to the current installation.');
      return;
    }
    if (!supportsCommsReplacement(record.meter)) {
      Alert.alert('Replacement unavailable', 'The comms-fault replacement form supports A3RM and A6M devices only.');
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
    const version = ++actionVersion.current;
    const assertAccess = captureAssignedWorkMutationGuard();
    try {
      assertAccess(record.installation);
      const gridSupplies = await canonicalInstallationRepo.gridSupplies(record.installation.id);
      if (actionVersion.current !== version) return;
      assertAccess(record.installation);
      const answers = createInitialFormAnswers(record.installation, user);
      answers['existing.switchboard_location'] = record.board.location_description ?? '';
      answers['existing.switchboard_type'] = record.board.asset_type;
      answers['existing.site_nmi'] = canonicalNmiForBoard(record.board, gridSupplies);
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
      if (actionVersion.current !== version) return;
      assertAccess(record.installation);
      navigation.navigate('FormEditor', {
        formId: form.id,
        installationId: record.installation.id,
      });
    } catch (error) {
      if (actionVersion.current !== version) return;
      Alert.alert(
        'Replacement form not started',
        error instanceof Error ? error.message : 'The replacement form could not be created.',
      );
    } finally {
      if (actionVersion.current === version) setReplacingId(null);
    }
  };

  const retry = () => { void refresh().catch(() => undefined); };
  if (loading && !loaded) {
    return <LoadingState />;
  }
  if (!installation) return <RecordLoadState title="Installation devices unavailable"
    message={error ?? 'The installation is no longer available.'} onRetry={retry} onBack={() => navigation.goBack()} />;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[typography.title, { color: colors.foreground }]}>Find a device</Text>
      {error ? <Card style={{ marginVertical: spacing.md }}>
        <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>
        <Button title="Retry device search" variant="secondary" onPress={retry} />
      </Card> : null}
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
        renderItem={({ item: record }) => {
          const identity = deviceSearchIdentity(record.meter);
          return (
          <Card style={{ marginBottom: spacing.md }}>
            <Text style={[typography.subheading, { color: colors.foreground }]}>
              {identity.name}
            </Text>
            <Text style={{ color: colors.foreground, marginTop: spacing.xs }}>Device name: {identity.customName || 'Not recorded'}</Text>
            {identity.assetId ? <Text style={{ color: colors.foreground, marginTop: spacing.xs }}>Asset ID: {identity.assetId}</Text> : null}
            <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs, lineHeight: 20 }}>
              {record.meter.deviceModel} · ID {record.meter.serialNumber || 'not recorded'}{record.meter.deviceNumber && record.meter.deviceNumber !== record.meter.serialNumber ? ` · site tag ${record.meter.deviceNumber}` : ''}{'\n'}
              {record.installation.site_name} · {record.zone.zone_name}{'\n'}
              {record.board.asset_name} · {record.board.asset_type}
            </Text>
            <View style={styles.actions}>
              <Button
                title="Open device"
                disabled={Boolean(error)}
                variant="secondary"
                style={styles.action}
                onPress={() => navigation.navigate('MeterForm', {
                  installationId: record.installation.id,
                  boardId: record.board.id,
                  meterId: record.meter.id,
                  deviceType: record.meter.deviceModel === 'OTHER' ? 'Other' : record.meter.deviceModel,
                })}
              />
              {supportsCommsReplacement(record.meter) ? <Button
                title={replacingId === record.meter.id ? 'Opening…' : 'Replace device'}
                disabled={Boolean(error) || Boolean(replacingId) || record.installation.status === 'Completed'}
                style={styles.action}
                onPress={() => { void replaceDevice(record); }}
              /> : null}
            </View>
            {!supportsCommsReplacement(record.meter) ? <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm }}>
              The comms-fault replacement form is available for A3RM and A6M devices.
            </Text> : null}
          </Card>
        ); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: spacing.lg },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  action: { flex: 1 },
});
