import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  ApiError,
  apiClient,
  type InventoryMeter,
  type InventoryMeterModel,
  type ManagedCloudUser,
} from '../api/apiClient';
import { BarcodeScanField } from '../components/BarcodeScanField';
import { Badge, Button, Card, EmptyState, LoadingState, SearchBar, TextArea, TextField } from '../components/ui';
import { useTheme } from '../context/AppProviders';
import { radii, spacing, typography } from '../theme';

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 409) return error.message;
  return error instanceof Error ? error.message : 'Inventory could not be updated.';
}

function modelLabel(model: InventoryMeterModel): string {
  return model === 'OTHER' ? 'Other' : model;
}

function ModelPicker({ value, onChange }: {
  value: InventoryMeterModel;
  onChange: (value: InventoryMeterModel) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
      {(['A3RM', 'A6M', 'OTHER'] as const).map((item) => (
        <Pressable
          key={item}
          accessibilityRole="button"
          accessibilityState={{ selected: item === value }}
          onPress={() => onChange(item)}
          style={{
            minHeight: 44,
            justifyContent: 'center',
            paddingHorizontal: spacing.md,
            borderRadius: radii.full,
            borderWidth: 1,
            borderColor: item === value ? colors.primary : colors.border,
            backgroundColor: item === value ? colors.muted : colors.card,
          }}
        >
          <Text style={{ color: item === value ? colors.primary : colors.foreground, fontWeight: '700' }}>
            {modelLabel(item)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function InventoryScreen() {
  const { colors } = useTheme();
  const [isMaintainer, setIsMaintainer] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const [scope, setScope] = useState<'mine' | 'company'>('mine');
  const [meters, setMeters] = useState<InventoryMeter[]>([]);
  const [users, setUsers] = useState<ManagedCloudUser[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [deviceModel, setDeviceModel] = useState<InventoryMeterModel>('A3RM');
  const [manufacturer, setManufacturer] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState<InventoryMeter | null>(null);

  const load = useCallback(async (nextScope?: 'mine' | 'company') => {
    const selectedScope = nextScope ?? scope;
    setError(null);
    try {
      const access = await apiClient.getInventoryAccess();
      const effectiveScope = selectedScope === 'company' && !access.isMaintainer ? 'mine' : selectedScope;
      const [inventory, directory] = await Promise.all([
        apiClient.listInventoryMeters(effectiveScope),
        access.isMaintainer ? apiClient.listUsers() : Promise.resolve({ data: [] }),
      ]);
      setCurrentUserId(access.userId);
      setIsMaintainer(access.isMaintainer);
      setScope(effectiveScope);
      setMeters(inventory.data);
      setUsers(directory.data.filter((user) => user.isActive));
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [scope]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    if (!needle) return meters;
    return meters.filter((meter) => [
      meter.deviceId,
      meter.deviceModel,
      meter.customManufacturerName,
      meter.customModelName,
      meter.custodianName,
    ].some((value) => value?.toLocaleLowerCase().includes(needle)));
  }, [meters, search]);

  function clearRegistration() {
    setDeviceId('');
    setDeviceModel('A3RM');
    setManufacturer('');
    setCustomModel('');
    setNotes('');
  }

  async function register() {
    if (!deviceId.trim()) {
      Alert.alert('Device ID required', 'Scan or enter the meter Device ID / serial.');
      return;
    }
    if (deviceModel === 'OTHER' && (!manufacturer.trim() || !customModel.trim())) {
      Alert.alert('Meter details required', 'Other meters require manufacturer and model.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const input = {
        deviceId,
        deviceModel,
        customManufacturerName: manufacturer.trim() || null,
        customModelName: customModel.trim() || null,
        notes: notes.trim() || null,
      };
      if (scope === 'company' && isMaintainer) {
        await apiClient.createInventoryMeter({ ...input, custodianUserId: null });
      } else {
        await apiClient.scanInventoryMeter(input);
      }
      clearRegistration();
      await load(scope);
    } catch (registerError) {
      setError(errorMessage(registerError));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <View style={{ flex: 1, backgroundColor: colors.background }}><LoadingState /></View>;
  }

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => {
          setRefreshing(true);
          void load();
        }} />}
      >
        <Text style={[typography.title, { color: colors.foreground }]}>Meter inventory</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 21 }}>
          Register meters before installation. Installed meters automatically leave user inventory and move to their client and site.
        </Text>

        {isMaintainer ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
            <Button title="My inventory" variant={scope === 'mine' ? 'primary' : 'secondary'} style={{ flex: 1 }} onPress={() => void load('mine')} />
            <Button title="Company inventory" variant={scope === 'company' ? 'primary' : 'secondary'} style={{ flex: 1 }} onPress={() => void load('company')} />
          </View>
        ) : null}

        {error ? (
          <Card style={{ marginTop: spacing.lg, borderColor: colors.destructive }}>
            <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>
          </Card>
        ) : null}

        <Card style={{ marginTop: spacing.lg }}>
          <Text style={[typography.heading, { color: colors.foreground, marginBottom: spacing.md }]}>Register a meter</Text>
          <BarcodeScanField label="Device ID / serial" value={deviceId} onChangeText={setDeviceId} placeholder="Scan or enter Device ID" />
          <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: '600', marginBottom: spacing.sm }}>Meter model</Text>
          <ModelPicker value={deviceModel} onChange={setDeviceModel} />
          {deviceModel === 'OTHER' ? (
            <>
              <TextField label="Manufacturer" value={manufacturer} onChangeText={setManufacturer} />
              <TextField label="Model" value={customModel} onChangeText={setCustomModel} />
            </>
          ) : null}
          <TextArea label="Notes (optional)" value={notes} onChangeText={setNotes} />
          <Button
            title={busy
              ? 'Adding…'
              : scope === 'company' && isMaintainer
                ? 'Add to company inventory'
                : 'Add to my inventory'}
            disabled={busy}
            onPress={() => void register()}
          />
        </Card>

        <View style={{ marginTop: spacing.xl }}>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search Device ID, model, or user" />
          {filtered.length === 0 ? (
            <EmptyState title="No meters found" subtitle={scope === 'mine' ? 'Scan a meter to add it to your inventory.' : 'Register company stock above.'} />
          ) : filtered.map((meter) => (
            <Pressable
              key={meter.id}
              accessibilityRole={isMaintainer && scope === 'company' ? 'button' : undefined}
              onPress={isMaintainer && scope === 'company' ? () => setEditing(meter) : undefined}
            >
              <Card style={{ marginBottom: spacing.md }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[typography.subheading, { color: colors.foreground }]}>{meter.deviceId}</Text>
                    <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs }}>
                      {modelLabel(meter.deviceModel)}
                      {meter.deviceModel === 'OTHER' ? ` · ${meter.customManufacturerName ?? ''} ${meter.customModelName ?? ''}` : ''}
                    </Text>
                    {meter.status === 'user' ? (
                      <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs }}>With {meter.custodianName ?? meter.custodianUserId}</Text>
                    ) : null}
                  </View>
                  <Badge
                    label={meter.status === 'company' ? 'Company' : meter.status === 'installed' ? 'Installed' : 'With user'}
                    tone={meter.status === 'installed' ? 'success' : meter.status === 'company' ? 'default' : 'tbc'}
                  />
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <Modal visible={Boolean(editing)} animationType="slide" onRequestClose={() => setEditing(null)}>
        {editing ? (
          <InventoryEditor
            meter={editing}
            users={users}
            currentUserId={currentUserId}
            onClose={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await load('company');
            }}
          />
        ) : null}
      </Modal>
    </>
  );
}

