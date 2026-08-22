import type { FormSubmission, FormValue } from '../types';
import {
  FORM_DEFINITION_BY_TYPE,
  isFieldVisible,
  isSectionVisible,
  type FormFieldDefinition,
} from '../forms/catalog';
import { FORM_REPORT_THEME as theme } from './formReportTheme';

export type EmbeddedFormImage =
  | string
  | {
      uri: string;
      caption?: string;
    };

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function displayValue(value: FormValue | undefined): string {
  if (!value) return 'Not provided';
  if (value === 'yes') return 'Yes';
  if (value === 'no') return 'No';
  if (value === 'not_applicable') return 'Not applicable';
  return String(value);
}

function displayDate(value: FormValue | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return displayValue(value);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  const hasTime = /T\d{2}:\d{2}/.test(raw);
  return new Intl.DateTimeFormat('en-AU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(hasTime
      ? { hour: '2-digit', minute: '2-digit', hour12: false }
      : {}),
  }).format(parsed);
}

function answerHtml(
  value: FormValue | undefined,
  field?: FormFieldDefinition,
): string {
  const display = escapeHtml(
    field && /(^|\.)(date|date_time)$/.test(field.key)
      ? displayDate(value)
      : displayValue(value),
  );
  if (value === 'yes') return `<span class="badge badge-yes">${display}</span>`;
  if (value === 'no') return `<span class="badge badge-no">${display}</span>`;
  if (value === 'not_applicable') {
    return `<span class="badge badge-neutral">${display}</span>`;
  }
  if (!value) return `<span class="not-provided">${display}</span>`;
  return display;
}

function fieldRows(submission: FormSubmission, fields: FormFieldDefinition[]): string {
  return fields
    .filter(
      (field) => field.kind !== 'photo' && isFieldVisible(field, submission.answers),
    )
    .map(
      (field) => `<div class="field-row">
        <div class="field-label">${escapeHtml(field.label)}</div>
        <div class="field-value">${answerHtml(submission.answers[field.key], field)}</div>
      </div>`,
    )
    .join('');
}

function coverValue(submission: FormSubmission, key: string): string {
  return escapeHtml(
    /(^|\.)(date|date_time)$/.test(key)
      ? displayDate(submission.answers[key])
      : displayValue(submission.answers[key]),
  );
}

function coverPrimaryDetails(submission: FormSubmission): {
  label: string;
  value: string;
} {
  if (submission.form_type === 'ace-switchboard') {
    return { label: 'Job', value: coverValue(submission, 'job.name') };
  }
  return {
    label: 'Customer / site',
    value: coverValue(submission, 'site.customer_name'),
  };
}

function photoGrid(images: EmbeddedFormImage[], label: string): string {
  const rows: string[] = [];
  for (let index = 0; index < images.length; index += 2) {
    const cells = images
      .slice(index, index + 2)
      .map((image) => {
        const uri = typeof image === 'string' ? image : image.uri;
        const caption =
          typeof image === 'string' ? '' : String(image.caption ?? '').trim();
        const accessibleLabel = caption || label;
        return `<div class="photo">
          <img src="${escapeHtml(uri)}" alt="${escapeHtml(accessibleLabel)}" />
          ${caption ? `<div class="photo-caption">${escapeHtml(caption)}</div>` : ''}
        </div>`;
      });
    if (cells.length === 1) cells.push('<div class="photo photo-empty"></div>');
    rows.push(`<div class="photo-row">${cells.join('')}</div>`);
  }
  return `<div class="photo-grid">${rows.join('')}</div>`;
}

