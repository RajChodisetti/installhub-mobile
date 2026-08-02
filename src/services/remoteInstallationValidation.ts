import { sha256 } from 'js-sha256';
import type { RemoteInstallationTree } from '../api/apiClient';

const text = (record: Record<string, unknown>, camel: string, snake?: string): string =>
  String(record[camel] ?? (snake ? record[snake] : '') ?? '');

const BOARD_TYPE_CODES = [
  'MSB', 'MSSB', 'DB', 'HVAC_DB', 'LX_DB', 'PV_DB', 'MCC', 'OTHER',
] as const;
const SITE_ASSET_TYPE_CODES = [
  'PV', 'HVAC', 'LIGHTING', 'EV_CHARGER', 'VEHICLE_HOIST', 'FORKLIFT',
  'EXHAUST_FAN_SYSTEM', 'POWER_OUTLET', 'HEATER_GEYSER', 'OTHER',
] as const;
const FORM_TYPES = [
  'ww-installation', 'a3rm-installation', 'a6m-installation', 'comms-fault',
  'ace-switchboard', 'honeywell-q400', 'captis-logger', 'sums-logger',
] as const;

const optionalText = (
  record: Record<string, unknown>,
  camel: string,
  snake?: string,
): string | undefined => {
  const value = record[camel] ?? (snake ? record[snake] : undefined);
  return typeof value === 'string' && value ? value : undefined;
};

function optionalStableId(
  record: Record<string, unknown>,
  camel: string,
  snake: string | undefined,
  label: string,
): string | undefined {
  const value = property(record, camel, snake);
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Cannot import canonical v2: ${label} must be a non-empty string ID.`);
  }
  return value;
}

const array = <T>(record: Record<string, unknown>, camel: string, snake?: string): T[] => {
  const value = record[camel] ?? (snake ? record[snake] : undefined);
  return Array.isArray(value) ? value as T[] : [];
};

const objectRecord = (
  source: Record<string, unknown>,
  camel: string,
  snake?: string,
): Record<string, unknown> | undefined => {
  const value = source[camel] ?? (snake ? source[snake] : undefined);
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
};

function requiredObjectRecord(
  source: Record<string, unknown>,
  camel: string,
  snake: string | undefined,
  label: string,
): Record<string, unknown> {
  const value = objectRecord(source, camel, snake);
  if (!value) throw new Error(`Cannot import canonical v2: ${label} is missing.`);
  return value;
}

function exactEnum<T extends string>(
  record: Record<string, unknown>,
  camel: string,
  snake: string | undefined,
  allowed: readonly T[],
  label: string,
): T {
  const value = record[camel] ?? (snake ? record[snake] : undefined);
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(
      `Cannot import canonical v2: ${label} must be one of ${allowed.join(', ')}.`,
    );
  }
  return value as T;
}

function requiredStringArray(
  record: Record<string, unknown>,
  camel: string,
  snake: string | undefined,
  label: string,
): string[] {
  const value = record[camel] ?? (snake ? record[snake] : undefined);
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`Cannot import canonical v2: ${label} must contain at least one stable ID.`);
  }
  const result = value as string[];
  if (new Set(result).size !== result.length) {
    throw new Error(`Cannot import canonical v2: ${label} contains duplicate channel or assignment IDs.`);
  }
  return result;
}

function exactSet(left: Set<string>, right: Set<string>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function property(
  record: Record<string, unknown>,
  camel: string,
  snake?: string,
): unknown {
  return record[camel] ?? (snake ? record[snake] : undefined);
}

function hasDeclaredProperty(
  record: Record<string, unknown>,
  camel: string,
  snake?: string,
): boolean {
  return Object.prototype.hasOwnProperty.call(record, camel) ||
    Boolean(snake && Object.prototype.hasOwnProperty.call(record, snake));
}

function requiredText(
  record: Record<string, unknown>,
  camel: string,
  snake: string | undefined,
  label: string,
  allowEmpty = false,
): string {
  const value = property(record, camel, snake);
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new Error(`Cannot import canonical v2: ${label} is missing or invalid.`);
  }
  return value;
}

function requiredBoolean(
  record: Record<string, unknown>,
  camel: string,
  snake: string | undefined,
  label: string,
): boolean {
  const value = property(record, camel, snake);
  if (typeof value !== 'boolean') {
    throw new Error(`Cannot import canonical v2: ${label} must be boolean.`);
  }
  return value;
}

function requiredInteger(
  record: Record<string, unknown>,
  camel: string,
  snake: string | undefined,
  label: string,
  minimum = 0,
): number {
  const value = property(record, camel, snake);
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new Error(`Cannot import canonical v2: ${label} must be an integer of at least ${minimum}.`);
  }
  return value as number;
}

function requiredArray<T>(
  record: Record<string, unknown>,
  camel: string,
  snake: string | undefined,
  label: string,
): T[] {
  const value = property(record, camel, snake);
  if (!Array.isArray(value)) {
    throw new Error(`Cannot import canonical v2: ${label} collection is missing.`);
  }
  return value as T[];
}

function requiredStringList(
  record: Record<string, unknown>,
  camel: string,
  snake: string | undefined,
  label: string,
): string[] {
  const values = requiredArray<unknown>(record, camel, snake, label);
  if (values.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new Error(`Cannot import canonical v2: ${label} must contain only non-empty strings.`);
  }
  return values as string[];
}

function validateDisplayCode(
  entity: Record<string, unknown>,
  camel: string,
  snake: string | undefined,
  label: string,
): void {
  const display = objectRecord(entity, camel, snake) ??
    objectRecord(
      entity,
      `${camel}Meta`,
      snake ? `${snake}_meta` : undefined,
    );
  if (!display) throw new Error(`Cannot import canonical v2: ${label} is missing.`);
  requiredText(display, 'value', undefined, `${label} value`);
  requiredText(display, 'generatedValue', 'generated_value', `${label} generated value`);
  const overridden = requiredBoolean(
    display,
    'isOverridden',
    'is_overridden',
    `${label} override flag`,
  );
  requiredInteger(display, 'ruleVersion', 'rule_version', `${label} rule version`, 1);
  if (overridden) {
    requiredText(display, 'overrideReason', 'override_reason', `${label} override reason`);
  } else if (property(display, 'overrideReason', 'override_reason') != null &&
      typeof property(display, 'overrideReason', 'override_reason') !== 'string') {
    throw new Error(`Cannot import canonical v2: ${label} override reason is invalid.`);
  }
  if (display.provisional !== undefined && typeof display.provisional !== 'boolean') {
    throw new Error(`Cannot import canonical v2: ${label} provisional flag must be boolean.`);
  }
}

function validateInstallationOwnership(
  record: Record<string, unknown>,
  installationId: string,
  label: string,
): void {
  if (requiredText(record, 'installationId', 'installation_id', `${label} installation ID`) !== installationId) {
    throw new Error(`Cannot import canonical v2: ${label} belongs to a different installation.`);
  }
}

function validIsoTimestamp(value: string): boolean {
  return Boolean(value.trim()) && Number.isFinite(Date.parse(value));
}

function validIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function assertUniqueRemoteIds(
  records: Record<string, unknown>[],
  label: string,
): Set<string> {
  const ids = new Set<string>();
  records.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Cannot import canonical v2: ${label} ${index + 1} must be an object.`);
    }
    const rawId = item.id;
    if (typeof rawId !== 'string' || !rawId.trim()) {
      throw new Error(`Cannot import canonical v2: ${label} ${index + 1} has no stable ID (expected a non-empty string).`);
    }
    const id = rawId;
    if (ids.has(id)) throw new Error(`Cannot import canonical v2: duplicate ${label} ID ${id}.`);
    ids.add(id);
  });
  return ids;
}

