import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppDataStore, FormSubmission } from '../types';
import { normalizeCanonicalStore } from '../domain/installationV2';
import userFixture from './fixtures/user.json';
import installationsFixture from './fixtures/installations.json';
import zonesFixture from './fixtures/zones.json';
import electricalAssetsFixture from './fixtures/electricalAssets.json';
import siteAssetsFixture from './fixtures/siteAssets.json';
import {
  LEGACY_STORE_KEYS,
  RECOVERY_RETENTION_MS,
  STORE_MANIFEST_KEY,
  STORE_RECOVERY_KEY,
  StoreStartupError,
  commitStoreDocumentWithinLifecycle,
  joinAndVerifyStoreDocument,
  parseRecoveryEnvelope,
  parseStoreManifest,
  recoveryHasExpired,
  recoveryEnvelopeMatches,
  recoveryShouldCleanupAfterReload,
  removeRecoveryEnvelopeIfCurrent as removeCurrentRecoveryEnvelope,
  runStorePersistenceLifecycle,
  storeChunkKeys,
  type StorePersistenceAdapter,
  type StoreManifest,
  type StoreRecoveryEnvelope,
} from './storePersistence';
import { LOCAL_STORE_SCHEMA_VERSION } from '../domain/installationV2';
import { recordMigrationDiagnostic } from '../services/operationalDiagnostics';

let memoryStore: AppDataStore | null = null;
let startupError: StoreStartupError | null = null;
let initFlight: Promise<AppDataStore> | null = null;
const listeners = new Set<() => void>();

const storageAdapter: StorePersistenceAdapter = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  multiSet: (entries) => AsyncStorage.multiSet(entries.map(([key, value]) => [key, value])),
  multiGet: async (keys) => (await AsyncStorage.multiGet([...keys]))
    .map(([key, value]) => [key, value] as [string, string | null]),
  multiRemove: (keys) => AsyncStorage.multiRemove([...keys]),
};

function cloneFixtures(): AppDataStore {
  return normalizeCanonicalStore({
    schemaVersion: LOCAL_STORE_SCHEMA_VERSION,
    user: structuredClone(userFixture) as AppDataStore['user'],
    installations: structuredClone(installationsFixture) as AppDataStore['installations'],
    gridSupplies: [],
    zones: structuredClone(zonesFixture) as AppDataStore['zones'],
    electricalAssets: structuredClone(electricalAssetsFixture) as AppDataStore['electricalAssets'],
    siteAssets: structuredClone(siteAssetsFixture) as AppDataStore['siteAssets'],
    meterDevices: [],
    measurementAssignments: [],
    formSubmissions: [],
    cloudSync: {
      synced_at_by_installation: {},
      force_dirty_installation_ids: [],
      pending_complete_attempts: {},
      conflicted_complete_attempts: {},
      upload_queue: [],
      thumbnail_queue: [],
    },
  });
}

function normalizeFormSubmission(form: FormSubmission): FormSubmission {
  const answers = { ...form.answers };
  if (['ww-installation', 'a3rm-installation', 'a6m-installation'].includes(form.form_type)) {
    answers['device.id'] ??= answers['device.number'];
    answers['device.number'] = answers['device.id'] ?? answers['device.number'];
  }
  if (form.form_type === 'comms-fault') {
    answers['existing.device_id'] ??= answers['existing.device_number'] ?? answers['existing.serial_number'];
    answers['existing.device_number'] = answers['existing.device_id'] ?? answers['existing.device_number'];
    answers['works.new_device_id'] ??= answers['works.new_device_number'] ?? answers['works.new_serial'];
    if (answers['works.new_device_id']) {
      answers['works.new_device_number'] = answers['works.new_device_id'];
    }
  }
  return {
    ...form,
    schema_version: Number(form.schema_version) || 1,
    answers,
  };
}

