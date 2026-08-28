import type { RemoteInstallationTree } from '../api/apiClient';
import { updateStore } from '../data/seed';
import { projectCanonicalCompatibility } from '../domain/installationV2';
import type {
  AppDataStore,
  DisplayCode,
  ResolvedDisplayCodeChange,
} from '../types';
import {
  applyServerResultCommitFence,
  type ServerResultCommitFence,
} from './serverResultCommitFence';
import { assignedWorkServerMetadataFromInstallation } from './assignedWorkPolicy';
import { remoteInstallationWorkTreeFingerprint } from './remoteInstallationRevision';
import {
  australianAddressFromInstallation,
  installationAddressFields,
} from '../domain/australianAddress';

function hasRemote(root: Record<string, unknown>, camel: string, snake: string): boolean {
  return Object.prototype.hasOwnProperty.call(root, camel)
    || Object.prototype.hasOwnProperty.call(root, snake);
}

function remoteValue(root: Record<string, unknown>, camel: string, snake: string): unknown {
  return Object.prototype.hasOwnProperty.call(root, camel) ? root[camel] : root[snake];
}

/** Server-generated directory identity and canonical address join the accepted CAS revision atomically. */
function reconcileCanonicalAddressMetadata(
  installation: AppDataStore['installations'][number],
  root: Record<string, unknown>,
): string | undefined {
  for (const [local, camel, snake] of [
    ['client_name', 'clientName', 'client_name'],
    ['site_name', 'siteName', 'site_name'],
  ] as const) {
    if (!hasRemote(root, camel, snake)) continue;
    const value = remoteValue(root, camel, snake);
    if (typeof value === 'string') installation[local] = value;
  }
  for (const [local, camel, snake] of [
    ['client_id', 'clientId', 'client_id'],
    ['client_site_id', 'clientSiteId', 'client_site_id'],
  ] as const) {
    if (!hasRemote(root, camel, snake)) continue;
    const value = remoteValue(root, camel, snake);
    installation[local] = typeof value === 'string' && value.trim() ? value : null;
  }
  const addressFields = [
    ['site_address', 'siteAddress', 'site_address'],
    ['site_locality', 'siteLocality', 'site_locality'],
    ['site_state', 'siteState', 'site_state'],
    ['site_postcode', 'sitePostcode', 'site_postcode'],
    ['site_country_code', 'siteCountryCode', 'site_country_code'],
    ['site_latitude', 'siteLatitude', 'site_latitude'],
    ['site_longitude', 'siteLongitude', 'site_longitude'],
    ['site_geocode_provider', 'siteGeocodeProvider', 'site_geocode_provider'],
    ['site_geocode_place_id', 'siteGeocodePlaceId', 'site_geocode_place_id'],
    ['site_address_source', 'siteAddressSource', 'site_address_source'],
    ['site_geocoding_status', 'siteGeocodeStatus', 'site_geocode_status'],
    ['site_address_fingerprint', 'siteAddressFingerprint', 'site_address_fingerprint'],
  ] as const;
  if (!addressFields.some(([, camel, snake]) => hasRemote(root, camel, snake))) return undefined;
  const candidate = { ...installation };
  for (const [local, camel, snake] of addressFields) {
    if (hasRemote(root, camel, snake)) {
      Object.assign(candidate, { [local]: remoteValue(root, camel, snake) });
    }
  }
  const canonicalFields = installationAddressFields(australianAddressFromInstallation(candidate));
  let canonicalFingerprint: string | undefined;
  if (hasRemote(root, 'siteAddressFingerprint', 'site_address_fingerprint')) {
    const fingerprint = remoteValue(root, 'siteAddressFingerprint', 'site_address_fingerprint');
    if (typeof fingerprint === 'string' && /^[0-9a-f]{64}$/.test(fingerprint)) {
      canonicalFields.site_address_fingerprint = fingerprint;
      canonicalFingerprint = fingerprint;
    }
  }
  Object.assign(installation, canonicalFields);
  return canonicalFingerprint;
}

function remoteRevision(tree: RemoteInstallationTree): number | undefined {
  const value = tree.treeRevision
    ?? tree.installation.treeRevision
    ?? tree.installation.tree_revision;
  const numberValue = Number(value);
  return Number.isSafeInteger(numberValue) ? numberValue : undefined;
}

function canonicalRemoteExternalKey(
  tree: RemoteInstallationTree,
  installationId: string,
): string {
  if (tree.installation.id !== installationId) {
    throw new Error('Canonical server tree returned a different installation identity.');
  }
  const value = tree.installation.externalKey ?? tree.installation.external_key;
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized.toLowerCase().startsWith('local:')) {
    throw new Error('Canonical server tree returned an invalid external key.');
  }
  return normalized;
}

