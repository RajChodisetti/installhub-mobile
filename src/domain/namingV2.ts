import type {
  AppDataStore,
  DisplayCode,
  ElectricalAsset,
  Installation,
  MeterDevice,
  SiteAsset,
  Zone,
} from '../types';

export const ZONE_CODE_MAX_LENGTH = 16;
export const DISPLAY_CODE_MAX_LENGTH = 64;
export const ZONE_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
export const DISPLAY_CODE_RULE_VERSION = 4;
export type DisplayCodeEntityKind = 'board' | 'site_asset' | 'meter';

function identifierSegment(value: string, maxLength: number): string {
  return value
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

export function normalizedZoneCode(value: string): string {
  return identifierSegment(value, ZONE_CODE_MAX_LENGTH) || 'ZONE';
}

export function isValidZoneCode(value: string): boolean {
  return value.length > 0
    && value.length <= ZONE_CODE_MAX_LENGTH
    && ZONE_CODE_PATTERN.test(value);
}

function shortZonePrefix(zoneName: string): string {
  return zoneName
    .normalize('NFKD')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 3) || 'ZON';
}

function shortSiteSegment(siteCode: string): string {
  return identifierSegment(siteCode, 8) || 'SITE';
}

function twoCharacterSequence(ordinal: number): string {
  const value = ordinal.toString(36).toUpperCase();
  if (value.length > 2) {
    throw new Error('No two-character zone short codes remain for this site.');
  }
  return value.padStart(2, '0');
}

function uniqueDerivedZoneCode(zoneName: string, siteCode: string, used: Set<string>): string {
  const prefix = shortZonePrefix(zoneName);
  const site = shortSiteSegment(siteCode);
  for (let ordinal = 1; ordinal < 36 ** 2; ordinal += 1) {
    const suffix = twoCharacterSequence(ordinal);
    const availableSiteLength = ZONE_CODE_MAX_LENGTH - prefix.length - suffix.length - 2;
    const candidate = `${prefix}-${site.slice(0, availableSiteLength).replace(/-+$/g, '')}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error('No two-character zone short codes remain for this site.');
}

export function resolvedZoneCodes(
  zones: readonly Pick<Zone, 'id' | 'zone_name' | 'zone_code'>[],
  siteCode: string,
): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>();
  for (const zone of zones) {
    const explicit = zone.zone_code?.trim().toUpperCase() || '';
    if (!isValidZoneCode(explicit) || used.has(explicit)) continue;
    result.set(zone.id, explicit);
    used.add(explicit);
  }
  for (const zone of [...zones].sort((left, right) => left.id.localeCompare(right.id))) {
    if (result.has(zone.id)) continue;
    const derived = uniqueDerivedZoneCode(zone.zone_name, siteCode, used);
    result.set(zone.id, derived);
    used.add(derived);
  }
  return result;
}

export function availableZoneCode(
  zones: readonly Pick<Zone, 'id' | 'zone_name' | 'zone_code'>[],
  siteCode: string,
  zoneName: string,
  excludeZoneId?: string,
): string {
  const resolved = resolvedZoneCodes(zones, siteCode);
  const used = new Set(
    [...resolved.entries()]
      .filter(([id]) => id !== excludeZoneId)
      .map(([, code]) => code),
  );
  return uniqueDerivedZoneCode(zoneName, siteCode, used);
}

export function isZoneCodeAvailable(
  zones: readonly Pick<Zone, 'id' | 'zone_name' | 'zone_code'>[],
  siteCode: string,
  zoneCode: string,
  excludeZoneId?: string,
): boolean {
  const candidate = zoneCode.trim().toUpperCase();
  if (!isValidZoneCode(candidate)) return false;
  return ![...resolvedZoneCodes(zones, siteCode).entries()]
    .some(([id, code]) => id !== excludeZoneId && code === candidate);
}

export function normalizedCustomName(value: string, fallback: string): string {
  return identifierSegment(value, DISPLAY_CODE_MAX_LENGTH)
    || identifierSegment(fallback, DISPLAY_CODE_MAX_LENGTH)
    || 'ASSET';
}

function sitePrefix(installation: Installation): string {
  const explicit = identifierSegment(installation.site_code || '', 16);
  if (explicit) return explicit;
  const words = installation.site_name.match(/[A-Za-z0-9]+/g) || [];
  return words.map((word) => word[0]).join('').toUpperCase().slice(0, 8) || 'SITE';
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type NamingInventory = {
  zones: Zone[];
  electricalAssets: ElectricalAsset[];
  siteAssets: SiteAsset[];
  meterDevices: MeterDevice[];
};

export function namingInventoryForInstallation(
  store: Pick<AppDataStore, 'zones' | 'electricalAssets' | 'siteAssets' | 'meterDevices'>,
  installationId: string,
): NamingInventory {
  return {
    zones: store.zones.filter((entity) => entity.audit_id === installationId),
    electricalAssets: store.electricalAssets.filter((entity) => entity.audit_id === installationId),
    siteAssets: store.siteAssets.filter((entity) => entity.audit_id === installationId),
    meterDevices: store.meterDevices.filter((entity) => entity.installationId === installationId),
  };
}

export function defaultMeterCustomName(
  model: MeterDevice['deviceModel'] | 'Other',
  customModelName?: string,
  customManufacturerName?: string,
): string {
  if (model === 'A3RM') return 'A3RM Meter';
  if (model === 'A6M') return 'A6M Meter';
  return (customModelName?.trim() || customManufacturerName?.trim() || 'Other Meter')
    .slice(0, DISPLAY_CODE_MAX_LENGTH);
}

/** Keep an installer edit, but advance untouched/blank type-derived defaults. */
export function nameAfterTypeChange(
  currentName: string,
  previousDefault: string,
  nextDefault: string,
): string {
  const current = currentName.trim();
  return !current || current === previousDefault.trim() ? nextDefault : currentName;
}

export function generatedDisplayCodeV2(
  installation: Installation,
  inventory: NamingInventory,
  input: {
    zoneId: string;
    customName: string;
    fallbackType: string;
    entityKind?: DisplayCodeEntityKind;
    entityTypeCode?: string;
    excludeId?: string;
  },
): string {
  const zoneCode = resolvedZoneCodes(inventory.zones, sitePrefix(installation)).get(input.zoneId) || 'ZONE';
  const prefix = `${sitePrefix(installation)}-${zoneCode}`;
  const sequencePattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)-`, 'i');
  const values = [
    ...inventory.electricalAssets
      .filter((entity) => entity.id !== input.excludeId)
      .map((entity) => entity.display_code_meta?.value || entity.display_code),
    ...inventory.siteAssets
      .filter((entity) => entity.id !== input.excludeId)
      .map((entity) => entity.display_code_meta?.value || entity.display_code || ''),
    ...inventory.meterDevices
      .filter((entity) => entity.id !== input.excludeId)
      .map((entity) => entity.displayName.value),
  ];
  let sequence = 1;
  for (const value of values) {
    const match = value.match(sequencePattern);
    if (match) sequence = Math.max(sequence, Number(match[1]) + 1);
  }
  return generatedWithSequence(installation, inventory, input, sequence);
}

