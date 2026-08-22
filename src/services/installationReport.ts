import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { PDFDocument } from 'pdf-lib';
import type {
  ElectricalAsset,
  FormSubmission,
  Installation,
  SiteAsset,
  Zone,
} from '../types';
import { createFormPdf } from './formReport';
import { FORM_REPORT_THEME as theme } from './formReportTheme';
import { buildCompletionNotesSummaryHtml } from './installationReportNotes';

const MIN_VALID_PDF_BYTES = 5 * 1024;

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

async function brandLogoDataUri(): Promise<string> {
  const [asset] = await Asset.loadAsync(
    require('../../assets/brand/sustainability-wise-logo-pdf.png'),
  );
  const file = new File(asset.localUri ?? asset.uri);
  return `data:image/png;base64,${await file.base64()}`;
}

export function buildInstallationSummaryHtml(input: {
  installation: Installation;
  zones: Zone[];
  boards: ElectricalAsset[];
  siteAssets: SiteAsset[];
  completedForms: FormSubmission[];
  brandLogoDataUri: string;
}): string {
  const { installation, zones, boards, siteAssets, completedForms } = input;
  const meters = boards.flatMap((board) =>
    board.meters.map((meter) => ({ board, meter })),
  );
  const completionNotesSection = buildCompletionNotesSummaryHtml(
    installation.status === 'Completed' ? installation.completion_notes : null,
  );
  const rows = (
    values: string[],
    empty: string,
    columns: number,
  ) => values.join('') || `<tr><td colspan="${columns}">${escapeHtml(empty)}</td></tr>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4 portrait; margin: 17mm 14mm 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: ${theme.body}; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; font-size: 9pt; line-height: 1.45; }
    .page-header { position: fixed; top: -12mm; left: 0; right: 0; height: 8mm; display: table; width: 100%; border-bottom: 1px solid ${theme.borderStrong}; color: ${theme.navy}; font-size: 7pt; }
    .page-header > div { display: table-cell; vertical-align: middle; }
    .page-header .right { text-align: right; color: ${theme.slate}; }
    .page-footer { position: fixed; bottom: -11mm; left: 0; right: 0; border-top: 1px solid ${theme.borderStrong}; padding-top: 4px; color: ${theme.muted}; font-size: 7pt; text-align: center; }
    .page-number::after { content: counter(page); }
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
    .completion-notes { break-inside: avoid; margin-bottom: 15px; }
    .completion-notes p { border: 1px solid ${theme.border}; background: ${theme.surfaceMuted}; margin: 0; padding: 9px 11px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 13px; }
    th, td { border: 1px solid ${theme.border}; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { color: ${theme.slate}; background: ${theme.surfaceMuted}; font-size: 7pt; text-transform: uppercase; letter-spacing: .04em; }
    tr { break-inside: avoid; }
  </style>
</head>
<body>
  <div class="page-header"><div><strong>SUSTAINABILITY WISE</strong></div><div class="right">Field App Complete &middot; Installation Pack</div></div>
  <div class="page-footer">Field App Complete installation pack &middot; Page <span class="page-number"></span></div>
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
        <div class="meta-cell"><div class="meta-label">Status</div><div class="meta-value">${escapeHtml(installation.status)}</div></div>
      </div>
    </div>
  </header>
  <div class="stats">
    <div class="stat"><div class="stat-value">${zones.length}</div><div class="stat-label">Zones</div></div>
    <div class="stat"><div class="stat-value">${boards.length}</div><div class="stat-label">Boards</div></div>
    <div class="stat"><div class="stat-value">${meters.length}</div><div class="stat-label">Meters</div></div>
    <div class="stat"><div class="stat-value">${completedForms.length}</div><div class="stat-label">Forms</div></div>
  </div>
  ${completionNotesSection}
  <h2>Zones</h2>
  <table><thead><tr><th>Name</th><th>Description</th></tr></thead><tbody>${rows(
    zones.map((zone) => `<tr><td>${escapeHtml(zone.zone_name)}</td><td>${escapeHtml(zone.zone_description)}</td></tr>`),
    'No zones recorded',
    2,
  )}</tbody></table>
  <h2>Electrical boards</h2>
  <table><thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Meters</th></tr></thead><tbody>${rows(
    boards.map((board) => `<tr><td>${escapeHtml(board.display_code)}</td><td>${escapeHtml(board.asset_name)}</td><td>${escapeHtml(board.asset_type)}</td><td>${board.meters.length}</td></tr>`),
    'No electrical boards recorded',
    4,
  )}</tbody></table>
  <h2>Wattwatcher registry</h2>
  <table><thead><tr><th>Board</th><th>Device</th><th>Type</th><th>ID / Serial</th></tr></thead><tbody>${rows(
    meters.map(({ board, meter }) => `<tr><td>${escapeHtml(board.display_code)}</td><td>${escapeHtml(meter.device_name)}</td><td>${escapeHtml(meter.device_type)}</td><td>${escapeHtml(meter.device_id)}</td></tr>`),
    'No meters recorded',
    4,
  )}</tbody></table>
  <h2>Site assets</h2>
  <table><thead><tr><th>Name</th><th>Type</th><th>Metered</th></tr></thead><tbody>${rows(
    siteAssets.map((asset) => `<tr><td>${escapeHtml(asset.asset_name)}</td><td>${escapeHtml(asset.asset_type)}</td><td>${asset.meter_present ? 'Yes' : 'No'}</td></tr>`),
    'No site assets recorded',
    3,
  )}</tbody></table>
  <h2>Completed forms included</h2>
  <table><thead><tr><th>Form type</th><th>Completed</th><th>Submission ID</th></tr></thead><tbody>${rows(
    completedForms.map((form) => `<tr><td>${escapeHtml(form.form_type)}</td><td>${escapeHtml(formatDate(form.completed_at || form.updated_at))}</td><td>${escapeHtml(form.id)}</td></tr>`),
    'No completed forms recorded',
    3,
  )}</tbody></table>
</body>
</html>`;
}