export function normalizeStore(value: Partial<AppDataStore>): AppDataStore {
  const fixtures = cloneFixtures();
  const syncedAtByInstallation = value.cloudSync?.synced_at_by_installation ?? {};
  return normalizeCanonicalStore({
    schemaVersion: LOCAL_STORE_SCHEMA_VERSION,
    user: value.user ?? fixtures.user,
    installations: (value.installations ?? []).map((installation) => ({
      ...installation,
      cloud_backup_enabled: installation.cloud_backup_enabled ?? false,
      assigned_work_state: installation.assigned_work_state ?? 'none',
      // A completed legacy watermark proves a retained server copy existed.
      cloud_backup_retained:
        installation.cloud_backup_retained ??
        (!(installation.cloud_backup_enabled ?? false) && Boolean(syncedAtByInstallation[installation.id])),
      thumbnail_status: installation.thumbnail_status ?? 'ready',
      thumbnail_total: installation.thumbnail_total ?? 0,
      thumbnail_ready: installation.thumbnail_ready ?? 0,
    })),
    gridSupplies: value.gridSupplies ?? [],
    zones: value.zones ?? [],
    electricalAssets: value.electricalAssets ?? [],
    siteAssets: value.siteAssets ?? [],
    meterDevices: value.meterDevices ?? [],
    measurementAssignments: value.measurementAssignments ?? [],
    formSubmissions: (value.formSubmissions ?? []).map(normalizeFormSubmission),
    siteAssetEditorDrafts: value.siteAssetEditorDrafts ?? [],
    cloudSync: {
      synced_at_by_installation: syncedAtByInstallation,
      force_dirty_installation_ids: value.cloudSync?.force_dirty_installation_ids ?? [],
      pending_complete_attempts: value.cloudSync?.pending_complete_attempts ?? {},
      conflicted_complete_attempts: value.cloudSync?.conflicted_complete_attempts ?? {},
      upload_queue: value.cloudSync?.upload_queue ?? [],
      thumbnail_queue: value.cloudSync?.thumbnail_queue ?? [],
    },
  });
}

function generationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

async function readManifestDocument(manifest: StoreManifest): Promise<string> {
  const rows = await AsyncStorage.multiGet(storeChunkKeys(manifest));
  return joinAndVerifyStoreDocument(manifest, rows);
}

async function hasUsableRecovery(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(STORE_RECOVERY_KEY);
    if (!raw) return false;
    const envelope = parseRecoveryEnvelope(raw);
    if (recoveryHasExpired(envelope)) return false;
    const SecureStore = await import('expo-secure-store');
    return Boolean(await SecureStore.getItemAsync(
      envelope.keyName,
      recoverySecureStoreOptions(SecureStore),
    ));
  } catch {
    return false;
  }
}

function recoverySecureStoreOptions(
  SecureStore: typeof import('expo-secure-store'),
) {
  return {
    keychainService: 'installhub.local-recovery.v1',
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  };
}

async function prepareEncryptedRecovery(
  document: string,
  sourceKey: string,
  sourceSchemaVersion?: number,
): Promise<StoreRecoveryEnvelope> {
  const [{ AESEncryptionKey, aesEncryptAsync }, SecureStore] = await Promise.all([
    import('expo-crypto'),
    import('expo-secure-store'),
  ]);
  const key = await AESEncryptionKey.generate();
  const keyName = `installhub.mobile.recovery.key.${generationId()}`;
  const createdAt = new Date();
  const sealed = await aesEncryptAsync(new TextEncoder().encode(document), key);
  const combinedBase64 = await sealed.combined('base64');
  const encodedKey = await key.encoded('base64');
  await SecureStore.setItemAsync(
    keyName,
    encodedKey,
    recoverySecureStoreOptions(SecureStore),
  );
  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    keyName,
    sourceKey,
    sourceSchemaVersion,
    combinedBase64: combinedBase64 as string,
    checksum: (await import('js-sha256')).sha256(document),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + RECOVERY_RETENTION_MS).toISOString(),
  };
}