function sequenceForPrefix(value: string, prefix: string): number | undefined {
  const match = value.match(new RegExp(`^${escapeRegExp(prefix)}-(\\d+)-`, 'i'));
  if (!match) return undefined;
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) && sequence > 0 ? sequence : undefined;
}

function largestSequenceForZone(
  installation: Installation,
  inventory: NamingInventory,
  zoneId: string,
  excludeId?: string,
): number {
  const zoneCode = resolvedZoneCodes(inventory.zones, sitePrefix(installation)).get(zoneId) || 'ZONE';
  const prefix = `${sitePrefix(installation)}-${zoneCode}`;
  const values = [
    ...inventory.electricalAssets
      .filter((entity) => entity.id !== excludeId && entity.zone_id === zoneId)
      .map((entity) => entity.display_code_meta?.value || entity.display_code),
    ...inventory.siteAssets
      .filter((entity) => entity.id !== excludeId && entity.zone_id === zoneId)
      .map((entity) => entity.display_code_meta?.value || entity.display_code || ''),
    ...inventory.meterDevices
      .filter((entity) => entity.id !== excludeId)
      .filter((entity) => inventory.electricalAssets.some(
        (board) => board.id === entity.installedOnBoardId && board.zone_id === zoneId,
      ))
      .map((entity) => entity.displayName.value),
  ];
  return values.reduce(
    (largest, value) => Math.max(largest, sequenceForPrefix(value, prefix) ?? 0),
    0,
  );
}

/** Seed durable local high-water marks before deletions can remove evidence. */
export function synchronizeZoneSequenceHighWater(
  installation: Installation,
  inventory: NamingInventory,
): void {
  const next = { ...(installation.display_code_zone_sequences ?? {}) };
  for (const zone of inventory.zones) {
    next[zone.id] = Math.max(
      next[zone.id] ?? 0,
      largestSequenceForZone(installation, inventory, zone.id),
    );
  }
  installation.display_code_zone_sequences = next;
}

