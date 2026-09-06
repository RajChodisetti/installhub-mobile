import { FormScrollView } from '../components/ui';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, Text, View } from 'react-native';
import { apiClient } from '../api/apiClient';
import { useTheme } from '../context/AppProviders';
import { Button, Card, SectionHeader, TextArea, TextField } from '../components/ui';
import { CommercialError, CommercialStatus, MoneyRows, QuickInvoice } from '../components/domain/CommercialUi';
import { useCommercialData } from '../hooks/useCommercialData';
import { commercialMoney, costLineInput, financeHeaderInput } from '../domain/commercial';
import { shareFinancialSummaryCsv } from '../services/commercialFiles';
import type { AuthenticatedCloudActionLease } from '../services/authenticatedCloudAction';
import type { CostCategory, PricingMode } from '../types/commercial';
import { spacing, typography } from '../theme';

type Props = {
  route: { params: { installationId: string } };
  navigation: { navigate: (name: 'Invoices' | 'InvoiceDetail', params: { installationId: string; invoiceId?: string }) => void };
};
const percent = (value: number | null) => value === null ? '—' : `${value.toFixed(1)}%`;

export function FinancialSummaryScreen({ route, navigation }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const loader = useCallback(async (lease: AuthenticatedCloudActionLease) => {
    const summary = await apiClient.getFinancialSummary(installationId, lease.cloudAuthority);
    if (summary.installationId !== installationId || summary.header.installationId !== installationId
      || summary.lines.some((line) => line.installationId !== installationId)) throw new Error('Financial summary belongs to another installation.');
    return summary;
  }, [installationId]);
  const state = useCommercialData(loader, installationId);
  const [pricingMode, setPricingMode] = useState<PricingMode>('charge_up');
  const [pricedAmount, setPricedAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState<CostCategory>('labour');
  const [description, setDescription] = useState('');
  const [cost, setCost] = useState('');
  const [sell, setSell] = useState('');
  useEffect(() => {
    setPricingMode('charge_up'); setPricedAmount(''); setNotes('');
    setCategory('labour'); setDescription(''); setCost(''); setSell('');
  }, [state.scopeKey]);
  useEffect(() => {
    if (!state.data) return;
    setPricingMode(state.data.header.pricingMode);
    setPricedAmount(state.data.header.pricedAmount == null ? '' : String(state.data.header.pricedAmount));
    setNotes(state.data.header.notes ?? '');
  }, [state.data?.header.pricingMode, state.data?.header.pricedAmount, state.data?.header.notes, state.data?.header.currency]);
  if (!state.isAdmin || !state.data) return <CommercialStatus {...state} retry={() => void state.load()} />;
  const s = state.data;
  async function savePricing() {
    try {
      const input = { ...financeHeaderInput(pricingMode, pricedAmount, notes), currency: state.data!.header.currency };
      await state.run((lease) => apiClient.updateFinanceHeader(installationId, input, lease.cloudAuthority));
    } catch (error) { state.setError(error instanceof Error ? error.message : String(error)); }
  }
  async function addLine() {
    try {
      const input = costLineInput({ category, description, cost, sell });
      await state.run((lease) => apiClient.createCostLine(installationId, input, lease.cloudAuthority), () => {
        setDescription(''); setCost(''); setSell('');
      });
    } catch (error) { state.setError(error instanceof Error ? error.message : String(error)); }
  }
  async function createInvoice(ids: string[], invoiceNotes: string | null) {
    await state.run((lease) => apiClient.quickCreateInvoice(installationId, { costLineIds: ids, notes: invoiceNotes }, lease.cloudAuthority), (created) => {
      if (created.installationId !== installationId) throw new Error('Created invoice belongs to another installation.');
      navigation.navigate('InvoiceDetail', { installationId, invoiceId: created.id });
    });
  }
  return <FormScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={state.loading} onRefresh={state.load} />}>
    <Text style={[typography.title, { color: colors.foreground }]}>Financial Summary</Text>
    <Text style={{ color: colors.mutedForeground, marginVertical: spacing.md }}>{s.installation.siteName} · {s.installation.clientName}{'\n'}{s.installation.siteAddress}</Text>
    <Button title="Invoices" variant="secondary" onPress={() => navigation.navigate('Invoices', { installationId })} style={{ marginBottom: spacing.sm }} />
    <Button title="Download / share CSV" variant="secondary" disabled={state.busy} onPress={() => void state.run((lease) => shareFinancialSummaryCsv(installationId, lease))} style={{ marginBottom: spacing.md }} />
    <CommercialError message={state.error} />
    <MoneyRows title="Overall position" currency={s.currency} rows={[
      ['Current potential profit', s.potentialProfit], ['Priced margin', percent(s.billablePricedMarginPct)], ['Costs uninvoiced', s.uninvoicedCosts],
    ]} />
    <QuickInvoice lines={s.lines} currency={s.currency} busy={state.busy} onCreate={(ids, invoiceNotes) => void createInvoice(ids, invoiceNotes)} />
    {s.autoLabour.enabled ? <Card style={{ marginBottom: spacing.md }}>
      <Text style={[typography.heading, { color: colors.foreground }]}>Auto labour</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm }}>From job start through {s.installation.status === 'Completed' ? 'completion' : 'today'}: {s.autoLabour.calendarDays} days × {s.autoLabour.hoursPerDay} hours × {commercialMoney(s.autoLabour.hourlyRate, s.currency)}/hour = {commercialMoney(s.autoLabour.costAmount, s.currency)} ({s.autoLabour.hours} hours).</Text>
    </Card> : null}
    <MoneyRows title="Overview" currency={s.currency} rows={[
      ['Billable / priced amount', s.billablePricedAmount], ['Invoiced costs', s.invoicedCosts], ['Uninvoiced costs', s.uninvoicedCosts], ['Uninvoicable costs', s.uninvoicableCosts], ['Potential profit', s.potentialProfit], ['Credit applied', s.creditApplied],
    ]} />
    <MoneyRows title="Profit margins" currency={s.currency} rows={[
      ['Billable / priced margin', percent(s.billablePricedMarginPct)], ['Current margin to date', percent(s.currentMarginToDatePct)], ['Margin breathing room', percent(s.marginBreathingRoomPct)],
    ]} />
    <MoneyRows title="Invoiced" currency={s.currency} rows={[
      ['Billable / priced amount', s.billablePricedAmount], ['Invoiced billable', s.invoicedBillable], ['Uninvoiced billable', s.uninvoicedBillable],
    ]} />
    <MoneyRows title="Spent costs" currency={s.currency} rows={[
      ['Total current costs', s.totalCurrentCosts], ['Labour cost', s.labour.cost], ['Labour hours', String(s.labour.hours)], ['Uncharged labour cost', s.labour.unchargedCost], ['Material cost', s.material.cost], ['Scheduled hours', String(s.scheduledHours)],
    ]} />
    <MoneyRows title="Labour and material" currency={s.currency} rows={[
      ['Labour cost', s.labour.cost], ['Labour sell', s.labour.sell], ['Material cost', s.material.cost], ['Material sell', s.material.sell],
    ]} />
    <Card style={{ marginBottom: spacing.md }}>
      <SectionHeader title="Job pricing" />
      <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
        {(['charge_up', 'quoted'] as const).map((mode) => <Button key={mode} title={mode === 'quoted' ? 'Quoted' : 'Charge-up'} variant={mode === pricingMode ? 'primary' : 'secondary'} accessibilityState={{ selected: mode === pricingMode }} disabled={state.busy} onPress={() => setPricingMode(mode)} />)}
      </View>
      <TextField label={`Billable / priced amount (${s.currency})`} value={pricedAmount} onChangeText={setPricedAmount} keyboardType="decimal-pad" editable={!state.busy} placeholder={pricingMode === 'quoted' ? 'Quote total' : 'Optional estimate'} />
      <TextArea label="Pricing notes" value={notes} onChangeText={setNotes} editable={!state.busy} />
      <Button title={state.busy ? 'Working…' : 'Save pricing'} disabled={state.busy} onPress={() => void savePricing()} />
    </Card>
    <SectionHeader title="Cost lines" />
    <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>Log labour, materials and other costs. Labour hours are managed through audited financial settings. Invoice status follows invoice creation, issue and void actions.</Text>
    {s.lines.length === 0 ? <Text style={{ color: colors.mutedForeground }}>No costs logged yet.</Text> : s.lines.map((line) => <Card key={line.id} style={{ marginBottom: spacing.md }}>
      <Text style={[typography.subheading, { color: colors.foreground }]}>{line.description}</Text>
      <Text style={{ color: colors.mutedForeground, marginVertical: spacing.sm }}>{line.category}{line.source === 'auto_labour' ? ' · Auto' : ''} · {line.billable ? 'Billable' : 'Non-billable'} · {line.invoiced ? 'Invoiced' : 'Uninvoiced'}{'\n'}Cost: {commercialMoney(line.costAmount, s.currency)} · Sell: {line.sellAmount == null ? '—' : commercialMoney(line.sellAmount, s.currency)} · Hours: {line.hours ?? '—'}</Text>
      {line.source !== 'auto_labour' ? <Button title="Delete cost line" variant="danger" disabled={state.busy} style={{ marginTop: spacing.sm }} onPress={() => Alert.alert('Delete cost line?', line.description, [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => { void state.run((lease) => apiClient.deleteCostLine(installationId, line.id, lease.cloudAuthority)); } }])} /> : null}
    </Card>)}
    <Card style={{ marginTop: spacing.md }}>
      <SectionHeader title="Add cost line" />
      <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>{(['labour', 'material', 'other'] as const).map((value) => <Button key={value} title={value[0].toUpperCase() + value.slice(1)} variant={category === value ? 'primary' : 'secondary'} accessibilityState={{ selected: category === value }} disabled={state.busy} onPress={() => setCategory(value)} />)}</View>
      <TextField label="Description" value={description} onChangeText={setDescription} editable={!state.busy} />
      <TextField label={`Cost (${s.currency})`} value={cost} onChangeText={setCost} keyboardType="decimal-pad" editable={!state.busy} />
      <TextField label={`Sell (${s.currency}, optional)`} value={sell} onChangeText={setSell} keyboardType="decimal-pad" editable={!state.busy} />
      <Button title={state.busy ? 'Working…' : 'Add cost line'} disabled={state.busy} onPress={() => void addLine()} />
    </Card>
  </FormScrollView>;
}
