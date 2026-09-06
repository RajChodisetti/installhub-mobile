import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, EmptyState, LoadingState, TextArea } from '../ui';
import { useTheme } from '../../context/AppProviders';
import { spacing, typography } from '../../theme';
import { commercialMoney, eligibleInvoiceLines, invoicePreview, selectedInvoiceLineIds } from '../../domain/commercial';
import type { CostLine } from '../../types/commercial';

export function CommercialStatus({ isAdmin, loading, error, retry }: { isAdmin: boolean; loading: boolean; error?: string; retry: () => void }) {
  const { colors } = useTheme();
  if (!isAdmin) return <EmptyState title="Administrator access required" subtitle="Only administrators can access installation financials and invoices." />;
  if (loading) return <LoadingState />;
  return <Card><Text accessibilityRole="alert" style={{ color: colors.destructive }}>{error ?? 'Financial data is unavailable.'}</Text><Button title="Try again" onPress={retry} /></Card>;
}

export function CommercialError({ message }: { message?: string }) {
  const { colors } = useTheme();
  return message ? <Card style={{ marginBottom: spacing.md }}><Text accessibilityRole="alert" style={{ color: colors.destructive }}>{message}</Text></Card> : null;
}

export function MoneyRows({ title, rows, currency }: { title: string; rows: Array<[string, number | string | null]>; currency: string }) {
  const { colors } = useTheme();
  return <Card style={{ marginBottom: spacing.md }}>
    <Text style={[typography.heading, { color: colors.foreground, marginBottom: spacing.md }]}>{title}</Text>
    {rows.map(([label, value]) => <View key={label} style={{ marginBottom: spacing.sm }}>
      <Text style={{ color: colors.mutedForeground }}>{label}</Text>
      <Text style={{ color: colors.foreground, fontWeight: '700' }}>{value === null ? '—' : typeof value === 'number' ? commercialMoney(value, currency) : value}</Text>
    </View>)}
  </Card>;
}

export function QuickInvoice({ lines, currency, busy, onCreate }: { lines: CostLine[]; currency: string; busy: boolean; onCreate: (ids: string[], notes: string | null) => void }) {
  const { colors } = useTheme();
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const eligible = eligibleInvoiceLines(lines);
  const selected = selectedInvoiceLineIds(lines, excluded);
  const preview = invoicePreview(lines, excluded);
  const toggle = (id: string) => setExcluded((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return <Card style={{ marginBottom: spacing.md }}>
    <Text style={[typography.heading, { color: colors.foreground }]}>Quick invoice</Text>
    <Text style={{ color: colors.mutedForeground, marginVertical: spacing.sm }}>Select uninvoiced billable costs to create a draft invoice. Review the draft before issuing.</Text>
    {eligible.length ? <>
      <Button title={selected.length === eligible.length ? 'Clear selection' : 'Select all'} variant="ghost" disabled={busy} onPress={() => setExcluded(selected.length === eligible.length ? new Set(eligible.map((line) => line.id)) : new Set())} />
      {eligible.map((line) => <Button key={line.id} accessibilityRole="checkbox" accessibilityState={{ checked: !excluded.has(line.id) }} title={`${!excluded.has(line.id) ? '✓ ' : ''}${line.description} · ${line.category} · ${commercialMoney(line.sellAmount ?? line.costAmount, currency)}`} variant="secondary" disabled={busy} style={{ marginTop: spacing.sm }} onPress={() => toggle(line.id)} />)}
      <TextArea label="Invoice notes (optional)" value={notes} onChangeText={setNotes} editable={!busy} style={{ marginTop: spacing.md }} />
      <Text style={{ color: colors.mutedForeground, marginVertical: spacing.sm }}>Selected: {selected.length} · Subtotal (ex GST): {commercialMoney(preview.subtotal, currency)} · GST (10%): {commercialMoney(preview.gst, currency)} · Total: {commercialMoney(preview.total, currency)}</Text>
      <Button title={busy ? 'Working…' : `Create draft invoice (${selected.length} lines)`} disabled={busy || selected.length === 0} style={{ marginTop: spacing.md }} onPress={() => onCreate(selected, notes.trim() || null)} />
    </> : <Text style={{ color: colors.mutedForeground }}>No uninvoiced billable lines are available.</Text>}
  </Card>;
}
