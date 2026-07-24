import type { AppDataStore } from '../types';

export const INSTALLHUB_STORE_KEY = 'installhub.mobile.store.v2';

const GENERATED_REPORT_DIRECTORY = 'form-reports';
const IMPORTED_THUMBNAIL_DIRECTORY = 'installhub-imported-thumbnails';
const ORIGINAL_EVIDENCE_DIRECTORY = 'form-media';

export interface EntityCounts {
  installations: number;
  zones: number;
  electricalAssets: number;
  siteAssets: number;
  meters: number;
  formSubmissions: number;
  attachments: number;
}

export interface BackupQueueCounts {
  total: number;
  pending: number;
  uploading: number;
  failed: number;
  cleared: number;
}

export interface ThumbnailQueueCounts {
  total: number;
  pending: number;
  downloading: number;
  failed: number;
  ready: number;
}

export interface QueueCounts {
  backup: BackupQueueCounts;
  thumbnails: ThumbnailQueueCounts;
}

export interface StorageDiagnostics {
  generatedAt: string;
  entities: EntityCounts;
  queues: QueueCounts;
  formMediaBytes: number;
  generatedReportBytes: number;
  thumbnailCacheBytes: number;
  asyncStorageBytes: number;
  totalBytes: number;
  storage: {
    asyncStorageBytes: number;
    originalEvidenceBytes: number;
    generatedReportBytes: number;
    importedThumbnailBytes: number;
    totalTrackedBytes: number;
  };
  warnings: string[];
}

export interface CacheClearResult {
  previousBytes: number;
  repairedQueueItems: number;
}

/**
 * Calculates UTF-8 storage cost without relying on Node's Buffer or a browser
 * TextEncoder, neither of which is guaranteed in every React Native runtime.
 */
export function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const amount = bytes / (1024 ** unitIndex);
  const decimals = unitIndex === 0 || amount >= 10 ? 0 : 1;
  return `${amount.toFixed(decimals)} ${units[unitIndex]}`;
}

export function formatStorageBytes(bytes: number): string {
  return formatBytes(bytes);
}

export function countStoreEntities(
  store: Pick<
    AppDataStore,
    | 'installations'
    | 'zones'
    | 'electricalAssets'
    | 'siteAssets'
    | 'formSubmissions'
  >,
): EntityCounts {
  return {
    installations: store.installations.length,
    zones: store.zones.length,
    electricalAssets: store.electricalAssets.length,
    siteAssets: store.siteAssets.length,
    meters: store.electricalAssets.reduce(
      (total, board) => total + (board.meters?.length ?? 0),
      0,
    ),
    formSubmissions: store.formSubmissions.length,
    attachments: store.formSubmissions.reduce(
      (total, form) => total + form.attachments.length,
      0,
    ),
  };
}

export function summarizeQueueState(
  store: Pick<AppDataStore, 'cloudSync'>,
): QueueCounts {
  const uploads = store.cloudSync.upload_queue;
  const thumbnails = store.cloudSync.thumbnail_queue;
  return {
    backup: {
      total: uploads.length,
      pending: uploads.filter((item) => item.status === 'pending').length,
      uploading: uploads.filter((item) => item.status === 'uploading').length,
      failed: uploads.filter((item) => item.status === 'failed').length,
      cleared: uploads.filter((item) => item.status === 'cleared').length,
    },
    thumbnails: {
      total: thumbnails.length,
      pending: thumbnails.filter((item) => item.status === 'pending').length,
      downloading: thumbnails.filter((item) => item.status === 'downloading').length,
      failed: thumbnails.filter((item) => item.status === 'failed').length,
      ready: thumbnails.filter((item) => item.status === 'ready').length,
    },
  };
}

async function directorySize(
  parent: 'cache' | 'document',
  name: string,
): Promise<number> {
  const { Directory, Paths } = await import('expo-file-system');
  const root = parent === 'cache' ? Paths.cache : Paths.document;
  const directory = new Directory(root, name);
  if (!directory.exists) return 0;

  const visit = (current: InstanceType<typeof Directory>): number =>
    current.list().reduce((total, entry) => {
      if (entry instanceof Directory) return total + visit(entry);
      return total + (entry.size ?? 0);
    }, 0);

  return visit(directory);
}

