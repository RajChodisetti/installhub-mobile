import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppDataStore, FormSubmission } from '../types';
import userFixture from './fixtures/user.json';
import installationsFixture from './fixtures/installations.json';
import zonesFixture from './fixtures/zones.json';
import electricalAssetsFixture from './fixtures/electricalAssets.json';
import siteAssetsFixture from './fixtures/siteAssets.json';

const STORAGE_KEY = 'installhub.mobile.store.v2';
const LEGACY_STORAGE_KEY = 'installhub.mobile.store.v1';

let memoryStore: AppDataStore | null = null;
const listeners = new Set<() => void>();

function cloneFixtures(): AppDataStore {
  return {
    user: structuredClone(userFixture) as AppDataStore['user'],
    installations: structuredClone(installationsFixture) as AppDataStore['installations'],
    zones: structuredClone(zonesFixture) as AppDataStore['zones'],
    electricalAssets: structuredClone(electricalAssetsFixture) as AppDataStore['electricalAssets'],
    siteAssets: structuredClone(siteAssetsFixture) as AppDataStore['siteAssets'],
    formSubmissions: [],
    cloudSync: {
      synced_at_by_installation: {},
      force_dirty_installation_ids: [],
      upload_queue: [],
      thumbnail_queue: [],
    },
  };
}

function normalizeFormSubmission(form: FormSubmission): FormSubmission {
  const answers = { ...form.answers };
  if (form.form_type === 'comms-fault') {
    answers['existing.device_id'] ??= answers['existing.serial_number'];
    answers['works.new_device_id'] ??= answers['works.new_serial'];
  }
  return {
    ...form,
    schema_version: Number(form.schema_version) || 1,
    answers,
  };
}

function normalizeStore(value: Partial<AppDataStore>): AppDataStore {
  const fixtures = cloneFixtures();
  const syncedAtByInstallation =
    value.cloudSync?.synced_at_by_installation ?? {};
  return {
    user: value.user ?? fixtures.user,
    installations: (value.installations ?? []).map((installation) => ({
      ...installation,
      cloud_backup_enabled: installation.cloud_backup_enabled ?? false,
      // Backfill legacy installs: a completed sync watermark proves a server
      // copy existed even though older app versions had no retained-copy flag.
      cloud_backup_retained:
        installation.cloud_backup_retained ??
        (
          !(installation.cloud_backup_enabled ?? false) &&
          Boolean(syncedAtByInstallation[installation.id])
        ),
      thumbnail_status: installation.thumbnail_status ?? 'ready',
      thumbnail_total: installation.thumbnail_total ?? 0,
      thumbnail_ready: installation.thumbnail_ready ?? 0,
    })),
    zones: value.zones ?? [],
    electricalAssets: value.electricalAssets ?? [],
    siteAssets: value.siteAssets ?? [],
    formSubmissions: (value.formSubmissions ?? []).map(normalizeFormSubmission),
    cloudSync: {
      synced_at_by_installation: syncedAtByInstallation,
      force_dirty_installation_ids: value.cloudSync?.force_dirty_installation_ids ?? [],
      upload_queue: value.cloudSync?.upload_queue ?? [],
      thumbnail_queue: value.cloudSync?.thumbnail_queue ?? [],
    },
  };
}

export async function initStore(): Promise<AppDataStore> {
  if (memoryStore) return memoryStore;
  try {
    const raw =
      (await AsyncStorage.getItem(STORAGE_KEY)) ??
      (await AsyncStorage.getItem(LEGACY_STORAGE_KEY));
    if (raw) {
      memoryStore = normalizeStore(JSON.parse(raw) as Partial<AppDataStore>);
      await persistStore();
      return memoryStore;
    }
  } catch {
    // fall through to fixtures
  }
  memoryStore = cloneFixtures();
  await persistStore();
  return memoryStore;
}

export function getStore(): AppDataStore {
  if (!memoryStore) {
    memoryStore = cloneFixtures();
  }
  return memoryStore;
}

export async function persistStore(): Promise<void> {
  if (!memoryStore) return;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(memoryStore));
  listeners.forEach((l) => l());
}

export function subscribeStore(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function resetStore(): Promise<AppDataStore> {
  memoryStore = cloneFixtures();
  await persistStore();
  return memoryStore;
}

export async function updateStore(
  mutator: (store: AppDataStore) => void,
): Promise<AppDataStore> {
  const store = getStore();
  mutator(store);
  await persistStore();
  return store;
}
