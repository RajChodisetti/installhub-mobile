import type { InstallationReportDetailMode } from '../types';

export type ReportVersionSelection =
  | { recordVersionNumber: number; liveMode?: never }
  | { recordVersionNumber?: never; liveMode: true };

export interface ReportJobPin {
  recordVersionNumber?: number | null;
  recordVersionPayloadHash?: string | null;
  reportSource?: 'canonical-version' | 'diagnostic-live' | string | null;
  detailMode?: InstallationReportDetailMode | string | null;
  reportVariantKey?: string | null;
}

export function validRecordVersionNumber(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) && numberValue > 0
    ? numberValue
    : undefined;
}

/** Explicitly selects an immutable version or an unpinned diagnostic. */
export function selectReportVersion(
  value: unknown,
  authoritativeRequired = false,
): ReportVersionSelection {
  const recordVersionNumber = validRecordVersionNumber(value);
  if (recordVersionNumber !== undefined) return { recordVersionNumber };
  if (authoritativeRequired) {
    throw new Error('An authoritative Completed report requires a pinned record version.');
  }
  return { liveMode: true };
}

export function reportVersionCacheToken(selection: ReportVersionSelection): string {
  return selection.recordVersionNumber !== undefined
    ? `record-version:${selection.recordVersionNumber}`
    : 'live-mode';
}

export function formReportVersionQuery(selection: ReportVersionSelection): string {
  return new URLSearchParams(
    selection.recordVersionNumber !== undefined
      ? { recordVersionNumber: String(selection.recordVersionNumber) }
      : { liveMode: 'true' },
  ).toString();
}

export function installationReportVersionFields(
  selection: ReportVersionSelection,
): { recordVersionNumber: number } | { liveMode: true } {
  return selection.recordVersionNumber !== undefined
    ? { recordVersionNumber: selection.recordVersionNumber }
    : { liveMode: true };
}

/** Polling is by job ID, but the echoed immutable job params must still match. */
export function reportJobMatchesSelection(
  job: ReportJobPin,
  selection: ReportVersionSelection,
  expectedPayloadHash?: string | null,
): boolean {
  const versionMatches = selection.recordVersionNumber !== undefined
    ? job.recordVersionNumber === selection.recordVersionNumber
    : job.recordVersionNumber == null;
  const authoritativeHashPresent = selection.recordVersionNumber === undefined ||
    Boolean(job.recordVersionPayloadHash);
  const hashMatches = !expectedPayloadHash ||
    job.recordVersionPayloadHash === expectedPayloadHash;
  const sourceMatches = selection.recordVersionNumber !== undefined
    ? job.reportSource === 'canonical-version'
    : job.reportSource === 'diagnostic-live';
  return versionMatches && authoritativeHashPresent && hashMatches && sourceMatches;
}

/** Installation packs must also preserve their grouping and server variant. */
export function installationReportJobMatchesSelection(
  job: ReportJobPin,
  selection: ReportVersionSelection,
  detailMode: InstallationReportDetailMode,
  expectedPayloadHash?: string | null,
  expectedVariantKey?: string | null,
): boolean {
  const variantPresent =
    typeof job.reportVariantKey === 'string' && job.reportVariantKey.length > 0;
  const variantMatches =
    !expectedVariantKey || job.reportVariantKey === expectedVariantKey;
  return (
    reportJobMatchesSelection(job, selection, expectedPayloadHash) &&
    job.detailMode === detailMode &&
    variantPresent &&
    variantMatches
  );
}