async function deleteRecoveryKey(keyName: string): Promise<void> {
  const SecureStore = await import('expo-secure-store');
  await SecureStore.deleteItemAsync(
    keyName,
    recoverySecureStoreOptions(SecureStore),
  );
}

async function writeRecoveryEnvelopeOnly(envelope: StoreRecoveryEnvelope): Promise<void> {
  let previous: StoreRecoveryEnvelope | null = null;
  const previousRaw = await AsyncStorage.getItem(STORE_RECOVERY_KEY).catch(() => null);
  if (previousRaw) {
    try { previous = parseRecoveryEnvelope(previousRaw); } catch { /* preserve unknown metadata */ }
  }
  const persistedEnvelope: StoreRecoveryEnvelope = {
    ...envelope,
    ...(previous && previous.keyName !== envelope.keyName
      ? {
          supersededKeyNames: [
            ...new Set([...(envelope.supersededKeyNames ?? []), previous.keyName]),
          ],
        }
      : {}),
  };
  await AsyncStorage.setItem(STORE_RECOVERY_KEY, JSON.stringify(persistedEnvelope));
  const verified = await AsyncStorage.getItem(STORE_RECOVERY_KEY);
  if (!verified || parseRecoveryEnvelope(verified).keyName !== persistedEnvelope.keyName) {
    throw new Error('Recovery metadata verification failed.');
  }
  await retireSupersededRecoveryKeys(persistedEnvelope).catch(() => {});
}

async function retireSupersededRecoveryKeys(
  envelope: StoreRecoveryEnvelope,
): Promise<void> {
  const currentRaw = await AsyncStorage.getItem(STORE_RECOVERY_KEY).catch(() => null);
  if (!currentRaw) return;
  let current: StoreRecoveryEnvelope;
  try { current = parseRecoveryEnvelope(currentRaw); } catch { return; }
  if (!recoveryEnvelopeMatches(current, envelope)) return;
  const keys = [...new Set(envelope.supersededKeyNames ?? [])]
    .filter((key) => key !== envelope.keyName);
  if (!keys.length) return;
  for (const key of keys) await deleteRecoveryKey(key);
  const latestRaw = await AsyncStorage.getItem(STORE_RECOVERY_KEY).catch(() => null);
  if (!latestRaw) return;
  const latest = parseRecoveryEnvelope(latestRaw);
  if (!recoveryEnvelopeMatches(latest, envelope)) return;
  const cleaned = { ...latest };
  delete cleaned.supersededKeyNames;
  await AsyncStorage.setItem(STORE_RECOVERY_KEY, JSON.stringify(cleaned));
  const verified = await AsyncStorage.getItem(STORE_RECOVERY_KEY);
  if (!verified || parseRecoveryEnvelope(verified).keyName !== cleaned.keyName) {
    throw new Error('Recovery cleanup journal verification failed.');
  }
}

async function removeRecoveryEnvelopeIfCurrent(
  envelope: StoreRecoveryEnvelope,
): Promise<boolean> {
  return removeCurrentRecoveryEnvelope({
    storage: storageAdapter,
    expected: envelope,
    deleteKey: deleteRecoveryKey,
  });
}

async function cleanupExpiredRecovery(): Promise<void> {
  const raw = await AsyncStorage.getItem(STORE_RECOVERY_KEY).catch(() => null);
  if (!raw) return;
  try {
    let envelope = parseRecoveryEnvelope(raw);
    await retireSupersededRecoveryKeys(envelope);
    const latestRaw = await AsyncStorage.getItem(STORE_RECOVERY_KEY);
    if (latestRaw) envelope = parseRecoveryEnvelope(latestRaw);
    if (!recoveryHasExpired(envelope)) return;
    await removeRecoveryEnvelopeIfCurrent(envelope);
  } catch {
    // Invalid recovery metadata is not trusted or used, but startup data is
    // left untouched so Diagnostics/support can inspect it.
  }
}

