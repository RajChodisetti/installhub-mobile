/** Process-local exclusive lease, checked again by repository/worker commits. */
const recovering = new Map<string, symbol>();
export function anyInstallationRecoveryIsActive(): boolean { return recovering.size > 0; }
export function installationRecoveryIsActive(id: string): boolean { return recovering.has(id); }
export function assertInstallationNotRecovering(id: string): void {
  if (recovering.has(id)) throw new Error('This installation is being recovered. Wait for recovery to finish.');
}
export function acquireInstallationRecovery(id: string): { assertCurrent(): void; release(): void } {
  assertInstallationNotRecovering(id);
  const token = Symbol(id); recovering.set(id, token);
  return {
    assertCurrent() { if (recovering.get(id) !== token) throw new Error('Recovery operation is no longer current.'); },
    release() { if (recovering.get(id) === token) recovering.delete(id); },
  };
}
