import type {
  AppDataStore,
  FormSubmission,
  ThumbnailDownloadQueueItem,
} from '../types';

export type LocalDeletionTarget =
  | { kind: 'installation'; id: string }
  | { kind: 'zone'; id: string }
  | { kind: 'electrical_asset'; id: string }
  | { kind: 'site_asset'; id: string }
  | { kind: 'form_draft'; id: string };

export interface LocalDeletionPlan {
  target: LocalDeletionTarget;
  installationId: string;
  installationIds: string[];
  zoneIds: string[];
  electricalAssetIds: string[];
  meterIds: string[];
  siteAssetIds: string[];
  formIds: string[];
}

export interface LocalDeletionEffects {
  plan: LocalDeletionPlan;
  deletedForms: FormSubmission[];
  protectedFormAttachmentUris: string[];
  orphanedThumbnailCacheUris: string[];
}

const unique = (values: Iterable<string>): string[] => [...new Set(values)];

function descendantFormIds(
  forms: FormSubmission[],
  installationId: string,
  initialIds: Set<string>,
): Set<string> {
  const ids = new Set(initialIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const form of forms) {
      if (
        form.installation_id === installationId &&
        form.supersedes_id &&
        ids.has(form.supersedes_id) &&
        !ids.has(form.id)
      ) {
        ids.add(form.id);
        changed = true;
      }
    }
  }
  return ids;
}

/**
 * Resolves the complete local tree affected by an entity deletion. Forms are
 * selected by every formal relationship, not just the relationship exposed by
 * the screen that initiated the deletion. Amendment descendants are included
 * so a surviving form can never retain an invalid supersedes_id.
 */
export function planLocalDeletion(
  store: AppDataStore,
  target: LocalDeletionTarget,
): LocalDeletionPlan | null {
  const installation = target.kind === 'installation'
    ? store.installations.find((item) => item.id === target.id)
    : undefined;
  const zone = target.kind === 'zone'
    ? store.zones.find((item) => item.id === target.id)
    : undefined;
  const board = target.kind === 'electrical_asset'
    ? store.electricalAssets.find((item) => item.id === target.id)
    : undefined;
  const siteAsset = target.kind === 'site_asset'
    ? store.siteAssets.find((item) => item.id === target.id)
    : undefined;
  const form = target.kind === 'form_draft'
    ? store.formSubmissions.find((item) => item.id === target.id)
    : undefined;
  const installationId =
    installation?.id ??
    zone?.audit_id ??
    board?.audit_id ??
    siteAsset?.audit_id ??
    form?.installation_id;
  if (!installationId) return null;

  const installationIds = new Set<string>();
  const zoneIds = new Set<string>();
  const electricalAssetIds = new Set<string>();
  const siteAssetIds = new Set<string>();

  if (target.kind === 'installation') {
    installationIds.add(installationId);
    store.zones
      .filter((item) => item.audit_id === installationId)
      .forEach((item) => zoneIds.add(item.id));
    store.electricalAssets
      .filter((item) => item.audit_id === installationId)
      .forEach((item) => electricalAssetIds.add(item.id));
    store.siteAssets
      .filter((item) => item.audit_id === installationId)
      .forEach((item) => siteAssetIds.add(item.id));
  } else if (target.kind === 'zone') {
    zoneIds.add(target.id);
    store.electricalAssets
      .filter((item) => item.zone_id === target.id)
      .forEach((item) => electricalAssetIds.add(item.id));
    store.siteAssets
      .filter((item) => item.zone_id === target.id)
      .forEach((item) => siteAssetIds.add(item.id));
  } else if (target.kind === 'electrical_asset') {
    electricalAssetIds.add(target.id);
  } else if (target.kind === 'site_asset') {
    siteAssetIds.add(target.id);
  }

  const meterIds = new Set(
    store.electricalAssets
      .filter((item) => electricalAssetIds.has(item.id))
      .flatMap((item) => item.meters.map((meter) => meter.id)),
  );
  const directFormIds = new Set(
    store.formSubmissions
      .filter((item) => {
        if (item.installation_id !== installationId) return false;
        if (target.kind === 'installation') return true;
        if (target.kind === 'form_draft') return item.id === target.id;
        return Boolean(
          (item.zone_id && zoneIds.has(item.zone_id)) ||
          (item.board_id && electricalAssetIds.has(item.board_id)) ||
          (item.meter_id && meterIds.has(item.meter_id)) ||
          (item.site_asset_id && siteAssetIds.has(item.site_asset_id)),
        );
      })
      .map((item) => item.id),
  );
  const formIds = descendantFormIds(
    store.formSubmissions,
    installationId,
    directFormIds,
  );

  return {
    target,
    installationId,
    installationIds: unique(installationIds),
    zoneIds: unique(zoneIds),
    electricalAssetIds: unique(electricalAssetIds),
    meterIds: unique(meterIds),
    siteAssetIds: unique(siteAssetIds),
    formIds: unique(formIds),
  };
}

