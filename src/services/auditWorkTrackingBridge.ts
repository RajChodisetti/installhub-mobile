import type {
  AuditWorkResumeAuthority,
  AuditWorkSuspensionReason,
  AuditWorkSuspensionToken,
} from './auditWorkTrackingResume';

interface AuditWorkTrackingRuntime {
  suspendInstallation(
    installationId: string,
    authority?: AuditWorkResumeAuthority,
    reason?: AuditWorkSuspensionReason,
  ): Promise<AuditWorkSuspensionToken | null>;
  resumeInstallation(
    target: string | AuditWorkSuspensionToken,
    authority?: AuditWorkResumeAuthority,
  ): Promise<boolean>;
  resumeInstallationReasons(
    installationId: string,
    reasons: ReadonlySet<AuditWorkSuspensionReason>,
    authority: AuditWorkResumeAuthority,
  ): Promise<number>;
  closeBeforeLogout(): Promise<void>;
}

let runtime: AuditWorkTrackingRuntime | null = null;

export function registerAuditWorkTrackingRuntime(
  next: AuditWorkTrackingRuntime,
): () => void {
  runtime = next;
  return () => {
    if (runtime === next) runtime = null;
  };
}

export function suspendAuditWorkForInstallation(
  installationId: string,
  authority?: AuditWorkResumeAuthority,
  reason?: AuditWorkSuspensionReason,
): Promise<AuditWorkSuspensionToken | null> {
  return runtime?.suspendInstallation(installationId, authority, reason)
    ?? Promise.resolve(null);
}

export function resumeAuditWorkSuspensionsForInstallationReasons(
  installationId: string,
  reasons: ReadonlySet<AuditWorkSuspensionReason>,
  authority: AuditWorkResumeAuthority,
): Promise<number> {
  return runtime?.resumeInstallationReasons(installationId, reasons, authority)
    ?? Promise.resolve(0);
}

export function resumeAuditWorkForInstallation(
  target: string | AuditWorkSuspensionToken,
  authority?: AuditWorkResumeAuthority,
): Promise<boolean> {
  return runtime?.resumeInstallation(target, authority) ?? Promise.resolve(false);
}

export function closeAuditWorkBeforeLogout(): Promise<void> {
  return runtime?.closeBeforeLogout() ?? Promise.resolve();
}
