import type {
  ElectricalAsset,
  Installation,
  Meter,
  SiteAsset,
  User,
  Zone,
} from '../types';
import { createId, nowIso } from '../utils';
import { getStore, initStore, persistStore, resetStore, updateStore } from '../data/seed';

export interface InstallationsRepository {
  list(): Promise<Installation[]>;
  getById(id: string): Promise<Installation | null>;
  create(input: Omit<Installation, 'id' | 'created_at' | 'updated_at' | 'status'> & { status?: Installation['status'] }): Promise<Installation>;
  update(id: string, patch: Partial<Installation>): Promise<Installation>;
  remove(id: string): Promise<void>;
}

export interface ZonesRepository {
  listByInstallation(auditId: string): Promise<Zone[]>;
  getById(id: string): Promise<Zone | null>;
  create(input: Omit<Zone, 'id' | 'created_at' | 'updated_at' | 'photos'> & { photos?: string[] }): Promise<Zone>;
  update(id: string, patch: Partial<Zone>): Promise<Zone>;
  remove(id: string): Promise<void>;
}

export interface ElectricalAssetsRepository {
  listByZone(zoneId: string): Promise<ElectricalAsset[]>;
  listByInstallation(auditId: string): Promise<ElectricalAsset[]>;
  getById(id: string): Promise<ElectricalAsset | null>;
  create(input: Omit<ElectricalAsset, 'id' | 'created_at' | 'updated_at' | 'meters' | 'extra_photos' | 'meter_present'> & {
    meters?: Meter[];
    extra_photos?: string[];
    meter_present?: boolean;
  }): Promise<ElectricalAsset>;
  update(id: string, patch: Partial<ElectricalAsset>): Promise<ElectricalAsset>;
  remove(id: string): Promise<void>;
}

export interface SiteAssetsRepository {
  listByZone(zoneId: string): Promise<SiteAsset[]>;
  listByInstallation(auditId: string): Promise<SiteAsset[]>;
  getById(id: string): Promise<SiteAsset | null>;
  create(input: Omit<SiteAsset, 'id' | 'created_at' | 'updated_at' | 'extra_photos' | 'meter_channels' | 'meter_present'> & {
    extra_photos?: string[];
    meter_channels?: SiteAsset['meter_channels'];
    meter_present?: boolean;
  }): Promise<SiteAsset>;
  update(id: string, patch: Partial<SiteAsset>): Promise<SiteAsset>;
  remove(id: string): Promise<void>;
}

export interface UserRepository {
  getCurrent(): Promise<User>;
  updateProfile(patch: Partial<User>): Promise<User>;
}