/** Rejects canonical v2 trees before any local IDs are allocated or data mutates. */
export function validateCanonicalRemoteTreeIds(tree: RemoteInstallationTree): void {
  const topSchemaVersion: unknown = tree.treeSchemaVersion;
  const nestedSchemaVersion =
    tree.installation.treeSchemaVersion ?? tree.installation.tree_schema_version;
  if (topSchemaVersion === '2' || nestedSchemaVersion === '2') {
    throw new Error('Cannot import canonical v2: schema versions must be numeric 2, not strings.');
  }
  const topDeclared = topSchemaVersion !== undefined && topSchemaVersion !== null;
  const nestedDeclared = nestedSchemaVersion !== undefined && nestedSchemaVersion !== null;
  for (const version of [topSchemaVersion, nestedSchemaVersion].filter(
    (value) => value !== undefined && value !== null,
  )) {
    if (typeof version !== 'number' || !Number.isSafeInteger(version)) {
      throw new Error('Cannot import installation: declared schema versions must be numeric integers.');
    }
    if (version !== 1 && version !== 2) {
      throw new Error(`Cannot import installation: schema version ${version} is unsupported.`);
    }
  }
  if (topDeclared && nestedDeclared && topSchemaVersion !== nestedSchemaVersion) {
    throw new Error('Cannot import installation: declared schema versions do not match.');
  }
  if (topSchemaVersion !== 2 && nestedSchemaVersion !== 2) return;
  if (topSchemaVersion !== 2 || nestedSchemaVersion !== 2) {
    throw new Error('Cannot import canonical v2: top-level and installation schema versions must both be 2.');
  }
  const treeRecord = tree as unknown as Record<string, unknown>;
  const installation = requiredObjectRecord(treeRecord, 'installation', undefined, 'installation');
  const gridSupplies = requiredArray<Record<string, unknown>>(
    treeRecord, 'gridSupplies', undefined, 'Grid supplies',
  );
  const zones = requiredArray<Record<string, unknown>>(treeRecord, 'zones', undefined, 'zones');
  const electricalAssets = requiredArray<Record<string, unknown>>(
    treeRecord, 'electricalAssets', undefined, 'electrical assets',
  );
  const siteAssets = requiredArray<Record<string, unknown>>(
    treeRecord, 'siteAssets', undefined, 'site assets',
  );
  const meterDevices = requiredArray<Record<string, unknown>>(
    treeRecord, 'meterDevices', undefined, 'meter devices',
  );
  const measurementAssignments = requiredArray<Record<string, unknown>>(
    treeRecord, 'measurementAssignments', undefined, 'measurement assignments',
  );
  const formSubmissions = requiredArray<Record<string, unknown>>(
    treeRecord, 'formSubmissions', undefined, 'form submissions',
  );
  const serverDerived = requiredObjectRecord(
    treeRecord, 'serverDerived', undefined, 'server-derived data',
  );
  requiredArray(serverDerived, 'virtualMeterDefinitions', undefined, 'virtual meter definitions');

  const installationId = requiredText(installation, 'id', undefined, 'installation ID');
  requiredText(installation, 'externalKey', 'external_key', 'installation external key');
  requiredText(installation, 'siteCode', 'site_code', 'installation site code');
  const timezone = requiredText(installation, 'timezone', undefined, 'installation timezone');
  if (!validIanaTimezone(timezone)) {
    throw new Error('Cannot import canonical v2: installation timezone must be a valid IANA timezone.');
  }
  requiredText(installation, 'clientName', 'client_name', 'installation client name');
  requiredText(installation, 'siteName', 'site_name', 'installation site name');
  requiredText(installation, 'siteAddress', 'site_address', 'installation site address');
  requiredText(installation, 'inspectorName', 'inspector_name', 'installation inspector name');
  requiredText(installation, 'auditDate', 'audit_date', 'installation audit date');
  if (requiredInteger(installation, 'treeSchemaVersion', 'tree_schema_version', 'installation tree schema version') !== 2) {
    throw new Error('Cannot import canonical v2: installation tree schema version must be 2.');
  }
  const topTreeRevision = requiredInteger(treeRecord, 'treeRevision', undefined, 'tree revision');
  const installationTreeRevision = requiredInteger(
    installation, 'treeRevision', 'tree_revision', 'installation tree revision',
  );
  if (topTreeRevision !== installationTreeRevision) {
    throw new Error('Cannot import canonical v2: tree revision metadata does not match.');
  }
  const installationStatus = exactEnum(
    installation,
    'status',
    undefined,
    ['Draft', 'Completed'],
    'installation status',
  );
  const recordVersionNumber = requiredInteger(
    treeRecord, 'recordVersionNumber', undefined, 'record version number',
  );
  const installationRecordVersionNumber = requiredInteger(
    installation,
    'recordVersionNumber',
    'record_version_number',
    'installation record version number',
  );
  if (recordVersionNumber !== installationRecordVersionNumber) {
    throw new Error('Cannot import canonical v2: record version metadata does not match.');
  }
  if (
    installationStatus === 'Completed' &&
    recordVersionNumber < 1
  ) {
    throw new Error('Cannot import canonical v2: Completed installation has no pinned record version.');
  }
  if (gridSupplies.length === 0 ||
      gridSupplies.filter((grid) => requiredBoolean(
        grid, 'isDefault', 'is_default', `Grid supply ${text(grid, 'id')} default flag`,
      )).length !== 1) {
    throw new Error('Cannot import canonical v2: exactly one default Grid supply is required.');
  }
  const normalizedNmis = new Set<string>();
  const normalizedGridExternalKeys = new Set<string>();
  for (const grid of gridSupplies) {
    const gridId = requiredText(grid, 'id', undefined, 'Grid supply ID');
    validateInstallationOwnership(grid, installationId, `Grid supply ${gridId}`);
    requiredText(grid, 'name', undefined, `Grid supply ${gridId} name`);
    for (const [field, label, seen] of [
      ['nmi', 'NMI', normalizedNmis],
      ['externalKey', 'external key', normalizedGridExternalKeys],
    ] as const) {
      const value = optionalText(grid, field, field === 'externalKey' ? 'external_key' : undefined);
      if (!value) continue;
      const normalized = value.replace(/\s+/g, '').toUpperCase();
      if (seen.has(normalized)) {
        throw new Error(`Cannot import canonical v2: duplicate Grid supply ${label}.`);
      }
      seen.add(normalized);
    }
  }
  const gridIds = assertUniqueRemoteIds(gridSupplies, 'Grid supply');
  const zoneIds = assertUniqueRemoteIds(zones, 'zone');
  const boardIds = assertUniqueRemoteIds(electricalAssets, 'board');
  const assetIds = assertUniqueRemoteIds(siteAssets, 'site asset');
  const meterIds = assertUniqueRemoteIds(meterDevices, 'meter');
  const assignmentIds = assertUniqueRemoteIds(measurementAssignments, 'measurement assignment');
  const formIds = assertUniqueRemoteIds(formSubmissions, 'form');

  for (const zone of zones) {
    const zoneId = text(zone, 'id');
    validateInstallationOwnership(zone, installationId, `zone ${zoneId}`);
    requiredText(zone, 'zoneName', 'zone_name', `zone ${zoneId} name`);
    requiredText(zone, 'zoneDescription', 'zone_description', `zone ${zoneId} description`, true);
    requiredStringList(zone, 'photos', undefined, `zone ${zoneId} photos`);
  }

  const channelIds = new Set<string>();
  const channelsByMeter = new Map<string, Set<string>>();
  const channelPurposeById = new Map<string, 'MAIN_SUPPLY' | 'SUB_CIRCUIT' | 'SPARE'>();
  for (const meter of meterDevices) {
    const meterId = text(meter, 'id');
    validateInstallationOwnership(meter, installationId, `meter ${meterId}`);
    const deviceFamily = exactEnum(
      meter,
      'deviceFamily',
      'device_family',
      ['WATTWATCHERS', 'OTHER'],
      `meter ${meterId} device family`,
    );
    const deviceModel = exactEnum(
      meter,
      'deviceModel',
      'device_model',
      ['A3RM', 'A6M', 'OTHER'],
      `meter ${meterId} device model`,
    );
    requiredText(meter, 'serialNumber', 'serial_number', `meter ${meterId} serial number`);
    validateDisplayCode(meter, 'displayName', 'display_name', `meter ${meterId} display name`);
    if (deviceFamily === 'OTHER' || deviceModel === 'OTHER') {
      requiredText(
        meter, 'customManufacturerName', 'custom_manufacturer_name',
        `meter ${meterId} custom manufacturer`,
      );
      requiredText(
        meter, 'customModelName', 'custom_model_name', `meter ${meterId} custom model`,
      );
    }
    const installedOnBoardId = requiredText(
      meter,
      'installedOnBoardId',
      'installed_on_board_id',
      `meter ${meterId} installed board ID`,
    );
    if (!boardIds.has(installedOnBoardId)) {
      throw new Error(`Cannot import canonical v2: meter ${meterId} references a missing board.`);
    }
    const rawChannels = meter.channels;
    if (!Array.isArray(rawChannels) || rawChannels.length === 0) {
      throw new Error(`Cannot import canonical v2: meter ${meterId} has no channels.`);
    }
    const channels = rawChannels as Record<string, unknown>[];
    const expectedChannelCount = deviceModel === 'A3RM' ? 3 : deviceModel === 'A6M' ? 6 : undefined;
    if (expectedChannelCount !== undefined && channels.length !== expectedChannelCount) {
      throw new Error(
        `Cannot import canonical v2: ${deviceModel} meter ${meterId} requires exactly ${expectedChannelCount} channels.`,
      );
    }
    const localChannelIds = assertUniqueRemoteIds(channels, `channel on meter ${meterId}`);
    for (const channelId of localChannelIds) {
      if (channelIds.has(channelId)) {
        throw new Error(`Cannot import canonical v2: duplicate channel ID ${channelId}.`);
      }
      channelIds.add(channelId);
    }
    channelsByMeter.set(meterId, localChannelIds);
    const ordinals = new Set<number>();
    for (const channel of channels) {
      const channelId = text(channel, 'id');
      const ordinal = channel.ordinal;
      if (!Number.isSafeInteger(ordinal) || (ordinal as number) < 1 || ordinals.has(ordinal as number)) {
        throw new Error(
          `Cannot import canonical v2: channel ${channelId} has an invalid or duplicate ordinal.`,
        );
      }
      ordinals.add(ordinal as number);
      const purpose = exactEnum(
        channel,
        'purpose',
        undefined,
        ['MAIN_SUPPLY', 'SUB_CIRCUIT', 'SPARE'],
        `channel ${channelId} purpose`,
      );
      channelPurposeById.set(channelId, purpose);
      const loadTypeCode = property(channel, 'loadTypeCode', 'load_type_code');
      if (loadTypeCode != null) {
        const code = exactEnum(
          channel,
          'loadTypeCode',
          'load_type_code',
          SITE_ASSET_TYPE_CODES,
          `channel ${channelId} load type`,
        );
        if (code === 'OTHER') {
          requiredText(
            channel,
            'customLoadTypeName',
            'custom_load_type_name',
            `channel ${channelId} custom load type`,
          );
        }
      }
      const direction = channel.direction;
      if (direction !== undefined && direction !== null) {
        exactEnum(
          channel,
          'direction',
          undefined,
          ['CONSUMPTION', 'GENERATION', 'BIDIRECTIONAL'],
          `channel ${channelId} direction`,
        );
      }
      if (channel.target !== undefined && channel.target !== null) {
        validateTarget(
          objectRecord(channel, 'target'),
          `channel ${channelId}`,
          boardIds,
          assetIds,
          gridIds,
        );
      }
      if ((deviceFamily === 'OTHER' || deviceModel === 'OTHER') &&
          (!objectRecord(channel, 'capabilities') || Object.keys(objectRecord(channel, 'capabilities')!).length === 0)) {
        throw new Error(
          `Cannot import canonical v2: custom meter channel ${channelId} has no capabilities.`,
        );
      }
      const capabilities = property(channel, 'capabilities');
      if (capabilities != null) {
        const capabilityRecord = objectRecord(channel, 'capabilities');
        if (!capabilityRecord ||
            Object.keys(capabilityRecord).some((key) => !key.trim()) ||
            JSON.stringify(capabilityRecord).length > 20_000) {
          throw new Error(`Cannot import canonical v2: channel ${channelId} capabilities are invalid.`);
        }
      }
    }
    if (expectedChannelCount !== undefined &&
        !Array.from({ length: expectedChannelCount }, (_, index) => index + 1)
          .every((ordinal) => ordinals.has(ordinal))) {
      throw new Error(
        `Cannot import canonical v2: ${deviceModel} meter ${meterId} requires ordinals 1 through ${expectedChannelCount}.`,
      );
    }
  }

  const childNodeIdsByParent = new Map<string, Set<string>>();
  const sourceBoardIdByBoardId = new Map<string, string>();
  const registerChild = (parentId: string, childId: string) => {
    const children = childNodeIdsByParent.get(parentId) ?? new Set<string>();
    children.add(childId);
    childNodeIdsByParent.set(parentId, children);
  };
  const validateSource = (entity: Record<string, unknown>, label: string) => {
    const source = requiredObjectRecord(
      entity,
      'electricalSource',
      'electrical_source',
      `${label} electrical source`,
    );
    const kind = exactEnum(
      source,
      'kind',
      undefined,
      ['GRID', 'BOARD', 'TBC'],
      `${label} electrical source kind`,
    );
    const declaresBoardId = hasDeclaredProperty(source, 'boardId', 'board_id');
    const declaresGridId = hasDeclaredProperty(source, 'gridSupplyId', 'grid_supply_id');
    if (kind === 'TBC') {
      if (declaresBoardId || declaresGridId) {
        throw new Error(`Cannot import canonical v2: ${label} TBC source cannot include a board or Grid ID.`);
      }
      return source;
    }
    if (kind === 'BOARD') {
      if (declaresGridId) {
        throw new Error(`Cannot import canonical v2: ${label} BOARD source cannot include a Grid ID.`);
      }
      const boardId = requiredText(source, 'boardId', 'board_id', `${label} source board ID`);
      if (!boardIds.has(boardId)) {
        throw new Error(`Cannot import canonical v2: ${label} references a missing source board.`);
      }
    }
    if (kind === 'GRID') {
      if (declaresBoardId) {
        throw new Error(`Cannot import canonical v2: ${label} GRID source cannot include a board ID.`);
      }
      const gridId = requiredText(source, 'gridSupplyId', 'grid_supply_id', `${label} Grid source ID`);
      if (!gridIds.has(gridId)) {
        throw new Error(`Cannot import canonical v2: ${label} references a missing Grid supply.`);
      }
    }
    return source;
  };
  for (const board of electricalAssets) {
    const id = text(board, 'id');
    validateInstallationOwnership(board, installationId, `board ${id}`);
    requiredText(board, 'assetName', 'asset_name', `board ${id} asset name`);
    const typeCode = exactEnum(
      board, 'typeCode', 'type_code', BOARD_TYPE_CODES, `board ${id} type code`,
    );
    if (typeCode === 'OTHER') {
      requiredText(board, 'customTypeName', 'custom_type_name', `board ${id} custom type`);
    }
    validateDisplayCode(board, 'displayCode', 'display_code', `board ${id} display code`);
    requiredStringList(board, 'extraPhotos', 'extra_photos', `board ${id} extra photos`);
    requiredBoolean(board, 'meterPresent', 'meter_present', `board ${id} meter-present flag`);
    const zoneId = requiredText(board, 'zoneId', 'zone_id', `board ${id} zone ID`);
    if (!zoneIds.has(zoneId)) {
      throw new Error(`Cannot import canonical v2: board ${id} references a missing zone.`);
    }
    const source = validateSource(board, `board ${id}`);
    if (source.kind === 'BOARD') {
      const sourceBoardId = requiredText(
        source, 'boardId', 'board_id', `board ${id} source board ID`,
      );
      if (sourceBoardId === id) {
        throw new Error(`Cannot import canonical v2: board ${id} cannot source itself.`);
      }
      sourceBoardIdByBoardId.set(id, sourceBoardId);
      registerChild(sourceBoardId, id);
    }
    if (source.kind === 'GRID') registerChild(requiredText(
      source, 'gridSupplyId', 'grid_supply_id', `board ${id} Grid source ID`,
    ), id);
    const parentId = optionalStableId(
      board, 'electricalParentId', 'electrical_parent_id', `board ${id} parent ID`,
    );
    if (parentId && !boardIds.has(parentId)) {
      throw new Error(`Cannot import canonical v2: board ${id} references a missing parent board.`);
    }
  }
  for (const startId of boardIds) {
    const path = new Set<string>();
    let current: string | undefined = startId;
    while (current) {
      if (path.has(current)) {
        throw new Error(`Cannot import canonical v2: board electrical sources contain a cycle at ${current}.`);
      }
      path.add(current);
      current = sourceBoardIdByBoardId.get(current);
    }
  }
  const meteringAssignmentIdsByAsset = new Map<
    string,
    { kind: 'METERED' | 'UNMETERED' | 'TBC'; ids: Set<string> }
  >();
  for (const asset of siteAssets) {
    const id = text(asset, 'id');
    validateInstallationOwnership(asset, installationId, `site asset ${id}`);
    requiredText(asset, 'assetName', 'asset_name', `site asset ${id} asset name`);
    const typeCode = exactEnum(
      asset,
      'typeCode',
      'type_code',
      SITE_ASSET_TYPE_CODES,
      `site asset ${id} type code`,
    );
    if (typeCode === 'OTHER') {
      requiredText(asset, 'customTypeName', 'custom_type_name', `site asset ${id} custom type`);
    }
    validateDisplayCode(asset, 'displayCode', 'display_code', `site asset ${id} display code`);
    requiredStringList(asset, 'extraPhotos', 'extra_photos', `site asset ${id} extra photos`);
    requiredBoolean(asset, 'meterPresent', 'meter_present', `site asset ${id} meter-present flag`);
    const zoneId = requiredText(asset, 'zoneId', 'zone_id', `site asset ${id} zone ID`);
    if (!zoneIds.has(zoneId)) {
      throw new Error(`Cannot import canonical v2: site asset ${id} references a missing zone.`);
    }
    const source = validateSource(asset, `site asset ${id}`);
    if (source.kind === 'BOARD') registerChild(requiredText(
      source, 'boardId', 'board_id', `site asset ${id} source board ID`,
    ), id);
    if (source.kind === 'GRID') registerChild(requiredText(
      source, 'gridSupplyId', 'grid_supply_id', `site asset ${id} Grid source ID`,
    ), id);
    const state = requiredObjectRecord(
      asset,
      'meteringState',
      'metering_state',
      `site asset ${id} metering state`,
    );
    const kind = exactEnum(
      state,
      'kind',
      undefined,
      ['METERED', 'UNMETERED', 'TBC'],
      `site asset ${id} metering state kind`,
    );
    const declaresAssignmentIds = hasDeclaredProperty(
      state,
      'measurementAssignmentIds',
      'measurement_assignment_ids',
    );
    if (kind !== 'METERED' && declaresAssignmentIds) {
      throw new Error(
        `Cannot import canonical v2: ${kind} site asset ${id} cannot list measurement assignments.`,
      );
    }
    const ids = kind === 'METERED'
      ? requiredStringArray(
          state,
          'measurementAssignmentIds',
          'measurement_assignment_ids',
          `site asset ${id} measurement assignments`,
        )
      : [];
    if (kind === 'METERED') {
      for (const assignmentId of ids) {
        if (!assignmentIds.has(assignmentId)) {
          throw new Error(`Cannot import canonical v2: site asset ${id} references a missing assignment.`);
        }
      }
    }
    meteringAssignmentIdsByAsset.set(id, { kind, ids: new Set(ids) });
  }
  const assignedChannels = new Map<string, string>();
  const directAssignmentIdsByAsset = new Map<string, Set<string>>();
  const assignmentById = new Map<string, Record<string, unknown>>();
  const assignmentTargetNodeById = new Map<string, string>();
  const assignmentStatusById = new Map<string, 'CONFIRMED' | 'TBC'>();
  const confirmedAssignmentIdsByTargetNode = new Map<string, string[]>();
  const mainTotalAssignmentIdsByTargetNode = new Map<string, string[]>();
  for (const assignment of measurementAssignments) {
    const id = text(assignment, 'id');
    validateInstallationOwnership(assignment, installationId, `assignment ${id}`);
    const meterId = requiredText(
      assignment, 'meterId', 'meter_id', `assignment ${id} meter ID`,
    );
    if (!meterIds.has(meterId)) {
      throw new Error(`Cannot import canonical v2: assignment ${id} references a missing meter.`);
    }
    const assignmentChannelIds = requiredStringArray(
      assignment,
      'channelIds',
      'channel_ids',
      `assignment ${id} channels`,
    );
    for (const channelId of assignmentChannelIds) {
      if (!channelsByMeter.get(meterId)?.has(channelId)) {
        throw new Error(`Cannot import canonical v2: assignment ${id} references a missing meter channel.`);
      }
      const priorAssignmentId = assignedChannels.get(channelId);
      if (priorAssignmentId && priorAssignmentId !== id) {
        throw new Error(
          `Cannot import canonical v2: channel ${channelId} is assigned more than once.`,
        );
      }
      assignedChannels.set(channelId, id);
    }
    const phaseMode = exactEnum(
      assignment,
      'phaseMode',
      'phase_mode',
      ['SINGLE_PHASE', 'THREE_PHASE', 'OTHER'],
      `assignment ${id} phase mode`,
    );
    const expectedCount = phaseMode === 'SINGLE_PHASE' ? 1 : phaseMode === 'THREE_PHASE' ? 3 : undefined;
    if (expectedCount !== undefined && assignmentChannelIds.length !== expectedCount) {
      throw new Error(
        `Cannot import canonical v2: assignment ${id} channel count does not match ${phaseMode}.`,
      );
    }
    exactEnum(
      assignment,
      'direction',
      undefined,
      ['CONSUMPTION', 'GENERATION', 'BIDIRECTIONAL'],
      `assignment ${id} direction`,
    );
    const status = exactEnum(
      assignment,
      'status',
      undefined,
      ['CONFIRMED', 'TBC'],
      `assignment ${id} status`,
    );
    const target = requiredObjectRecord(
      assignment,
      'target',
      undefined,
      `assignment ${id} target`,
    );
    const targetKind = validateTarget(target, `assignment ${id}`, boardIds, assetIds, gridIds);
    if ((status === 'TBC') !== (targetKind === 'TBC')) {
      throw new Error(
        `Cannot import canonical v2: assignment ${id} status and target must use the same TBC state.`,
      );
    }
    if (targetKind === 'SITE_ASSET') {
      const assetId = requiredText(
        target, 'siteAssetId', 'site_asset_id', `assignment ${id} target asset ID`,
      );
      const directIds = directAssignmentIdsByAsset.get(assetId) ?? new Set<string>();
      directIds.add(id);
      directAssignmentIdsByAsset.set(assetId, directIds);
    }
    const targetNodeId = targetKind === 'BOARD'
      ? requiredText(target, 'boardId', 'board_id', `assignment ${id} target board ID`)
      : targetKind === 'SITE_ASSET'
        ? requiredText(target, 'siteAssetId', 'site_asset_id', `assignment ${id} target asset ID`)
        : targetKind === 'GRID_BOUNDARY'
          ? requiredText(target, 'gridSupplyId', 'grid_supply_id', `assignment ${id} Grid target ID`)
          : '';
    assignmentById.set(id, assignment);
    assignmentStatusById.set(id, status);
    if (targetNodeId) {
      assignmentTargetNodeById.set(id, targetNodeId);
      if (status === 'CONFIRMED') {
        const confirmed = confirmedAssignmentIdsByTargetNode.get(targetNodeId) ?? [];
        confirmed.push(id);
        confirmedAssignmentIdsByTargetNode.set(targetNodeId, confirmed);
        if (assignmentChannelIds.every(
          (channelId) => channelPurposeById.get(channelId) === 'MAIN_SUPPLY'
        )) {
          const totals = mainTotalAssignmentIdsByTargetNode.get(targetNodeId) ?? [];
          totals.push(id);
          mainTotalAssignmentIdsByTargetNode.set(targetNodeId, totals);
        }
      }
    }
  }
  for (const asset of siteAssets) {
    const assetId = text(asset, 'id');
    const state = meteringAssignmentIdsByAsset.get(assetId)!;
    const directIds = directAssignmentIdsByAsset.get(assetId) ?? new Set<string>();
    if (
      (state.kind === 'METERED' && !exactSet(state.ids, directIds)) ||
      (state.kind !== 'METERED' && directIds.size > 0)
    ) {
      throw new Error(
        `Cannot import canonical v2: site asset ${assetId} metering state does not exactly match assignment targets.`,
      );
    }
  }

  type ExpectedVirtualDefinition = {
    id: string;
    parentNodeId: string;
    totalMeasurementAssignmentId: string;
    subtractAssignmentIds: string[];
  };
  const expectedVirtualByParent = new Map<string, ExpectedVirtualDefinition>();
  for (const [parentNodeId, totalIds] of mainTotalAssignmentIdsByTargetNode) {
    if (totalIds.length !== 1) continue;
    const totalId = totalIds[0]!;
    const childMeasurements = [...(childNodeIdsByParent.get(parentNodeId) ?? [])]
      .map((childNodeId) => (
        (confirmedAssignmentIdsByTargetNode.get(childNodeId) ?? [])
          .filter((assignmentId) => assignmentId !== totalId)
      ));
    if (childMeasurements.some((assignmentIds) => assignmentIds.length > 1)) continue;
    const subtractAssignmentIds = childMeasurements
      .flatMap((assignmentIds) => assignmentIds)
      .sort();
    expectedVirtualByParent.set(parentNodeId, {
      id: `virtual_${sha256(
        [parentNodeId, totalId, ...subtractAssignmentIds].join('\u0000'),
      ).slice(0, 24)}`,
      parentNodeId,
      totalMeasurementAssignmentId: totalId,
      subtractAssignmentIds,
    });
  }

  const virtualDefinitions = requiredArray<Record<string, unknown>>(
    serverDerived,
    'virtualMeterDefinitions',
    undefined,
    'virtual meter definitions',
  );
  const virtualIds = assertUniqueRemoteIds(virtualDefinitions, 'virtual meter definition');
  const virtualTotalIds = new Set<string>();
  const virtualParentIds = new Set<string>();
  const nodeIds = new Set([...gridIds, ...boardIds, ...assetIds]);
  for (const definition of virtualDefinitions) {
    const id = requiredText(definition, 'id', undefined, 'virtual meter definition ID');
    const parentNodeId = requiredText(
      definition, 'parentNodeId', 'parent_node_id', `virtual meter ${id} parent node ID`,
    );
    if (!nodeIds.has(parentNodeId)) {
      throw new Error(`Cannot import canonical v2: virtual meter ${id} references a missing parent node.`);
    }
    if (virtualParentIds.has(parentNodeId)) {
      throw new Error(`Cannot import canonical v2: parent node ${parentNodeId} has duplicate virtual meters.`);
    }
    virtualParentIds.add(parentNodeId);
    const totalId = requiredText(
      definition,
      'totalMeasurementAssignmentId',
      'total_measurement_assignment_id',
      `virtual meter ${id} total assignment ID`,
    );
    const total = assignmentById.get(totalId);
    if (!total || assignmentStatusById.get(totalId) !== 'CONFIRMED' ||
        assignmentTargetNodeById.get(totalId) !== parentNodeId) {
      throw new Error(`Cannot import canonical v2: virtual meter ${id} has an invalid total assignment reference.`);
    }
    if (virtualTotalIds.has(totalId)) {
      throw new Error(`Cannot import canonical v2: total assignment ${totalId} is reused by virtual meters.`);
    }
    virtualTotalIds.add(totalId);
    const totalChannelIds = requiredStringArray(
      total, 'channelIds', 'channel_ids', `virtual meter ${id} total channels`,
    );
    if (!totalChannelIds.every((channelId) => channelPurposeById.get(channelId) === 'MAIN_SUPPLY')) {
      throw new Error(`Cannot import canonical v2: virtual meter ${id} total must use MAIN_SUPPLY channels.`);
    }
    const subtractIds = requiredStringList(
      definition,
      'subtractAssignmentIds',
      'subtract_assignment_ids',
      `virtual meter ${id} subtract assignments`,
    );
    if (new Set(subtractIds).size !== subtractIds.length || subtractIds.includes(totalId)) {
      throw new Error(`Cannot import canonical v2: virtual meter ${id} has duplicate or self-subtract assignments.`);
    }
    if ([...subtractIds].sort().some((value, index) => value !== subtractIds[index])) {
      throw new Error(`Cannot import canonical v2: virtual meter ${id} subtract assignments are not canonical.`);
    }
    const usedChildNodes = new Set<string>();
    for (const subtractId of subtractIds) {
      const childNodeId = assignmentTargetNodeById.get(subtractId);
      if (!assignmentById.has(subtractId) ||
          assignmentStatusById.get(subtractId) !== 'CONFIRMED' ||
          !childNodeId ||
          !childNodeIdsByParent.get(parentNodeId)?.has(childNodeId) ||
          usedChildNodes.has(childNodeId)) {
        throw new Error(`Cannot import canonical v2: virtual meter ${id} has an invalid subtract assignment reference.`);
      }
      usedChildNodes.add(childNodeId);
    }
    if (requiredInteger(definition, 'formulaVersion', 'formula_version', `virtual meter ${id} formula version`, 1) !== 1) {
      throw new Error(`Cannot import canonical v2: virtual meter ${id} formula version must be 1.`);
    }
    exactEnum(
      definition,
      'allocation',
      undefined,
      ['UNALLOCATED_RESIDUAL'],
      `virtual meter ${id} allocation`,
    );
    const expectedId = `virtual_${sha256(
      [parentNodeId, totalId, ...subtractIds].join('\u0000'),
    ).slice(0, 24)}`;
    if (id !== expectedId || !virtualIds.has(id)) {
      throw new Error(`Cannot import canonical v2: virtual meter ${id} has a non-canonical ID.`);
    }
    const expected = expectedVirtualByParent.get(parentNodeId);
    if (!expected ||
        expected.id !== id ||
        expected.totalMeasurementAssignmentId !== totalId ||
        expected.subtractAssignmentIds.length !== subtractIds.length ||
        expected.subtractAssignmentIds.some((value, index) => value !== subtractIds[index])) {
      throw new Error(
        `Cannot import canonical v2: virtual meter ${id} does not exactly match the canonical measured-child topology.`,
      );
    }
  }
  if (virtualDefinitions.length !== expectedVirtualByParent.size) {
    throw new Error(
      'Cannot import canonical v2: virtual meter definitions do not exactly match the canonical topology.',
    );
  }

  const attachmentIds = new Set<string>();
  const supersedesByFormId = new Map<string, string>();
  for (const form of formSubmissions) {
    const id = text(form, 'id');
    validateInstallationOwnership(form, installationId, `form ${id}`);
    const formType = exactEnum(form, 'formType', 'form_type', FORM_TYPES, `form ${id} type`);
    const formSchemaVersion = requiredInteger(
      form, 'schemaVersion', 'schema_version', `form ${id} schema version`, 1,
    );
    if (formSchemaVersion !== 1 && formSchemaVersion !== 2) {
      throw new Error(`Cannot import canonical v2: form ${id} schema version must be 1 or 2.`);
    }
    const formStatus = exactEnum(
      form,
      'status',
      undefined,
      ['Draft', 'Completed'],
      `form ${id} status`,
    );
    const zoneId = optionalStableId(form, 'zoneId', 'zone_id', `form ${id} zone ID`);
    const boardId = optionalStableId(form, 'boardId', 'board_id', `form ${id} board ID`);
    const meterId = optionalStableId(form, 'meterId', 'meter_id', `form ${id} meter ID`);
    const assetId = optionalStableId(form, 'siteAssetId', 'site_asset_id', `form ${id} asset ID`);
    const completedAt = optionalText(form, 'completedAt', 'completed_at');
    if (formStatus === 'Completed' && (!completedAt || !validIsoTimestamp(completedAt))) {
      throw new Error(`Cannot import canonical v2: Completed form ${id} has no valid completion timestamp.`);
    }
    if (formStatus === 'Draft' && completedAt) {
      throw new Error(`Cannot import canonical v2: Draft form ${id} cannot have a completion timestamp.`);
    }
    const answers = requiredObjectRecord(form, 'answers', undefined, `form ${id} answers`);
    if (Object.entries(answers).some(([key, value]) => !key.trim() || typeof value !== 'string')) {
      throw new Error(`Cannot import canonical v2: form ${id} answers must map stable keys to strings.`);
    }
    const historicalMeterRemoved = requiredBoolean(
      form,
      'historicalMeterRemoved',
      'historical_meter_removed',
      `form ${id} historical-meter marker`,
    );
    const retainedHistoricalMeterContext = Boolean(
      historicalMeterRemoved && formType === 'ww-installation' &&
      meterId && !meterIds.has(meterId) && formStatus === 'Completed' &&
      completedAt && Number.isFinite(Date.parse(completedAt)),
    );
    if (historicalMeterRemoved && !retainedHistoricalMeterContext) {
      throw new Error(`Cannot import canonical v2: form ${id} has invalid historical-meter semantics.`);
    }
    if ((zoneId && !zoneIds.has(zoneId)) || (boardId && !boardIds.has(boardId)) ||
        (meterId && !meterIds.has(meterId) && !retainedHistoricalMeterContext) ||
        (assetId && !assetIds.has(assetId))) {
      throw new Error(`Cannot import canonical v2: form ${id} contains a dangling context ID.`);
    }
    const supersedesId = optionalStableId(
      form, 'supersedesId', 'supersedes_id', `form ${id} supersedes ID`,
    );
    if (supersedesId && !formIds.has(supersedesId)) {
      throw new Error(`Cannot import canonical v2: form ${id} references a missing superseded form.`);
    }
    if (supersedesId === id) {
      throw new Error(`Cannot import canonical v2: form ${id} cannot supersede itself.`);
    }
    if (supersedesId) supersedesByFormId.set(id, supersedesId);
    const attachments = requiredArray<Record<string, unknown>>(
      form, 'attachments', undefined, `form ${id} attachments`,
    );
    for (const attachment of attachments) {
      const rawAttachmentId = attachment.id;
      if (typeof rawAttachmentId !== 'string' || !rawAttachmentId.trim()) {
        throw new Error(`Cannot import canonical v2: an attachment on form ${id} has no stable ID.`);
      }
      const attachmentId = rawAttachmentId;
      if (attachmentIds.has(attachmentId)) {
        throw new Error(`Cannot import canonical v2: duplicate attachment ID ${attachmentId}.`);
      }
      attachmentIds.add(attachmentId);
      requiredText(attachment, 'slot', undefined, `attachment ${attachmentId} slot`);
      const uri = requiredText(attachment, 'uri', undefined, `attachment ${attachmentId} URI`);
      try {
        if (new URL(uri).protocol !== 'https:') throw new Error('unsafe protocol');
      } catch {
        throw new Error(`Cannot import canonical v2: attachment ${attachmentId} URI must use HTTPS.`);
      }
      const mimeType = requiredText(
        attachment, 'mimeType', 'mime_type', `attachment ${attachmentId} MIME type`,
      );
      if (!/^image\/[a-z0-9.+-]+$/i.test(mimeType)) {
        throw new Error(`Cannot import canonical v2: attachment ${attachmentId} MIME type is invalid.`);
      }
      const capturedAt = requiredText(
        attachment, 'capturedAt', 'captured_at', `attachment ${attachmentId} capture timestamp`,
      );
      if (!validIsoTimestamp(capturedAt)) {
        throw new Error(`Cannot import canonical v2: attachment ${attachmentId} capture timestamp is invalid.`);
      }
      if (attachment.caption != null && typeof attachment.caption !== 'string') {
        throw new Error(`Cannot import canonical v2: attachment ${attachmentId} caption is invalid.`);
      }
    }
  }
  for (const startId of formIds) {
    const path = new Set<string>();
    let current: string | undefined = startId;
    while (current) {
      if (path.has(current)) {
        throw new Error(`Cannot import canonical v2: form supersession contains a cycle at ${current}.`);
      }
      path.add(current);
      current = supersedesByFormId.get(current);
    }
  }
}

