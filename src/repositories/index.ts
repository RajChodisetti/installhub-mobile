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
import { answersWithCanonicalBoardContext } from '../domain/meterCommissioning';
import { completeFormSubmissionInStore } from '../domain/formCompletion';
import {
  applyLocalDeletionPlan,
  planLocalDeletion,
  previewLocalDeletion,
  type LocalDeletionTarget,
} from './deletionIntegrity';
import {
  allAssetMeteringRows,
  BOARD_TYPE_LABELS,
  boardIsOnAssetSupplyPath,
  boardTypeCode,
  bumpTreeRevision,
  createMeasurementAssignment,
  electricalTreeRows,
  installationReadiness,
  isValidInstallationSiteCode,
  meteringInventorySummary,
  normalizeCanonicalStore,
  primaryGridSupplyId,
  projectCanonicalCompatibility,
  replaceBoardMetersFromLegacy,
  replaceMeterMeasurementAssignments,
  setAssetMeteringState,
  SITE_ASSET_TYPE_LABELS,
  siteAssetTypeCode,
  type AllAssetMeteringRow,
  type ElectricalTreeRow,
  type MeteringInventorySummary,
} from '../domain/installationV2';
import {
  availableZoneCode,
  defaultMeterCustomName,
  namingInventoryForInstallation,
  normalizedZoneCode,
  provisionalDisplayCodeV2,
} from '../domain/namingV2';

function boardDefaultName(typeCode: ReturnType<typeof boardTypeCode>, customTypeName?: string): string {
  return typeCode === 'OTHER'
    ? customTypeName?.trim() || BOARD_TYPE_LABELS[typeCode]
    : BOARD_TYPE_LABELS[typeCode];
}

function siteAssetDefaultName(
  typeCode: ReturnType<typeof siteAssetTypeCode>,
  customTypeName?: string,
): string {
  return typeCode === 'OTHER'
    ? customTypeName?.trim() || SITE_ASSET_TYPE_LABELS[typeCode]
    : SITE_ASSET_TYPE_LABELS[typeCode];
}

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
  saveMeterConfiguration(
    boardId: string,
    meter: Meter,
    assignments: MeasurementAssignment[],
  ): Promise<ElectricalAsset>;
  remove(id: string): Promise<void>;
}

export interface SiteAssetsRepository {
  listByZone(zoneId: string): Promise<SiteAsset[]>;
  listByInstallation(auditId: string): Promise<SiteAsset[]>;
  getById(id: string): Promise<SiteAsset | null>;
  create(input: SiteAssetWriteInput): Promise<SiteAsset>;
  update(id: string, patch: Partial<SiteAsset>): Promise<SiteAsset>;
  saveEditor(
    id: string | null,
    input: SiteAssetWriteInput,
    metering: SiteAssetEditorMetering,
  ): Promise<SiteAsset>;
  remove(id: string): Promise<void>;
  setMetering(id: string, state: MeteringState, assignments?: MeasurementAssignment[]): Promise<SiteAsset>;
}

export type SiteAssetWriteInput = Omit<
  SiteAsset,
  'id' | 'created_at' | 'updated_at' | 'extra_photos' | 'meter_channels' | 'meter_present'
> & {
  extra_photos?: string[];
  meter_channels?: SiteAsset['meter_channels'];
  meter_present?: boolean;
};

export type SiteAssetEditorMetering =
  | {
      kind: 'METERED';
      meterId: string;
      channelIds: string[];
      phaseMode: MeasurementAssignment['phaseMode'];
      direction: MeasurementAssignment['direction'];
    }
  | { kind: 'UNMETERED' }
  | { kind: 'TBC' };

