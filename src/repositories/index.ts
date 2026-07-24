import type {
  ElectricalAsset,
  FormSubmission,
  FormType,
  Installation,
  Meter,
  SiteAsset,
  User,
  Zone,
} from '../types';
import { createId, nowIso } from '../utils';
import { getStore, initStore, persistStore, resetStore, updateStore } from '../data/seed';
import { FORM_DEFINITION_BY_TYPE } from '../forms/catalog';
import {
  applyLocalDeletionPlan,
  planLocalDeletion,
  type LocalDeletionTarget,
} from './deletionIntegrity';

export * from './cloudSyncRepository';
export * from './deletionIntegrity';
export * from './remoteInstallationsRepository';

export interface InstallationsRepository {
  list(): Promise<Installation[]>;
  getById(id: string): Promise<Installation | null>;
  create(input: Omit<
    Installation,
    | 'id'
    | 'created_at'
    | 'updated_at'
    | 'status'
    | 'cloud_backup_enabled'
    | 'cloud_backup_retained'
    | 'is_imported_copy'
    | 'import_source_server_id'
    | 'copy_index'
    | 'thumbnail_status'
    | 'thumbnail_total'
    | 'thumbnail_ready'
  > & { status?: Installation['status']; cloud_backup_enabled?: boolean }): Promise<Installation>;
  update(id: string, patch: Partial<Installation>): Promise<Installation>;
  remove(id: string): Promise<void>;
  setCloudBackupEnabled(id: string, enabled: boolean): Promise<Installation>;
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

export interface FormsRepository {
  listByInstallation(installationId: string): Promise<FormSubmission[]>;
  getById(id: string): Promise<FormSubmission | null>;
  create(input: {
    form_type: FormType;
    schema_version: number;
    installation_id: string;
    zone_id?: string;
    board_id?: string;
    meter_id?: string;
    site_asset_id?: string;
    answers?: FormSubmission['answers'];
  }): Promise<FormSubmission>;
  updateDraft(
    id: string,
    patch: Pick<FormSubmission, 'answers' | 'attachments'>,
  ): Promise<FormSubmission>;
  complete(id: string): Promise<FormSubmission>;
  cloneAmendment(id: string): Promise<FormSubmission>;
  removeDraft(id: string): Promise<void>;
}

async function removeLocalTreeTarget(target: LocalDeletionTarget): Promise<void> {
  await initStore();
  const currentPlan = planLocalDeletion(getStore(), target);
  if (!currentPlan) return;
  if (
    target.kind === 'form_draft' &&
    currentPlan.formIds.some((id) => id !== target.id)
  ) {
    throw new Error(
      'This draft cannot be deleted while a later amendment refers to it.',
    );
  }

  let effects: ReturnType<typeof applyLocalDeletionPlan> | null = null;
  await updateStore((store) => {
    const plan = planLocalDeletion(store, target);
    if (!plan) return;
    effects = applyLocalDeletionPlan(store, plan, nowIso());
  });
  if (!effects) return;
  const { cleanupDeletedTreeStorage } = await import(
    '../services/deletionStorageCleanup'
  );
  cleanupDeletedTreeStorage(effects);
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
      cloud_backup_enabled: input.cloud_backup_enabled ?? false,
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
    await removeLocalTreeTarget({ kind: 'installation', id });
  },
  async setCloudBackupEnabled(id, enabled) {
    return this.update(id, {
      cloud_backup_enabled: enabled,
      ...(enabled ? { cloud_backup_retained: false } : {}),
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
    await removeLocalTreeTarget({ kind: 'zone', id });
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
    await removeLocalTreeTarget({ kind: 'electrical_asset', id });
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
    await removeLocalTreeTarget({ kind: 'site_asset', id });
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

export const formsRepo: FormsRepository = {
  async listByInstallation(installationId) {
    await initStore();
    return getStore()
      .formSubmissions.filter((form) => form.installation_id === installationId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  },
  async getById(id) {
    await initStore();
    return getStore().formSubmissions.find((form) => form.id === id) ?? null;
  },
  async create(input) {
    const timestamp = nowIso();
    const record: FormSubmission = {
      id: createId('form'),
      form_type: input.form_type,
      schema_version: input.schema_version,
      status: 'Draft',
      installation_id: input.installation_id,
      zone_id: input.zone_id,
      board_id: input.board_id,
      meter_id: input.meter_id,
      site_asset_id: input.site_asset_id,
      answers: input.answers ?? {},
      attachments: [],
      created_at: timestamp,
      updated_at: timestamp,
    };
    await updateStore((store) => {
      store.formSubmissions.unshift(record);
    });
    return record;
  },
  async updateDraft(id, patch) {
    let updated: FormSubmission | null = null;
    await updateStore((store) => {
      const index = store.formSubmissions.findIndex((form) => form.id === id);
      if (index < 0) throw new Error('Form submission not found');
      if (store.formSubmissions[index].status === 'Completed') {
        throw new Error('Completed forms are read-only. Create an amendment instead.');
      }
      updated = {
        ...store.formSubmissions[index],
        ...patch,
        id,
        import_source_server_id: undefined,
        updated_at: nowIso(),
      };
      store.formSubmissions[index] = updated;
    });
    return updated!;
  },
  async complete(id) {
    let updated: FormSubmission | null = null;
    await updateStore((store) => {
      const index = store.formSubmissions.findIndex((form) => form.id === id);
      if (index < 0) throw new Error('Form submission not found');
      const timestamp = nowIso();
      updated = {
        ...store.formSubmissions[index],
        status: 'Completed',
        completed_at: timestamp,
        updated_at: timestamp,
      };
      store.formSubmissions[index] = updated;
    });
    return updated!;
  },
  async cloneAmendment(id) {
    const original = await this.getById(id);
    if (!original) throw new Error('Form submission not found');
    const timestamp = nowIso();
    const clone: FormSubmission = {
      ...original,
      id: createId('form'),
      import_source_server_id: undefined,
      schema_version: FORM_DEFINITION_BY_TYPE[original.form_type].schemaVersion,
      status: 'Draft',
      attachments: original.attachments.map((item) => ({ ...item })),
      created_at: timestamp,
      updated_at: timestamp,
      completed_at: undefined,
      supersedes_id: original.id,
    };
    await updateStore((store) => {
      store.formSubmissions.unshift(clone);
    });
    return clone;
  },
  async removeDraft(id) {
    const form = await this.getById(id);
    if (form?.status === 'Completed') {
      throw new Error('Completed forms cannot be deleted');
    }
    await removeLocalTreeTarget({ kind: 'form_draft', id });
  },
};

export async function resetDemoData() {
  await initStore();
  const forms = [...getStore().formSubmissions];
  await resetStore();
  await persistStore();
  const { deleteFormsLocalFiles } = await import(
    '../services/formStorageCleanup'
  );
  deleteFormsLocalFiles(forms);
}

/**
 * Swap point for production API:
 * export const installationsRepo = new ApiInstallationsRepository(apiClient);
 */
