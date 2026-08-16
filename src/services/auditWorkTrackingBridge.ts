interface AuditWorkTrackingRuntime {
  suspendInstallation(installationId: string): Promise<void>;
  resumeInstallation(installationId: string): Promise<void>;
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

export function suspendAuditWorkForInstallation(installationId: string): Promise<void> {
  return runtime?.suspendInstallation(installationId) ?? Promise.resolve();
}

export function resumeAuditWorkForInstallation(installationId: string): Promise<void> {
  return runtime?.resumeInstallation(installationId) ?? Promise.resolve();
}

export function closeAuditWorkBeforeLogout(): Promise<void> {
  return runtime?.closeBeforeLogout() ?? Promise.resolve();
}
