import type { InstallationPackServerTarget } from './installationPackTarget';
import { resolveRetainedReportVersion, type RetainedVersionLookup } from './retainedReportVersion';

/** Targets have already passed the local/imported-copy identity boundary. Keep
 * those identities and require one eligible version containing the entire pack. */
export async function resolveHistoricalInstallationPackServerTarget(
  target: InstallationPackServerTarget,
  lookup: RetainedVersionLookup,
): Promise<InstallationPackServerTarget> {
  if (target.liveMode) return target;
  const pinned = await resolveRetainedReportVersion({
    installationId: target.installationId,
    formIds: target.formSubmissionIds,
    recordVersionNumber: target.recordVersionNumber,
  }, lookup);
  return { ...target, ...pinned };
}
