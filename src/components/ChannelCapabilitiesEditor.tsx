import React, { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Button, TextField } from './ui';
import { useTheme } from '../context/AppProviders';
import { capabilitiesFromDrafts, capabilityDrafts, type CapabilityDraft } from '../domain/meterEditorAdditions';
import { createId } from '../utils';

export function ChannelCapabilitiesEditor({ value, onChange, onValidityChange }: {
  value?: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const { colors } = useTheme();
  const [rows, setRows] = useState(() => capabilityDrafts(value));
  const [error, setError] = useState('');
  const edited = useRef(false);
  const callbacks = useRef({ onChange, onValidityChange });
  callbacks.current = { onChange, onValidityChange };
  useEffect(() => {
    if (!edited.current) {
      callbacks.current.onValidityChange(true);
      return;
    }
    try {
      const next = capabilitiesFromDrafts(rows);
      setError(''); callbacks.current.onValidityChange(true);
      callbacks.current.onChange(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Check capability values.');
      callbacks.current.onValidityChange(false);
    }
  }, [rows]);
  useEffect(() => () => callbacks.current.onValidityChange(true), []);
  const update = (id: string, patch: Partial<CapabilityDraft>) => {
    edited.current = true;
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  };
  return <View style={{ gap: 8 }}>
    <Text style={{ color: colors.foreground, fontWeight: '700' }}>Channel capabilities</Text>
    <Text style={{ color: colors.mutedForeground }}>Add manufacturer capability names and values. JSON preserves numbers, booleans, arrays and objects.</Text>
    {rows.map((row) => <View key={row.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10 }}>
      <TextField label="Capability name" value={row.key} onChangeText={(key) => update(row.id, { key })} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {(['Text', 'JSON'] as const).map((format) => <Button key={format} title={`${row.format === format ? '✓ ' : ''}${format}`} variant="secondary" onPress={() => {
          if (format !== row.format) update(row.id, { format, value: format === 'JSON' ? JSON.stringify(row.value) : row.value });
        }} />)}
      </View>
      <TextField
        label="Capability value"
        // Announce the format and reapply the label when iOS replaces its native
        // backing control on a multiline change (including recycled controls).
        accessibilityLabel={`Capability value (${row.format})`}
        value={row.value}
        multiline={row.format === 'JSON'}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(entry) => update(row.id, { value: entry })}
      />
      <Button title={`Remove ${row.key || 'capability'}`} variant="danger" onPress={() => { edited.current = true; setRows((current) => current.filter((item) => item.id !== row.id)); }} />
    </View>)}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text> : null}
    <Button title="Add capability" variant="secondary" onPress={() => { edited.current = true; setRows((current) => {
      let suffix = current.length + 1;
      while (current.some((row) => row.key === `capability_${suffix}`)) suffix += 1;
      return [...current, { id: createId('capability'), key: `capability_${suffix}`, value: '', format: 'Text' }];
    }); }} />
  </View>;
}
