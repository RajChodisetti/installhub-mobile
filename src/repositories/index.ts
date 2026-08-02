import type {
  ElectricalAsset,
  FormSubmission,
  FormType,
  GridSupply,
  InstallationReadiness,
  Installation,
  MeasurementAssignment,
  MeterDevice,
  MeteringState,
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
  previewLocalDeletion,
  type LocalDeletionTarget,
} from './deletionIntegrity';
import {
  allAssetMeteringRows,
  boardIsOnAssetSupplyPath,
  boardTypeCode,
  bumpTreeRevision,
  electricalTreeRows,
  installationReadiness,
  nextDisplayCode,
  normalizeCanonicalStore,
  primaryGridSupplyId,
  projectCanonicalCompatibility,
  replaceBoardMetersFromLegacy,
  setAssetMeteringState,
  siteAssetTypeCode,
  type AllAssetMeteringRow,
  type ElectricalTreeRow,
} from '../domain/installationV2';

export * from './cloudSyncRepository';
export * from './deletionIntegrity';
export * from './remoteInstallationsRepository';

export async function getLocalDeletionPreview(target: LocalDeletionTarget) {
  await initStore();
  return previewLocalDeletion(getStore(), target);
}

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
  applyServerState(id: string, patch: Pick<Installation,
    'status' | 'tree_revision' | 'server_tree_revision' | 'record_version_number' | 'completed_at' | 'completed_from_revision' |
    'reopened_at' | 'reopen_reason' | 'backup_conflict' | 'pending_completion' |
    'legacy_completed_unpinned'>): Promise<Installation>;
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
  setMetering(id: string, state: MeteringState, assignments?: MeasurementAssignment[]): Promise<SiteAsset>;
}

export interface CanonicalInstallationRepository {
  readiness(installationId: string): Promise<InstallationReadiness>;
  electricalTree(installationId: string): Promise<ElectricalTreeRow[]>;
  allAssetMetering(installationId: string): Promise<AllAssetMeteringRow[]>;
  meterDevices(installationId: string): Promise<MeterDevice[]>;
  measurementAssignments(installationId: string): Promise<MeasurementAssignment[]>;
  gridSupplies(installationId: string): Promise<GridSupply[]>;
  eligibleMetersForAsset(assetId: string): Promise<MeterDevice[]>;
}

export interface GridSupplyRemovalPreview {
  boards: number;
  siteAssets: number;
  assignments: number;
}

export interface GridSuppliesRepository {
  create(input: Omit<GridSupply, 'id'>): Promise<GridSupply>;
  update(id: string, patch: Partial<Omit<GridSupply, 'id' | 'installationId'>>): Promise<GridSupply>;
  previewRemove(id: string): Promise<GridSupplyRemovalPreview>;
  remove(id: string, convertDependentsToTbc: boolean): Promise<void>;
}

