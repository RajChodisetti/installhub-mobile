import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseClientReportPhotoExclusions, type ClientReportPhotoExclusions } from '../domain/clientReport';

const key = (installationId: string) => `installhub.client-report-photos.v1:${encodeURIComponent(installationId)}`;
const currentSelections = new Map<string, ClientReportPhotoExclusions>();
const listeners = new Map<string, Set<(selection: ClientReportPhotoExclusions) => void>>();
const pendingWrites = new Map<string, Promise<void>>();

export async function readClientReportPhotoExclusions(installationId: string): Promise<ClientReportPhotoExclusions> {
  const existing = currentSelections.get(installationId);
  if (existing) return existing;
  const raw = await AsyncStorage.getItem(key(installationId));
  if (raw !== null) {
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new Error('Saved photo choices are unreadable.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || Object.values(parsed).some((value) => typeof value !== 'string' || !value)) {
      throw new Error('Saved photo choices are unreadable.');
    }
  }
  const loaded = parseClientReportPhotoExclusions(raw);
  const current = currentSelections.get(installationId) ?? loaded;
  currentSelections.set(installationId, current);
  return current;
}

export async function writeClientReportPhotoExclusions(installationId: string, exclusions: ClientReportPhotoExclusions): Promise<void> {
  currentSelections.set(installationId, exclusions);
  listeners.get(installationId)?.forEach((listener) => listener(exclusions));
  const next = (pendingWrites.get(installationId) ?? Promise.resolve()).catch(() => undefined)
    .then(() => AsyncStorage.setItem(key(installationId), JSON.stringify(exclusions)));
  pendingWrites.set(installationId, next);
  try { await next; } finally {
    if (pendingWrites.get(installationId) === next) pendingWrites.delete(installationId);
  }
}

export function subscribeClientReportPhotoExclusions(installationId: string, listener: (selection: ClientReportPhotoExclusions) => void): () => void {
  const group = listeners.get(installationId) ?? new Set();
  group.add(listener);
  listeners.set(installationId, group);
  return () => { group.delete(listener); if (!group.size) listeners.delete(installationId); };
}
