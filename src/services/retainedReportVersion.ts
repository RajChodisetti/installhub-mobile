import { validRecordVersionNumber } from './reportVersioning';

export type RetainedVersionLookup = {
  list: (installationId: string) => Promise<{ versions: { versionNumber: number }[] }>;
  get: (installationId: string, versionNumber: number) => Promise<unknown>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Match all selected forms within one eligible immutable snapshot. Never merge
 * evidence from different versions or accept the job's hash as source proof. */
export async function resolveRetainedReportVersion(
  target: { installationId: string; formIds: string[]; recordVersionNumber?: number },
  lookup: RetainedVersionLookup,
): Promise<{ recordVersionNumber: number; recordVersionPayloadHash: string }> {
  const preferred = validRecordVersionNumber(target.recordVersionNumber);
  if (!preferred) throw new Error('Historical form evidence requires a pinned record version.');
  if (!target.formIds.length || target.formIds.some((id) => !id)) throw new Error('Select completed forms for the retained report.');
  const listed = await lookup.list(target.installationId);
  const candidates = [...new Set([preferred, ...listed.versions
    .map((version) => validRecordVersionNumber(version.versionNumber))
    .filter((version): version is number => version !== undefined)
    .sort((left, right) => right - left)])];
  for (const versionNumber of candidates) {
    try {
      const version = record(await lookup.get(target.installationId, versionNumber));
      const snapshot = record(version?.snapshot);
      const tree = record(snapshot?.installationTree);
      const installation = record(tree?.installation);
      const eligibility = record(record(snapshot?.readiness)?.eligibility);
      if (version?.entityId !== target.installationId || version.versionNumber !== versionNumber
        || snapshot?.snapshotSchema !== 'InstallationCanonicalSnapshotV2'
        || installation?.id !== target.installationId
        || installation.recordVersionNumber !== versionNumber
        || eligibility?.authoritativeReport !== true
        || typeof version.payloadHash !== 'string' || !version.payloadHash
        || snapshot.payloadHash !== version.payloadHash) continue;
      const forms = Array.isArray(tree?.formSubmissions) ? tree.formSubmissions : [];
      const completedIds = new Set(forms.filter((form) => record(form)?.status === 'Completed').map((form) => record(form)?.id));
      if (!target.formIds.every((id) => completedIds.has(id))) continue;
      return {
        recordVersionNumber: versionNumber,
        recordVersionPayloadHash: version.payloadHash,
      };
    } catch {
      // Match portal behavior: a missing retained version does not hide older evidence.
    }
  }
  throw new Error('No retained pinned record version contains every selected completed form.');
}