export interface UserRepository {
  getCurrent(): Promise<User>;
  setCurrent(user: User): Promise<User>;
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
  const installation = getStore().installations.find(
    (item) => item.id === currentPlan.installationId,
  );
  if (installation?.status === 'Completed' && target.kind !== 'installation') {
    throw new Error('Reopen this completed installation before deleting or reassigning its records.');
  }
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
    if (!plan.installationIds.length) bumpTreeRevision(store, plan.installationId);
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
    const id = createId('inst');
    const record: Installation = {
      ...input,
      id,
      status: input.status ?? 'Draft',
      cloud_backup_enabled: input.cloud_backup_enabled ?? false,
      tree_schema_version: 2,
      external_key: input.external_key ?? `local:${id}`,
      site_code: input.site_code,
      timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      tree_revision: 0,
      backup_conflict: { kind: 'NONE' },
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
      if (patch.status && patch.status !== s.installations[idx].status) {
        throw new Error('Use the validated Complete or Reopen action to change installation status.');
      }
      const domainKeys: Array<keyof Installation> = [
        'client_name', 'site_name', 'site_address', 'inspector_name', 'audit_date',
        'site_code', 'timezone',
      ];
      if (s.installations[idx].status === 'Completed' && domainKeys.some((key) => key in patch)) {
        throw new Error('Reopen this completed installation before editing it.');
      }
      updated = { ...s.installations[idx], ...patch, id, updated_at: nowIso() };
      s.installations[idx] = updated;
      if (domainKeys.some((key) => key in patch)) bumpTreeRevision(s, id);
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
  async applyServerState(id, patch) {
    let updated: Installation | null = null;
    await updateStore((store) => {
      const index = store.installations.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('Installation not found');
      updated = { ...store.installations[index], ...patch, id };
      store.installations[index] = updated;
    });
    return updated!;
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
      const installation = s.installations.find((item) => item.id === input.audit_id);
      if (installation?.status === 'Completed') throw new Error('Reopen this completed installation before editing it.');
      s.zones.push(record);
      bumpTreeRevision(s, input.audit_id);
    });
    return record;
  },
  async update(id, patch) {
    let updated: Zone | null = null;
    await updateStore((s) => {
      const idx = s.zones.findIndex((z) => z.id === id);
      if (idx < 0) throw new Error('Zone not found');
      const installation = s.installations.find((item) => item.id === s.zones[idx].audit_id);
      if (installation?.status === 'Completed') throw new Error('Reopen this completed installation before editing it.');
      updated = { ...s.zones[idx], ...patch, id, updated_at: nowIso() };
      s.zones[idx] = updated;
      bumpTreeRevision(s, updated.audit_id);
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
    let record: ElectricalAsset | null = null;
    await updateStore((s) => {
      const installation = s.installations.find((item) => item.id === input.audit_id);
      if (!installation) throw new Error('Installation not found');
      if (installation.status === 'Completed') throw new Error('Reopen this completed installation before editing it.');
      const typeCode = input.type_code ?? boardTypeCode(input.asset_type);
      const generated = nextDisplayCode(installation, typeCode);
      const requested = input.display_code?.trim();
      const displayCode = input.display_code_meta ?? {
        ...generated,
        value: requested || generated.value,
        isOverridden: Boolean(requested && requested !== generated.value),
      };
      record = {
        ...input,
        type_code: typeCode,
        display_code_meta: displayCode,
        display_code: displayCode.value,
        electrical_source: input.electrical_source ?? (
          input.electrical_parent_tbc
            ? { kind: 'TBC' }
            : input.electrical_parent_id
              ? { kind: 'BOARD', boardId: input.electrical_parent_id }
              : typeCode === 'MSB'
                ? { kind: 'GRID', gridSupplyId: primaryGridSupplyId(input.audit_id) }
                : { kind: 'TBC' }
        ),
        meters: input.meters ?? [],
        extra_photos: input.extra_photos ?? [],
        meter_present: input.meter_present ?? (input.meters?.length ?? 0) > 0,
        id: createId('board'),
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      s.electricalAssets.push(record);
      if (record.meters.length) replaceBoardMetersFromLegacy(s, record, [...record.meters]);
      bumpTreeRevision(s, input.audit_id);
    });
    return record!;
  },
  async update(id, patch) {
    let updated: ElectricalAsset | null = null;
    await updateStore((s) => {
      const idx = s.electricalAssets.findIndex((e) => e.id === id);
      if (idx < 0) throw new Error('Electrical asset not found');
      const installation = s.installations.find((item) => item.id === s.electricalAssets[idx].audit_id);
      if (installation?.status === 'Completed') throw new Error('Reopen this completed installation before editing it.');
      const previous = s.electricalAssets[idx];
      const typeCode = patch.type_code ?? (patch.asset_type ? boardTypeCode(patch.asset_type) : previous.type_code);
      const displayCodeMeta = patch.display_code_meta ?? (patch.display_code !== undefined
        ? {
            ...(previous.display_code_meta ?? { generatedValue: previous.display_code, ruleVersion: 1 as const, provisional: true }),
            value: patch.display_code.trim(),
            isOverridden: patch.display_code.trim() !== (previous.display_code_meta?.generatedValue ?? previous.display_code),
          }
        : previous.display_code_meta);
      const electricalSource = patch.electrical_source ?? (
        patch.electrical_parent_tbc
          ? { kind: 'TBC' as const }
          : patch.electrical_parent_id
            ? { kind: 'BOARD' as const, boardId: patch.electrical_parent_id }
            : previous.electrical_source
      );
      updated = {
        ...previous,
        ...patch,
        type_code: typeCode,
        display_code_meta: displayCodeMeta,
        electrical_source: electricalSource,
        id,
        updated_at: nowIso(),
      };
      if (patch.meters) {
        updated.meter_present = patch.meters.length > 0;
      }
      s.electricalAssets[idx] = updated;
      if (patch.meters) replaceBoardMetersFromLegacy(s, updated, patch.meters);
      projectCanonicalCompatibility(s, updated.audit_id);
      bumpTreeRevision(s, updated.audit_id);
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
    let record: SiteAsset | null = null;
    await updateStore((s) => {
      const installation = s.installations.find((item) => item.id === input.audit_id);
      if (!installation) throw new Error('Installation not found');
      if (installation.status === 'Completed') throw new Error('Reopen this completed installation before editing it.');
      const typeCode = input.type_code ?? siteAssetTypeCode(input.asset_type);
      const generated = nextDisplayCode(installation, typeCode);
      const requested = input.display_code?.trim();
      const displayCode = input.display_code_meta ?? {
        ...generated,
        value: requested || generated.value,
        isOverridden: Boolean(requested && requested !== generated.value),
      };
      record = {
        ...input,
        type_code: typeCode,
        display_code_meta: displayCode,
        display_code: displayCode.value,
        electrical_source: input.electrical_source ?? (
          input.electrical_board_tbc || !input.electrical_board_id
            ? { kind: 'TBC' }
            : { kind: 'BOARD', boardId: input.electrical_board_id }
        ),
        metering_state: input.metering_state ?? { kind: 'TBC' },
        extra_photos: input.extra_photos ?? [],
        meter_channels: input.meter_channels ?? [],
        meter_present: input.meter_present ?? false,
        id: createId('site'),
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      s.siteAssets.push(record);
      bumpTreeRevision(s, input.audit_id);
    });
    return record!;
  },
  async update(id, patch) {
    let updated: SiteAsset | null = null;
    await updateStore((s) => {
      const idx = s.siteAssets.findIndex((a) => a.id === id);
      if (idx < 0) throw new Error('Site asset not found');
      const previous = s.siteAssets[idx];
      const installation = s.installations.find((item) => item.id === previous.audit_id);
      if (installation?.status === 'Completed') throw new Error('Reopen this completed installation before editing it.');
      if (
        patch.metering_state &&
        JSON.stringify(patch.metering_state) !== JSON.stringify(previous.metering_state)
      ) {
        throw new Error('Use the atomic metering reconciliation action to change metering state.');
      }
      if (patch.meter_present !== undefined && patch.meter_present !== previous.meter_present) {
        throw new Error('Use the atomic metering reconciliation action to change meter coverage.');
      }
      const typeCode = patch.type_code ?? (patch.asset_type ? siteAssetTypeCode(patch.asset_type) : previous.type_code);
      const displayCodeMeta = patch.display_code_meta ?? (patch.display_code !== undefined
        ? {
            ...(previous.display_code_meta ?? { generatedValue: previous.display_code ?? '', ruleVersion: 1 as const, provisional: true }),
            value: patch.display_code.trim(),
            isOverridden: patch.display_code.trim() !== (previous.display_code_meta?.generatedValue ?? previous.display_code),
          }
        : previous.display_code_meta);
      const electricalSource = patch.electrical_source ?? (
        patch.electrical_board_tbc
          ? { kind: 'TBC' as const }
          : patch.electrical_board_id
            ? { kind: 'BOARD' as const, boardId: patch.electrical_board_id }
            : previous.electrical_source
      );
      updated = {
        ...previous,
        ...patch,
        type_code: typeCode,
        display_code_meta: displayCodeMeta,
        electrical_source: electricalSource,
        id,
        updated_at: nowIso(),
      };
      s.siteAssets[idx] = updated;
      projectCanonicalCompatibility(s, updated.audit_id);
      bumpTreeRevision(s, updated.audit_id);
    });
    return updated!;
  },
  async remove(id) {
    await removeLocalTreeTarget({ kind: 'site_asset', id });
  },
  async setMetering(id, state, assignments = []) {
    let updated: SiteAsset | null = null;
    await updateStore((store) => {
      const asset = store.siteAssets.find((item) => item.id === id);
      if (!asset) throw new Error('Site asset not found');
      const installation = store.installations.find((item) => item.id === asset.audit_id);
      if (installation?.status === 'Completed') throw new Error('Reopen this completed installation before editing it.');
      setAssetMeteringState(store, id, state, assignments);
      asset.updated_at = nowIso();
      bumpTreeRevision(store, asset.audit_id);
      updated = asset;
    });
    return updated!;
  },
};

export const canonicalInstallationRepo: CanonicalInstallationRepository = {
  async readiness(installationId) {
    await initStore();
    return installationReadiness(getStore(), installationId);
  },
  async electricalTree(installationId) {
    await initStore();
    return electricalTreeRows(getStore(), installationId);
  },
  async allAssetMetering(installationId) {
    await initStore();
    return allAssetMeteringRows(getStore(), installationId);
  },
  async meterDevices(installationId) {
    await initStore();
    return getStore().meterDevices.filter((item) => item.installationId === installationId);
  },
  async measurementAssignments(installationId) {
    await initStore();
    return getStore().measurementAssignments.filter((item) => item.installationId === installationId);
  },
  async gridSupplies(installationId) {
    await initStore();
    return getStore().gridSupplies.filter((item) => item.installationId === installationId);
  },
  async eligibleMetersForAsset(assetId) {
    await initStore();
    const store = getStore();
    const asset = store.siteAssets.find((item) => item.id === assetId);
    if (!asset) return [];
    return store.meterDevices.filter(
      (meter) =>
        meter.installationId === asset.audit_id &&
        boardIsOnAssetSupplyPath(store, asset, meter.installedOnBoardId),
    );
  },
};

export const gridSuppliesRepo: GridSuppliesRepository = {
  async create(input) {
    if (!input.name.trim()) throw new Error('Grid supply name is required.');
    let created: GridSupply | null = null;
    await updateStore((store) => {
      const installation = store.installations.find((item) => item.id === input.installationId);
      if (!installation) throw new Error('Installation not found');
      if (installation.status === 'Completed') throw new Error('Reopen this completed installation before editing Grid supplies.');
      const existing = store.gridSupplies.filter((item) => item.installationId === input.installationId);
      const makeDefault = input.isDefault || !existing.length;
      if (makeDefault) existing.forEach((item) => { item.isDefault = false; });
      created = {
        ...input,
        id: createId('grid'),
        name: input.name.trim(),
        nmi: input.nmi?.trim() || undefined,
        externalKey: input.externalKey?.trim() || undefined,
        isDefault: makeDefault,
      };
      store.gridSupplies.push(created);
      bumpTreeRevision(store, input.installationId);
    });
    return created!;
  },
  async update(id, patch) {
    let updated: GridSupply | null = null;
    await updateStore((store) => {
      const index = store.gridSupplies.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('Grid supply not found');
      const current = store.gridSupplies[index];
      const installation = store.installations.find((item) => item.id === current.installationId);
      if (installation?.status === 'Completed') throw new Error('Reopen this completed installation before editing Grid supplies.');
      if (patch.name !== undefined && !patch.name.trim()) throw new Error('Grid supply name is required.');
      if (patch.isDefault === false && current.isDefault) {
        throw new Error('Set another Grid supply as default instead.');
      }
      if (patch.isDefault) {
        store.gridSupplies
          .filter((item) => item.installationId === current.installationId)
          .forEach((item) => { item.isDefault = item.id === id; });
      }
      updated = {
        ...current,
        ...patch,
        id,
        installationId: current.installationId,
        name: patch.name?.trim() ?? current.name,
        nmi: patch.nmi !== undefined ? patch.nmi.trim() || undefined : current.nmi,
        externalKey: patch.externalKey !== undefined ? patch.externalKey.trim() || undefined : current.externalKey,
      };
      store.gridSupplies[index] = updated;
      bumpTreeRevision(store, current.installationId);
    });
    return updated!;
  },
  async previewRemove(id) {
    await initStore();
    const store = getStore();
    return {
      boards: store.electricalAssets.filter(
        (item) => item.electrical_source?.kind === 'GRID' && item.electrical_source.gridSupplyId === id,
      ).length,
      siteAssets: store.siteAssets.filter(
        (item) => item.electrical_source?.kind === 'GRID' && item.electrical_source.gridSupplyId === id,
      ).length,
      assignments: store.measurementAssignments.filter(
        (item) => item.target.kind === 'GRID_BOUNDARY' && item.target.gridSupplyId === id,
      ).length,
    };
  },
  async remove(id, convertDependentsToTbc) {
    await updateStore((store) => {
      const grid = store.gridSupplies.find((item) => item.id === id);
      if (!grid) return;
      const installation = store.installations.find((item) => item.id === grid.installationId);
      if (installation?.status === 'Completed') throw new Error('Reopen this completed installation before deleting a Grid supply.');
      const siblings = store.gridSupplies.filter((item) => item.installationId === grid.installationId && item.id !== id);
      if (!siblings.length) throw new Error('An installation must keep at least one Grid supply.');
      if (grid.isDefault) throw new Error('Set another Grid supply as default before deleting this one.');
      const boards = store.electricalAssets.filter(
        (item) => item.audit_id === grid.installationId && item.electrical_source?.kind === 'GRID' && item.electrical_source.gridSupplyId === id,
      );
      const assets = store.siteAssets.filter(
        (item) => item.audit_id === grid.installationId && item.electrical_source?.kind === 'GRID' && item.electrical_source.gridSupplyId === id,
      );
      const assignments = store.measurementAssignments.filter(
        (item) => item.installationId === grid.installationId && item.target.kind === 'GRID_BOUNDARY' && item.target.gridSupplyId === id,
      );
      if (!convertDependentsToTbc && (boards.length || assets.length || assignments.length)) {
        throw new Error('This Grid supply still has dependants. Preview and explicitly convert them to TBC first.');
      }
      boards.forEach((board) => {
        board.electrical_source = { kind: 'TBC' };
        board.electrical_parent_id = null;
        board.electrical_parent_tbc = true;
        board.updated_at = nowIso();
      });
      assets.forEach((asset) => {
        asset.electrical_source = { kind: 'TBC' };
        asset.electrical_board_id = null;
        asset.electrical_board_tbc = true;
        asset.updated_at = nowIso();
      });
      assignments.forEach((assignment) => {
        assignment.target = { kind: 'TBC' };
        assignment.status = 'TBC';
      });
      store.gridSupplies = store.gridSupplies.filter((item) => item.id !== id);
      bumpTreeRevision(store, grid.installationId);
    });
  },
};

export const userRepo: UserRepository = {
  async getCurrent() {
    await initStore();
    return getStore().user;
  },
  async setCurrent(user) {
    await updateStore((s) => {
      s.user = { ...user };
    });
    return { ...user };
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
      const installation = store.installations.find((item) => item.id === input.installation_id);
      if (installation?.status === 'Completed') throw new Error('Reopen this completed installation before adding a form.');
      store.formSubmissions.unshift(record);
      bumpTreeRevision(store, input.installation_id);
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
      const installation = store.installations.find(
        (item) => item.id === store.formSubmissions[index].installation_id,
      );
      if (installation?.status === 'Completed') throw new Error('Reopen this completed installation before editing a form.');
      updated = {
        ...store.formSubmissions[index],
        ...patch,
        id,
        import_source_server_id: undefined,
        updated_at: nowIso(),
      };
      store.formSubmissions[index] = updated;
      bumpTreeRevision(store, updated.installation_id);
    });
    return updated!;
  },
  async complete(id) {
    let updated: FormSubmission | null = null;
    await updateStore((store) => {
      const index = store.formSubmissions.findIndex((form) => form.id === id);
      if (index < 0) throw new Error('Form submission not found');
      if (store.formSubmissions[index].status === 'Completed') {
        throw new Error('Completed forms are immutable. Create an amendment instead.');
      }
      const installation = store.installations.find(
        (item) => item.id === store.formSubmissions[index].installation_id,
      );
      if (installation?.status === 'Completed') throw new Error('Reopen this completed installation before completing a form.');
      const timestamp = nowIso();
      updated = {
        ...store.formSubmissions[index],
        status: 'Completed',
        completed_at: timestamp,
        updated_at: timestamp,
      };
      store.formSubmissions[index] = updated;
      bumpTreeRevision(store, updated.installation_id);
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
      const installation = store.installations.find((item) => item.id === clone.installation_id);
      if (installation?.status === 'Completed') throw new Error('Reopen this completed installation before creating an amendment.');
      store.formSubmissions.unshift(clone);
      bumpTreeRevision(store, clone.installation_id);
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