function canonicalRemoteCode(
  record: Record<string, unknown>,
  field: 'displayCode' | 'displayName',
): DisplayCode {
  const value = record[field] ?? record[field === 'displayCode' ? 'display_code' : 'display_name'];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Canonical server tree is missing ${field}.`);
  }
  const raw = value as Record<string, unknown>;
  const ruleVersion = Number(raw.ruleVersion ?? raw.rule_version);
  if (
    typeof raw.value !== 'string' ||
    typeof raw.generatedValue !== 'string' ||
    !Number.isSafeInteger(ruleVersion) ||
    ruleVersion < 1
  ) {
    throw new Error(`Canonical server tree returned an invalid ${field}.`);
  }
  return {
    value: raw.value,
    generatedValue: raw.generatedValue,
    isOverridden: raw.isOverridden === true,
    ruleVersion,
    ...(typeof raw.overrideReason === 'string' ? { overrideReason: raw.overrideReason } : {}),
    provisional: false,
  };
}

function reconcileOne(
  local: DisplayCode,
  remote: DisplayCode,
  entityType: ResolvedDisplayCodeChange['entityType'],
  entityId: string,
  resolvedAt: string,
  changes: ResolvedDisplayCodeChange[],
): DisplayCode {
  if (
    local.provisional === false &&
    (local.value !== remote.value || local.generatedValue !== remote.generatedValue)
  ) {
    throw new Error(`Server attempted to rename confirmed display code for ${entityType} ${entityId}.`);
  }
  if (local.isOverridden) {
    if (!remote.isOverridden || remote.value !== local.value) {
      throw new Error(`Server display-code conflict for ${entityType} ${entityId}.`);
    }
  } else if (remote.isOverridden) {
    throw new Error(`Server unexpectedly replaced generated code for ${entityType} ${entityId}.`);
  }
  if (local.value !== remote.value) {
    changes.push({
      entityType,
      entityId,
      previousValue: local.value,
      resolvedValue: remote.value,
      resolvedAt,
    });
  }
  return remote;
}

/**
 * Merges the canonical installation identity and display-code objects from an
 * exact server revision. A revision-only push response is intentionally insufficient.
 */
export function mergeResolvedDisplayCodes(
  store: AppDataStore,
  installationId: string,
  tree: RemoteInstallationTree,
  expectedTreeRevision: number,
  resolvedAt = new Date().toISOString(),
  replaceRecordedChanges = true,
): ResolvedDisplayCodeChange[] {
  if (tree.treeSchemaVersion !== 2 || remoteRevision(tree) !== expectedTreeRevision) {
    throw new Error('Canonical server tree revision did not match the completed backup.');
  }
  if (!tree.meterDevices) {
    throw new Error('Canonical server tree omitted meter devices.');
  }
  const externalKey = canonicalRemoteExternalKey(tree, installationId);
  const installation = store.installations.find((item) => item.id === installationId);
  if (!installation) throw new Error('Installation not found.');
  const currentExternalKey = installation.external_key?.trim();
  const legacyImportedCopyCanConverge = installation.is_imported_copy === true
    && Boolean(installation.import_source_server_id?.trim())
    && (
      installation.server_tree_revision === undefined
      || installation.server_tree_revision === expectedTreeRevision
    );
  if (
    currentExternalKey
    && !currentExternalKey.toLowerCase().startsWith('local:')
    && currentExternalKey !== externalKey
    && !legacyImportedCopyCanConverge
  ) {
    throw new Error('Canonical server tree attempted to replace the installation external key.');
  }
  const boardById = new Map(tree.electricalAssets.map((item) => [String(item.id ?? ''), item]));
  const assetById = new Map(tree.siteAssets.map((item) => [String(item.id ?? ''), item]));
  const meterById = new Map(tree.meterDevices.map((item) => [String(item.id ?? ''), item]));
  const changes: ResolvedDisplayCodeChange[] = [];
  const normalizedValues = new Set<string>();
  const boardUpdates: Array<{ entity: AppDataStore['electricalAssets'][number]; code: DisplayCode }> = [];
  const assetUpdates: Array<{ entity: AppDataStore['siteAssets'][number]; code: DisplayCode }> = [];
  const meterUpdates: Array<{ entity: AppDataStore['meterDevices'][number]; code: DisplayCode }> = [];

  const trackUnique = (code: DisplayCode) => {
    const key = code.value.replace(/\s+/g, '').toUpperCase();
    if (!key || normalizedValues.has(key)) {
      throw new Error('Canonical server tree returned duplicate or empty display codes.');
    }
    normalizedValues.add(key);
  };

  for (const board of store.electricalAssets.filter((item) => item.audit_id === installationId)) {
    const remoteRecord = boardById.get(board.id);
    if (!remoteRecord || !board.display_code_meta) {
      throw new Error(`Canonical server tree omitted board ${board.id}.`);
    }
    const remote = canonicalRemoteCode(remoteRecord, 'displayCode');
    const code = reconcileOne(
      board.display_code_meta, remote, 'board', board.id, resolvedAt, changes,
    );
    boardUpdates.push({ entity: board, code });
    trackUnique(code);
  }
  for (const asset of store.siteAssets.filter((item) => item.audit_id === installationId)) {
    const remoteRecord = assetById.get(asset.id);
    if (!remoteRecord || !asset.display_code_meta) {
      throw new Error(`Canonical server tree omitted site asset ${asset.id}.`);
    }
    const remote = canonicalRemoteCode(remoteRecord, 'displayCode');
    const code = reconcileOne(
      asset.display_code_meta, remote, 'site_asset', asset.id, resolvedAt, changes,
    );
    assetUpdates.push({ entity: asset, code });
    trackUnique(code);
  }
  for (const meter of store.meterDevices.filter((item) => item.installationId === installationId)) {
    const remoteRecord = meterById.get(meter.id);
    if (!remoteRecord) throw new Error(`Canonical server tree omitted meter ${meter.id}.`);
    const remote = canonicalRemoteCode(remoteRecord, 'displayName');
    const code = reconcileOne(
      meter.displayName, remote, 'meter', meter.id, resolvedAt, changes,
    );
    meterUpdates.push({ entity: meter, code });
    trackUnique(code);
  }

  installation.external_key = externalKey;
  const canonicalAddressFingerprint = reconcileCanonicalAddressMetadata(
    installation,
    tree.installation,
  );
  // The identity and its accepted CAS base must advance in the same durable
  // store commit. Persisting only the revision can strand an imported copy
  // with its source canonical key if the confirmation pull is interrupted.
  installation.server_tree_revision = expectedTreeRevision;
  installation.assigned_work_server_metadata_base =
    assignedWorkServerMetadataFromInstallation(installation);
  installation.assigned_work_server_tree_fingerprint =
    remoteInstallationWorkTreeFingerprint(tree);
  installation.assigned_work_refresh_conflict = undefined;
  for (const { entity, code } of boardUpdates) {
    entity.display_code_meta = code;
    entity.display_code = code.value;
  }
  for (const { entity, code } of assetUpdates) {
    entity.display_code_meta = code;
    entity.display_code = code.value;
  }
  for (const { entity, code } of meterUpdates) entity.displayName = code;
  installation.resolved_display_code_changes = replaceRecordedChanges
    ? changes
    : [
        ...(installation.resolved_display_code_changes ?? []),
        ...changes.filter((change) => !(installation.resolved_display_code_changes ?? []).some(
          (existing) => existing.entityType === change.entityType && existing.entityId === change.entityId &&
            existing.resolvedValue === change.resolvedValue,
        )),
      ];
  if (tree.serverDerived) {
    const recordVersion = Number(
      tree.recordVersionNumber
      ?? tree.installation.recordVersionNumber
      ?? tree.installation.record_version_number,
    );
    installation.server_derived = {
      treeRevision: expectedTreeRevision,
      ...(Number.isSafeInteger(recordVersion) ? { recordVersionNumber: recordVersion } : {}),
      virtualMeterDefinitions: tree.serverDerived.virtualMeterDefinitions,
    };
  }
  projectCanonicalCompatibility(store, installationId);
  // Compatibility projection normalizes legacy address rows. The exact digest
  // from this accepted canonical revision remains authoritative after that pass.
  if (canonicalAddressFingerprint) {
    installation.site_address_fingerprint = canonicalAddressFingerprint;
  }
  return changes;
}

export async function reconcileResolvedDisplayCodes(
  installationId: string,
  tree: RemoteInstallationTree,
  expectedTreeRevision: number,
  commitFence: ServerResultCommitFence,
  replaceRecordedChanges = true,
): Promise<ResolvedDisplayCodeChange[]> {
  let result: ResolvedDisplayCodeChange[] = [];
  await updateStore((store) => {
    result = applyServerResultCommitFence(
      store,
      installationId,
      commitFence,
      () => mergeResolvedDisplayCodes(
        store,
        installationId,
        tree,
        expectedTreeRevision,
        new Date().toISOString(),
        replaceRecordedChanges,
      ),
    );
  });
  return result;
}
