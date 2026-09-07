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
    <Text style={{ color: colors.mutedForeground }}>Record arbitrary manufacturer capability keys without assuming a standard meter layout.</Text>
    <Button title="Add capability" variant="secondary" onPress={() => { edited.current = true; setRows((current) => {
      let suffix = current.length + 1;
      while (current.some((row) => row.key === `capability_${suffix}`)) suffix += 1;
      return [...current, { id: createId('capability'), key: `capability_${suffix}`, value: '', format: 'Text' }];
    }); }} />
    {rows.map((row) => <View key={row.id} style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10 }}>
      <TextField label="Capability name" value={row.key} onChangeText={(key) => update(row.id, { key })} />
      <TextField
        label="Capability value"
        accessibilityLabel={`Channel capability value for ${row.key || 'unnamed capability'}`}
        value={row.value}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(entry) => update(row.id, { value: entry, format: 'Text' })}
      />
      <Button title={`Remove ${row.key || 'capability'}`} variant="danger" onPress={() => { edited.current = true; setRows((current) => current.filter((item) => item.id !== row.id)); }} />
    </View>)}
    {error ? <Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error}</Text> : null}
  </View>;
}
