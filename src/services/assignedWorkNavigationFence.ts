/** Includes retained stack routes: a covered editor can still hold an unsaved draft. */
export function installationIdsRetainedByNavigation(state: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    const item = value as { routes?: unknown[]; params?: { installationId?: unknown }; state?: unknown };
    if (typeof item.params?.installationId === 'string') ids.add(item.params.installationId);
    item.routes?.forEach(visit);
    visit(item.state);
  };
  visit(state);
  return ids;
}

type NavigationSnapshot = () => unknown;
let currentNavigation: NavigationSnapshot | null = null;

/** Read navigation synchronously again inside the serialized store commit. */
export function registerAssignedWorkNavigationSnapshot(snapshot: NavigationSnapshot): () => void {
  currentNavigation = snapshot;
  return () => { if (currentNavigation === snapshot) currentNavigation = null; };
}

export function assignedWorkTreeReplacementHasNoRetainedScreen(installationId: string): boolean {
  if (!currentNavigation) return false;
  try {
    const state = currentNavigation();
    return Boolean(state) && !installationIdsRetainedByNavigation(state).has(installationId);
  } catch {
    return false;
  }
}
