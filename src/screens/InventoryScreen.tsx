import { FormScrollView } from '../components/ui';
import { useInventoryData, type InventoryAction } from '../hooks/useInventoryData';
import React, { useEffect, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, Text, View } from 'react-native';
import {
  apiClient,
  type InventoryMeter,
  type InventoryMeterModel,
  type ManagedCloudUser,
} from '../api/apiClient';
import { BarcodeScanField } from '../components/BarcodeScanField';
import { Badge, Button, Card, EmptyState, LoadingState, SearchBar, TextArea, TextField } from '../components/ui';
import { useAuth, useTheme } from '../context/AppProviders';
import { radii, spacing, typography } from '../theme';

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
  const { user } = useAuth();
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [scope, setScope] = useState<'mine' | 'company'>('mine');
  const [search, setSearch] = useState('');
  const inventory = useInventoryData(scope, debouncedSearch);
  const { data, loading, busy, error, run, viewToken, load } = inventory;
  const { access, inventory: matches, summary, users = [] } = data ?? {};
  const isMaintainer = access?.isMaintainer ?? false;
  const currentUserId = access?.userId ?? '';
  const meters = matches?.data ?? [];
  const matchingTotal = matches?.total ?? 0;
  const truncated = matches?.truncated ?? false;
  const inventoryTotal = summary?.total ?? 0;
  const summaryMeters = summary?.data ?? [];
  const summaryTruncated = summary?.truncated ?? false;
  const searching = loading || search.trim() !== debouncedSearch;
  const [actionView, setActionView] = useState<unknown>();
  const [modalAction, setModalAction] = useState<{ run: InventoryAction }>();
  const [deviceId, setDeviceId] = useState('');
  const [deviceModel, setDeviceModel] = useState<InventoryMeterModel>('A3RM');
  const [manufacturer, setManufacturer] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [notes, setNotes] = useState('');
  const [editing, setEditing] = useState<InventoryMeter | null>(null);
  const [addMode, setAddMode] = useState<'scan' | 'manual' | null>(null);
  const [claimDeviceId, setClaimDeviceId] = useState('');
  const [scanKey, setScanKey] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (data && data.scope !== scope) setScope(data.scope);
  }, [data, scope]);
  useEffect(() => {
    setEditing(null); setAddMode(null); setClaimDeviceId('');
    setSearch(''); setDebouncedSearch(''); setScope('mine'); clearRegistration();
  }, [user?.id]);

  const filtered = meters;

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
    await run(async (lease, view) => {
      const input = { deviceId, deviceModel, customManufacturerName: manufacturer.trim() || null,
        customModelName: customModel.trim() || null, notes: notes.trim() || null };
      lease.assertCurrent();
      if (view.scope === 'company' && view.access.isMaintainer) {
        await apiClient.createInventoryMeter({ ...input, custodianUserId: null }, lease.cloudAuthority);
      } else {
        await apiClient.scanInventoryMeter(input, lease.cloudAuthority);
      }
      lease.assertCurrent();
    }, clearRegistration);
  }

  function chooseAddMethod() {
    if (!data || busy) return;
    const initiatingView = viewToken;
    const initiatingRun = run;
    Alert.alert('Add meter', 'Choose how to enter the company-stock meter Device ID.', [
      {
        text: 'Scan barcode',
        onPress: () => {
          setActionView(initiatingView); setModalAction({ run: initiatingRun });
          setClaimDeviceId('');
          setAddMode('scan');
          setScanKey((value) => value + 1);
        },
      },
      {
        text: 'Enter manually',
        onPress: () => {
          setActionView(initiatingView); setModalAction({ run: initiatingRun });
          setClaimDeviceId('');
          setAddMode('manual');
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function claimMeter(rawDeviceId: string, continueScanning: boolean) {
    const normalized = rawDeviceId.trim().toUpperCase();
    if (!normalized) {
      Alert.alert('Device ID required', 'Scan or enter the meter Device ID / serial.');
      return;
    }
    const claim = modalAction?.run;
    if (!claim) return;
    await claim(async (lease) => {
      lease.assertCurrent();
      await apiClient.claimInventoryMeterByDeviceId(normalized, lease.cloudAuthority);
      lease.assertCurrent();
    }, () => {
      setClaimDeviceId('');
      if (continueScanning) setScanKey((value) => value + 1);
      else setAddMode(null);
    });
  }

  function confirmScannedMeter(value: string) {
    const normalized = value.trim().toUpperCase();
    if (!normalized) return;
    Alert.alert('Confirm meter', `Add ${normalized} to your inventory?`, [
      {
        text: 'Scan again',
        style: 'cancel',
        onPress: () => setScanKey((key) => key + 1),
      },
      {
        text: 'Add meter',
        onPress: () => void claimMeter(normalized, true),
      },
    ]);
  }

  if (loading && !search && !addMode && !editing) {
    return <View style={{ flex: 1, backgroundColor: colors.background }}><LoadingState /></View>;
  }

  return (
    <>
      <FormScrollView
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void load(); }} />}
      >
        <Text style={[typography.title, { color: colors.foreground }]}>Meter inventory</Text>
        <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, lineHeight: 21 }}>
          Register meters before installation. Installed meters automatically leave user inventory and move to their client and site.
        </Text>

        {isMaintainer ? (
          <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg }}>
            <Button title="My inventory" variant={scope === 'mine' ? 'primary' : 'secondary'} style={{ flex: 1 }} disabled={busy} onPress={() => setScope('mine')} />
            <Button title="Company inventory" variant={scope === 'company' ? 'primary' : 'secondary'} style={{ flex: 1 }} disabled={busy} onPress={() => setScope('company')} />
          </View>
        ) : null}

        <Card style={{ marginTop: spacing.lg }}>
          <Text style={{ color: colors.mutedForeground, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>
            {scope === 'mine' ? 'My inventory total' : 'Active meters'}
          </Text>
          <Text style={[typography.title, { color: colors.foreground, marginTop: spacing.xs }]}>{data ? inventoryTotal : loading ? '…' : 'Unavailable'}</Text>
          {scope === 'company' && data ? (
            <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm }}>
              Company stock{summaryTruncated ? ' shown' : ''}: {summaryMeters.filter((meter) => meter.status === 'company').length} · With field users{summaryTruncated ? ' shown' : ''}: {summaryMeters.filter((meter) => meter.status === 'user').length}
            </Text>
          ) : null}
          {scope === 'mine' && data ? (
            <Button disabled={busy} title="Add meter" style={{ marginTop: spacing.md }} onPress={chooseAddMethod} />
          ) : null}
        </Card>

        {error ? (
          <Card style={{ marginTop: spacing.lg, borderColor: colors.destructive }}>
            <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text>
            <Button title="Retry inventory" variant="secondary" disabled={busy} onPress={() => void load()} />
          </Card>
        ) : null}

        {scope === 'company' && isMaintainer ? <Card style={{ marginTop: spacing.lg }}>
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
        </Card> : null}

        <View style={{ marginTop: spacing.xl }}>
          <SearchBar value={search} onChangeText={setSearch} placeholder="Search Device ID, model, or user" />
          <Text accessibilityLiveRegion="polite" style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>
            {searching ? 'Searching all active inventory…' : !data ? 'Inventory could not be loaded.' : `Showing ${meters.length} of ${matchingTotal}${debouncedSearch ? ' matching' : ''} meters.`}
            {truncated ? ' Only the first 500 matching records are shown. Refine your search.' : ''}
          </Text>
          {searching ? <LoadingState /> : !data ? null : filtered.length === 0 ? (
            <EmptyState title="No meters found" subtitle={scope === 'mine' ? 'Scan a meter to add it to your inventory.' : 'Register company stock above.'} />
          ) : filtered.map((meter) => (
            <Pressable
              key={meter.id}
              accessibilityRole={isMaintainer && scope === 'company' ? 'button' : undefined}
              onPress={isMaintainer && scope === 'company' && !busy ? () => { setActionView(viewToken); setModalAction({ run }); setEditing(meter); } : undefined}
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
                    {meter.notes ? <Text style={{ color: colors.mutedForeground, marginTop: spacing.xs }}>{meter.notes}</Text> : null}
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
      </FormScrollView>

      <Modal visible={Boolean(editing && data && actionView === viewToken)} animationType="slide" onRequestClose={() => setEditing(null)}>
        {editing && modalAction && data && actionView === viewToken ? (
          <InventoryEditor
            meter={editing}
            users={users}
            currentUserId={currentUserId}
            onClose={() => setEditing(null)}
            run={modalAction.run}
            busy={busy}
            error={error}
            onSaved={() => setEditing(null)}
          />
        ) : null}
      </Modal>

      <Modal visible={addMode !== null && Boolean(data) && actionView === viewToken} animationType="slide" onRequestClose={() => setAddMode(null)}>
        <FormScrollView
          style={{ flex: 1, backgroundColor: colors.background }}
          contentContainerStyle={{ padding: spacing.lg, paddingTop: 56, paddingBottom: spacing.xxl }}
        >
          <Text style={[typography.title, { color: colors.foreground }]}>Add meter</Text>
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, marginBottom: spacing.lg, lineHeight: 21 }}>
            The meter must already be registered in company stock. Adding it transfers custody to you and updates Scheduler immediately.
          </Text>
          {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text> : null}
          {addMode === 'scan' ? (
            <>
              <BarcodeScanField
                label="Device ID / serial"
                value={claimDeviceId}
                onChangeText={setClaimDeviceId}
                modes={['barcode']}
                autoOpenKey={scanKey}
                onScanResult={confirmScannedMeter}
                editable={!busy}
              />
              <Text style={{ color: colors.mutedForeground, marginBottom: spacing.lg }}>
                After confirmation, the scanner opens again automatically for the next meter.
              </Text>
              <Button title="Review Device ID" disabled={busy || !claimDeviceId.trim()}
                onPress={() => confirmScannedMeter(claimDeviceId)} />
              <Button
                title="Enter Device ID manually instead"
                variant="secondary"
                disabled={busy}
                onPress={() => {
                  setAddMode('manual');
                }}
              />
            </>
          ) : (
            <>
              <TextField
                label="Device ID / serial"
                value={claimDeviceId}
                onChangeText={setClaimDeviceId}
                autoCapitalize="characters"
                editable={!busy}
              />
              <Button
                title={busy ? 'Adding…' : 'Add to my inventory'}
                disabled={busy}
                onPress={() => void claimMeter(claimDeviceId, false)}
              />
            </>
          )}
          <Button title="Close" variant="ghost" disabled={busy} style={{ marginTop: spacing.md }} onPress={() => setAddMode(null)} />
        </FormScrollView>
      </Modal>
    </>
  );
}

