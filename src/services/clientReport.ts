import { resolveOwnedMediaUri } from './ownedMediaPaths';
import { File } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { clientReportModel, type ClientReportData, type ClientReportPhotoExclusions } from '../domain/clientReport';
import { cachedThumbnailUri } from '../repositories/cloudSyncRepository';
import { buildClientReportHtml } from './clientReportHtml';
import { A4_PRINT_HEIGHT, A4_PRINT_WIDTH } from './reportPage';

export async function shareClientReportPdf(
  data: ClientReportData,
  excluded: ClientReportPhotoExclusions,
  assertCurrent: () => void = () => {},
): Promise<void> {
  assertCurrent();
  const images: Record<string, string> = {};
  let encodedBytes = 0;
  for (const photo of clientReportModel(data, excluded).includedPhotos) {
    assertCurrent();
    const localUri = /^https?:\/\//i.test(photo.uri) ? cachedThumbnailUri(photo.uri) : resolveOwnedMediaUri(photo.uri);
    if (!localUri || !new File(localUri).exists) {
      throw new Error(`Preview image unavailable for ${photo.label}. Finish downloading the photo previews or deselect this photo and retry.`);
    }
    const processed = await manipulateAsync(localUri, [{ resize: { width: 800 } }], { compress: 0.65, format: SaveFormat.JPEG });
    const temporary = new File(processed.uri);
    try {
      assertCurrent();
      const base64 = await temporary.base64();
      assertCurrent();
      encodedBytes += base64.length;
      if (encodedBytes > 80 * 1024 * 1024) throw new Error('The preview contains too many photos for device export. Choose fewer photos and retry.');
      images[photo.key] = `data:image/jpeg;base64,${base64}`;
    } finally {
      if (processed.uri !== localUri && temporary.exists) temporary.delete();
    }
  }
  assertCurrent();
  const output = await Print.printToFileAsync({ html: buildClientReportHtml(data, excluded, images), width: A4_PRINT_WIDTH, height: A4_PRINT_HEIGHT });
  assertCurrent();
  if (!new File(output.uri).exists || !output.numberOfPages) throw new Error('The device did not create a client report PDF.');
  const available = await Sharing.isAvailableAsync();
  assertCurrent();
  if (!available) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(output.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `${data.installation.site_name} client report` });
  assertCurrent();
}
