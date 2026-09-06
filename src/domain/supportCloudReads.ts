import type { InstallationAccess, InventoryMeter, ManagedCloudUser } from '../api/apiClient';

type InventoryResult = { data: InventoryMeter[]; total: number; truncated: boolean };
type InventoryApi = {
  getInventoryAccess(): Promise<{ userId: string; isMaintainer: boolean }>;
  listInventoryMeters(scope: 'mine' | 'company', q?: string): Promise<InventoryResult>;
  listUsers(): Promise<{ data: ManagedCloudUser[] }>;
};

/** The independent maintainer grant must never require the admin user directory. */
export async function loadInventoryView(input: { scope: 'mine' | 'company'; search: string; role?: string }, api: InventoryApi) {
  const access = await api.getInventoryAccess();
  const scope = input.scope === 'company' && !access.isMaintainer ? 'mine' : input.scope;
  const [inventory, summary, directory] = await Promise.all([
    api.listInventoryMeters(scope, input.search.trim()),
    input.search.trim() ? api.listInventoryMeters(scope) : Promise.resolve(null),
    input.role === 'admin' && access.isMaintainer
      ? api.listUsers().catch(() => ({ data: [] as ManagedCloudUser[] }))
      : Promise.resolve({ data: [] as ManagedCloudUser[] }),
  ]);
  return { access, scope, inventory, summary: summary ?? inventory, users: directory.data.filter((user) => user.isActive) };
}

export async function loadInstallationAccessView(
  installationId: string,
  role: string | undefined,
  api: { getInstallationAccess(id: string): Promise<InstallationAccess>; listUsers(): Promise<{ data: ManagedCloudUser[] }> },
) {
  const [access, users] = await Promise.all([
    api.getInstallationAccess(installationId),
    role === 'admin' ? api.listUsers() : Promise.resolve({ data: [] as ManagedCloudUser[] }),
  ]);
  return { access, users: users.data };
}