function InventoryEditor({ meter, users, currentUserId, onClose, onSaved, run, busy, error }: {
  meter: InventoryMeter;
  users: ManagedCloudUser[];
  currentUserId: string;
  onClose: () => void;
  onSaved: () => void;
  run: InventoryAction;
  busy: boolean;
  error?: string;
}) {
  const { colors } = useTheme();
  const [deviceId, setDeviceId] = useState(meter.deviceId);
  const [deviceModel, setDeviceModel] = useState(meter.deviceModel);
  const [manufacturer, setManufacturer] = useState(meter.customManufacturerName ?? '');
  const [customModel, setCustomModel] = useState(meter.customModelName ?? '');
  const [notes, setNotes] = useState(meter.notes ?? '');
  const [custodianUserId, setCustodianUserId] = useState<string | null>(meter.custodianUserId);

  const update = () => run(async (lease, view) => {
    if (!view.access.isMaintainer || view.scope !== 'company') throw new Error('Company inventory access is required.');
    lease.assertCurrent();
    const saved = await apiClient.updateInventoryMeter(meter.id, {
      expectedRevision: meter.revision, deviceId, deviceModel,
      customManufacturerName: manufacturer.trim() || null,
      customModelName: customModel.trim() || null, notes: notes.trim() || null,
      ...(meter.status === 'installed' ? {} : { custodianUserId }),
    }, lease.cloudAuthority);
    lease.assertCurrent();
    if (saved.id !== meter.id) throw new Error('Inventory update returned a different meter. Refresh before continuing.');
  }, onSaved);

  return (
    <FormScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, paddingTop: 56, paddingBottom: spacing.xxl }}>
      <Text style={[typography.title, { color: colors.foreground }]}>Edit meter</Text>
      {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text> : null}
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
              void run(async (lease, view) => {
                if (!view.access.isMaintainer || view.scope !== 'company') throw new Error('Company inventory access is required.');
                lease.assertCurrent();
                await apiClient.deleteInventoryMeter(meter.id, lease.cloudAuthority);
                lease.assertCurrent();
              }, onSaved);
            } },
          ])}
        />
      ) : null}
      <Button title="Close" variant="ghost" disabled={busy} style={{ marginTop: spacing.md }} onPress={onClose} />
    </FormScrollView>
  );
}
