export interface CloudVersionInspection {
  siteName: string;
  zones: number;
  boards: number;
  siteAssets: number;
  forms: number;
  reportEligibility: string;
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

/** Canonical versions wrap the tree; pre-canonical records stored the tree directly. */
export function inspectCloudVersion(snapshot: unknown): CloudVersionInspection {
  const record = object(snapshot);
  const tree = object(record?.installationTree) ?? record;
  if (!tree || !object(tree.installation)) throw new Error('This saved version has an unsupported snapshot shape.');
  const installation = object(tree.installation)!;
  const count = (key: string) => Array.isArray(tree[key]) ? (tree[key] as unknown[]).length : 0;
  const readiness = object(record?.readiness);
  const eligible = object(readiness?.eligibility)?.authoritativeReport;
  return {
    siteName: String(installation.siteName ?? installation.site_name ?? 'Site unavailable'),
    zones: count('zones'), boards: count('electricalAssets'), siteAssets: count('siteAssets'), forms: count('formSubmissions'),
    reportEligibility: eligible === true ? 'Authoritative' : eligible === false ? 'Diagnostic only' : 'Not recorded in this legacy version',
  };
}
