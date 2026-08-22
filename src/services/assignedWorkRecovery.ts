import type {
  AppDataStore,
  AssignedWorkRecoveryCheckout,
} from '../types';
import type { StoredActiveTimeSession } from './activeTimeOutbox';
import { createId, nowIso } from '../utils';
import {
  actorForCurrentAssignedWorkAuthority,
  assertCurrentAssignedWorkAuthority,
  captureAssignedWorkMutationAuthority,
} from './assignedWorkMutationGuard';

function installationLocalOwnerUserId(
  installation: AppDataStore['installations'][number],
): string | null {
  const owner = installation.local_owner_user_id
    ?? installation.assigned_work_actor_user_id;
  return typeof owner === 'string' && owner.trim() ? owner : null;
}

/**
 * Atomically removes one actor's canonical checkout from the live store and
 * retains its complete local state in an inert recovery envelope. The caller
 * may then insert a clean server materialization with the canonical IDs in the
 * same store transaction, without transferring dirty work between actors.
 */
export function quarantineAssignedWorkCheckout(
  store: AppDataStore,
  canonicalInstallationId: string,
  replacementActorUserId: string,
  options: {
    createRecoveryId?: () => string;
    quarantinedAt?: string;
  } = {},
): AssignedWorkRecoveryCheckout {
  const installation = store.installations.find(
    (item) => item.id === canonicalInstallationId,
  );
  if (!installation) throw new Error('Assigned checkout no longer exists.');
  const actorUserId = installationLocalOwnerUserId(installation);
  if (!actorUserId || actorUserId === replacementActorUserId) {
    throw new Error('Only another actor\'s owned checkout can be quarantined.');
  }

  const recovery: AssignedWorkRecoveryCheckout = {
    version: 1,
    id: (options.createRecoveryId ?? (() => createId('assigned_recovery')))(),
    actor_user_id: actorUserId,
    replacement_actor_user_id: replacementActorUserId,
    canonical_installation_id: canonicalInstallationId,
    quarantined_at: options.quarantinedAt ?? nowIso(),
    installation,
    gridSupplies: store.gridSupplies.filter(
      (item) => item.installationId === canonicalInstallationId,
    ),
    zones: store.zones.filter((item) => item.audit_id === canonicalInstallationId),
    electricalAssets: store.electricalAssets.filter(
      (item) => item.audit_id === canonicalInstallationId,
    ),
    siteAssets: store.siteAssets.filter(
      (item) => item.audit_id === canonicalInstallationId,
    ),
    meterDevices: store.meterDevices.filter(
      (item) => item.installationId === canonicalInstallationId,
    ),
    measurementAssignments: store.measurementAssignments.filter(
      (item) => item.installationId === canonicalInstallationId,
    ),
    formSubmissions: store.formSubmissions.filter(
      (item) => item.installation_id === canonicalInstallationId,
    ),
    siteAssetEditorDrafts: (store.siteAssetEditorDrafts ?? []).filter(
      (item) => (
        item.installationId === canonicalInstallationId
        && item.userId === actorUserId
      ),
    ),
    cloudSync: {
      synced_at: store.cloudSync.synced_at_by_installation[canonicalInstallationId],
      force_dirty: store.cloudSync.force_dirty_installation_ids.includes(
        canonicalInstallationId,
      ),
      pending_complete_attempt:
        store.cloudSync.pending_complete_attempts?.[canonicalInstallationId],
      conflicted_complete_attempt:
        store.cloudSync.conflicted_complete_attempts?.[canonicalInstallationId],
      upload_queue: store.cloudSync.upload_queue.filter(
        (item) => item.installation_id === canonicalInstallationId,
      ),
      thumbnail_queue: store.cloudSync.thumbnail_queue.filter(
        (item) => item.installation_id === canonicalInstallationId,
      ),
    },
  };

  const recoveries = store.assignedWorkRecoveryCheckouts ??= [];
  if (recoveries.some((item) => item.id === recovery.id)) {
    throw new Error('Assigned checkout recovery identity already exists.');
  }
  recoveries.push(recovery);

  store.installations = store.installations.filter(
    (item) => item.id !== canonicalInstallationId,
  );
  store.gridSupplies = store.gridSupplies.filter(
    (item) => item.installationId !== canonicalInstallationId,
  );
  store.zones = store.zones.filter((item) => item.audit_id !== canonicalInstallationId);
  store.electricalAssets = store.electricalAssets.filter(
    (item) => item.audit_id !== canonicalInstallationId,
  );
  store.siteAssets = store.siteAssets.filter(
    (item) => item.audit_id !== canonicalInstallationId,
  );
  store.meterDevices = store.meterDevices.filter(
    (item) => item.installationId !== canonicalInstallationId,
  );
  store.measurementAssignments = store.measurementAssignments.filter(
    (item) => item.installationId !== canonicalInstallationId,
  );
  store.formSubmissions = store.formSubmissions.filter(
    (item) => item.installation_id !== canonicalInstallationId,
  );
  store.siteAssetEditorDrafts = (store.siteAssetEditorDrafts ?? []).filter(
    (item) => (
      item.installationId !== canonicalInstallationId
      || item.userId !== actorUserId
    ),
  );
  delete store.cloudSync.synced_at_by_installation[canonicalInstallationId];
  store.cloudSync.force_dirty_installation_ids =
    store.cloudSync.force_dirty_installation_ids.filter(
      (id) => id !== canonicalInstallationId,
    );
  if (store.cloudSync.pending_complete_attempts) {
    delete store.cloudSync.pending_complete_attempts[canonicalInstallationId];
  }
  if (store.cloudSync.conflicted_complete_attempts) {
    delete store.cloudSync.conflicted_complete_attempts[canonicalInstallationId];
  }
  store.cloudSync.upload_queue = store.cloudSync.upload_queue.filter(
    (item) => item.installation_id !== canonicalInstallationId,
  );
  store.cloudSync.thumbnail_queue = store.cloudSync.thumbnail_queue.filter(
    (item) => item.installation_id !== canonicalInstallationId,
  );

  return recovery;
}