function addRemoteUri(uris: Set<string>, value: string | null | undefined): void {
  if (value && /^https?:\/\//i.test(value)) uris.add(value);
}

/** Returns the remote evidence that remains referenced by one local tree. */
export function referencedRemoteMediaUris(
  store: AppDataStore,
  installationId: string,
): Set<string> {
  const uris = new Set<string>();
  store.zones
    .filter((item) => item.audit_id === installationId)
    .forEach((item) => item.photos.forEach((uri) => addRemoteUri(uris, uri)));
  store.electricalAssets
    .filter((item) => item.audit_id === installationId)
    .forEach((item) => {
      addRemoteUri(uris, item.photo);
      item.extra_photos?.forEach((uri) => addRemoteUri(uris, uri));
      item.meters.forEach((meter) => {
        addRemoteUri(uris, meter.ww_photos?.device_installed);
        addRemoteUri(uris, meter.ww_photos?.switchboard_overview);
        addRemoteUri(uris, meter.ww_photos?.labeling);
        meter.ww_photos?.extra?.forEach((uri) => addRemoteUri(uris, uri));
      });
    });
  store.siteAssets
    .filter((item) => item.audit_id === installationId)
    .forEach((item) => {
      addRemoteUri(uris, item.location_photo);
      item.extra_photos?.forEach((uri) => addRemoteUri(uris, uri));
    });
  store.formSubmissions
    .filter((item) => item.installation_id === installationId)
    .forEach((item) => {
      item.attachments.forEach((attachment) => addRemoteUri(uris, attachment.uri));
    });
  return uris;
}

function queueEntityStillExists(
  store: AppDataStore,
  item: AppDataStore['cloudSync']['upload_queue'][number],
): boolean {
  if (item.entity_type === 'zone') {
    return store.zones.some(
      (entity) => entity.id === item.entity_id && entity.audit_id === item.installation_id,
    );
  }
  if (item.entity_type === 'electrical_asset') {
    return store.electricalAssets.some(
      (entity) => entity.id === item.entity_id && entity.audit_id === item.installation_id,
    );
  }
  if (item.entity_type === 'site_asset') {
    return store.siteAssets.some(
      (entity) => entity.id === item.entity_id && entity.audit_id === item.installation_id,
    );
  }
  return store.formSubmissions.some(
    (entity) =>
      entity.id === item.entity_id &&
      entity.installation_id === item.installation_id,
  );
}

function orphanedThumbnailCacheUris(
  removed: ThumbnailDownloadQueueItem[],
  remaining: ThumbnailDownloadQueueItem[],
): string[] {
  const retained = new Set(
    remaining
      .map((item) => item.local_uri)
      .filter((uri): uri is string => Boolean(uri)),
  );
  return unique(
    removed
      .map((item) => item.local_uri)
      .filter(
        (uri): uri is string =>
          typeof uri === 'string' && !retained.has(uri),
      ),
  );
}

/**
 * Applies a precomputed plan to the in-memory store. The caller persists the
 * store, then performs the returned file cleanup. Relationship repairs use TBC
 * rather than guessing a replacement board.
 */
export function applyLocalDeletionPlan(
  store: AppDataStore,
  plan: LocalDeletionPlan,
  updatedAt: string,
): LocalDeletionEffects {
  const installationIds = new Set(plan.installationIds);
  const zoneIds = new Set(plan.zoneIds);
  const electricalAssetIds = new Set(plan.electricalAssetIds);
  const siteAssetIds = new Set(plan.siteAssetIds);
  const formIds = new Set(plan.formIds);
  const deletedForms = store.formSubmissions.filter((item) => formIds.has(item.id));

  store.installations = store.installations.filter(
    (item) => !installationIds.has(item.id),
  );
  store.zones = store.zones.filter((item) => !zoneIds.has(item.id));
  store.electricalAssets = store.electricalAssets.filter(
    (item) => !electricalAssetIds.has(item.id),
  );
  store.siteAssets = store.siteAssets.filter(
    (item) => !siteAssetIds.has(item.id),
  );
  store.formSubmissions = store.formSubmissions.filter(
    (item) => !formIds.has(item.id),
  );

  for (const board of store.electricalAssets) {
    if (
      board.audit_id === plan.installationId &&
      board.electrical_parent_id &&
      electricalAssetIds.has(board.electrical_parent_id)
    ) {
      board.electrical_parent_id = null;
      board.electrical_parent_tbc = true;
      board.updated_at = updatedAt;
    }
  }
  for (const asset of store.siteAssets) {
    if (asset.audit_id !== plan.installationId) continue;
    let changed = false;
    if (
      asset.electrical_board_id &&
      electricalAssetIds.has(asset.electrical_board_id)
    ) {
      asset.electrical_board_id = null;
      asset.electrical_board_tbc = true;
      changed = true;
    }
    if (
      asset.meter_switchboard_id &&
      electricalAssetIds.has(asset.meter_switchboard_id)
    ) {
      asset.meter_switchboard_id = null;
      asset.meter_switchboard_tbc = true;
      asset.meter_channels = [];
      changed = true;
    }
    if (changed) asset.updated_at = updatedAt;
  }

  store.cloudSync.upload_queue = store.cloudSync.upload_queue.filter(
    (item) =>
      item.installation_id !== plan.installationId ||
      queueEntityStillExists(store, item),
  );

  const referencedRemoteUris = installationIds.has(plan.installationId)
    ? new Set<string>()
    : referencedRemoteMediaUris(store, plan.installationId);
  const removedThumbnails = store.cloudSync.thumbnail_queue.filter(
    (item) =>
      item.installation_id === plan.installationId &&
      !referencedRemoteUris.has(item.remote_uri),
  );
  store.cloudSync.thumbnail_queue = store.cloudSync.thumbnail_queue.filter(
    (item) =>
      item.installation_id !== plan.installationId ||
      referencedRemoteUris.has(item.remote_uri),
  );

  if (installationIds.has(plan.installationId)) {
    delete store.cloudSync.synced_at_by_installation[plan.installationId];
    store.cloudSync.force_dirty_installation_ids =
      store.cloudSync.force_dirty_installation_ids.filter(
        (item) => item !== plan.installationId,
      );
  } else {
    if (!store.cloudSync.force_dirty_installation_ids.includes(plan.installationId)) {
      store.cloudSync.force_dirty_installation_ids.push(plan.installationId);
    }
    const installation = store.installations.find(
      (item) => item.id === plan.installationId,
    );
    if (installation) {
      const thumbnailJobs = store.cloudSync.thumbnail_queue.filter(
        (item) => item.installation_id === plan.installationId,
      );
      installation.thumbnail_total = thumbnailJobs.length;
      installation.thumbnail_ready = thumbnailJobs.filter(
        (item) => item.status === 'ready',
      ).length;
      installation.thumbnail_status =
        installation.thumbnail_ready === installation.thumbnail_total
          ? 'ready'
          : 'pending';
    }
  }

  return {
    plan,
    deletedForms,
    protectedFormAttachmentUris: store.formSubmissions.flatMap((item) =>
      item.attachments.map((attachment) => attachment.uri)),
    orphanedThumbnailCacheUris: orphanedThumbnailCacheUris(
      removedThumbnails,
      store.cloudSync.thumbnail_queue,
    ),
  };
}