async function safeDirectorySize(
  parent: 'cache' | 'document',
  name: string,
  warnings: string[],
): Promise<number> {
  try {
    return await directorySize(parent, name);
  } catch (error) {
    warnings.push(
      `Could not inspect ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 0;
  }
}

async function inspectOrphanEvidence(
  formIds: Set<string>,
  warnings: string[],
): Promise<void> {
  try {
    const { Directory, Paths } = await import('expo-file-system');
    const evidenceRoot = new Directory(
      Paths.document,
      ORIGINAL_EVIDENCE_DIRECTORY,
    );
    if (!evidenceRoot.exists) return;
    const orphanDirectories = evidenceRoot
      .list()
      .filter(
        (entry): entry is InstanceType<typeof Directory> =>
          entry instanceof Directory && !formIds.has(entry.name),
      );
    if (orphanDirectories.length) {
      warnings.push(
        `${orphanDirectories.length} orphan form-evidence director${
          orphanDirectories.length === 1 ? 'y' : 'ies'
        } need cleanup.`,
      );
    }
  } catch (error) {
    warnings.push(
      `Could not inspect evidence ownership: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function getStorageDiagnostics(): Promise<StorageDiagnostics> {
  const [{ default: AsyncStorage }, storeModule] = await Promise.all([
    import('@react-native-async-storage/async-storage'),
    import('../data/seed'),
  ]);
  const store = await storeModule.initStore();
  const rawStore = await AsyncStorage.getItem(INSTALLHUB_STORE_KEY);
  const warnings: string[] = [];
  const [
    originalEvidenceBytes,
    generatedReportBytes,
    importedThumbnailBytes,
  ] = await Promise.all([
    safeDirectorySize('document', ORIGINAL_EVIDENCE_DIRECTORY, warnings),
    safeDirectorySize('cache', GENERATED_REPORT_DIRECTORY, warnings),
    safeDirectorySize('cache', IMPORTED_THUMBNAIL_DIRECTORY, warnings),
  ]);
  const asyncStorageBytes = utf8ByteLength(rawStore ?? JSON.stringify(store));
  await inspectOrphanEvidence(
    new Set(store.formSubmissions.map((form) => form.id)),
    warnings,
  );
  const totalBytes =
    asyncStorageBytes +
    originalEvidenceBytes +
    generatedReportBytes +
    importedThumbnailBytes;

  return {
    generatedAt: new Date().toISOString(),
    entities: countStoreEntities(store),
    queues: summarizeQueueState(store),
    formMediaBytes: originalEvidenceBytes,
    generatedReportBytes,
    thumbnailCacheBytes: importedThumbnailBytes,
    asyncStorageBytes,
    totalBytes,
    storage: {
      asyncStorageBytes,
      originalEvidenceBytes,
      generatedReportBytes,
      importedThumbnailBytes,
      totalTrackedBytes: totalBytes,
    },
    warnings,
  };
}

async function clearDirectory(
  parent: 'cache' | 'document',
  name: string,
): Promise<number> {
  const { Directory, Paths } = await import('expo-file-system');
  const previousBytes = await directorySize(parent, name);
  const root = parent === 'cache' ? Paths.cache : Paths.document;
  const directory = new Directory(root, name);
  if (directory.exists) directory.delete();
  directory.create({ idempotent: true, intermediates: true });
  return previousBytes;
}

/**
 * Removes only locally generated PDFs. Original form evidence is stored under
 * Paths.document/form-media and is deliberately outside this operation.
 */
export async function clearGeneratedReportCache(): Promise<CacheClearResult> {
  return {
    previousBytes: await clearDirectory('cache', GENERATED_REPORT_DIRECTORY),
    repairedQueueItems: 0,
  };
}

/**
 * Removes downloaded thumbnail copies and atomically marks their queue records
 * pending so the normal worker can safely recreate them. Remote originals and
 * locally captured form evidence are never touched.
 */
export async function clearImportedThumbnailCache(): Promise<CacheClearResult> {
  const previousBytes = await clearDirectory(
    'cache',
    IMPORTED_THUMBNAIL_DIRECTORY,
  );
  const { initStore, updateStore } = await import('../data/seed');
  await initStore();
  let repairedQueueItems = 0;
  await updateStore((store) => {
    const now = new Date().toISOString();
    for (const job of store.cloudSync.thumbnail_queue) {
      job.status = 'pending';
      job.attempts = 0;
      job.local_uri = undefined;
      job.last_error = undefined;
      job.updated_at = now;
      repairedQueueItems += 1;
    }

    for (const installation of store.installations) {
      const jobs = store.cloudSync.thumbnail_queue.filter(
        (job) => job.installation_id === installation.id,
      );
      installation.thumbnail_total = jobs.length;
      installation.thumbnail_ready = 0;
      installation.thumbnail_status = jobs.length ? 'pending' : 'ready';
    }
  });

  return { previousBytes, repairedQueueItems };
}