export function assignedWorkRecoveryCheckoutsForActor(
  store: AppDataStore,
  actorUserId: string,
): AssignedWorkRecoveryCheckout[] {
  return (store.assignedWorkRecoveryCheckouts ?? []).filter(
    (item) => item.actor_user_id === actorUserId,
  );
}

export function assignedWorkRecoveryContainsActorInstallation(
  store: Pick<AppDataStore, 'assignedWorkRecoveryCheckouts'>,
  actorUserId: string,
  canonicalInstallationId: string,
): boolean {
  return (store.assignedWorkRecoveryCheckouts ?? []).some((recovery) => (
    recovery.actor_user_id === actorUserId
    && recovery.canonical_installation_id === canonicalInstallationId
  ));
}

export interface AssignedWorkRecoverySummary {
  id: string;
  canonicalInstallationId: string;
  siteName: string;
  clientName: string;
  quarantinedAt: string;
  zones: number;
  forms: number;
  pendingUploads: number;
  pendingActiveTimeSessions: number;
}

export const ASSIGNED_WORK_RECOVERY_MANIFEST_WARNING =
  'This support manifest is not a backup. Local photos and evidence are not embedded and remain only on this device. DO NOT reset this device, clear app data, or delete or reinstall the app. Share this manifest with support before any device change.';

export interface AssignedWorkRecoveryManifest {
  format: 'field-app-complete-assigned-work-recovery-manifest-v1';
  exportedAt: string;
  warning: string;
  media: {
    filesEmbedded: false;
    localUriReferences: string[];
  };
  activeTime: {
    disposition: 'support_only_not_automatically_delivered_after_reassignment';
    pendingSessionCount: number;
    pendingSessions: StoredActiveTimeSession[];
  };
  recovery: AssignedWorkRecoveryCheckout;
}

function addLocalMediaReference(
  references: Set<string>,
  value: string | null | undefined,
): void {
  if (value && !/^https?:\/\//i.test(value)) references.add(value);
}

export function assignedWorkRecoveryLocalMediaReferences(
  recovery: AssignedWorkRecoveryCheckout,
): string[] {
  const references = new Set<string>();
  recovery.zones.forEach((zone) => {
    zone.photos.forEach((uri) => addLocalMediaReference(references, uri));
  });
  recovery.electricalAssets.forEach((asset) => {
    addLocalMediaReference(references, asset.photo);
    asset.extra_photos?.forEach((uri) => addLocalMediaReference(references, uri));
    asset.meters.forEach((meter) => {
      addLocalMediaReference(references, meter.ww_photos?.device_installed);
      addLocalMediaReference(references, meter.ww_photos?.switchboard_overview);
      addLocalMediaReference(references, meter.ww_photos?.labeling);
      meter.ww_photos?.extra?.forEach((uri) => addLocalMediaReference(references, uri));
    });
  });
  recovery.siteAssets.forEach((asset) => {
    addLocalMediaReference(references, asset.location_photo);
    asset.extra_photos?.forEach((uri) => addLocalMediaReference(references, uri));
  });
  recovery.meterDevices.forEach((meter) => {
    addLocalMediaReference(references, meter.wwPhotos?.deviceInstalled);
    addLocalMediaReference(references, meter.wwPhotos?.switchboardOverview);
    addLocalMediaReference(references, meter.wwPhotos?.labeling);
    meter.wwPhotos?.extra?.forEach((uri) => addLocalMediaReference(references, uri));
  });
  recovery.formSubmissions.forEach((form) => {
    form.attachments.forEach((attachment) => {
      addLocalMediaReference(references, attachment.uri);
    });
  });
  recovery.siteAssetEditorDrafts.forEach((draft) => {
    addLocalMediaReference(references, draft.payload.locationPhoto);
    draft.payload.extraPhotos?.forEach((uri) => addLocalMediaReference(references, uri));
  });
  recovery.cloudSync.upload_queue.forEach((item) => {
    addLocalMediaReference(references, item.local_uri);
  });
  recovery.cloudSync.thumbnail_queue.forEach((item) => {
    addLocalMediaReference(references, item.local_uri);
  });
  return [...references].sort();
}

export function pendingActiveTimeSessionsForRecovery(
  recovery: AssignedWorkRecoveryCheckout,
  sessions: StoredActiveTimeSession[],
): StoredActiveTimeSession[] {
  return sessions
    .filter((session) => (
      session.actorUserId === recovery.actor_user_id
      && session.installationId === recovery.canonical_installation_id
      && session.revision > session.acknowledgedRevision
    ))
    .map((session) => ({ ...session }))
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt));
}

