import AsyncStorage from '@react-native-async-storage/async-storage';
import type { AppDataStore } from '../types';
import userFixture from './fixtures/user.json';
import installationsFixture from './fixtures/installations.json';
import zonesFixture from './fixtures/zones.json';
import electricalAssetsFixture from './fixtures/electricalAssets.json';
import siteAssetsFixture from './fixtures/siteAssets.json';

const STORAGE_KEY = 'installhub.mobile.store.v1';

let memoryStore: AppDataStore | null = null;
const listeners = new Set<() => void>();

function cloneFixtures(): AppDataStore {
  return {
    user: structuredClone(userFixture) as AppDataStore['user'],
    installations: structuredClone(installationsFixture) as AppDataStore['installations'],
    zones: structuredClone(zonesFixture) as AppDataStore['zones'],
    electricalAssets: structuredClone(electricalAssetsFixture) as AppDataStore['electricalAssets'],
    siteAssets: structuredClone(siteAssetsFixture) as AppDataStore['siteAssets'],
  };
}

export async function initStore(): Promise<AppDataStore> {
  if (memoryStore) return memoryStore;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (raw) {
      memoryStore = JSON.parse(raw) as AppDataStore;
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