function generatedWithSequence(
  installation: Installation,
  inventory: NamingInventory,
  input: {
    zoneId: string;
    customName: string;
    fallbackType: string;
    entityKind?: DisplayCodeEntityKind;
    entityTypeCode?: string;
  },
  sequence: number,
): string {
  const zoneCode = resolvedZoneCodes(inventory.zones, sitePrefix(installation)).get(input.zoneId) || 'ZONE';
  const prefix = `${sitePrefix(installation)}-${zoneCode}`;
  const ordinal = String(sequence).padStart(2, '0');
  const fixedPrefix = `${prefix}-${ordinal}-`;
  const fallback = normalizedCustomName(input.fallbackType, 'ASSET');
  const available = Math.max(1, DISPLAY_CODE_MAX_LENGTH - fixedPrefix.length);
  const customName = normalizedCustomName(input.customName, fallback);
  const typeCode = normalizedCustomName(input.entityTypeCode || input.fallbackType, fallback);
  const customSegments = customName.split('-');
  const typeSegments = typeCode.split('-');
  const customNameContainsType = typeSegments.length <= customSegments.length
    && customSegments.some((_, start) => typeSegments.every(
      (segment, offset) => customSegments[start + offset] === segment,
    ));
  const identityName = input.entityKind
    ? customNameContainsType ? customName : `${typeCode}-${customName}`
    : customName;
  const suffix = identityName
    .slice(0, available)
    .replace(/-+$/g, '') || fallback.slice(0, available);
  return `${fixedPrefix}${suffix}`.slice(0, DISPLAY_CODE_MAX_LENGTH).replace(/-+$/g, '');
}

export function provisionalDisplayCodeV2(
  installation: Installation,
  inventory: NamingInventory,
  input: {
    zoneId: string;
    customName: string;
    fallbackType: string;
    entityKind?: DisplayCodeEntityKind;
    entityTypeCode?: string;
    excludeId?: string;
    current?: DisplayCode;
    /** Only supplied when the same zone's short code is being renamed. */
    previousZoneCode?: string;
    refreshConfirmedGenerated?: boolean;
  },
): DisplayCode {
  const refreshableConfirmedBoard = Boolean(
    input.current
    && input.entityKind === 'board'
    && input.refreshConfirmedGenerated
    && !input.current.isOverridden
    && input.current.provisional !== true
    && input.current.ruleVersion >= 3
    && input.current.ruleVersion <= DISPLAY_CODE_RULE_VERSION,
  );
  if (input.current && !refreshableConfirmedBoard && (
    input.current.isOverridden
    || input.current.provisional !== true
    || input.current.ruleVersion > DISPLAY_CODE_RULE_VERSION
  )) {
    return input.current;
  }
  const currentValue = input.current?.generatedValue || input.current?.value || '';
  const zoneCode = resolvedZoneCodes(inventory.zones, sitePrefix(installation)).get(input.zoneId) || 'ZONE';
  const currentPrefix = `${sitePrefix(installation)}-${zoneCode}`;
  const previousPrefix = input.previousZoneCode
    ? `${sitePrefix(installation)}-${normalizedZoneCode(input.previousZoneCode)}`
    : '';
  const retainedSequence = sequenceForPrefix(currentValue, currentPrefix)
    ?? (previousPrefix ? sequenceForPrefix(currentValue, previousPrefix) : undefined);
  const observed = largestSequenceForZone(
    installation,
    inventory,
    input.zoneId,
    input.excludeId,
  );
  const highWater = installation.display_code_zone_sequences?.[input.zoneId] ?? 0;
  const sequence = retainedSequence ?? Math.max(observed, highWater) + 1;
  installation.display_code_zone_sequences = {
    ...(installation.display_code_zone_sequences ?? {}),
    [input.zoneId]: Math.max(observed, highWater, sequence),
  };
  const generatedValue = generatedWithSequence(installation, inventory, input, sequence);
  return {
    value: generatedValue,
    generatedValue,
    isOverridden: false,
    ruleVersion: DISPLAY_CODE_RULE_VERSION,
    provisional: true,
  };
}

/** Current names; v2 aliases remain for compatible imports in older modules. */
export const generatedDisplayCodeV4 = generatedDisplayCodeV2;
export const provisionalDisplayCodeV4 = provisionalDisplayCodeV2;