export interface CanonicalInstallationRepository {
  readiness(installationId: string): Promise<InstallationReadiness>;
  electricalTree(installationId: string): Promise<ElectricalTreeRow[]>;
  allAssetMetering(installationId: string): Promise<AllAssetMeteringRow[]>;
  meteringInventory(installationId: string): Promise<MeteringInventorySummary>;
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
  if (
    target.kind === 'installation'
    && getStore().cloudSync.pending_complete_attempts?.[currentPlan.installationId]
  ) {
    throw new Error(
      'Confirm or resolve the pending cloud backup before deleting this installation.',
    );
  }
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
    return getStore().installations
      .filter((installation) => installation.assigned_work_state !== 'inactive')
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  },
  async getById(id) {
    await initStore();
    return getStore().installations.find((i) => i.id === id) ?? null;
  },
  async create(input) {
    if (input.site_code !== undefined && !isValidInstallationSiteCode(input.site_code)) {
      throw new Error(
        'Site code must be 1-16 uppercase letters/digits, with single hyphens only between groups.',
      );
    }
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
      if (
        Object.prototype.hasOwnProperty.call(patch, 'site_code')
        && patch.site_code !== s.installations[idx].site_code
        && (typeof patch.site_code !== 'string' || !isValidInstallationSiteCode(patch.site_code))
      ) {
        throw new Error(
          'Site code must be 1-16 uppercase letters/digits, with single hyphens only between groups.',
        );
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
    await initStore();
    let updated: Installation | null = null;
    await updateStore((store) => {
      const index = store.installations.findIndex((item) => item.id === id);
      if (index < 0) throw new Error('Installation not found');
      if (!enabled && store.cloudSync.pending_complete_attempts?.[id]) {
        throw new Error(
          'Confirm or resolve the pending cloud backup before turning backup off.',
        );
      }
      updated = {
        ...store.installations[index],
        cloud_backup_enabled: enabled,
        ...(enabled ? { cloud_backup_retained: false } : {}),
        id,
        updated_at: nowIso(),
      };
      store.installations[index] = updated;
    });
    return updated!;
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
    let record: Zone | null = null;
    await updateStore((s) => {
      const installation = s.installations.find((item) => item.id === input.audit_id);
      if (!installation) throw new Error('Installation not found.');
      if (installation?.status === 'Completed') throw new Error('Reopen this completed installation before editing it.');
      const installationZones = s.zones.filter((zone) => zone.audit_id === input.audit_id);
      const zoneCode = availableZoneCode(
        installationZones,
        normalizedZoneCode(input.zone_code?.trim() || input.zone_name),
      );
      record = {
        ...input,
        zone_code: zoneCode,
        photos: input.photos ?? [],
        id: createId('zone'),
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      s.zones.push(record);
      bumpTreeRevision(s, input.audit_id);
    });
    return record!;
  },
  async update(id, patch) {
    let updated: Zone | null = null;
    await updateStore((s) => {
      const idx = s.zones.findIndex((z) => z.id === id);
      if (idx < 0) throw new Error('Zone not found');
      const installation = s.installations.find((item) => item.id === s.zones[idx].audit_id);
      if (!installation) throw new Error('Installation not found.');
      if (installation?.status === 'Completed') throw new Error('Reopen this completed installation before editing it.');
      const previous = s.zones[idx];
      const installationZones = s.zones.filter((zone) => zone.audit_id === previous.audit_id);
      const shouldResolveCode = Object.prototype.hasOwnProperty.call(patch, 'zone_code')
        || !previous.zone_code;
      const zoneCode = shouldResolveCode
        ? availableZoneCode(
            installationZones,
            normalizedZoneCode(patch.zone_code?.trim() || patch.zone_name || previous.zone_name),
            id,
          )
        : previous.zone_code;
      updated = { ...previous, ...patch, zone_code: zoneCode, id, updated_at: nowIso() };
      s.zones[idx] = updated;

      if (previous.zone_code !== updated.zone_code) {
        const inventory = namingInventoryForInstallation(s, updated.audit_id);
        const boards = s.electricalAssets.filter(
          (board) => board.audit_id === updated!.audit_id && board.zone_id === id,
        );
        for (const board of boards) {
          const typeCode = board.type_code ?? boardTypeCode(board.asset_type);
          board.display_code_meta = provisionalDisplayCodeV2(
            installation!,
            inventory,
            {
              zoneId: id,
              customName: board.asset_name,
              fallbackType: boardDefaultName(typeCode, board.custom_type_name),
              excludeId: board.id,
              current: board.display_code_meta,
              previousZoneCode: previous.zone_code,
            },
          );
          board.display_code = board.display_code_meta.value;
        }
        for (const asset of s.siteAssets.filter(
          (item) => item.audit_id === updated!.audit_id && item.zone_id === id,
        )) {
          const typeCode = asset.type_code ?? siteAssetTypeCode(asset.asset_type);
          asset.display_code_meta = provisionalDisplayCodeV2(
            installation!,
            inventory,
            {
              zoneId: id,
              customName: asset.asset_name,
              fallbackType: siteAssetDefaultName(typeCode, asset.custom_type_name),
              excludeId: asset.id,
              current: asset.display_code_meta,
              previousZoneCode: previous.zone_code,
            },
          );
          asset.display_code = asset.display_code_meta.value;
        }
        for (const meter of s.meterDevices.filter((device) =>
          device.installationId === updated!.audit_id
          && boards.some((board) => board.id === device.installedOnBoardId))) {
          const customName = meter.customName?.trim().slice(0, 64)
            || defaultMeterCustomName(
              meter.deviceModel,
              meter.customModelName,
              meter.customManufacturerName,
            );
          meter.customName = customName;
          meter.displayName = provisionalDisplayCodeV2(
            installation!,
            inventory,
            {
              zoneId: id,
              customName,
              fallbackType: defaultMeterCustomName(
                meter.deviceModel,
                meter.customModelName,
                meter.customManufacturerName,
              ),
              excludeId: meter.id,
              current: meter.displayName,
              previousZoneCode: previous.zone_code,
            },
          );
        }
        projectCanonicalCompatibility(s, updated.audit_id);
      }
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
      const fallbackName = boardDefaultName(typeCode, input.custom_type_name);
      const customName = input.asset_name.trim() || fallbackName;
      const requested = input.display_code?.trim();
      const current = input.display_code_meta ?? (requested ? {
        value: requested,
        generatedValue: requested,
        isOverridden: true,
        ruleVersion: 1,
        provisional: true,
      } : undefined);
      const id = createId('board');
      const displayCode = provisionalDisplayCodeV2(
        installation,
        namingInventoryForInstallation(s, input.audit_id),
        {
          zoneId: input.zone_id,
          customName,
          fallbackType: fallbackName,
          excludeId: id,
          current,
        },
      );
      record = {
        ...input,
        asset_name: customName,
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
        id,
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
      if (!installation) throw new Error('Installation not found.');
      if (installation?.status === 'Completed') throw new Error('Reopen this completed installation before editing it.');
      const previous = s.electricalAssets[idx];
      const typeCode = patch.type_code
        ?? (patch.asset_type ? boardTypeCode(patch.asset_type) : undefined)
        ?? previous.type_code
        ?? boardTypeCode(previous.asset_type);
      const fallbackName = boardDefaultName(typeCode, patch.custom_type_name ?? previous.custom_type_name);
      const customName = patch.asset_name?.trim() || previous.asset_name.trim() || fallbackName;
      const explicitDisplayCode = patch.display_code?.trim();
      const currentDisplayCode = patch.display_code_meta ?? (
        explicitDisplayCode && explicitDisplayCode !== previous.display_code
          ? {
              ...(previous.display_code_meta ?? {
                generatedValue: previous.display_code,
                ruleVersion: 1,
                provisional: true,
              }),
              value: explicitDisplayCode,
              isOverridden: true,
            }
          : previous.display_code_meta ?? {
              value: previous.display_code,
              generatedValue: previous.display_code,
              isOverridden: false,
              ruleVersion: 1,
              provisional: true,
            }
      );
      const zoneId = patch.zone_id ?? previous.zone_id;
      const displayCodeMeta = provisionalDisplayCodeV2(
        installation!,
        namingInventoryForInstallation(s, previous.audit_id),
        {
          zoneId,
          customName,
          fallbackType: fallbackName,
          excludeId: id,
          current: currentDisplayCode,
        },
      );
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
        asset_name: customName,
        type_code: typeCode,
        display_code_meta: displayCodeMeta,
        display_code: displayCodeMeta.value,
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
  async saveMeterConfiguration(boardId, meter, assignments) {
    let updated: ElectricalAsset | null = null;
    await updateStore((store) => {
      const index = store.electricalAssets.findIndex((item) => item.id === boardId);
      if (index < 0) throw new Error('Switchboard not found.');
      const board = store.electricalAssets[index];
      const installation = store.installations.find((item) => item.id === board.audit_id);
      if (installation?.status === 'Completed') {
        throw new Error('Reopen this completed installation before editing meter mappings.');
      }
      const existingDevice = store.meterDevices.find((item) => item.id === meter.id);
      if (existingDevice && existingDevice.installedOnBoardId !== board.id) {
        throw new Error('This stable meter is installed on another switchboard.');
      }
      const meters = board.meters.some((item) => item.id === meter.id)
        ? board.meters.map((item) => item.id === meter.id ? meter : item)
        : [...board.meters, meter];
      replaceBoardMetersFromLegacy(store, board, meters);
      replaceMeterMeasurementAssignments(store, meter.id, assignments);
      updated = {
        ...board,
        meter_present: true,
        updated_at: nowIso(),
      };
      store.electricalAssets[index] = updated;
      projectCanonicalCompatibility(store, board.audit_id);
      bumpTreeRevision(store, board.audit_id);
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
  async saveEditor(id, input, metering) {
    let saved: SiteAsset | null = null;
    await updateStore((store) => {
      const existingIndex = id
        ? store.siteAssets.findIndex((item) => item.id === id)
        : -1;
      if (id && existingIndex < 0) throw new Error('Site asset not found.');
      const previous = existingIndex >= 0 ? store.siteAssets[existingIndex] : undefined;
      const installationId = previous?.audit_id ?? input.audit_id;
      const installation = store.installations.find((item) => item.id === installationId);
      if (!installation) throw new Error('Installation not found.');
      if (installation.status === 'Completed') {
        throw new Error('Reopen this completed installation before editing it.');
      }
      const typeCode = input.type_code ?? siteAssetTypeCode(input.asset_type);
      const fallbackName = siteAssetDefaultName(typeCode, input.custom_type_name);
      const customName = input.asset_name.trim() || previous?.asset_name.trim() || fallbackName;
      const requested = input.display_code?.trim();
      const currentDisplayCode = input.display_code_meta ?? (
        requested && requested !== previous?.display_code
          ? {
              value: requested,
              generatedValue: previous?.display_code_meta?.generatedValue ?? requested,
              isOverridden: true,
              ruleVersion: previous?.display_code_meta?.ruleVersion ?? 1,
              provisional: previous?.display_code_meta?.provisional ?? true,
            }
          : previous?.display_code_meta ?? (previous?.display_code ? {
              value: previous.display_code,
              generatedValue: previous.display_code,
              isOverridden: false,
              ruleVersion: 1,
              provisional: true,
            } : undefined)
      );
      const recordId = previous?.id ?? createId('site');
      const displayCode = provisionalDisplayCodeV2(
        installation,
        namingInventoryForInstallation(store, installationId),
        {
          zoneId: input.zone_id,
          customName,
          fallbackType: fallbackName,
          excludeId: recordId,
          current: currentDisplayCode,
        },
      );
      const timestamp = nowIso();
      saved = {
        ...(previous ?? {}),
        ...input,
        id: recordId,
        audit_id: installationId,
        asset_name: customName,
        type_code: typeCode,
        display_code_meta: displayCode,
        display_code: displayCode.value,
        electrical_source: input.electrical_source ?? (
          input.electrical_board_tbc || !input.electrical_board_id
            ? { kind: 'TBC' }
            : { kind: 'BOARD', boardId: input.electrical_board_id }
        ),
        metering_state: previous?.metering_state ?? { kind: 'TBC' },
        extra_photos: input.extra_photos ?? previous?.extra_photos ?? [],
        meter_channels: input.meter_channels ?? previous?.meter_channels ?? [],
        meter_present: previous?.meter_present ?? false,
        created_at: previous?.created_at ?? timestamp,
        updated_at: timestamp,
      };
      if (existingIndex >= 0) store.siteAssets[existingIndex] = saved;
      else store.siteAssets.push(saved);

      if (metering.kind === 'METERED') {
        const meter = store.meterDevices.find(
          (item) => item.id === metering.meterId && item.installationId === installationId,
        );
        if (!meter) throw new Error('Selected meter is no longer available.');
        if (!boardIsOnAssetSupplyPath(store, saved, meter.installedOnBoardId)) {
          throw new Error('Selected meter is not on this asset’s electrical source path.');
        }
        const previousAssignmentIds = new Set(
          previous?.metering_state?.kind === 'METERED'
            ? previous.metering_state.measurementAssignmentIds
            : [],
        );
        const conflicting = store.measurementAssignments.find((assignment) =>
          !previousAssignmentIds.has(assignment.id) &&
          assignment.target.kind !== 'TBC' &&
          assignment.channelIds.some((channelId) => metering.channelIds.includes(channelId)));
        if (conflicting) throw new Error('A selected channel is already assigned elsewhere.');
        const assignment = createMeasurementAssignment({
          installationId,
          assetId: saved.id,
          meter,
          channelIds: metering.channelIds,
          phaseMode: metering.phaseMode,
          direction: metering.direction,
        });
        setAssetMeteringState(
          store,
          saved.id,
          { kind: 'METERED', measurementAssignmentIds: [assignment.id] },
          [assignment],
        );
      } else {
        setAssetMeteringState(store, saved.id, { kind: metering.kind });
      }
      saved.updated_at = timestamp;
      projectCanonicalCompatibility(store, installationId);
      bumpTreeRevision(store, installationId);
    });
    return saved!;
  },
  async create(input) {
    let record: SiteAsset | null = null;
    await updateStore((s) => {
      const installation = s.installations.find((item) => item.id === input.audit_id);
      if (!installation) throw new Error('Installation not found');
      if (installation.status === 'Completed') throw new Error('Reopen this completed installation before editing it.');
      const typeCode = input.type_code ?? siteAssetTypeCode(input.asset_type);
      const fallbackName = siteAssetDefaultName(typeCode, input.custom_type_name);
      const customName = input.asset_name.trim() || fallbackName;
      const requested = input.display_code?.trim();
      const current = input.display_code_meta ?? (requested ? {
        value: requested,
        generatedValue: requested,
        isOverridden: true,
        ruleVersion: 1,
        provisional: true,
      } : undefined);
      const id = createId('site');
      const displayCode = provisionalDisplayCodeV2(
        installation,
        namingInventoryForInstallation(s, input.audit_id),
        {
          zoneId: input.zone_id,
          customName,
          fallbackType: fallbackName,
          excludeId: id,
          current,
        },
      );
      record = {
        ...input,
        asset_name: customName,
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
        id,
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
      if (!installation) throw new Error('Installation not found.');
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
      const typeCode = patch.type_code
        ?? (patch.asset_type ? siteAssetTypeCode(patch.asset_type) : undefined)
        ?? previous.type_code
        ?? siteAssetTypeCode(previous.asset_type);
      const fallbackName = siteAssetDefaultName(typeCode, patch.custom_type_name ?? previous.custom_type_name);
      const customName = patch.asset_name?.trim() || previous.asset_name.trim() || fallbackName;
      const explicitDisplayCode = patch.display_code?.trim();
      const currentDisplayCode = patch.display_code_meta ?? (
        explicitDisplayCode && explicitDisplayCode !== previous.display_code
          ? {
              ...(previous.display_code_meta ?? {
                generatedValue: previous.display_code ?? '',
                ruleVersion: 1,
                provisional: true,
              }),
              value: explicitDisplayCode,
              isOverridden: true,
            }
          : previous.display_code_meta ?? (previous.display_code ? {
              value: previous.display_code,
              generatedValue: previous.display_code,
              isOverridden: false,
              ruleVersion: 1,
              provisional: true,
            } : undefined)
      );
      const displayCodeMeta = provisionalDisplayCodeV2(
        installation,
        namingInventoryForInstallation(s, previous.audit_id),
        {
          zoneId: patch.zone_id ?? previous.zone_id,
          customName,
          fallbackType: fallbackName,
          excludeId: id,
          current: currentDisplayCode,
        },
      );
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
        asset_name: customName,
        type_code: typeCode,
        display_code_meta: displayCodeMeta,
        display_code: displayCodeMeta.value,
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
  async meteringInventory(installationId) {
    await initStore();
    return meteringInventorySummary(getStore(), installationId);
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
    const commissionsMeter = [
      'ww-installation',
      'a3rm-installation',
      'a6m-installation',
    ].includes(input.form_type);
    if (commissionsMeter && !input.board_id) {
      throw new Error('Choose or create the switchboard before starting a WW installation form.');
    }
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
      if (!installation) throw new Error('Installation not found');
      if (installation?.status === 'Completed') throw new Error('Reopen this completed installation before adding a form.');
      if (commissionsMeter) {
        const board = store.electricalAssets.find((item) => item.id === input.board_id);
        if (!board || board.audit_id !== input.installation_id) {
          throw new Error('Choose a switchboard in this installation before starting the WW form.');
        }
        record.zone_id = board.zone_id;
        record.answers = answersWithCanonicalBoardContext(record.answers, board);
      }
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
      updated = completeFormSubmissionInStore(
        store,
        id,
        nowIso(),
        () => createId('meter'),
      );
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
