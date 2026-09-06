import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { runWithCloudAccessToken } from '../api/apiClient';
import { SYNC_API_URL } from '../constants/syncConfig';
import { authenticatedFileDownload } from './authenticatedFileDownload';
import type { AuthenticatedCloudActionLease } from './authenticatedCloudAction';
import { runLeasedCloudActionStep } from './cloudActionLease';

async function shareCommercialFile(path: string, title: string, mimeType: string, lease: AuthenticatedCloudActionLease): Promise<void> {
  lease.assertCurrent();
  if (!await runLeasedCloudActionStep(lease, () => Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  lease.assertCurrent();
  const directory = new Directory(Paths.cache, 'installhub-commercial-files');
  directory.create({ idempotent: true, intermediates: true });
  const safeName = title.replace(/[^a-z0-9._-]+/gi, '-').slice(0, 150);
  const destination = new File(directory, `${Date.now()}-${safeName}`);
  try {
    await runLeasedCloudActionStep(lease, () => runWithCloudAccessToken((token) => {
      lease.assertCurrent();
      return authenticatedFileDownload({ url: `${SYNC_API_URL}${path}`, destination, token, expectedContentType: mimeType });
    }, lease.cloudAuthority));
    await runLeasedCloudActionStep(lease, () => Sharing.shareAsync(destination.uri, {
      mimeType, dialogTitle: title, ...(mimeType === 'application/pdf' ? { UTI: 'com.adobe.pdf' } : {}),
    }));
  } finally {
    if (destination.exists) destination.delete();
  }
}

export function shareFinancialSummaryCsv(installationId: string, lease: AuthenticatedCloudActionLease): Promise<void> {
  return shareCommercialFile(`/v1/installhub/installations/${encodeURIComponent(installationId)}/financial-summary.csv`, 'financial-summary.csv', 'text/csv', lease);
}

export function shareInvoicePdf(installationId: string, invoiceId: string, invoiceNumber: string, lease: AuthenticatedCloudActionLease): Promise<void> {
  return shareCommercialFile(`/v1/installhub/installations/${encodeURIComponent(installationId)}/invoices/${encodeURIComponent(invoiceId)}/pdf`, `invoice-${invoiceNumber}.pdf`, 'application/pdf', lease);
}