export function buildFormReportHtml(
  submission: FormSubmission,
  embeddedImages: Record<string, EmbeddedFormImage[]> = {},
  brandLogoDataUri = '',
): string {
  const definition = FORM_DEFINITION_BY_TYPE[submission.form_type];
  const primaryDetails = coverPrimaryDetails(submission);
  const logo = brandLogoDataUri
    ? `<img class="cover-brand-logo" src="${brandLogoDataUri}" alt="Sustainability Wise" />`
    : '<div class="cover-brand-fallback">SUSTAINABILITY <span>WISE</span></div>';
  const sections = definition.sections
    .filter((section) => isSectionVisible(section, submission.answers))
    .map((section, sectionIndex) => {
      const rows = fieldRows(submission, section.fields);
      const photos = section.fields
        .filter(
          (field) => field.kind === 'photo' && isFieldVisible(field, submission.answers),
        )
        .map((field) => {
          const images = embeddedImages[field.key] ?? [];
          return `<div class="photo-block">
            <h3>${escapeHtml(field.label)}</h3>
            ${
              images.length
                ? photoGrid(images, field.label)
                : '<div class="missing">No photo provided</div>'
            }
          </div>`;
        })
        .join('');
      return `<section>
        <div class="section-bar"><span class="section-number">${sectionIndex + 1}</span>${escapeHtml(section.title)}</div>
        ${rows ? `<div class="fields">${rows}</div>` : ''}
        ${photos}
      </section>`;
    })
    .join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    @page { size: A4 portrait; margin: 17mm 14mm 22mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { margin: 0; color: ${theme.body}; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; font-size: 10pt; line-height: 1.45; }

    .cover { background: ${theme.cover}; border-top: 5px solid ${theme.coverAccent}; border-radius: 8px; padding: 20px 22px 18px; margin-bottom: 18px; }
    .cover-eyebrow { color: ${theme.border}; font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .12em; margin-bottom: 7px; }
    .cover-title { color: ${theme.white}; font-size: 18pt; font-weight: 900; line-height: 1.2; margin: 0 0 13px; }
    .cover-brand { margin: 8px 0 13px; }
    .cover-brand-label { color: #BFDBFE; font-size: 7pt; font-weight: 800; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 5px; }
    .cover-brand-logo { display: block; width: 162px; height: auto; background: ${theme.white}; border-radius: 6px; padding: 5px 9px; }
    .cover-brand-fallback { display: inline-block; color: ${theme.ink}; background: ${theme.white}; border-radius: 6px; padding: 8px 10px; font-size: 10pt; font-weight: 900; letter-spacing: .04em; }
    .cover-brand-fallback span { color: #65A30D; }
    .cover-meta { display: table; width: 100%; border-collapse: collapse; overflow: hidden; border-radius: 6px; }
    .cover-meta-row { display: table-row; }
    .cover-meta-cell { display: table-cell; width: 50%; padding: 9px 12px; background: ${theme.white}; border: 1px solid #BFDBFE; vertical-align: top; }
    .cover-meta-label { color: ${theme.slate}; font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 3px; }
    .cover-meta-value { color: ${theme.ink}; font-size: 9.5pt; font-weight: 600; white-space: pre-wrap; }
    .cover-status { display: inline-block; margin-top: 11px; padding: 3px 10px; border: 1px solid; border-radius: 4px; font-size: 7.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
    .cover-status-completed { color: ${theme.successText}; background: ${theme.successBackground}; border-color: ${theme.successBorder}; }
    .cover-status-draft { color: ${theme.warningText}; background: ${theme.warningBackground}; border-color: ${theme.warningBorder}; }

    section { break-inside: auto; page-break-inside: auto; margin: 0 0 14px; }
    .section-bar { background: ${theme.navy}; color: ${theme.white}; font-size: 8.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; padding: 7px 12px; margin-top: 14px; break-after: avoid; page-break-after: avoid; }
    .section-number { display: inline-block; width: 19px; height: 19px; margin-right: 8px; border-radius: 50%; background: rgba(255,255,255,.18); text-align: center; line-height: 19px; letter-spacing: 0; }
    h3 { color: ${theme.navy}; background: ${theme.surface}; border-left: 4px solid ${theme.navy}; font-size: 9.5pt; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; margin: 10px 0 5px; padding: 7px 10px; break-after: avoid; page-break-after: avoid; }
    .fields { display: table; width: 100%; border: 1px solid ${theme.border}; border-top: 0; border-collapse: collapse; }
    .field-row { display: table-row; break-inside: avoid; page-break-inside: avoid; }
    .field-label, .field-value { display: table-cell; border-top: 1px solid ${theme.border}; vertical-align: top; }
    .field-row:first-child .field-label, .field-row:first-child .field-value { border-top: 0; }
    .field-label { width: 40%; padding: 6px 10px 6px 12px; color: ${theme.slate}; background: ${theme.surfaceMuted}; font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; }
    .field-value { width: 60%; padding: 6px 12px; color: ${theme.ink}; font-size: 9pt; white-space: pre-wrap; }
    .not-provided { color: ${theme.muted}; font-style: italic; }
    .badge { display: inline-block; padding: 2px 8px; border: 1px solid; border-radius: 999px; font-size: 7.5pt; font-weight: 800; }
    .badge-yes { color: ${theme.successText}; background: ${theme.successBackground}; border-color: ${theme.successBorder}; }
    .badge-no { color: ${theme.warningText}; background: ${theme.warningBackground}; border-color: ${theme.warningBorder}; }
    .badge-neutral { color: ${theme.neutralText}; background: ${theme.neutralBackground}; border-color: ${theme.neutralBorder}; }

    .photo-block { break-inside: avoid; page-break-inside: avoid; margin-top: 10px; }
    .photo-grid { display: table; width: 100%; border-collapse: separate; border-spacing: 7px; table-layout: fixed; }
    .photo-row { display: table-row; }
    .photo { display: table-cell; width: 50%; min-height: 225px; padding: 5px; border: 1px solid ${theme.border}; border-radius: 6px; text-align: center; vertical-align: top; break-inside: avoid; }
    .photo-empty { border-color: transparent; }
    .photo img { max-width: 100%; max-height: 212px; object-fit: contain; border-radius: 4px; }
    .photo-caption { color: ${theme.slate}; font-size: 7.5pt; line-height: 1.35; margin-top: 5px; overflow-wrap: anywhere; text-align: left; white-space: pre-wrap; }
    .missing { color: ${theme.muted}; font-size: 8.5pt; font-style: italic; border: 1px dashed ${theme.neutralBorder}; background: ${theme.surfaceMuted}; padding: 10px 12px; }
    .page-header { position: fixed; top: -12mm; left: 0; right: 0; height: 8mm; display: table; width: 100%; border-bottom: 1px solid ${theme.borderStrong}; color: ${theme.navy}; font-size: 7pt; }
    .page-header-brand, .page-header-title { display: table-cell; vertical-align: middle; }
    .page-header-brand { width: 42%; font-weight: 900; letter-spacing: .08em; }
    .page-header-title { text-align: right; color: ${theme.slate}; }
    .document-footer { color: ${theme.muted}; font-size: 7pt; text-align: center; border-top: 1.5px solid ${theme.borderStrong}; padding-top: 8px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="page-header">
    <div class="page-header-brand">SUSTAINABILITY WISE</div>
    <div class="page-header-title">${escapeHtml(definition.shortTitle)} &middot; ${coverValue(submission, 'site.date_time')}</div>
  </div>
  <header class="cover">
    <div class="cover-eyebrow">Field installation record &middot; Field App Complete</div>
    <h1 class="cover-title">${escapeHtml(definition.title)}</h1>
    <div class="cover-brand">
      <div class="cover-brand-label">Prepared by</div>
      ${logo}
    </div>
    <div class="cover-meta">
      <div class="cover-meta-row">
        <div class="cover-meta-cell"><div class="cover-meta-label">${primaryDetails.label}</div><div class="cover-meta-value">${primaryDetails.value}</div></div>
        <div class="cover-meta-cell"><div class="cover-meta-label">Date and time</div><div class="cover-meta-value">${coverValue(submission, 'site.date_time')}</div></div>
      </div>
      <div class="cover-meta-row">
        <div class="cover-meta-cell"><div class="cover-meta-label">Installer</div><div class="cover-meta-value">${coverValue(submission, 'installer.name')}</div></div>
        <div class="cover-meta-cell"><div class="cover-meta-label">Submission ID</div><div class="cover-meta-value">${escapeHtml(submission.id)}</div></div>
      </div>
    </div>
    <div class="cover-status ${submission.status === 'Completed' ? 'cover-status-completed' : 'cover-status-draft'}">${escapeHtml(submission.status)}</div>
  </header>
  ${sections}
  <div class="document-footer">Prepared by Sustainability Wise &middot; Field App Complete field record &middot; Schema v${submission.schema_version}${submission.supersedes_id ? ` &middot; Amendment of ${escapeHtml(submission.supersedes_id)}` : ''}</div>
</body>
</html>`;
}
