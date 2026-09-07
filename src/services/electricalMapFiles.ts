import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { runWithCloudAccessToken } from '../api/apiClient';
import { SYNC_API_URL } from '../constants/syncConfig';
import { authenticatedFileDownload } from './authenticatedFileDownload';
import { captureAuthenticatedCloudActionLease } from './authenticatedCloudAction';
import { runLeasedCloudActionStep } from './cloudActionLease';
import {
  electricalMapDownloadPath,
  electricalMapRecordVersionForDownload,
  type ElectricalMapFileFormat,
} from '../domain/electricalMapDownload';
import type { InstallationStatus } from '../types';

/** Download/share the portal-parity renderer without exposing bearer tokens. */
export async function shareInstallationElectricalMap(input: {
  installationId: string;
  siteCode?: string;
  format: ElectricalMapFileFormat;
  installationStatus: InstallationStatus;
  recordVersionNumber?: number | null;
  assertScreenCurrent: () => void;
}): Promise<void> {
  const recordVersionNumber = electricalMapRecordVersionForDownload(
    input.installationStatus,
    input.recordVersionNumber,
  );
  const lease = await captureAuthenticatedCloudActionLease();
  const assertCurrent = () => { lease.assertCurrent(); input.assertScreenCurrent(); };
  assertCurrent();
  if (!await runLeasedCloudActionStep(lease, () => Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  const directory = new Directory(Paths.cache, 'installhub-electrical-maps');
  directory.create({ idempotent: true, intermediates: true });
  const safeSite = (input.siteCode || input.installationId).replace(/[^a-z0-9._-]+/gi, '-').slice(0, 100);
  const suffix = recordVersionNumber ? `-v${recordVersionNumber}` : '-current';
  const destination = new File(directory, `${safeSite}-electrical-map${suffix}-${Date.now()}.${input.format}`);
  const mimeType = input.format === 'png' ? 'image/png' : 'image/svg+xml';
  try {
    await runLeasedCloudActionStep(lease, () => runWithCloudAccessToken((token) => {
      assertCurrent();
      return authenticatedFileDownload({
        url: `${SYNC_API_URL}${electricalMapDownloadPath(input.installationId, input.format, recordVersionNumber)}`,
        destination,
        token,
        expectedContentType: mimeType,
      });
    }, lease.cloudAuthority));
    assertCurrent();
    await runLeasedCloudActionStep(lease, () => Sharing.shareAsync(destination.uri, {
      mimeType,
      UTI: input.format === 'png' ? 'public.png' : 'public.svg-image',
      dialogTitle: `${input.siteCode || 'Installation'} electrical map`,
    }));
  } finally {
    if (destination.exists) destination.delete();
  }
}

export { electricalMapDownloadPath } from '../domain/electricalMapDownload';
export type { ElectricalMapFileFormat } from '../domain/electricalMapDownload';
