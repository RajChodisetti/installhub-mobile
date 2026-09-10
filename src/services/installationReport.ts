import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { PDFDocument } from 'pdf-lib';
import type { InstallationBackupTree } from '../repositories/cloudSyncRepository';
import type {
  FormSubmission,
  InstallationReportDetailMode,
  VirtualMeterDefinition,
} from '../types';
import { buildElectricalDiagramModel } from '../domain/electricalDiagram';
import {
  collectClientReportPhotos,
  type ClientReportPhoto,
} from '../domain/clientReport';
import { deriveVirtualMetersFromEntities } from '../domain/installationV2';
import {
  FORM_PDF_TIERS,
  FormPdfGenerationError,
  MissingLocalFormEvidenceError,
  RemoteFormEvidenceError,
  createFormPdf,
} from './formReport';
import { resolveOwnedMediaUri } from './ownedMediaPaths';
import { FORM_REPORT_THEME as theme } from './formReportTheme';
import {
  buildElectricalMapReportHtml,
  ELECTRICAL_MAP_REPORT_CSS,
} from './electricalMapReport';
import {
  A4_PRINT_HEIGHT,
  A4_PRINT_WIDTH,
  stampPdfPageFooters,
} from './reportPage';
import { buildCompletionNotesSummaryHtml } from './installationReportNotes';

const MIN_VALID_PDF_BYTES = 5 * 1024;
const MAX_PDF_HTML_BYTES = 120 * 1024 * 1024;

export interface InstallationPackReportInput {
  /** One repository snapshot captured when the user starts generation. */
  tree: InstallationBackupTree;
  /** Undefined preserves legacy all-completed behavior; an explicit empty list is validated. */
  selectedFormIds?: string[];
  detailMode: InstallationReportDetailMode;
}

export type InstallationReportGenerationPath =
  | 'DEVICE'
  | 'API_RECOMMENDED'
  | 'API_REQUIRED';

export interface InstallationReportWeight {
  nodeCount: number;
  formCount: number;
  attachmentCount: number;
  remoteAttachmentCount: number;
  estimatedPages: number;
  path: InstallationReportGenerationPath;
  reasons: string[];
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value: string): string {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-AU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      }).format(date);
}

function detailModeLabel(mode: InstallationReportDetailMode): string {
  return mode === 'by-zone'
    ? 'Physical zone details'
    : 'Electrical hierarchy details';
}

async function brandLogoDataUri(): Promise<string> {
  const [asset] = await Asset.loadAsync(
    require('../../assets/brand/sustainability-wise-logo-pdf.png'),
  );
  const file = new File(asset.localUri ?? asset.uri);
  return `data:image/png;base64,${await file.base64()}`;
}

export function selectInstallationReportForms(
  tree: InstallationBackupTree,
  selectedFormIds?: string[],
): FormSubmission[] {
  const completed = tree.formSubmissions.filter(
    (form) => form.status === 'Completed',
  );
  if (selectedFormIds === undefined) return completed;

  const selectedIds = [...new Set(selectedFormIds.filter(Boolean))];
  if (completed.length > 0 && selectedIds.length === 0) {
    throw new Error('Select at least one completed form for the installation pack.');
  }
  const completedById = new Map(completed.map((form) => [form.id, form]));
  return selectedIds.map((id) => {
    const form = completedById.get(id);
    if (!form) {
      throw new Error(
        'The report selection contains a form that is missing or not Completed.',
      );
    }
    return form;
  });
}

function reportVirtualMeters(
  tree: InstallationBackupTree,
): VirtualMeterDefinition[] {
  const serverDerived = tree.installation.server_derived;
  if (
    serverDerived &&
    serverDerived.treeRevision === tree.installation.server_tree_revision
  ) {
    return serverDerived.virtualMeterDefinitions;
  }
  return deriveVirtualMetersFromEntities({
    boards: tree.electricalAssets,
    siteAssets: tree.siteAssets,
    gridSupplies: tree.gridSupplies,
    meterDevices: tree.meterDevices,
    measurementAssignments: tree.measurementAssignments,
  });
}

function installationReportModel(tree: InstallationBackupTree) {
  return buildElectricalDiagramModel({
    installation: tree.installation,
    zones: tree.zones,
    boards: tree.electricalAssets,
    siteAssets: tree.siteAssets,
    gridSupplies: tree.gridSupplies,
    meterDevices: tree.meterDevices,
    measurementAssignments: tree.measurementAssignments,
    virtualMeterDefinitions: reportVirtualMeters(tree),
  });
}

