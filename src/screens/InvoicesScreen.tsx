import { FormScrollView } from '../components/ui';
import React, { useCallback } from 'react';
import { RefreshControl, Text } from 'react-native';
import { apiClient } from '../api/apiClient';
import { useTheme } from '../context/AppProviders';
import { Badge, Button, Card, EmptyState, SectionHeader } from '../components/ui';
import { CommercialError, CommercialStatus, QuickInvoice } from '../components/domain/CommercialUi';
import { useCommercialData } from '../hooks/useCommercialData';
import { commercialMoney } from '../domain/commercial';
import type { AuthenticatedCloudActionLease } from '../services/authenticatedCloudAction';
import { spacing, typography } from '../theme';

type Props = {
  route: { params: { installationId: string } };
  navigation: { navigate: (name: 'FinancialSummary' | 'InvoiceDetail', params: { installationId: string; invoiceId?: string }) => void };
};
export function InvoicesScreen({ route, navigation }: Props) {
  const { installationId } = route.params;
  const { colors } = useTheme();
  const loader = useCallback(async (lease: AuthenticatedCloudActionLease) => {
    const [invoices, summary] = await Promise.all([apiClient.listInvoices(installationId, lease.cloudAuthority), apiClient.getFinancialSummary(installationId, lease.cloudAuthority)]);
    if (summary.installationId !== installationId || summary.header.installationId !== installationId
      || invoices.items.some((invoice) => invoice.installationId !== installationId)
      || summary.lines.some((line) => line.installationId !== installationId)) throw new Error('Invoice list belongs to another installation.');
    return { invoices: invoices.items, summary };
  }, [installationId]);
  const state = useCommercialData(loader, installationId);
  if (!state.isAdmin || !state.data) return <CommercialStatus {...state} retry={() => void state.load()} />;
  const { invoices, summary } = state.data;
  async function create(ids: string[], invoiceNotes: string | null) {
    await state.run((lease) => apiClient.quickCreateInvoice(installationId, { costLineIds: ids, notes: invoiceNotes }, lease.cloudAuthority), (invoice) => {
      if (invoice.installationId !== installationId) throw new Error('Created invoice belongs to another installation.');
      navigation.navigate('InvoiceDetail', { installationId, invoiceId: invoice.id });
    });
  }
  return <FormScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl }} refreshControl={<RefreshControl refreshing={state.loading} onRefresh={state.load} />}>
    <Text style={[typography.title, { color: colors.foreground }]}>Invoices</Text>
    <Text style={{ color: colors.mutedForeground, marginVertical: spacing.md }}>{summary.installation.siteName} · {summary.installation.clientName}</Text>
    <Button title="Financial Summary" variant="secondary" onPress={() => navigation.navigate('FinancialSummary', { installationId })} style={{ marginBottom: spacing.md }} />
    <CommercialError message={state.error} />
    <QuickInvoice lines={summary.lines} currency={summary.currency} busy={state.busy} onCreate={(ids, invoiceNotes) => void create(ids, invoiceNotes)} />
    <SectionHeader title={`All invoices (${invoices.length})`} />
    {invoices.length === 0 ? <EmptyState title="No invoices yet" subtitle="Add billable cost lines in Financial Summary, then create a draft." /> : invoices.map((invoice) => <Card key={invoice.id} style={{ marginBottom: spacing.md }}>
      <Text style={[typography.subheading, { color: colors.foreground }]}>{invoice.invoiceNumber}</Text>
      <Badge label={invoice.status} tone={invoice.status === 'paid' ? 'success' : invoice.status === 'void' ? 'danger' : 'default'} />
      <Text style={{ color: colors.mutedForeground, marginVertical: spacing.sm }}>{invoice.issueDate ? `Issued: ${invoice.issueDate}` : `Created: ${invoice.createdAt}`} · Due: {invoice.dueDate ?? 'Not set'}{'\n'}Subtotal: {commercialMoney(invoice.subtotalExGst, invoice.currency)} · GST: {commercialMoney(invoice.gstAmount, invoice.currency)}{'\n'}Total: {commercialMoney(invoice.totalIncGst, invoice.currency)}</Text>
      <Button title="Open invoice" variant="secondary" onPress={() => navigation.navigate('InvoiceDetail', { installationId, invoiceId: invoice.id })} />
    </Card>)}
  </FormScrollView>;
}