async function cleanupRecoveryAfterVerifiedReload(manifest: StoreManifest): Promise<void> {
  const raw = await AsyncStorage.getItem(STORE_RECOVERY_KEY).catch(() => null);
  if (!raw) return;
  try {
    let envelope = parseRecoveryEnvelope(raw);
    await retireSupersededRecoveryKeys(envelope);
    const latestRaw = await AsyncStorage.getItem(STORE_RECOVERY_KEY);
    if (latestRaw) envelope = parseRecoveryEnvelope(latestRaw);
    if (!recoveryShouldCleanupAfterReload(envelope, manifest)) return;
    // Delete the discoverable key first. If deletion fails, metadata remains
    // so support/retry can still identify the exact key.
    await removeRecoveryEnvelopeIfCurrent(envelope);
  } catch {
    // A failed cleanup never invalidates the already verified store.
  }
}

async function recoveryEnvelopeReferences(keyName: string): Promise<boolean> {
  const raw = await AsyncStorage.getItem(STORE_RECOVERY_KEY).catch(() => null);
  if (!raw) return false;
  try {
    return parseRecoveryEnvelope(raw).keyName === keyName;
  } catch {
    return false;
  }
}

async function persistDocument(
  document: string,
  recovery?: StoreRecoveryEnvelope,
  cleanupRecoveryAfterReload = false,
): Promise<string> {
  const committed = await commitStoreDocumentWithinLifecycle({
    storage: storageAdapter,
    document,
    generation: generationId(),
    storeSchemaVersion: LOCAL_STORE_SCHEMA_VERSION,
    writtenAt: new Date().toISOString(),
    recoveryEnvelope: recovery,
    cleanupRecoveryAfterReload,
  });
  if (committed.recoveryEnvelope) {
    await retireSupersededRecoveryKeys(committed.recoveryEnvelope).catch(() => {});
  }
  return committed.verifiedDocument;
}

async function startupFailure(
  code: ConstructorParameters<typeof StoreStartupError>[0],
  message: string,
): Promise<never> {
  void recordMigrationDiagnostic('FAILED', code);
  startupError = new StoreStartupError(code, message, await hasUsableRecovery());
  throw startupError;
}