async function summaryPdf(input: Parameters<typeof buildInstallationSummaryHtml>[0]): Promise<File> {
  const html = buildInstallationSummaryHtml(input);
  const rendered = new File((await Print.printToFileAsync({ html })).uri);
  if (!rendered.exists || (rendered.size ?? 0) < MIN_VALID_PDF_BYTES) {
    throw new Error('The device created an empty installation summary PDF.');
  }
  return rendered;
}

export async function createInstallationPackPdf(
  input: Omit<Parameters<typeof buildInstallationSummaryHtml>[0], 'brandLogoDataUri'>,
  qualityTier = 0,
  onProgress: (message: string) => void = () => {},
): Promise<string> {
  onProgress('Preparing installation summary…');
  const summary = await summaryPdf({
    ...input,
    brandLogoDataUri: await brandLogoDataUri(),
  });
  const sourceFiles: File[] = [summary];
  for (let index = 0; index < input.completedForms.length; index += 1) {
    onProgress(`Rendering form ${index + 1} of ${input.completedForms.length}…`);
    sourceFiles.push(
      new File(await createFormPdf(input.completedForms[index], qualityTier)),
    );
  }

  onProgress('Merging installation pack…');
  const merged = await PDFDocument.create();
  for (const source of sourceFiles) {
    if (!source.exists || (source.size ?? 0) < MIN_VALID_PDF_BYTES) {
      throw new Error('A form PDF is missing or incomplete.');
    }
    const document = await PDFDocument.load(await source.base64());
    const pages = await merged.copyPages(document, document.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }

  const bytes = await merged.save({ useObjectStreams: true });
  const directory = new Directory(Paths.cache, 'form-reports');
  directory.create({ idempotent: true, intermediates: true });
  const safeSite = input.installation.site_name
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
  input: Omit<Parameters<typeof buildInstallationSummaryHtml>[0], 'brandLogoDataUri'>,
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
    dialogTitle: `Share ${input.installation.site_name} installation pack`,
  });
}
