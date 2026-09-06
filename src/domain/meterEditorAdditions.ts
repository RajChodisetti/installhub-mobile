import type { AppDataStore, Installation, MeasurementAssignment, SiteAsset, SiteAssetTypeCode } from '../types';
import { SITE_ASSET_TYPE_LABELS, siteAssetTypeFromCode } from './installationV2';
import { namingInventoryForInstallation, provisionalDisplayCodeV2 } from './namingV2';

export type CapabilityDraft = { id: string; key: string; format: 'Text' | 'JSON'; value: string };

export function capabilityDrafts(value: Record<string, unknown> = {}): CapabilityDraft[] {
  return Object.entries(value).map(([key, entry], index) => ({
    id: `${index}-${key}`, key, format: typeof entry === 'string' ? 'Text' : 'JSON',
    value: typeof entry === 'string' ? entry : JSON.stringify(entry) ?? 'null',
  }));
}

export function capabilitiesFromDrafts(rows: CapabilityDraft[]): Record<string, unknown> {
  const entries: Array<[string, unknown]> = [];
  const keys = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) throw new Error('Every capability needs a name.');
    if (keys.has(key)) throw new Error(`Capability ${key} is duplicated. Choose a unique name.`);
    keys.add(key);
    let value: unknown = row.value;
    if (row.format === 'JSON') {
      try { value = JSON.parse(row.value); } catch { throw new Error(`Enter valid JSON for ${key}, or choose Text.`); }
    }
    entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

export function stagedMeterSiteAsset(input: {
  id: string; installationId: string; zoneId: string; boardId: string;
  name: string; typeCode: SiteAssetTypeCode; customType: string; timestamp: string;
}): SiteAsset {
  const name = input.name.trim() || (input.typeCode === 'OTHER' ? input.customType.trim() : '') || SITE_ASSET_TYPE_LABELS[input.typeCode];
  if (name.length > 64) throw new Error('Use 64 characters or fewer for the site asset name.');
  return {
    id: input.id, audit_id: input.installationId, zone_id: input.zoneId,
    asset_name: name, asset_type: siteAssetTypeFromCode(input.typeCode), type_code: input.typeCode,
    custom_type_name: input.typeCode === 'OTHER' ? input.customType.trim() : undefined,
    electrical_source: { kind: 'BOARD', boardId: input.boardId },
    electrical_board_id: input.boardId, electrical_board_tbc: false,
    metering_state: { kind: 'TBC' }, meter_present: false, meter_channels: [], extra_photos: [],
    created_at: input.timestamp, updated_at: input.timestamp,
  };
}

/** Called inside the meter-save transaction; abandoned/unreferenced drafts never persist. */
export function insertStagedMeterSiteAssets(
  store: AppDataStore, installation: Installation, boardId: string,
  assignments: MeasurementAssignment[], staged: SiteAsset[],
): void {
  const referencedIds = new Set(assignments.flatMap((assignment) => assignment.target.kind === 'SITE_ASSET' ? [assignment.target.siteAssetId] : []));
  const selected = staged.filter((asset) => referencedIds.has(asset.id));
  const ids = new Set<string>();
  for (const asset of selected) {
    if (!asset.id || ids.has(asset.id) || store.siteAssets.some((item) => item.id === asset.id)) throw new Error('A staged site asset ID is already in use.');
    ids.add(asset.id);
    if (asset.audit_id !== installation.id || !store.zones.some((zone) => zone.id === asset.zone_id && zone.audit_id === installation.id)) throw new Error('The staged asset physical zone is no longer available.');
    if (asset.electrical_source?.kind !== 'BOARD' || asset.electrical_source.boardId !== boardId) throw new Error('A new measured asset must be directly supplied by this meter’s switchboard.');
    if (!asset.asset_name.trim() || asset.asset_name.length > 64) throw new Error('The staged asset name is invalid.');
  }
  for (const asset of selected) {
    const copy = structuredClone(asset);
    copy.display_code_meta = provisionalDisplayCodeV2(installation, namingInventoryForInstallation(store, installation.id), {
      zoneId: copy.zone_id, customName: copy.asset_name,
      fallbackType: SITE_ASSET_TYPE_LABELS[copy.type_code ?? 'OTHER'], excludeId: copy.id,
    });
    copy.display_code = copy.display_code_meta.value;
    store.siteAssets.push(copy);
  }
}