async function migrateDocument(document: string, sourceKey: string): Promise<AppDataStore> {
  let recovery: StoreRecoveryEnvelope;
  try {
    let schemaVersion: number | undefined;
    try {
      schemaVersion = Number((JSON.parse(document) as Partial<AppDataStore>).schemaVersion) || undefined;
    } catch {
      // The raw bytes are still encrypted before the corrupt parse is surfaced.
    }
    recovery = await prepareEncryptedRecovery(document, sourceKey, schemaVersion);
  } catch (error) {
    return startupFailure(
      'RECOVERY_WRITE_FAILED',
      `The safe recovery copy could not be created, so migration did not run. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let normalized: AppDataStore;
  try {
    normalized = normalizeStore(JSON.parse(document) as Partial<AppDataStore>);
  } catch (error) {
    try {
      await writeRecoveryEnvelopeOnly(recovery);
    } catch {
      if (!(await recoveryEnvelopeReferences(recovery.keyName))) {
        await deleteRecoveryKey(recovery.keyName).catch(() => {});
      }
      return startupFailure('RECOVERY_WRITE_FAILED', 'The local data is unreadable and its recovery copy could not be saved.');
    }
    return startupFailure(
      'CORRUPT_STORE',
      `Local installation data is unreadable. It has not been replaced. ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  try {
    const verified = await persistDocument(JSON.stringify(normalized), recovery, true);
    const reloaded = normalizeStore(JSON.parse(verified) as Partial<AppDataStore>);
    if (JSON.stringify(reloaded) !== JSON.stringify(normalized)) {
      throw new Error('Verified reload did not reproduce the migrated store.');
    }
    // Legacy keys are removed only after the new generation and its in-process
    // verification. Early cleanup requires the exact migration generation on
    // the next verified startup reload. If a normal save advances first, the
    // recovery copy fails safe and remains until restore or seven-day expiry.
    await AsyncStorage.multiRemove([...LEGACY_STORE_KEYS]).catch(() => {});
    void recordMigrationDiagnostic('SUCCESS', 'RECOVERY_COPY_RETAINED');
    return reloaded;
  } catch (error) {
    if (!(await recoveryEnvelopeReferences(recovery.keyName))) {
      await deleteRecoveryKey(recovery.keyName).catch(() => {});
    }
    return startupFailure(
      'MIGRATION_FAILED',
      `Migration could not be committed. Existing local data was left in place. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function initStoreWithinLifecycle(): Promise<AppDataStore> {
  if (memoryStore) return memoryStore;
  if (startupError) throw startupError;
  await cleanupExpiredRecovery();

  const manifestRaw = await AsyncStorage.getItem(STORE_MANIFEST_KEY);
  if (manifestRaw) {
    let document: string;
    let manifest: StoreManifest;
    try {
      manifest = parseStoreManifest(manifestRaw);
      document = await readManifestDocument(manifest);
    } catch (error) {
      return startupFailure(
        'CORRUPT_STORE',
        `The saved installation store failed integrity checks and was not replaced. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    let parsed: Partial<AppDataStore>;
    try {
      parsed = JSON.parse(document) as Partial<AppDataStore>;
    } catch (error) {
      return startupFailure(
        'CORRUPT_STORE',
        `The saved installation store is unreadable and was not replaced. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const normalized = normalizeStore(parsed);
    const normalizedDocument = JSON.stringify(normalized);
    if (parsed.schemaVersion !== LOCAL_STORE_SCHEMA_VERSION || normalizedDocument !== document) {
      memoryStore = await migrateDocument(document, STORE_MANIFEST_KEY);
    } else {
      memoryStore = normalized;
      await cleanupRecoveryAfterVerifiedReload(manifest);
    }
    startupError = null;
    return memoryStore;
  }

  for (const key of LEGACY_STORE_KEYS) {
    const document = await AsyncStorage.getItem(key);
    if (!document) continue;
    memoryStore = await migrateDocument(document, key);
    startupError = null;
    return memoryStore;
  }

  // No current or legacy key is a genuine first run. Fixture creation is never
  // reached after a parse/integrity/migration failure.
  memoryStore = cloneFixtures();
  try {
    await persistDocument(JSON.stringify(memoryStore));
  } catch (error) {
    memoryStore = null;
    return startupFailure(
      'PERSISTENCE_FAILED',
      `Initial local storage could not be created. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  startupError = null;
  return memoryStore;
}

export function initStore(): Promise<AppDataStore> {
  if (initFlight) return initFlight;
  const operation = runStorePersistenceLifecycle(
    storageAdapter,
    initStoreWithinLifecycle,
  );
  const tracked = operation.finally(() => {
    if (initFlight === tracked) initFlight = null;
  });
  initFlight = tracked;
  return tracked;
}

function invalidateInitFlight(): void {
  // A later public lifecycle operation establishes an ordering boundary. An
  // init invoked after that boundary must queue behind it instead of joining an
  // older init that may still be running ahead of it.
  initFlight = null;
}

export function getStore(): AppDataStore {
  if (startupError) throw startupError;
  if (!memoryStore) {
    throw new Error('Local store has not finished loading.');
  }
  return memoryStore;
}

export function getStoreStartupError(): StoreStartupError | null {
  return startupError;
}

async function persistStoreWithinLifecycle(): Promise<void> {
  if (!memoryStore) return;
  normalizeCanonicalStore(memoryStore);
  const snapshot = JSON.stringify(memoryStore);
  await persistDocument(snapshot);
  listeners.forEach((listener) => listener());
}

export function persistStore(): Promise<void> {
  invalidateInitFlight();
  return runStorePersistenceLifecycle(storageAdapter, persistStoreWithinLifecycle);
}

export function subscribeStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function resetStoreWithinLifecycle(): Promise<AppDataStore> {
  const prior = memoryStore ? JSON.stringify(memoryStore) : null;
  const recovery = prior
    ? await prepareEncryptedRecovery(prior, STORE_MANIFEST_KEY, memoryStore?.schemaVersion)
    : undefined;
  const next = cloneFixtures();
  try {
    await persistDocument(JSON.stringify(next), recovery);
  } catch (error) {
    if (recovery && !(await recoveryEnvelopeReferences(recovery.keyName))) {
      await deleteRecoveryKey(recovery.keyName).catch(() => {});
    }
    throw error;
  }
  memoryStore = next;
  startupError = null;
  listeners.forEach((listener) => listener());
  return memoryStore;
}

export function resetStore(): Promise<AppDataStore> {
  invalidateInitFlight();
  return runStorePersistenceLifecycle(storageAdapter, resetStoreWithinLifecycle);
}

async function updateStoreWithinLifecycle(
  mutator: (store: AppDataStore) => void,
): Promise<AppDataStore> {
  const store = getStore();
  const priorSnapshot = JSON.stringify(store);
  try {
    mutator(store);
    await persistStoreWithinLifecycle();
    return store;
  } catch (error) {
    memoryStore = normalizeStore(JSON.parse(priorSnapshot) as Partial<AppDataStore>);
    throw error;
  }
}

export function updateStore(
  mutator: (store: AppDataStore) => void,
): Promise<AppDataStore> {
  invalidateInitFlight();
  return runStorePersistenceLifecycle(
    storageAdapter,
    () => updateStoreWithinLifecycle(mutator),
  );
}

async function retryStoreStartupWithinLifecycle(): Promise<AppDataStore> {
  memoryStore = null;
  startupError = null;
  return initStoreWithinLifecycle();
}

export function retryStoreStartup(): Promise<AppDataStore> {
  invalidateInitFlight();
  return runStorePersistenceLifecycle(storageAdapter, retryStoreStartupWithinLifecycle);
}

async function recoverStoreFromEncryptedCopyWithinLifecycle(): Promise<AppDataStore> {
  const raw = await AsyncStorage.getItem(STORE_RECOVERY_KEY);
  if (!raw) throw new Error('No encrypted recovery copy is available.');
  const envelope = parseRecoveryEnvelope(raw);
  if (recoveryHasExpired(envelope)) throw new Error('The encrypted recovery copy has expired.');
  const [{ AESEncryptionKey, AESSealedData, aesDecryptAsync }, SecureStore, { sha256 }] = await Promise.all([
    import('expo-crypto'),
    import('expo-secure-store'),
    import('js-sha256'),
  ]);
  const encodedKey = await SecureStore.getItemAsync(
    envelope.keyName,
    recoverySecureStoreOptions(SecureStore),
  );
  if (!encodedKey) throw new Error('The recovery key is unavailable on this device.');
  const key = await AESEncryptionKey.import(encodedKey, 'base64');
  const sealed = AESSealedData.fromCombined(envelope.combinedBase64);
  const bytes = await aesDecryptAsync(sealed, key);
  const document = new TextDecoder().decode(bytes);
  if (sha256(document) !== envelope.checksum) throw new Error('Recovery integrity validation failed.');
  const recovered = normalizeStore(JSON.parse(document) as Partial<AppDataStore>);
  const verified = await persistDocument(JSON.stringify(recovered));
  memoryStore = normalizeStore(JSON.parse(verified) as Partial<AppDataStore>);
  // Recovery was actually exercised and the restored generation was verified;
  // this satisfies the accepted early-cleanup gate.
  await retireSupersededRecoveryKeys(envelope);
  await removeRecoveryEnvelopeIfCurrent(envelope);
  void recordMigrationDiagnostic('RECOVERED', 'RECOVERY_RESTORED');
  startupError = null;
  listeners.forEach((listener) => listener());
  return memoryStore;
}

export function recoverStoreFromEncryptedCopy(): Promise<AppDataStore> {
  invalidateInitFlight();
  return runStorePersistenceLifecycle(
    storageAdapter,
    recoverStoreFromEncryptedCopyWithinLifecycle,
  );
}