export const installationsRepo: InstallationsRepository = {
  async list() {
    await initStore();
    return [...getStore().installations].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  },
  async getById(id) {
    await initStore();
    return getStore().installations.find((i) => i.id === id) ?? null;
  },
  async create(input) {
    const record: Installation = {
      ...input,
      id: createId('inst'),
      status: input.status ?? 'Draft',
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    await updateStore((s) => {
      s.installations.unshift(record);
    });
    return record;
  },
  async update(id, patch) {
    let updated: Installation | null = null;
    await updateStore((s) => {
      const idx = s.installations.findIndex((i) => i.id === id);
      if (idx < 0) throw new Error('Installation not found');
      updated = { ...s.installations[idx], ...patch, id, updated_at: nowIso() };
      s.installations[idx] = updated;
    });
    return updated!;
  },
  async remove(id) {
    await updateStore((s) => {
      s.installations = s.installations.filter((i) => i.id !== id);
      s.zones = s.zones.filter((z) => z.audit_id !== id);
      s.electricalAssets = s.electricalAssets.filter((e) => e.audit_id !== id);
      s.siteAssets = s.siteAssets.filter((a) => a.audit_id !== id);
    });
  },
};

export const zonesRepo: ZonesRepository = {
  async listByInstallation(auditId) {
    await initStore();
    return getStore().zones.filter((z) => z.audit_id === auditId);
  },
  async getById(id) {
    await initStore();
    return getStore().zones.find((z) => z.id === id) ?? null;
  },
  async create(input) {
    const record: Zone = {
      ...input,
      photos: input.photos ?? [],
      id: createId('zone'),
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    await updateStore((s) => {
      s.zones.push(record);
    });
    return record;
  },
  async update(id, patch) {
    let updated: Zone | null = null;
    await updateStore((s) => {
      const idx = s.zones.findIndex((z) => z.id === id);
      if (idx < 0) throw new Error('Zone not found');
      updated = { ...s.zones[idx], ...patch, id, updated_at: nowIso() };
      s.zones[idx] = updated;
    });
    return updated!;
  },
  async remove(id) {
    await updateStore((s) => {
      s.zones = s.zones.filter((z) => z.id !== id);
      s.electricalAssets = s.electricalAssets.filter((e) => e.zone_id !== id);
      s.siteAssets = s.siteAssets.filter((a) => a.zone_id !== id);
    });
  },
};

export const electricalAssetsRepo: ElectricalAssetsRepository = {
  async listByZone(zoneId) {
    await initStore();
    return getStore().electricalAssets.filter((e) => e.zone_id === zoneId);
  },
  async listByInstallation(auditId) {
    await initStore();
    return getStore().electricalAssets.filter((e) => e.audit_id === auditId);
  },
  async getById(id) {
    await initStore();
    return getStore().electricalAssets.find((e) => e.id === id) ?? null;
  },
  async create(input) {
    const record: ElectricalAsset = {
      ...input,
      meters: input.meters ?? [],
      extra_photos: input.extra_photos ?? [],
      meter_present: input.meter_present ?? (input.meters?.length ?? 0) > 0,
      id: createId('board'),
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    await updateStore((s) => {
      s.electricalAssets.push(record);
    });
    return record;
  },
  async update(id, patch) {
    let updated: ElectricalAsset | null = null;
    await updateStore((s) => {
      const idx = s.electricalAssets.findIndex((e) => e.id === id);
      if (idx < 0) throw new Error('Electrical asset not found');
      updated = {
        ...s.electricalAssets[idx],
        ...patch,
        id,
        updated_at: nowIso(),
      };
      if (patch.meters) {
        updated.meter_present = patch.meters.length > 0;
      }
      s.electricalAssets[idx] = updated;
    });
    return updated!;
  },
  async remove(id) {
    await updateStore((s) => {
      s.electricalAssets = s.electricalAssets.filter((e) => e.id !== id);
    });
  },
};

export const siteAssetsRepo: SiteAssetsRepository = {
  async listByZone(zoneId) {
    await initStore();
    return getStore().siteAssets.filter((a) => a.zone_id === zoneId);
  },
  async listByInstallation(auditId) {
    await initStore();
    return getStore().siteAssets.filter((a) => a.audit_id === auditId);
  },
  async getById(id) {
    await initStore();
    return getStore().siteAssets.find((a) => a.id === id) ?? null;
  },
  async create(input) {
    const record: SiteAsset = {
      ...input,
      extra_photos: input.extra_photos ?? [],
      meter_channels: input.meter_channels ?? [],
      meter_present: input.meter_present ?? false,
      id: createId('site'),
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    await updateStore((s) => {
      s.siteAssets.push(record);
    });
    return record;
  },
  async update(id, patch) {
    let updated: SiteAsset | null = null;
    await updateStore((s) => {
      const idx = s.siteAssets.findIndex((a) => a.id === id);
      if (idx < 0) throw new Error('Site asset not found');
      updated = { ...s.siteAssets[idx], ...patch, id, updated_at: nowIso() };
      s.siteAssets[idx] = updated;
    });
    return updated!;
  },
  async remove(id) {
    await updateStore((s) => {
      s.siteAssets = s.siteAssets.filter((a) => a.id !== id);
    });
  },
};

export const userRepo: UserRepository = {
  async getCurrent() {
    await initStore();
    return getStore().user;
  },
  async updateProfile(patch) {
    let updated: User | null = null;
    await updateStore((s) => {
      updated = { ...s.user, ...patch, id: s.user.id };
      s.user = updated;
    });
    return updated!;
  },
};

export async function resetDemoData() {
  await resetStore();
  await persistStore();
}

/**
 * Swap point for production API:
 * export const installationsRepo = new ApiInstallationsRepository(apiClient);
 */