function InventoryEditor({ meter, users, currentUserId, onClose, onSaved }: {
  meter: InventoryMeter;
  users: ManagedCloudUser[];
  currentUserId: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { colors } = useTheme();
  const [deviceId, setDeviceId] = useState(meter.deviceId);
  const [deviceModel, setDeviceModel] = useState(meter.deviceModel);
  const [manufacturer, setManufacturer] = useState(meter.customManufacturerName ?? '');
  const [customModel, setCustomModel] = useState(meter.customModelName ?? '');
  const [notes, setNotes] = useState(meter.notes ?? '');
  const [custodianUserId, setCustodianUserId] = useState<string | null>(meter.custodianUserId);
  const [busy, setBusy] = useState(false);

  const update = async () => {
    setBusy(true);
    try {
      await apiClient.updateInventoryMeter(meter.id, {
        expectedRevision: meter.revision,
        deviceId,
        deviceModel,
        customManufacturerName: manufacturer.trim() || null,
        customModelName: customModel.trim() || null,
        notes: notes.trim() || null,
        ...(meter.status === 'installed' ? {} : { custodianUserId }),
      });
      await onSaved();
    } catch (error) {
      Alert.alert('Inventory update failed', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, paddingTop: 56, paddingBottom: spacing.xxl }}>
      <Text style={[typography.title, { color: colors.foreground }]}>Edit meter</Text>
      <TextField label="Device ID / serial" value={deviceId} onChangeText={setDeviceId} autoCapitalize="characters" />
      <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: '600', marginBottom: spacing.sm }}>Meter model</Text>
      <ModelPicker value={deviceModel} onChange={setDeviceModel} />
      {deviceModel === 'OTHER' ? (
        <>
          <TextField label="Manufacturer" value={manufacturer} onChangeText={setManufacturer} />
          <TextField label="Model" value={customModel} onChangeText={setCustomModel} />
        </>
      ) : null}
      <TextArea label="Notes" value={notes} onChangeText={setNotes} />

      {meter.status !== 'installed' ? (
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={[typography.subheading, { color: colors.foreground }]}>Custody</Text>
          <Button title="Company stock" variant={custodianUserId === null ? 'primary' : 'secondary'} style={{ marginTop: spacing.md }} onPress={() => setCustodianUserId(null)} />
          {users.map((user) => (
            <Button
              key={user.id}
              title={`${user.fullName?.trim() || user.email}${user.id === currentUserId ? ' (you)' : ''}`}
              variant={custodianUserId === user.id ? 'primary' : 'secondary'}
              style={{ marginTop: spacing.sm }}
              onPress={() => setCustodianUserId(user.id)}
            />
          ))}
        </Card>
      ) : (
        <Card style={{ marginBottom: spacing.lg }}>
          <Text style={{ color: colors.mutedForeground }}>Installed custody is retained as site history and cannot be reassigned here.</Text>
        </Card>
      )}

      <Button title={busy ? 'Saving…' : 'Save changes'} disabled={busy} onPress={() => void update()} />
      {meter.status !== 'installed' ? (
        <Button
          title="Delete meter"
          variant="danger"
          disabled={busy}
          style={{ marginTop: spacing.md }}
          onPress={() => Alert.alert('Delete meter?', `${meter.deviceId} will be removed from active inventory.`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => {
              setBusy(true);
              void apiClient.deleteInventoryMeter(meter.id)
                .then(onSaved)
                .catch((error) => Alert.alert('Delete failed', errorMessage(error)))
                .finally(() => setBusy(false));
            } },
          ])}
        />
      ) : null}
      <Button title="Close" variant="ghost" disabled={busy} style={{ marginTop: spacing.md }} onPress={onClose} />
    </ScrollView>
  );
}
