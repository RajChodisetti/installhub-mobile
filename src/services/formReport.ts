import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import type { FormAttachment, FormSubmission } from '../types';
import { FORM_DEFINITION_BY_TYPE } from '../forms/catalog';
import {
  buildFormReportHtml,
  type EmbeddedFormImage,
} from './formReportHtml';
import { formPdfFilename } from './reportFilenames';

export { buildFormReportHtml } from './formReportHtml';

export const FORM_PDF_TIERS = [
  { width: 1600, quality: 0.82, label: 'Standard quality' },
  { width: 1200, quality: 0.68, label: 'Reduced quality' },
  { width: 800, quality: 0.52, label: 'Compact quality' },
] as const;

const MAX_PDF_HTML_BYTES = 120 * 1024 * 1024;
const MIN_VALID_PDF_BYTES = 5 * 1024;

export class FormPdfGenerationError extends Error {
  readonly name = 'FormPdfGenerationError';

  constructor(
    message: string,
    readonly nextTier: number | null,
  ) {
    super(message);
  }
}

export class RemoteFormEvidenceError extends Error {
  readonly name = 'RemoteFormEvidenceError';
}

let brandLogoDataUriPromise: Promise<string> | null = null;

async function loadBrandLogoDataUri(): Promise<string> {
  brandLogoDataUriPromise ??= (async () => {
    const [asset] = await Asset.loadAsync(
      require('../../assets/brand/sustainability-wise-logo-pdf.png'),
    );
    const logo = new File(asset.localUri ?? asset.uri);
    const base64 = await logo.base64();
    return `data:image/png;base64,${base64}`;
  })();
  try {
    return await brandLogoDataUriPromise;
  } catch (error) {
    brandLogoDataUriPromise = null;
    throw error;
  }
}

async function embedAttachments(
  attachments: FormAttachment[],
  qualityTier: number,
): Promise<Record<string, EmbeddedFormImage[]>> {
  const tier = FORM_PDF_TIERS[qualityTier] ?? FORM_PDF_TIERS[0];
  const result: Record<string, EmbeddedFormImage[]> = {};
  let encodedBytes = 0;
  for (const attachment of attachments) {
    if (/^https?:\/\//i.test(attachment.uri)) {
      throw new RemoteFormEvidenceError(
        'This form uses cloud evidence. Generate it on the API server to use the original images.',
      );
    }
    const file = new File(attachment.uri);
    if (!file.exists) {
      throw new FormPdfGenerationError(
        `Evidence is missing for ${attachment.slot}.`,
        qualityTier + 1 < FORM_PDF_TIERS.length ? qualityTier + 1 : null,
      );
    }
    let source = file;
    let generated: File | null = null;
    if (qualityTier > 0) {
      const processed = await manipulateAsync(
        attachment.uri,
        [{ resize: { width: tier.width } }],
        { compress: tier.quality, format: SaveFormat.JPEG },
      );
      generated = new File(processed.uri);
      source = generated;
    }
    const base64 = await source.base64();
    encodedBytes += base64.length;
    if (generated?.exists) generated.delete();
    if (encodedBytes > MAX_PDF_HTML_BYTES) {
      throw new FormPdfGenerationError(
        'The report is too large to render safely on this device.',
        qualityTier + 1 < FORM_PDF_TIERS.length ? qualityTier + 1 : null,
      );
    }
    (result[attachment.slot] ??= []).push({
      uri: `data:${qualityTier > 0 ? 'image/jpeg' : attachment.mime_type};base64,${base64}`,
      ...(attachment.caption?.trim()
        ? { caption: attachment.caption.trim() }
        : {}),
    });
  }
  return result;
}

function nextTierAfterFailure(qualityTier: number): number | null {
  return qualityTier + 1 < FORM_PDF_TIERS.length ? qualityTier + 1 : null;
}

export function isRetryableFormPdfError(error: unknown): boolean {
  if (
    error instanceof FormPdfGenerationError ||
    error instanceof RemoteFormEvidenceError
  ) return true;
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /pdf|print|render|memory|empty|too large|not created|failed|string length|length exceeded/i
    .test(message);
}

export async function createFormPdf(
  submission: FormSubmission,
  qualityTier = 0,
): Promise<string> {
  const [embeddedImages, brandLogoDataUri] = await Promise.all([
    embedAttachments(submission.attachments, qualityTier),
    loadBrandLogoDataUri(),
  ]);
  const html = buildFormReportHtml(submission, embeddedImages, brandLogoDataUri);
  if (html.length * 2 > MAX_PDF_HTML_BYTES) {
    throw new FormPdfGenerationError(
      'The report HTML is too large to render safely on this device.',
      nextTierAfterFailure(qualityTier),
    );
  }

  let temporary: File | null = null;
  try {
    const { uri } = await Print.printToFileAsync({ html });
    temporary = new File(uri);
    if (!temporary.exists || (temporary.size ?? 0) < MIN_VALID_PDF_BYTES) {
      throw new FormPdfGenerationError(
        'The device created an empty or incomplete PDF.',
        nextTierAfterFailure(qualityTier),
      );
    }
  } catch (error) {
    if (error instanceof FormPdfGenerationError) throw error;
    throw new FormPdfGenerationError(
      error instanceof Error ? error.message : 'The device could not render the PDF.',
      nextTierAfterFailure(qualityTier),
    );
  }

  const directory = new Directory(Paths.cache, 'form-reports');
  directory.create({ idempotent: true, intermediates: true });
  const output = new File(directory, formPdfFilename(submission));
  try {
    await temporary.copy(output, { overwrite: true });
  } finally {
    if (temporary.exists) temporary.delete();
  }
  if (!output.exists || (output.size ?? 0) < MIN_VALID_PDF_BYTES) {
    if (output.exists) output.delete();
    throw new FormPdfGenerationError(
      'The generated PDF could not be saved.',
      nextTierAfterFailure(qualityTier),
    );
  }
  return output.uri;
}

export async function shareFormPdf(
  submission: FormSubmission,
  qualityTier = 0,
): Promise<void> {
  const uri = await createFormPdf(submission, qualityTier);
  if (!await Sharing.isAvailableAsync()) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: `Share ${FORM_DEFINITION_BY_TYPE[submission.form_type].shortTitle}`,
  });
}
