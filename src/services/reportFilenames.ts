import { FORM_DEFINITION_BY_TYPE } from '../forms/catalog';
import type { FormSubmission } from '../types';

function safeFilenameSegment(value: string, maxLength: number): string {
  return value
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength) || 'form';
}

export function formPdfFilename(submission: FormSubmission): string {
  const definition = FORM_DEFINITION_BY_TYPE[submission.form_type];
  const site = String(submission.answers['site.customer_name'] ?? 'site');
  const date = String(
    submission.answers['site.date_time'] ?? submission.updated_at,
  ).slice(0, 10);
  const formId = safeFilenameSegment(submission.id, 48);
  return [
    safeFilenameSegment(definition.shortTitle, 48),
    safeFilenameSegment(site, 60),
    safeFilenameSegment(date, 16),
    formId,
  ].join('-') + '.pdf';
}