export function assertRemoteInstallationIdentity(
  tree: RemoteInstallationTree,
  requestedInstallationId: string,
): void {
  const sourceInstallationId = optionalStableId(
    tree.installation,
    'id',
    undefined,
    'installation ID',
  ) ?? optionalStableId(
    tree.installation,
    'installationId',
    'installation_id',
    'installation ID',
  );
  if (!sourceInstallationId || sourceInstallationId !== requestedInstallationId) {
    throw new Error('Cannot import installation: the server returned a different installation identity.');
  }
}

function validateTarget(
  target: Record<string, unknown> | undefined,
  label: string,
  boardIds: Set<string>,
  assetIds: Set<string>,
  gridIds: Set<string>,
): 'BOARD' | 'SITE_ASSET' | 'GRID_BOUNDARY' | 'TBC' {
  if (!target) throw new Error(`Cannot import canonical v2: ${label} target is missing.`);
  const kind = exactEnum(
    target,
    'kind',
    undefined,
    ['BOARD', 'SITE_ASSET', 'GRID_BOUNDARY', 'TBC'],
    `${label} target kind`,
  );
  const declaresBoardId = hasDeclaredProperty(target, 'boardId', 'board_id');
  const declaresAssetId = hasDeclaredProperty(target, 'siteAssetId', 'site_asset_id');
  const declaresGridId = hasDeclaredProperty(target, 'gridSupplyId', 'grid_supply_id');
  if (kind === 'BOARD') {
    if (declaresAssetId || declaresGridId) {
      throw new Error(`Cannot import canonical v2: ${label} BOARD target cannot include an asset or Grid ID.`);
    }
    const id = requiredText(target, 'boardId', 'board_id', `${label} target board ID`);
    if (!boardIds.has(id)) {
      throw new Error(`Cannot import canonical v2: ${label} references a missing target board.`);
    }
  }
  if (kind === 'SITE_ASSET') {
    if (declaresBoardId || declaresGridId) {
      throw new Error(`Cannot import canonical v2: ${label} SITE_ASSET target cannot include a board or Grid ID.`);
    }
    const id = requiredText(target, 'siteAssetId', 'site_asset_id', `${label} target asset ID`);
    if (!assetIds.has(id)) {
      throw new Error(`Cannot import canonical v2: ${label} references a missing target asset.`);
    }
  }
  if (kind === 'GRID_BOUNDARY') {
    if (declaresBoardId || declaresAssetId) {
      throw new Error(`Cannot import canonical v2: ${label} GRID_BOUNDARY target cannot include a board or asset ID.`);
    }
    const id = requiredText(target, 'gridSupplyId', 'grid_supply_id', `${label} Grid boundary ID`);
    if (!gridIds.has(id)) {
      throw new Error(`Cannot import canonical v2: ${label} references a missing Grid boundary.`);
    }
  }
  if (kind === 'TBC' && (declaresBoardId || declaresAssetId || declaresGridId)) {
    throw new Error(`Cannot import canonical v2: ${label} TBC target cannot include a target ID.`);
  }
  return kind;
}

export function remoteAttachmentCopyId(
  localInstallationId: string,
  remoteFormId: string,
  remoteAttachmentId: string,
  index: number,
): string {
  return `attachment_${sha256([
    localInstallationId,
    remoteFormId,
    remoteAttachmentId,
    String(index),
  ].join('\u0000')).slice(0, 24)}`;
}
