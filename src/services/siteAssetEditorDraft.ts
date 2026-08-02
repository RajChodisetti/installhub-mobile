import { sha256 } from 'js-sha256';
import { getStore, updateStore } from '../data/seed';
import type {
  SiteAssetEditorDraftRecord,
} from '../types';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export type SiteAssetEditorDraftSnapshot = SiteAssetEditorDraftRecord['payload'];
export type SiteAssetDraftLoadResult =
  | { status: 'NONE' | 'EXPIRED' | 'CORRUPT' }
  | { status: 'READY' | 'CONFLICT'; draft: SiteAssetEditorDraftSnapshot };

export function siteAssetEditorDraftScope(input: {
  assetId?: string;
  installationId?: string;
  zoneId?: string;
}): string {
  return input.assetId
    ? `asset:${input.assetId}`
    : `new:${input.installationId ?? 'unknown'}:${input.zoneId ?? 'unknown'}`;
}

function checksum(record: Omit<SiteAssetEditorDraftRecord, 'checksum'>): string {
  return sha256(JSON.stringify(record));
}

function withoutChecksum(
  record: SiteAssetEditorDraftRecord,
): Omit<SiteAssetEditorDraftRecord, 'checksum'> {
  const { checksum: _checksum, ...unsigned } = record;
  return unsigned;
}

export async function loadSiteAssetEditorDraft(
  scope: string,
): Promise<SiteAssetDraftLoadResult> {
  const store = getStore();
  const record = (store.siteAssetEditorDrafts ?? []).find((item) => item.scope === scope);
  if (!record || record.userId !== store.user.id) return { status: 'NONE' };
  if (record.checksum !== checksum(withoutChecksum(record))) {
    await clearSiteAssetEditorDraft(scope);
    return { status: 'CORRUPT' };
  }
  if (!Number.isFinite(Date.parse(record.expiresAt)) || Date.parse(record.expiresAt) <= Date.now()) {
    await clearSiteAssetEditorDraft(scope);
    return { status: 'EXPIRED' };
  }
  const installation = store.installations.find((item) => item.id === record.installationId);
  if (!installation) {
    await clearSiteAssetEditorDraft(scope);
    return { status: 'CORRUPT' };
  }
  const asset = record.assetId
    ? store.siteAssets.find((item) => item.id === record.assetId && item.audit_id === record.installationId)
    : undefined;
  if (record.assetId && !asset) return { status: 'CONFLICT', draft: record.payload };
  const conflict = (installation.tree_revision ?? 0) !== record.baseTreeRevision ||
    (record.assetId ? asset?.updated_at !== record.baseAssetUpdatedAt : false);
  return { status: conflict ? 'CONFLICT' : 'READY', draft: record.payload };
}

export async function saveSiteAssetEditorDraft(
  scope: string,
  input: {
    installationId: string;
    assetId?: string;
    draft: SiteAssetEditorDraftSnapshot;
    now?: string;
  },
): Promise<void> {
  await updateStore((store) => {
    const installation = store.installations.find((item) => item.id === input.installationId);
    if (!installation) throw new Error('Installation not found while protecting the asset draft.');
    const asset = input.assetId
      ? store.siteAssets.find((item) => item.id === input.assetId && item.audit_id === input.installationId)
      : undefined;
    if (input.assetId && !asset) throw new Error('Site asset not found while protecting its draft.');
    const current = (store.siteAssetEditorDrafts ?? []).find(
      (item) => item.scope === scope && item.userId === store.user.id,
    );
    const now = input.now ?? new Date().toISOString();
    const unsigned: Omit<SiteAssetEditorDraftRecord, 'checksum'> = {
      scope,
      userId: store.user.id,
      installationId: input.installationId,
      assetId: input.assetId,
      baseTreeRevision: current?.baseTreeRevision ?? installation.tree_revision ?? 0,
      baseAssetUpdatedAt: current?.baseAssetUpdatedAt ?? asset?.updated_at,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      expiresAt: new Date(Date.parse(now) + RETENTION_MS).toISOString(),
      payload: input.draft,
    };
    const record: SiteAssetEditorDraftRecord = { ...unsigned, checksum: checksum(unsigned) };
    store.siteAssetEditorDrafts = [
      ...(store.siteAssetEditorDrafts ?? []).filter((item) => item.scope !== scope),
      record,
    ];
  });
}

export async function clearSiteAssetEditorDraft(scope: string): Promise<void> {
  await updateStore((store) => {
    store.siteAssetEditorDrafts = (store.siteAssetEditorDrafts ?? [])
      .filter((item) => item.scope !== scope);
  });
}

export async function clearSiteAssetEditorDraftsForUser(userId: string): Promise<void> {
  await updateStore((store) => {
    store.siteAssetEditorDrafts = (store.siteAssetEditorDrafts ?? [])
      .filter((item) => item.userId !== userId);
  });
}
