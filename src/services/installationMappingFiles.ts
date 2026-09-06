import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { apiClient } from '../api/apiClient';
import { getInstallationBackupTree, getInstallationSyncMetadata } from '../repositories/cloudSyncRepository';
import { captureAuthenticatedCloudActionLease } from './authenticatedCloudAction';
import { runLeasedCloudActionStep } from './cloudActionLease';
import { assertAssignedWorkMutationAllowed } from './assignedWorkMutationGuard';
import { assertPinnedInstallationMapping, assertPinnedMappingLocalTarget, pinnedMappingCanonicalJson } from './pinnedInstallationMapping';

export async function sharePinnedInstallationMapping(installationId: string, recordVersionNumber: number, assertScreenCurrent: () => void): Promise<void> {
  const lease = await captureAuthenticatedCloudActionLease();
  const assertCurrent = () => { lease.assertCurrent(); assertScreenCurrent(); };
  const read = async () => {
    assertCurrent();
    const tree = await runLeasedCloudActionStep(lease, () => getInstallationBackupTree(installationId));
    const metadata = await runLeasedCloudActionStep(lease, () => getInstallationSyncMetadata(installationId));
    assertCurrent();
    if (!tree || tree.installation.id !== installationId) throw new Error('The installation is no longer available.');
    assertAssignedWorkMutationAllowed(tree.installation, lease.processAuthority);
    assertPinnedMappingLocalTarget(tree, metadata, recordVersionNumber);
    return { tree, metadata };
  };
  const baseline = await read();
  const fingerprint = pinnedMappingCanonicalJson(baseline);
  const mapping = await runLeasedCloudActionStep(lease, () => apiClient.getInstallationMapping(installationId, recordVersionNumber, lease.cloudAuthority));
  assertCurrent();
  assertPinnedInstallationMapping(mapping, installationId, recordVersionNumber);
  if (!await Sharing.isAvailableAsync()) throw new Error('Sharing is not available on this device.');
  if (pinnedMappingCanonicalJson(await read()) !== fingerprint) throw new Error('The installation changed during the download. Retry from its current saved version.');
  assertCurrent();
  const directory = new Directory(Paths.cache, 'installhub-mappings');
  directory.create({ idempotent: true, intermediates: true });
  const name = (baseline.tree.installation.site_code || installationId).replace(/[^a-z0-9._-]+/gi, '-').slice(0, 100);
  const file = new File(directory, `${name}-mapping-v${recordVersionNumber}-${Date.now()}.json`);
  try {
    file.write(JSON.stringify(mapping, null, 2));
    assertCurrent();
    await runLeasedCloudActionStep(lease, () => Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: `Pinned mapping · version ${recordVersionNumber}` }));
  } finally {
    if (file.exists) file.delete();
  }
}