export function installationEntityEvidencePhotos(
  tree: InstallationBackupTree,
): ClientReportPhoto[] {
  return collectClientReportPhotos(tree).filter(
    (photo) => !photo.key.startsWith('form:'),
  );
}

export function installationReportWeight(
  tree: InstallationBackupTree,
  selectedFormIds?: string[],
): InstallationReportWeight {
  const forms = selectInstallationReportForms(tree, selectedFormIds);
  const model = installationReportModel(tree);
  const attachments = forms.flatMap((form) => form.attachments);
  const entityPhotos = installationEntityEvidencePhotos(tree);
  const evidenceCount = attachments.length + entityPhotos.length;
  const largeEvidenceCount = attachments.filter((attachment) => attachment.largeInPdf).length
    + entityPhotos.filter((photo) => photo.largeInPdf).length;
  const remoteAttachmentCount = [
    ...attachments.map((attachment) => attachment.uri),
    ...entityPhotos.map((photo) => photo.uri),
  ].filter((uri) => /^https?:\/\//i.test(uri)).length;
  const estimatedPages = Math.max(
    4,
    3 + Math.ceil(model.nodes.length / 16) + forms.length * 2 +
      largeEvidenceCount + Math.ceil((evidenceCount - largeEvidenceCount) / 4),
  );
  const reasons: string[] = [];
  let path: InstallationReportGenerationPath = 'DEVICE';

  if (remoteAttachmentCount > 0) {
    path = 'API_REQUIRED';
    reasons.push(
      `${remoteAttachmentCount} selected evidence image${remoteAttachmentCount === 1 ? '' : 's'} ${remoteAttachmentCount === 1 ? 'is' : 'are'} stored in Cloud Backup`,
    );
  } else {
    if (model.nodes.length >= 70) reasons.push('the electrical map has many symbols');
    if (forms.length >= 10) reasons.push('many completed forms are selected');
    if (evidenceCount >= 40) reasons.push('the installation contains many evidence images');
    if (estimatedPages >= 35) reasons.push('the estimated report is long');
    if (reasons.length) path = 'API_RECOMMENDED';
  }

  return {
    nodeCount: model.nodes.length,
    formCount: forms.length,
    attachmentCount: evidenceCount,
    remoteAttachmentCount,
    estimatedPages,
    path,
    reasons,
  };
}

function evidenceSource(
  photo: ClientReportPhoto,
  images: Record<string, string>,
): string {
  const source = images[photo.key];
  if (!source || !/^data:image\/(jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(source)) {
    throw new Error(`Installation evidence is unavailable for ${photo.label}.`);
  }
  return source;
}

function compactEvidenceGrid(
  photos: ClientReportPhoto[],
  images: Record<string, string>,
): string {
  const columns = photos.length <= 2 ? 2 : 3;
  const rows: string[] = [];
  for (let index = 0; index < photos.length; index += columns) {
    const cells = photos.slice(index, index + columns).map((photo) => (
      `<figure class="evidence-photo"><img src="${evidenceSource(photo, images)}" alt="${escapeHtml(photo.label)}"/><figcaption>${escapeHtml(photo.label)}</figcaption></figure>`
    ));
    while (cells.length < columns) cells.push('<figure class="evidence-photo evidence-empty"></figure>');
    rows.push(`<div class="evidence-row">${cells.join('')}</div>`);
  }
  return `<div class="evidence-grid evidence-cols-${columns}">${rows.join('')}</div>`;
}

function installationEvidenceHtml(
  photos: ClientReportPhoto[],
  images: Record<string, string>,
): string {
  if (!photos.length) {
    return '<section class="report-section"><h2>Photographic evidence</h2><p>No zone, switchboard, meter, or site-asset evidence was recorded.</p></section>';
  }
  let content = '';
  let compact: ClientReportPhoto[] = [];
  const flushCompact = () => {
    if (!compact.length) return;
    content += compactEvidenceGrid(compact, images);
    compact = [];
  };
  for (const photo of photos) {
    if (photo.largeInPdf) {
      flushCompact();
      content += `<figure class="evidence-large"><img src="${evidenceSource(photo, images)}" alt="${escapeHtml(photo.label)}"/><figcaption>${escapeHtml(photo.label)}</figcaption></figure>`;
    } else compact.push(photo);
  }
  flushCompact();
  return `<section class="report-section evidence-section"><h2>Photographic evidence</h2><p>${photos.length} zone, switchboard, meter and site-asset photo${photos.length === 1 ? '' : 's'}.</p>${content}</section>`;
}

export function buildInstallationSummaryHtml(input: {
  tree: InstallationBackupTree;
  completedForms: FormSubmission[];
  detailMode: InstallationReportDetailMode;
  brandLogoDataUri: string;
  evidencePhotos?: ClientReportPhoto[];
  evidenceImages?: Record<string, string>;
}): string {
  const { tree, completedForms, detailMode } = input;
  const { installation } = tree;
  const electricalModel = installationReportModel(tree);
  const electricalMap = buildElectricalMapReportHtml(
    electricalModel,
    detailMode,
  );
  const completionNotesSection = buildCompletionNotesSummaryHtml(
    installation.status === 'Completed' ? installation.completion_notes : null,
  );
  const evidenceSection = input.evidenceImages
    ? installationEvidenceHtml(
        input.evidencePhotos ?? installationEntityEvidencePhotos(tree),
        input.evidenceImages,
      )
    : '';
  const formRows = completedForms.length
    ? completedForms
        .map(
          (form, index) =>
            `<tr><td>${index + 1}</td><td>${escapeHtml(form.form_type)}</td><td>${escapeHtml(formatDate(form.completed_at || form.updated_at))}</td><td>${form.attachments.length}</td></tr>`,
        )
        .join('')
    : '<tr><td colspan="4">No completed form appendices selected.</td></tr>';
  const generatedAt = new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4 portrait; margin: 17mm 14mm 16mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { margin: 0; color: ${theme.body}; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; font-size: 9pt; line-height: 1.45; }
    .cover { background: ${theme.cover}; border-top: 5px solid ${theme.coverAccent}; border-radius: 8px; padding: 21px 23px; margin-bottom: 18px; }
    .eyebrow { color: #BFDBFE; font-size: 7.5pt; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
    h1 { color: ${theme.white}; font-size: 21pt; margin: 7px 0 14px; }
    .logo { width: 172px; background: white; border-radius: 6px; padding: 6px 10px; }
    .meta { display: table; width: 100%; margin-top: 14px; border-collapse: collapse; }
    .meta-row { display: table-row; }
    .meta-cell { display: table-cell; width: 50%; padding: 8px 11px; background: white; border: 1px solid #BFDBFE; }
    .meta-label { color: ${theme.slate}; font-size: 6.8pt; font-weight: 800; text-transform: uppercase; letter-spacing: .07em; }
    .meta-value { color: ${theme.ink}; font-size: 9pt; font-weight: 650; margin-top: 2px; }
    .stats { display: table; width: 100%; table-layout: fixed; border-spacing: 7px; margin: 0 -7px 15px; }
    .stat { display: table-cell; text-align: center; background: ${theme.surfaceMuted}; border: 1px solid ${theme.border}; border-radius: 6px; padding: 9px; }
    .stat-value { color: ${theme.navy}; font-size: 16pt; font-weight: 900; }
    .stat-label { color: ${theme.slate}; font-size: 7pt; font-weight: 800; text-transform: uppercase; }
    h2 { margin: 14px 0 0; padding: 7px 11px; background: ${theme.navy}; color: white; font-size: 8.5pt; letter-spacing: .08em; text-transform: uppercase; break-after: avoid; }
    h3 { color: ${theme.navy}; margin: 12px 0 6px; break-after: avoid; }
    .completion-notes { break-inside: avoid; margin-bottom: 15px; }
    .completion-notes p { border: 1px solid ${theme.border}; background: ${theme.surfaceMuted}; margin: 0; padding: 9px 11px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 13px; }
    th, td { border: 1px solid ${theme.border}; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { color: ${theme.slate}; background: ${theme.surfaceMuted}; font-size: 7pt; text-transform: uppercase; letter-spacing: .04em; }
    tr { break-inside: avoid; }
    .evidence-grid { display: table; width: 100%; border-collapse: separate; border-spacing: 7px; table-layout: fixed; }
    .evidence-row { display: table-row; }
    .evidence-photo { display: table-cell; padding: 5px; margin: 0; border: 1px solid #CBD5E1; border-radius: 5px; vertical-align: top; text-align: center; break-inside: avoid; page-break-inside: avoid; }
    .evidence-cols-2 .evidence-photo { width: 50%; }
    .evidence-cols-3 .evidence-photo { width: 33.333%; }
    .evidence-photo img { display: block; width: 100%; height: auto; max-height: 172px; object-fit: contain; }
    .evidence-empty { border-color: transparent; }
    .evidence-large { width: 100%; margin: 8px 0; padding: 5px; border: 1px solid #CBD5E1; border-radius: 5px; text-align: center; break-inside: avoid; page-break-inside: avoid; }
    .evidence-large img { display: block; width: 100%; height: auto; max-height: 370px; object-fit: contain; }
    .evidence-photo figcaption, .evidence-large figcaption { color: ${theme.slate}; font-size: 7.5pt; line-height: 1.35; margin-top: 5px; text-align: left; overflow-wrap: anywhere; white-space: pre-wrap; }
    .forms-index { break-before: page; page-break-before: always; }
    ${ELECTRICAL_MAP_REPORT_CSS}
  </style>
</head>
<body>
  <header class="cover">
    <div class="eyebrow">Field installation record &middot; Field App Complete</div>
    <h1>Installation Pack</h1>
    <img class="logo" src="${input.brandLogoDataUri}" alt="Sustainability Wise" />
    <div class="meta">
      <div class="meta-row">
        <div class="meta-cell"><div class="meta-label">Site</div><div class="meta-value">${escapeHtml(installation.site_name)}</div></div>
        <div class="meta-cell"><div class="meta-label">Client</div><div class="meta-value">${escapeHtml(installation.client_name)}</div></div>
      </div>
      <div class="meta-row">
        <div class="meta-cell"><div class="meta-label">Address</div><div class="meta-value">${escapeHtml(installation.site_address)}</div></div>
        <div class="meta-cell"><div class="meta-label">Installation date</div><div class="meta-value">${escapeHtml(formatDate(installation.audit_date))}</div></div>
      </div>
      <div class="meta-row">
        <div class="meta-cell"><div class="meta-label">Installer</div><div class="meta-value">${escapeHtml(installation.inspector_name)}</div></div>
        <div class="meta-cell"><div class="meta-label">Record</div><div class="meta-value">${escapeHtml(installation.status)}${installation.record_version_number ? ` &middot; Version ${installation.record_version_number}` : ''}</div></div>
      </div>
      <div class="meta-row">
        <div class="meta-cell"><div class="meta-label">Detail grouping</div><div class="meta-value">${escapeHtml(detailModeLabel(detailMode))}</div></div>
        <div class="meta-cell"><div class="meta-label">Generated</div><div class="meta-value">${escapeHtml(generatedAt)}</div></div>
      </div>
    </div>
  </header>
  <div class="stats">
    <div class="stat"><div class="stat-value">${tree.zones.length}</div><div class="stat-label">Zones</div></div>
    <div class="stat"><div class="stat-value">${tree.electricalAssets.length}</div><div class="stat-label">Boards</div></div>
    <div class="stat"><div class="stat-value">${tree.meterDevices.length}</div><div class="stat-label">Devices</div></div>
    <div class="stat"><div class="stat-value">${tree.siteAssets.length}</div><div class="stat-label">Loads</div></div>
    <div class="stat"><div class="stat-value">${completedForms.length}</div><div class="stat-label">Forms</div></div>
  </div>
  ${completionNotesSection}
  ${electricalMap}
  ${evidenceSection}
  <section class="forms-index">
    <h2>Completed form appendices</h2>
    <p>The selected completed forms follow this installation and electrical-map section in the order shown.</p>
    <table><thead><tr><th>#</th><th>Form type</th><th>Completed</th><th>Evidence</th></tr></thead><tbody>${formRows}</tbody></table>
  </section>
</body>
</html>`;
}

async function summaryPdf(input: {
  tree: InstallationBackupTree;
  completedForms: FormSubmission[];
  detailMode: InstallationReportDetailMode;
  brandLogoDataUri: string;
}, qualityTier: number): Promise<File> {
  const evidencePhotos = installationEntityEvidencePhotos(input.tree);
  const evidenceImages = await embedInstallationEvidence(evidencePhotos, qualityTier);
  const html = buildInstallationSummaryHtml({
    ...input,
    evidencePhotos,
    evidenceImages,
  });
  const rendered = new File((await Print.printToFileAsync({
    html,
    width: A4_PRINT_WIDTH,
    height: A4_PRINT_HEIGHT,
  })).uri);
  if (!rendered.exists || (rendered.size ?? 0) < MIN_VALID_PDF_BYTES) {
    throw new Error('The device created an empty installation summary PDF.');
  }
  return rendered;
}

async function embedInstallationEvidence(
  photos: ClientReportPhoto[],
  qualityTier: number,
): Promise<Record<string, string>> {
  const tier = FORM_PDF_TIERS[qualityTier] ?? FORM_PDF_TIERS[0];
  const images: Record<string, string> = {};
  let encodedBytes = 0;
  for (const photo of photos) {
    if (/^https?:\/\//i.test(photo.uri)) {
      throw new RemoteFormEvidenceError(
        'This installation uses cloud evidence. Generate it on the API server to use the original images.',
      );
    }
    const localUri = resolveOwnedMediaUri(photo.uri);
    const original = new File(localUri);
    if (!original.exists) {
      throw new MissingLocalFormEvidenceError(
        `Original evidence is unavailable on this device for ${photo.label}. The photo has been kept unchanged.`,
      );
    }
    const reportedMime = String(original.type ?? '').toLowerCase();
    const extension = original.extension.toLowerCase();
    const originalMime = /^(image\/jpeg|image\/png|image\/webp)$/.test(reportedMime)
      ? reportedMime
      : extension === '.png'
        ? 'image/png'
        : extension === '.webp'
          ? 'image/webp'
          : extension === '.jpg' || extension === '.jpeg'
            ? 'image/jpeg'
            : null;
    let source = original;
    let generated: File | null = null;
    if (qualityTier > 0 || !originalMime) {
      const processed = await manipulateAsync(
        localUri,
        [{ resize: { width: tier.width } }],
        { compress: tier.quality, format: SaveFormat.JPEG },
      );
      generated = new File(processed.uri);
      source = generated;
    }
    const base64 = await source.base64();
    if (generated?.exists) generated.delete();
    encodedBytes += base64.length;
    if (encodedBytes > MAX_PDF_HTML_BYTES) {
      throw new FormPdfGenerationError(
        'The installation evidence is too large to render safely on this device.',
        qualityTier + 1 < FORM_PDF_TIERS.length ? qualityTier + 1 : null,
      );
    }
    images[photo.key] = `data:${generated ? 'image/jpeg' : originalMime};base64,${base64}`;
  }
  return images;
}

export async function createInstallationPackPdf(
  input: InstallationPackReportInput,
  qualityTier = 0,
  onProgress: (message: string) => void = () => {},
): Promise<string> {
  const completedForms = selectInstallationReportForms(
    input.tree,
    input.selectedFormIds,
  );
  onProgress('Rendering electrical map and report details…');
  const summary = await summaryPdf({
    tree: input.tree,
    completedForms,
    detailMode: input.detailMode,
    brandLogoDataUri: await brandLogoDataUri(),
  }, qualityTier);
  const sourceFiles: File[] = [summary];
  for (let index = 0; index < completedForms.length; index += 1) {
    onProgress(`Rendering form ${index + 1} of ${completedForms.length}…`);
    sourceFiles.push(
      new File(await createFormPdf(completedForms[index], qualityTier, {
        stampPageNumbers: false,
      })),
    );
  }

  onProgress('Merging the installation pack…');
  const merged = await PDFDocument.create();
  for (const source of sourceFiles) {
    if (!source.exists || (source.size ?? 0) < MIN_VALID_PDF_BYTES) {
      throw new Error('A report section is missing or incomplete.');
    }
    const document = await PDFDocument.load(await source.base64());
    const pages = await merged.copyPages(document, document.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }

  await stampPdfPageFooters(
    merged,
    'Field App Complete installation pack · Sustainability Wise',
  );
  const bytes = await merged.save({ useObjectStreams: true });
  const directory = new Directory(Paths.cache, 'form-reports');
  directory.create({ idempotent: true, intermediates: true });
  const safeSite = input.tree.installation.site_name
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || 'site';
  const output = new File(
    directory,
    `Field-App-Complete-${safeSite}-${Date.now()}.pdf`,
  );
  output.write(bytes);
  if (!output.exists || (output.size ?? 0) < MIN_VALID_PDF_BYTES) {
    if (output.exists) output.delete();
    throw new Error('The merged installation pack could not be saved.');
  }
  return output.uri;
}

export async function shareInstallationPackPdf(
  input: InstallationPackReportInput,
  qualityTier = 0,
  onProgress: (message: string) => void = () => {},
): Promise<void> {
  const uri = await createInstallationPackPdf(input, qualityTier, onProgress);
  if (!await Sharing.isAvailableAsync()) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: `Share ${input.tree.installation.site_name} installation pack`,
  });
}
