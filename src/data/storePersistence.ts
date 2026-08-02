import { sha256 } from 'js-sha256';

export const STORE_MANIFEST_KEY = 'installhub.mobile.store.v3.manifest';
export const STORE_GENERATION_PREFIX = 'installhub.mobile.store.v3.generation';
export const STORE_RECOVERY_KEY = 'installhub.mobile.store.v3.recovery';
export const LEGACY_STORE_KEYS = [
  'installhub.mobile.store.v2',
  'installhub.mobile.store.v1',
] as const;

/**
 * Kept well below Android's documented multi-megabyte single-read ceiling.
 * Installations are not capped; a large document is split across more keys.
 */
export const STORE_CHUNK_CHARACTERS = 200_000;
export const RECOVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface StoreManifest {
  version: 1;
  storeSchemaVersion: number;
  generation: string;
  chunkCount: number;
  checksum: string;
  characterLength: number;
  writtenAt: string;
}

export interface StoreRecoveryEnvelope {
  version: 1;
  algorithm: 'AES-256-GCM';
  keyName: string;
  sourceKey: string;
  sourceSchemaVersion?: number;
  combinedBase64: string;
  checksum: string;
  createdAt: string;
  expiresAt: string;
  /** Retire early only if this exact migration generation survives the next verified reload. */
  cleanupAfterGeneration?: string;
  /** Discoverable key cleanup journal; prevents superseded-key orphaning. */
  supersededKeyNames?: string[];
}

export interface StorePersistenceAdapter {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  multiSet(entries: ReadonlyArray<readonly [string, string]>): Promise<void>;
  multiGet(keys: readonly string[]): Promise<Array<[string, string | null]>>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

export type StoreCommitBoundary =
  | 'CHUNKS_WRITTEN'
  | 'CHUNKS_VERIFIED'
  | 'RECOVERY_WRITTEN'
  | 'MANIFEST_FLIPPED'
  | 'MANIFEST_VERIFIED';

export type StoreStartupIssueCode =
  | 'CORRUPT_STORE'
  | 'MIGRATION_FAILED'
  | 'RECOVERY_WRITE_FAILED'
  | 'PERSISTENCE_FAILED';

export class StoreStartupError extends Error {
  readonly name = 'StoreStartupError';