export function buildAssignedWorkRecoveryManifest(
  recovery: AssignedWorkRecoveryCheckout,
  sessions: StoredActiveTimeSession[],
  exportedAt = nowIso(),
): AssignedWorkRecoveryManifest {
  const pendingSessions = pendingActiveTimeSessionsForRecovery(recovery, sessions);
  return {
    format: 'field-app-complete-assigned-work-recovery-manifest-v1',
    exportedAt,
    warning: ASSIGNED_WORK_RECOVERY_MANIFEST_WARNING,
    media: {
      filesEmbedded: false,
      localUriReferences: assignedWorkRecoveryLocalMediaReferences(recovery),
    },
    activeTime: {
      disposition: 'support_only_not_automatically_delivered_after_reassignment',
      pendingSessionCount: pendingSessions.length,
      pendingSessions,
    },
    recovery,
  };
}

function captureRecoveryActorAuthority() {
  const authority = captureAssignedWorkMutationAuthority();
  const actorUserId = actorForCurrentAssignedWorkAuthority(authority);
  if (!actorUserId) {
    throw new Error('Sign in again before accessing recovery copies.');
  }
  return { authority, actorUserId };
}

export async function listAssignedWorkRecoverySummaries(): Promise<
AssignedWorkRecoverySummary[]
> {
  const { authority, actorUserId } = captureRecoveryActorAuthority();
  const [{ initStore, getStore }, { getActiveTimeOutboxStore }] = await Promise.all([
    import('../data/seed'),
    import('./activeTimeOutbox'),
  ]);
  await initStore();
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  const activeTimeOutbox = await getActiveTimeOutboxStore();
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  const activeTimeDocument = await activeTimeOutbox.read();
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  return assignedWorkRecoveryCheckoutsForActor(getStore(), actorUserId)
    .map((item) => ({
      id: item.id,
      canonicalInstallationId: item.canonical_installation_id,
      siteName: item.installation.site_name,
      clientName: item.installation.client_name,
      quarantinedAt: item.quarantined_at,
      zones: item.zones.length,
      forms: item.formSubmissions.length,
      pendingUploads: item.cloudSync.upload_queue.filter(
        (row) => row.status !== 'cleared',
      ).length,
      pendingActiveTimeSessions: pendingActiveTimeSessionsForRecovery(
        item,
        activeTimeDocument.sessions,
      ).length,
    }))
    .sort((left, right) => right.quarantinedAt.localeCompare(left.quarantinedAt));
}

/**
 * Explicit actor-owned support path. The JSON manifest contains local URI
 * references, not media bytes; the warning requires retaining the device.
 */
export async function shareAssignedWorkRecoveryManifest(
  recoveryId: string,
): Promise<void> {
  const { authority, actorUserId } = captureRecoveryActorAuthority();
  const [
    { initStore, getStore },
    { getActiveTimeOutboxStore },
    fileSystem,
    Sharing,
  ] = await Promise.all([
    import('../data/seed'),
    import('./activeTimeOutbox'),
    import('expo-file-system'),
    import('expo-sharing'),
  ]);
  await initStore();
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  const recovery = assignedWorkRecoveryCheckoutsForActor(
    getStore(),
    actorUserId,
  ).find((item) => item.id === recoveryId);
  if (!recovery) throw new Error('Recovery manifest is unavailable for this account.');
  const activeTimeOutbox = await getActiveTimeOutboxStore();
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  const activeTimeDocument = await activeTimeOutbox.read();
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  if (!await Sharing.isAvailableAsync()) {
    throw new Error('Sharing is not available on this device.');
  }
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  const directory = new fileSystem.Directory(
    fileSystem.Paths.cache,
    'assigned-work-recovery',
  );
  directory.create({ idempotent: true, intermediates: true });
  const safeSite = recovery.installation.site_name
    .replace(/[^a-z0-9-]+/gi, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'installation';
  const output = new fileSystem.File(
    directory,
    `Field-App-Recovery-Manifest-${safeSite}-${recovery.id}.json`,
  );
  output.write(JSON.stringify(buildAssignedWorkRecoveryManifest(
    recovery,
    activeTimeDocument.sessions,
  ), null, 2));
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  await Sharing.shareAsync(output.uri, {
    mimeType: 'application/json',
    UTI: 'public.json',
    dialogTitle: `Share ${recovery.installation.site_name} recovery manifest`,
  });
}
