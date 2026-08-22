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