  constructor(
    readonly code: StoreStartupIssueCode,
    message: string,
    readonly canRestore: boolean,
  ) {
    super(message);
  }
}

export function storeChunkKey(generation: string, index: number): string {
  return `${STORE_GENERATION_PREFIX}.${generation}.${index}`;
}

export function splitStoreDocument(
  document: string,
  chunkCharacters = STORE_CHUNK_CHARACTERS,
): string[] {
  if (!Number.isSafeInteger(chunkCharacters) || chunkCharacters < 1) {
    throw new Error('Store chunk size must be a positive safe integer.');
  }
  if (!document.length) return [''];
  const chunks: string[] = [];
  for (let offset = 0; offset < document.length; offset += chunkCharacters) {
    chunks.push(document.slice(offset, offset + chunkCharacters));
  }
  return chunks;
}

export function createStoreManifest(input: {
  document: string;
  generation: string;
  storeSchemaVersion: number;
  writtenAt: string;
  chunkCharacters?: number;
}): { manifest: StoreManifest; entries: Array<[string, string]> } {
  const chunks = splitStoreDocument(input.document, input.chunkCharacters);
  const manifest: StoreManifest = {
    version: 1,
    storeSchemaVersion: input.storeSchemaVersion,
    generation: input.generation,
    chunkCount: chunks.length,
    checksum: sha256(input.document),
    characterLength: input.document.length,
    writtenAt: input.writtenAt,
  };
  return {
    manifest,
    entries: chunks.map((chunk, index) => [storeChunkKey(input.generation, index), chunk]),
  };
}

export function parseStoreManifest(raw: string): StoreManifest {
  const value = JSON.parse(raw) as Partial<StoreManifest>;
  if (
    value.version !== 1 ||
    !Number.isSafeInteger(value.storeSchemaVersion) ||
    typeof value.generation !== 'string' ||
    !value.generation ||
    !Number.isSafeInteger(value.chunkCount) ||
    (value.chunkCount ?? 0) < 1 ||
    typeof value.checksum !== 'string' ||
    typeof value.characterLength !== 'number' ||
    typeof value.writtenAt !== 'string'
  ) {
    throw new Error('Store manifest is invalid.');
  }
  return value as StoreManifest;
}

export function storeChunkKeys(manifest: StoreManifest): string[] {
  return Array.from(
    { length: manifest.chunkCount },
    (_, index) => storeChunkKey(manifest.generation, index),
  );
}

export function joinAndVerifyStoreDocument(
  manifest: StoreManifest,
  rows: ReadonlyArray<readonly [string, string | null]>,
): string {
  const byKey = new Map(rows);
  const chunks = storeChunkKeys(manifest).map((key) => byKey.get(key));
  if (chunks.some((chunk) => chunk === null || chunk === undefined)) {
    throw new Error('A persisted store chunk is missing.');
  }
  const document = (chunks as string[]).join('');
  if (document.length !== manifest.characterLength || sha256(document) !== manifest.checksum) {
    throw new Error('Persisted store checksum validation failed.');
  }
  return document;
}

export function parseRecoveryEnvelope(raw: string): StoreRecoveryEnvelope {
  const value = JSON.parse(raw) as Partial<StoreRecoveryEnvelope>;
  if (
    value.version !== 1 ||
    value.algorithm !== 'AES-256-GCM' ||
    typeof value.keyName !== 'string' ||
    typeof value.sourceKey !== 'string' ||
    typeof value.combinedBase64 !== 'string' ||
    typeof value.checksum !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.expiresAt !== 'string'
  ) {
    throw new Error('Recovery metadata is invalid.');
  }
  if (
    value.cleanupAfterGeneration !== undefined &&
    typeof value.cleanupAfterGeneration !== 'string'
  ) throw new Error('Recovery cleanup generation is invalid.');
  if (
    value.supersededKeyNames !== undefined &&
    (!Array.isArray(value.supersededKeyNames) ||
      value.supersededKeyNames.some((key) => typeof key !== 'string' || !key))
  ) throw new Error('Recovery key cleanup journal is invalid.');
  return value as StoreRecoveryEnvelope;
}

export function recoveryHasExpired(
  envelope: StoreRecoveryEnvelope,
  now = Date.now(),
): boolean {
  const expiresAt = Date.parse(envelope.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now;
}

/** Delete only the exact superseded key after its replacement is verified. */
export function replacedRecoveryKey(
  previous: StoreRecoveryEnvelope | null,
  next: StoreRecoveryEnvelope | null,
): string | null {
  if (!previous || !next || previous.keyName === next.keyName) return null;
  return previous.keyName;
}

export function recoveryShouldCleanupAfterReload(
  envelope: StoreRecoveryEnvelope,
  manifest: StoreManifest,
): boolean {
  return envelope.cleanupAfterGeneration === manifest.generation;
}

export function recoveryEnvelopeMatches(
  current: StoreRecoveryEnvelope,
  expected: StoreRecoveryEnvelope,
): boolean {
  return current.keyName === expected.keyName && current.checksum === expected.checksum;
}

/** Call only while holding the lifecycle for this adapter. */
export async function removeRecoveryEnvelopeIfCurrent(input: {
  storage: StorePersistenceAdapter;
  expected: StoreRecoveryEnvelope;
  deleteKey: (keyName: string) => Promise<void>;
}): Promise<boolean> {
  const raw = await input.storage.getItem(STORE_RECOVERY_KEY).catch(() => null);
  if (!raw) return false;
  let current: StoreRecoveryEnvelope;
  try { current = parseRecoveryEnvelope(raw); } catch { return false; }
  if (!recoveryEnvelopeMatches(current, input.expected)) return false;

  await input.deleteKey(current.keyName);
  const latestRaw = await input.storage.getItem(STORE_RECOVERY_KEY).catch(() => null);
  if (!latestRaw) return true;
  let latest: StoreRecoveryEnvelope;
  try { latest = parseRecoveryEnvelope(latestRaw); } catch { return false; }
  if (!recoveryEnvelopeMatches(latest, current)) return false;
  await input.storage.multiRemove([STORE_RECOVERY_KEY]);
  return true;
}

export interface StoreCommitResult {
  manifest: StoreManifest;
  previousManifest: StoreManifest | null;
  recoveryEnvelope?: StoreRecoveryEnvelope;
  verifiedDocument: string;
}

export interface StoreCommitInput {
  storage: StorePersistenceAdapter;
  document: string;
  generation: string;
  storeSchemaVersion: number;
  writtenAt: string;
  recoveryEnvelope?: StoreRecoveryEnvelope;
  cleanupRecoveryAfterReload?: boolean;
  onBoundary?: (boundary: StoreCommitBoundary) => void | Promise<void>;
}

/** One invocation-ordered lifecycle per physical storage adapter. */
const storeLifecycleQueues = new WeakMap<StorePersistenceAdapter, Promise<void>>();

export function runStorePersistenceLifecycle<T>(
  storage: StorePersistenceAdapter,
  operation: () => Promise<T> | T,
): Promise<T> {
  const previous = storeLifecycleQueues.get(storage) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  const tail = current.then(() => undefined, () => undefined);
  storeLifecycleQueues.set(storage, tail);
  void tail.then(() => {
    if (storeLifecycleQueues.get(storage) === tail) storeLifecycleQueues.delete(storage);
  });
  return current;
}

/**
 * Durable two-phase store commit. New immutable chunks are fully written and
 * verified before one atomic active-manifest pointer flip. Old chunks remain
 * available until the new pointer and document have both been re-read.
 */
export function commitStoreDocument(input: StoreCommitInput): Promise<StoreCommitResult> {
  return runStorePersistenceLifecycle(
    input.storage,
    () => commitStoreDocumentWithinLifecycle(input),
  );
}

/** Call only while holding runStorePersistenceLifecycle for this adapter. */
export async function commitStoreDocumentWithinLifecycle(
  input: StoreCommitInput,
): Promise<StoreCommitResult> {
  let previousManifest: StoreManifest | null = null;
  const previousManifestRaw = await input.storage.getItem(STORE_MANIFEST_KEY);
  if (previousManifestRaw) {
    try { previousManifest = parseStoreManifest(previousManifestRaw); } catch { /* new commit can supersede */ }
  }
  let previousRecovery: StoreRecoveryEnvelope | null = null;
  const previousRecoveryRaw = input.recoveryEnvelope
    ? await input.storage.getItem(STORE_RECOVERY_KEY)
    : null;
  if (previousRecoveryRaw) {
    try { previousRecovery = parseRecoveryEnvelope(previousRecoveryRaw); } catch { /* preserve unknown metadata */ }
  }

  const { manifest, entries } = createStoreManifest({
    document: input.document,
    generation: input.generation,
    storeSchemaVersion: input.storeSchemaVersion,
    writtenAt: input.writtenAt,
  });
  await input.storage.multiSet(entries);
  await input.onBoundary?.('CHUNKS_WRITTEN');
  const stagedRows = await input.storage.multiGet(storeChunkKeys(manifest));
  const stagedDocument = joinAndVerifyStoreDocument(manifest, stagedRows);
  JSON.parse(stagedDocument);
  await input.onBoundary?.('CHUNKS_VERIFIED');

  let recoveryEnvelope: StoreRecoveryEnvelope | undefined;
  if (input.recoveryEnvelope) {
    const supersededKey = replacedRecoveryKey(previousRecovery, input.recoveryEnvelope);
    recoveryEnvelope = {
      ...input.recoveryEnvelope,
      ...(input.cleanupRecoveryAfterReload
        ? { cleanupAfterGeneration: manifest.generation }
        : {}),
      ...(supersededKey
        ? {
            supersededKeyNames: [
              ...new Set([
                ...(input.recoveryEnvelope.supersededKeyNames ?? []),
                supersededKey,
              ]),
            ],
          }
        : {}),
    };
    await input.storage.setItem(STORE_RECOVERY_KEY, JSON.stringify(recoveryEnvelope));
    const storedRecovery = await input.storage.getItem(STORE_RECOVERY_KEY);
    const parsedRecovery = storedRecovery ? parseRecoveryEnvelope(storedRecovery) : null;
    if (
      !parsedRecovery || parsedRecovery.keyName !== recoveryEnvelope.keyName ||
      parsedRecovery.checksum !== recoveryEnvelope.checksum
    ) throw new Error('Recovery metadata verification failed.');
  }
  await input.onBoundary?.('RECOVERY_WRITTEN');

  // This is the only mutable pointer in the generation protocol.
  await input.storage.setItem(STORE_MANIFEST_KEY, JSON.stringify(manifest));
  await input.onBoundary?.('MANIFEST_FLIPPED');
  const activeRaw = await input.storage.getItem(STORE_MANIFEST_KEY);
  const active = activeRaw ? parseStoreManifest(activeRaw) : null;
  if (!active || active.generation !== manifest.generation || active.checksum !== manifest.checksum) {
    throw new Error('Active store manifest verification failed.');
  }
  const activeRows = await input.storage.multiGet(storeChunkKeys(active));
  const verifiedDocument = joinAndVerifyStoreDocument(active, activeRows);
  JSON.parse(verifiedDocument);
  await input.onBoundary?.('MANIFEST_VERIFIED');

  if (previousManifest && previousManifest.generation !== manifest.generation) {
    await input.storage.multiRemove(storeChunkKeys(previousManifest)).catch(() => {});
  }
  return { manifest, previousManifest, recoveryEnvelope, verifiedDocument };
}
