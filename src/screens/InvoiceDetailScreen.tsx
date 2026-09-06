import { FormScrollView } from '../components/ui';
import React, { useCallback } from 'react';
import { Alert, RefreshControl, Text } from 'react-native';
import { apiClient } from '../api/apiClient';
import { useTheme } from '../context/AppProviders';
import { Badge, Button, Card, SectionHeader } from '../components/ui';
import { CommercialError, CommercialStatus, MoneyRows } from '../components/domain/CommercialUi';
import { useCommercialData } from '../hooks/useCommercialData';
import { commercialMoney, invoiceActions } from '../domain/commercial';
import { shareInvoicePdf } from '../services/commercialFiles';
import type { AuthenticatedCloudActionLease } from '../services/authenticatedCloudAction';
import { spacing, typography } from '../theme';

type Props = {
  route: { params: { installationId: string; invoiceId: string } };
  navigation: { navigate: (name: 'Invoices', params: { installationId: string }) => void };
};
export function InvoiceDetailScreen({ route, navigation }: Props) {
  const { installationId, invoiceId } = route.params;
  const { colors } = useTheme();
  const loader = useCallback(async (lease: AuthenticatedCloudActionLease) => {
    const invoice = await apiClient.getInvoice(installationId, invoiceId, lease.cloudAuthority);
    if (invoice.id !== invoiceId || invoice.installationId !== installationId
      || invoice.lines.some((line) => line.invoiceId !== invoiceId)) throw new Error('Invoice belongs to another record.');
    return invoice;
  }, [installationId, invoiceId]);
  const state = useCommercialData(loader, JSON.stringify([installationId, invoiceId]));
  if (!state.isAdmin || !state.data) return <CommercialStatus {...state} retry={() => void state.load()} />;
  const invoice = state.data;
  const actions = invoiceActions(invoice.status);
  return <FormScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} refreshControl={<RefreshControl refreshing={state.loading} onRefresh={state.load} />}>
    <Text style={[typography.title, { color: colors.foreground }]}>{invoice.invoiceNumber}</Text>
    <Badge label={invoice.status} />
    <Button title="All invoices" variant="secondary" style={{ marginVertical: spacing.md }} onPress={() => navigation.navigate('Invoices', { installationId })} />
    <CommercialError message={state.error} />
    {actions.download ? <Button title={state.busy ? 'Working…' : 'Download / share PDF'} variant="secondary" disabled={state.busy} style={{ marginBottom: spacing.sm }} onPress={() => void state.run((lease) => shareInvoicePdf(installationId, invoiceId, invoice.invoiceNumber, lease))} /> : null}
    {actions.issue ? <Button title="Issue invoice" disabled={state.busy} style={{ marginBottom: spacing.sm }} onPress={() => Alert.alert('Issue invoice?', `Issue ${invoice.invoiceNumber} for ${commercialMoney(invoice.totalIncGst, invoice.currency)}?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Issue', onPress: () => { void state.run((lease) => apiClient.issueInvoice(installationId, invoiceId, lease.cloudAuthority)); } }])} /> : null}
    {actions.void ? <Button title="Void invoice" variant="danger" disabled={state.busy} style={{ marginBottom: spacing.md }} onPress={() => Alert.alert('Void invoice?', `Void ${invoice.invoiceNumber}?`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Void', style: 'destructive', onPress: () => { void state.run((lease) => apiClient.voidInvoice(installationId, invoiceId, lease.cloudAuthority)); } }])} /> : null}
    <Card style={{ marginBottom: spacing.md }}>
      <SectionHeader title="Bill to" />
      <Text style={{ color: colors.foreground }}>{invoice.installation.clientName}{'\n'}{invoice.installation.siteName}{'\n'}{invoice.installation.siteAddress}</Text>
    </Card>
    <Card style={{ marginBottom: spacing.md }}>
      <SectionHeader title="Dates" />
      <Text style={{ color: colors.foreground }}>Issue: {invoice.issueDate ?? 'Not issued'}{'\n'}Due: {invoice.dueDate ?? 'Not set'}</Text>
    </Card>
    <MoneyRows title="Totals" currency={invoice.currency} rows={[
      ['Subtotal (ex GST)', invoice.subtotalExGst], [`GST (${Math.round(invoice.gstRate * 1000) / 10}%)`, invoice.gstAmount], ['Total (inc GST)', invoice.totalIncGst],
    ]} />
    <SectionHeader title="Invoice lines" />
    {invoice.lines.map((line) => <Card key={line.id} style={{ marginBottom: spacing.md }}>
      <Text style={[typography.subheading, { color: colors.foreground }]}>{line.description}</Text>
      <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm }}>Quantity: {line.quantity} · Unit (ex GST): {commercialMoney(line.unitAmountExGst, invoice.currency)}{'\n'}Amount (ex GST): {commercialMoney(line.lineTotalExGst, invoice.currency)}</Text>
    </Card>)}
    {invoice.notes ? <Card><SectionHeader title="Notes" /><Text style={{ color: colors.foreground }}>{invoice.notes}</Text></Card> : null}
  </FormScrollView>;
}
