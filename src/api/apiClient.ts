import * as SecureStore from 'expo-secure-store';
import { SYNC_API_URL } from '../constants/syncConfig';
import type {
  AddressGeocodingStatus,
  AddressProvider,
  AddressSource,
  InstallationReadiness,
  InstallationReportDetailMode,
  UserSourceApp,
  UserSourceState,
  VirtualMeterDefinition,
} from '../types';
import {
  buildCloudLoginPayload,
  createSessionMutationCoordinator,
  isCloudAuthResponse,
  isCloudUser,
  persistCloudSessionWithRollback,
  persistSessionIfCurrent,
  restoreCloudSessionWithDependencies,
  runWithSessionAccessLease,
  type CloudAuthResponse,
  type CloudLoginSource,
  type CloudUser,
  type RefreshSessionResult,
} from '../services/authSession';
import {
  formReportVersionQuery,
  installationReportVersionFields,
  type ReportVersionSelection,
} from '../services/reportVersioning';
import { buildNotificationDeviceDeletePath } from '../services/pushNotificationRegistration';
export type { CloudUser } from '../services/authSession';

const ACCESS_TOKEN_KEY = 'ih_cloud_jwt';
const REFRESH_TOKEN_KEY = 'ih_cloud_refresh';
const CLOUD_USER_KEY = 'ih_cloud_user';
const cloudSessionMutations = createSessionMutationCoordinator();
const cloudSessionAuthorityBrand: unique symbol = Symbol('cloud-session-authority');
const cloudSessionAuthorityIdentity = Symbol('cloud-session-authority-runtime');

export interface CloudSessionAuthority {
  readonly actorUserId: string;
  readonly generation: number;
  readonly [cloudSessionAuthorityBrand]: symbol;
}

export class AuthError extends Error {
  readonly type = 'auth' as const;
}

export class NetworkError extends Error {
  readonly type = 'network' as const;
}

export class ApiError extends Error {
  readonly type = 'api' as const;
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface ManagedCloudUser {
  id: string;
  email: string;
  fullName: string | null;
  role: 'admin' | 'inspector';
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  sourceManaged?: boolean;
  sourceApp?: UserSourceApp | null;
  sourceState?: UserSourceState;
}

export type InventoryMeterModel = 'A3RM' | 'A6M' | 'OTHER';
export type InventoryMeterStatus = 'company' | 'user' | 'installed';

export interface InventoryMeter {
  id: string;
  deviceId: string;
  deviceModel: InventoryMeterModel;
  customManufacturerName: string | null;
  customModelName: string | null;
  status: InventoryMeterStatus;
  custodianUserId: string | null;
  custodianName?: string | null;
  installedInstallationId: string | null;
  businessClientId: string | null;
  businessSiteId: string | null;
  notes: string | null;
  revision: number;
  updatedAt: string;
}

export interface InventoryMeterInput {
  deviceId: string;
  deviceModel: InventoryMeterModel;
  customManufacturerName?: string | null;
  customModelName?: string | null;
  notes?: string | null;
}

export interface ClientDirectorySite {
  id: string;
  clientId: string;
  siteName: string;
  displayAddress: string;
  locality: string | null;
  state: string | null;
  postcode: string | null;
  countryCode: 'AU';
  latitude: number | null;
  longitude: number | null;
  provider: AddressProvider | null;
  placeId: string | null;
  source: AddressSource;
  geocodingStatus: AddressGeocodingStatus;
  fingerprint: string;
  timezone: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  accessInformation: string | null;
  updatedAt: string;
}

export interface ClientDirectoryClient {
  id: string;
  name: string;
  normalizedKey: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  updatedAt: string;
  sites: ClientDirectorySite[];
}

export interface ClientDirectoryResponse {
  companyScope: 'current';
  clients: ClientDirectoryClient[];
}

export interface ClientAddressSuggestion {
  kind: 'client_saved' | 'provider';
  id: string;
  label: string;
  clientId: string | null;
  clientSiteId: string | null;
  siteName: string | null;
  address: {
    displayAddress: string;
    locality: string | null;
    state: string | null;
    postcode: string | null;
    countryCode: 'AU';
    latitude: number | null;
    longitude: number | null;
    provider: AddressProvider | null;
    placeId: string | null;
    source: AddressSource;
    geocodingStatus: AddressGeocodingStatus;
    fingerprint: string;
  };
}

export interface ClientAddressSuggestionsResponse {
  available: boolean;
  provider: AddressProvider | null;
  attribution: string | null;
  storedSuggestions: ClientAddressSuggestion[];
  providerSuggestions: ClientAddressSuggestion[];
  suggestions: ClientAddressSuggestion[];
}

export interface ExportJobStatus {
  id: string;
  status: 'queued' | 'running' | 'complete' | 'failed';
  phase: string | null;
  progressCurrent: number | null;
  progressTotal: number | null;
  pdfUrl: string | null;
  error: string | null;
  filename?: string;
  contentType?: string;
  recordVersionNumber: number | null;
  recordVersionPayloadHash: string | null;
  reportSource: 'canonical-version' | 'diagnostic-live';
  detailMode: InstallationReportDetailMode | null;
  reportVariantKey: string | null;
}

export type ReportJobVersionInput = ReportVersionSelection;

export interface ExportJobStartResponse {
  jobId: string;
  reused?: boolean;
  recordVersionNumber: number | null;
  recordVersionPayloadHash: string | null;
  reportSource: 'canonical-version' | 'diagnostic-live';
  detailMode: InstallationReportDetailMode;
  reportVariantKey: string | null;
}

export interface InstallationAccess {
  installationId: string;
  assignedInspectorUserId: string | null;
  assignedInspector: Pick<
    ManagedCloudUser,
    | 'id'
    | 'email'
    | 'fullName'
    | 'role'
    | 'isActive'
    | 'sourceManaged'
    | 'sourceApp'
    | 'sourceState'
  > | null;
}

export interface CloudStoredFile {
  storageKey: string;
  downloadUrl: string;
  contentType: string;
  sizeBytes: number;
  lastModified: string | null;
  source: 'photo_registry' | 'report_pdf' | 'storage';
  photoId: string | null;
  parentId: string | null;
  entityType: string | null;
  entityId: string | null;
  fieldName: string | null;
  originalFilename: string | null;
  status: string | null;
  uploadedAt: string | null;
  createdAt: string | null;
}

export interface InstallationFilesResponse {
  app: 'installhub';
  entityType: 'installation';
  installationId: string;
  installationName: string;
  prefix: string;
  files: CloudStoredFile[];
}

export interface InstallationVersionSummary {
  id: string;
  versionNumber: number;
  createdByUserId: string | null;
  createdAt: string;
}

export interface InstallationVersionRecord extends InstallationVersionSummary {
  app: 'installhub';
  entityType: 'installation';
  entityId: string;
  snapshot: RemoteInstallationTree;
}

function normalizeCloudUser(user: CloudUser): CloudUser {
  const sourceApp =
    user.sourceApp === 'ecoaudit' || user.sourceApp === 'solarsense'
      ? user.sourceApp
      : null;
  const sourceState =
    user.sourceState === 'linked' ||
    user.sourceState === 'orphaned' ||
    user.sourceState === 'explicit'
      ? user.sourceState
      : undefined;
  return {
    ...user,
    sourceManaged:
      user.sourceManaged === true ||
      sourceState === 'linked' ||
      sourceState === 'orphaned',
    sourceApp,
    sourceState,
  };
}

async function saveTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}

async function saveCloudUser(user: CloudUser): Promise<void> {
  await SecureStore.setItemAsync(
    CLOUD_USER_KEY,
    JSON.stringify(normalizeCloudUser(user)),
  );
}

async function getCachedCloudUser(): Promise<CloudUser | null> {
  const raw = await SecureStore.getItemAsync(CLOUD_USER_KEY).catch(() => null);
  if (!raw) return null;
  try {
    const user = JSON.parse(raw) as unknown;
    return isCloudUser(user) ? normalizeCloudUser(user) : null;
  } catch {
    return null;
  }
}

async function deleteStoredCloudSession(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(CLOUD_USER_KEY).catch(() => {}),
  ]);
}

export async function clearCloudTokens(): Promise<void> {
  cloudSessionMutations.invalidate();
  await cloudSessionMutations.runExclusive(deleteStoredCloudSession);
}

async function getStoredCloudJwt(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY).catch(() => null);
}

async function parseError(
  response: Response,
): Promise<{ message: string; code?: string }> {
  const text = await response.text().catch(() => response.statusText);
  try {
    const parsed = JSON.parse(text) as {
      error?: string;
      detail?: string;
      code?: string;
    };
    return {
      message: parsed.detail || parsed.error || text,
      ...(typeof parsed.code === 'string' && parsed.code.trim()
        ? { code: parsed.code.trim() }
        : {}),
    };
  } catch {
    return { message: text || response.statusText };
  }
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  try {
    const response = await fetch(url, init);
    if (!response.ok) {
      const parsed = await parseError(response);
      throw new ApiError(parsed.message, response.status, parsed.code);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new NetworkError(error instanceof Error ? error.message : String(error));
  }
}

export async function loginToCloud(input: {
  identifier: string;
  password: string;
  sourceApp?: CloudLoginSource;
}): Promise<CloudUser> {
  const initialGeneration = cloudSessionMutations.captureGeneration();
  let response: CloudAuthResponse;
  try {
    response = await fetchJson<CloudAuthResponse>(`${SYNC_API_URL}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildCloudLoginPayload(input)),
    });
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      throw new AuthError(
        'That username and password were not accepted for Field App Complete.',
      );
    }
    throw error;
  }
  if (!isCloudAuthResponse(response)) {
    throw new AuthError('The API returned an invalid Field App Complete session.');
  }
  let cloudUser = normalizeCloudUser(response.user);
  if (
    response.user.sourceManaged === undefined ||
    response.user.sourceApp === undefined ||
    response.user.sourceState === undefined
  ) {
    try {
      const me = await fetchJson<CloudUser>(`${SYNC_API_URL}/v1/auth/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${response.accessToken}` },
      });
      if (isCloudUser(me) && me.id === response.user.id) {
        cloudUser = normalizeCloudUser(me);
      }
    } catch {
      // Older APIs may not expose source metadata yet. The authenticated
      // session remains usable and a later restore will retry /me.
    }
  }
  let persisted = false;
  await cloudSessionMutations.runExclusive(async () => {
    if (!cloudSessionMutations.isCurrent(initialGeneration)) return;
    const sessionGeneration = cloudSessionMutations.invalidate();
    await persistCloudSessionWithRollback({
      persistTokens: () => saveTokens(
        response.accessToken,
        response.refreshToken,
      ),
      persistUser: () => saveCloudUser(cloudUser),
      revokeSession: () => fetch(`${SYNC_API_URL}/v1/auth/logout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: response.refreshToken }),
      }),
      clearSession: async () => {
        cloudSessionMutations.invalidate();
        await deleteStoredCloudSession();
      },
    });
    persisted = cloudSessionMutations.isCurrent(sessionGeneration);
  });
  if (!persisted) {
    void fetch(`${SYNC_API_URL}/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: response.refreshToken }),
    }).catch(() => {});
    throw new AuthError('This sign-in was cancelled. Please try again.');
  }
  return cloudUser;
}

interface StoredCloudSessionSnapshot {
  generation: number;
  accessToken: string | null;
  refreshToken: string | null;
}

const activeRefreshes = new Map<number, Promise<RefreshSessionResult>>();

async function getStoredRefreshToken(): Promise<string | null> {
  return SecureStore.getItemAsync(REFRESH_TOKEN_KEY).catch(() => null);
}

async function captureStoredCloudSession(): Promise<
  StoredCloudSessionSnapshot | null
> {
  return cloudSessionMutations.runExclusive(async () => {
    const generation = cloudSessionMutations.captureGeneration();
    const [accessToken, refreshToken] = await Promise.all([
      getStoredCloudJwt(),
      getStoredRefreshToken(),
    ]);
    if (!cloudSessionMutations.isCurrent(generation)) return null;
    return { generation, accessToken, refreshToken };
  });
}

/**
 * Captures the exact persisted cloud-account generation that may own a
 * multi-request workflow. Unlike a boolean session check, this lease becomes
 * stale across every logout/login replacement, including the same user
 * signing back in with new credentials.
 */
export async function captureCloudSessionAuthority(): Promise<CloudSessionAuthority | null> {
  return cloudSessionMutations.runExclusive(async () => {
    const generation = cloudSessionMutations.captureGeneration();
    const [accessToken, user] = await Promise.all([
      getStoredCloudJwt(),
      getCachedCloudUser(),
    ]);
    if (
      !cloudSessionMutations.isCurrent(generation)
      || !accessToken
      || !user
    ) {
      return null;
    }
    return {
      actorUserId: user.id,
      generation,
      [cloudSessionAuthorityBrand]: cloudSessionAuthorityIdentity,
    };
  });
}

export function assertCurrentCloudSessionAuthority(
  authority: CloudSessionAuthority,
  expectedActorUserId: string = authority.actorUserId,
): string {
  if (
    authority[cloudSessionAuthorityBrand] !== cloudSessionAuthorityIdentity
    || authority.actorUserId !== expectedActorUserId
    || !cloudSessionMutations.isCurrent(authority.generation)
  ) {
    throw new AuthError(
      'The cloud account changed while this sync was running. Please retry.',
    );
  }
  return authority.actorUserId;
}

export function cloudSessionAuthoritiesMatch(
  left: CloudSessionAuthority,
  right: CloudSessionAuthority,
): boolean {
  return left[cloudSessionAuthorityBrand] === cloudSessionAuthorityIdentity
    && right[cloudSessionAuthorityBrand] === cloudSessionAuthorityIdentity
    && left.generation === right.generation
    && left.actorUserId === right.actorUserId;
}

async function performRefresh(
  session: StoredCloudSessionSnapshot,
): Promise<RefreshSessionResult> {
  const { generation, refreshToken } = session;
  if (!refreshToken || !cloudSessionMutations.isCurrent(generation)) {
    return { status: 'rejected' };
  }

  const currentSession = await captureStoredCloudSession();
  if (!currentSession || currentSession.generation !== generation) {
    return { status: 'rejected' };
  }
  if (currentSession.refreshToken !== refreshToken) {
    return currentSession.accessToken
      ? { status: 'refreshed', accessToken: currentSession.accessToken }
      : { status: 'rejected' };
  }

  const rejectAndClearCurrentSession = async (): Promise<RefreshSessionResult> =>
    cloudSessionMutations.runExclusive(async () => {
      if (!cloudSessionMutations.isCurrent(generation)) {
        return { status: 'rejected' };
      }
      const [storedAccessToken, storedRefreshToken] = await Promise.all([
        getStoredCloudJwt(),
        getStoredRefreshToken(),
      ]);
      if (storedRefreshToken !== refreshToken) {
        return storedAccessToken
          ? { status: 'refreshed', accessToken: storedAccessToken }
          : { status: 'rejected' };
      }
      cloudSessionMutations.invalidate();
      await deleteStoredCloudSession();
      return { status: 'rejected' };
    });

  try {
    const response = await fetch(`${SYNC_API_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      if ([400, 401, 403, 404].includes(response.status)) {
        return rejectAndClearCurrentSession();
      }
      return { status: 'offline' };
    }
    let tokens: {
      accessToken?: string;
      refreshToken?: string;
    };
    try {
      tokens = await response.json() as typeof tokens;
    } catch {
      return rejectAndClearCurrentSession();
    }
    if (!tokens.accessToken || !tokens.refreshToken) {
      return rejectAndClearCurrentSession();
    }
    return cloudSessionMutations.runExclusive(async () => {
      if (!cloudSessionMutations.isCurrent(generation)) {
        return { status: 'rejected' };
      }
      const [storedAccessToken, storedRefreshToken] = await Promise.all([
        getStoredCloudJwt(),
        getStoredRefreshToken(),
      ]);
      if (storedRefreshToken !== refreshToken) {
        return storedAccessToken
          ? { status: 'refreshed', accessToken: storedAccessToken }
          : { status: 'rejected' };
      }
      try {
        await saveTokens(tokens.accessToken!, tokens.refreshToken!);
      } catch {
        cloudSessionMutations.invalidate();
        await deleteStoredCloudSession();
        return { status: 'rejected' };
      }
      return cloudSessionMutations.isCurrent(generation)
        ? { status: 'refreshed', accessToken: tokens.accessToken! }
        : { status: 'rejected' };
    });
  } catch {
    return { status: 'offline' };
  }
}

async function refreshCloudSession(
  providedSession?: StoredCloudSessionSnapshot,
): Promise<RefreshSessionResult> {
  const session = providedSession ?? await captureStoredCloudSession();
  if (
    !session?.refreshToken ||
    !cloudSessionMutations.isCurrent(session.generation)
  ) {
    return { status: 'rejected' };
  }
  const existing = activeRefreshes.get(session.generation);
  if (existing) return existing;

  const refresh = performRefresh(session);
  activeRefreshes.set(session.generation, refresh);
  try {
    return await refresh;
  } finally {
    if (activeRefreshes.get(session.generation) === refresh) {
      activeRefreshes.delete(session.generation);
    }
  }
}

export async function hasStoredCloudSession(): Promise<boolean> {
  const session = await captureStoredCloudSession();
  return !!session?.accessToken;
}

export async function runWithCloudAccessToken<T>(
  operation: (accessToken: string) => Promise<T>,
  requiredAuthority?: CloudSessionAuthority,
): Promise<T> {
  const session = await captureStoredCloudSession();
  if (!session?.accessToken) {
    throw new AuthError('Cloud Backup is not connected.');
  }
  if (requiredAuthority) {
    assertCurrentCloudSessionAuthority(requiredAuthority);
    if (session.generation !== requiredAuthority.generation) {
      throw new AuthError(
        'The cloud account changed while this download was running. Please retry.',
      );
    }
  }
  const result = await runWithSessionAccessLease(
    {
      generation: session.generation,
      accessToken: session.accessToken,
    },
    {
      isCurrent: cloudSessionMutations.isCurrent,
      perform: operation,
      refresh: async () => {
        const result = await refreshCloudSession(session);
        return result.status === 'refreshed' ? result.accessToken : null;
      },
      staleSessionError: () => new AuthError(
        'The cloud account changed while this download was running. Please retry.',
      ),
    },
  );
  if (requiredAuthority) {
    assertCurrentCloudSessionAuthority(requiredAuthority);
  }
  return result;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
  providedSession?: StoredCloudSessionSnapshot,
  signal?: AbortSignal,
  requiredAuthority?: CloudSessionAuthority,
): Promise<T> {
  const session = providedSession ?? await captureStoredCloudSession();
  if (!session?.accessToken) {
    throw new AuthError('Cloud Backup is not connected.');
  }
  const assertSessionIsCurrent = () => {
    if (requiredAuthority) {
      assertCurrentCloudSessionAuthority(requiredAuthority);
    }
    if (!cloudSessionMutations.isCurrent(session.generation)) {
      throw new AuthError(
        'The cloud account changed while this request was running. Please retry.',
      );
    }
  };
  assertSessionIsCurrent();
  try {
    const response = await fetch(`${SYNC_API_URL}${path}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    assertSessionIsCurrent();
    if (response.status === 401 && !retried) {
      const refresh = await refreshCloudSession(session);
      if (refresh.status === 'refreshed') {
        assertSessionIsCurrent();
        return request<T>(
          method,
          path,
          body,
          true,
          { ...session, accessToken: refresh.accessToken },
          signal,
          requiredAuthority,
        );
      }
      if (refresh.status === 'offline') {
        assertSessionIsCurrent();
        throw new NetworkError(
          'The cloud session could not be refreshed while offline.',
        );
      }
      throw new AuthError('Cloud session expired. Sign in again.');
    }
    if (response.status === 401) throw new AuthError('Cloud session expired. Sign in again.');
    if (!response.ok) {
      const parsed = await parseError(response);
      assertSessionIsCurrent();
      throw new ApiError(parsed.message, response.status, parsed.code);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    assertSessionIsCurrent();
    return text.trim() ? JSON.parse(text) as T : undefined as T;
  } catch (error) {
    if (!(error instanceof AuthError)) assertSessionIsCurrent();
    if (
      error instanceof ApiError ||
      error instanceof AuthError ||
      error instanceof NetworkError
    ) throw error;
    throw new NetworkError(error instanceof Error ? error.message : String(error));
  }
}

export async function restoreCloudSession(): Promise<CloudUser | null> {
  const generation = cloudSessionMutations.captureGeneration();
  return restoreCloudSessionWithDependencies({
    getCachedUser: getCachedCloudUser,
    getAccessToken: getStoredCloudJwt,
    getRefreshToken: getStoredRefreshToken,
    refreshSession: refreshCloudSession,
    fetchCurrentUser: async () => {
      const user = await request<unknown>('GET', '/v1/auth/me');
      return isCloudUser(user) ? normalizeCloudUser(user) : user;
    },
    persistCurrentUser: async (user) => {
      await persistSessionIfCurrent(
        cloudSessionMutations,
        generation,
        () => saveCloudUser(user),
      );
    },
    clearSession: clearCloudTokens,
    isOfflineError: (error) => (
      error instanceof NetworkError ||
      (error instanceof ApiError && error.status >= 500)
    ),
    isDefinitiveAuthError: (error) => (
      error instanceof AuthError ||
      (
        error instanceof ApiError &&
        [401, 403, 404].includes(error.status)
      )
    ),
  });
}

export async function logoutFromCloud(): Promise<void> {
  cloudSessionMutations.invalidate();
  const refreshToken = await cloudSessionMutations.runExclusive(async () => {
    const storedRefreshToken = await getStoredRefreshToken();
    await deleteStoredCloudSession();
    return storedRefreshToken;
  });
  if (refreshToken) {
    void fetch(`${SYNC_API_URL}/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {});
  }
}

export interface PhotoIdentity {
  installationId: string;
  baseTreeRevision: number;
  entityType: string;
  entityId: string;
  fieldName: string;
}

export interface RemoteInstallationTree {
  treeSchemaVersion?: number;
  treeRevision?: number;
  recordVersionNumber?: number;
  installation: Record<string, unknown>;
  gridSupplies?: Record<string, unknown>[];
  zones: Record<string, unknown>[];
  electricalAssets: Record<string, unknown>[];
  siteAssets: Record<string, unknown>[];
  meterDevices?: Record<string, unknown>[];
  measurementAssignments?: Record<string, unknown>[];
  formSubmissions: Record<string, unknown>[];
  serverDerived?: {
    virtualMeterDefinitions: VirtualMeterDefinition[];
  };
}

export interface InstallationMappingResponse {
  schema: 'installation-mapping/v1';
  authority?: 'SERVER_PINNED' | 'LOCAL_ADVISORY';
  installation: Record<string, unknown> & { recordVersionNumber: number };
  physicalLocations: Array<Record<string, unknown>>;
  electricalNodes: Array<Record<string, unknown>>;
  supplyEdges: Array<Record<string, unknown>>;
  unresolvedRelationships: Array<Record<string, unknown>>;
  meters: Array<Record<string, unknown>>;
  channels: Array<Record<string, unknown>>;
  measurementAssignments: Array<Record<string, unknown>>;
  assetCoverage: Array<Record<string, unknown>>;
  virtualMeters: VirtualMeterDefinition[];
  readiness: InstallationReadiness;
}

export interface InstallHubPushResponse {
  installationId: string;
  treeRevision: number;
  recordVersionNumber: number | null;
  /** Compatibility alias returned during the expand/migrate/contract window. */
  versionNumber: number | null;
  readiness: InstallationReadiness;
}

export interface InstallationLifecycleResponse {
  installationId: string;
  status: 'Draft' | 'Completed';
  treeRevision: number;
  recordVersionNumber: number | null;
  completedAt?: string | null;
  completedByUserId?: string | null;
  completedFromRevision?: number | null;
  completionNotes?: string | null;
  /** Compatibility alias accepted only at the response boundary. */
  completion_notes?: string | null;
  reopenedAt?: string | null;
  reopenReason?: string | null;
  readiness: InstallationReadiness;
}

export interface ActiveTimeSessionInput {
  revision: number;
  activeMilliseconds: number;
  startedAt: string;
  lastActiveAt: string;
  endedAt: string | null;
}

export interface ActiveTimeSessionResponse extends ActiveTimeSessionInput {
  sessionId: string;
  applied: boolean;
}

export interface NotificationDeviceInput {
  expoPushToken: string;
  platform: 'ios' | 'android';
  projectId: string;
  registrationGeneration: number;
}

export interface InstallHubPullResponse {
  installations: RemoteInstallationTree[];
  pulledAt: string;
}

export const apiClient = {
  health: () => fetchJson<{ status: string }>(`${SYNC_API_URL}/health`, { method: 'GET' }),

  push: (payload: unknown, authority?: CloudSessionAuthority) =>
    request<InstallHubPushResponse>(
      'POST', '/v1/installhub/sync/push', payload, false, undefined, undefined, authority,
    ),

  pull: (
    since: string,
    installationId?: string,
    authority?: CloudSessionAuthority,
  ) => {
    const params = new URLSearchParams({ since });
    if (installationId) params.set('installationId', installationId);
    return request<InstallHubPullResponse>(
      'GET', `/v1/installhub/sync/pull?${params}`, undefined, false, undefined, undefined, authority,
    );
  },

  listClientDirectory: (
    input: { q?: string; clientId?: string; limit?: number } = {},
    signal?: AbortSignal,
    authority?: CloudSessionAuthority,
  ) => {
    const params = new URLSearchParams();
    if (input.q) params.set('q', input.q);
    if (input.clientId) params.set('clientId', input.clientId);
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    const query = params.toString();
    return request<ClientDirectoryResponse>(
      'GET',
      `/v1/installhub/client-directory${query ? `?${query}` : ''}`,
      undefined,
      false,
      undefined,
      signal,
      authority,
    );
  },

  suggestClientAddresses: (
    input: { clientId?: string; query: string; postcode?: string; limit?: number },
    signal?: AbortSignal,
    authority?: CloudSessionAuthority,
  ) => request<ClientAddressSuggestionsResponse>(
    'POST',
    '/v1/installhub/client-address-suggestions',
    input,
    false,
    undefined,
    signal,
    authority,
  ),

  getInstallationMapping: (installationId: string, recordVersionNumber: number) => {
    const params = new URLSearchParams({ recordVersionNumber: String(recordVersionNumber) });
    return request<InstallationMappingResponse>(
      'GET',
      `/v1/installhub/installations/${encodeURIComponent(installationId)}/mapping?${params}`,
    );
  },

  deleteInstallationCloud: (
    installationId: string,
    purge = false,
    authority?: CloudSessionAuthority,
  ) =>
    request<void>(
      'DELETE',
      `/v1/installhub/installations/${encodeURIComponent(installationId)}${
        purge ? '?purge=true' : ''
      }`,
      undefined,
      false,
      undefined,
      undefined,
      authority,
    ),

  getInstallationReadiness: (
    installationId: string,
    recordVersionNumber?: number,
    authority?: CloudSessionAuthority,
  ) => {
    const query = recordVersionNumber === undefined
      ? ''
      : `?recordVersionNumber=${encodeURIComponent(String(recordVersionNumber))}`;
    return request<InstallationReadiness>(
      'GET',
      `/v1/installhub/installations/${encodeURIComponent(installationId)}/readiness${query}`,
      undefined,
      false,
      undefined,
      undefined,
      authority,
    );
  },

  completeInstallation: (
    installationId: string,
    input: {
      baseTreeRevision: number;
      idempotencyKey: string;
      completionNotes?: string | null;
    },
    authority?: CloudSessionAuthority,
  ) => request<InstallationLifecycleResponse>(
    'POST',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/complete`,
    input,
    false,
    undefined,
    undefined,
    authority,
  ),

  reopenInstallation: (
    installationId: string,
    input: { baseTreeRevision: number; reason: string },
    authority?: CloudSessionAuthority,
  ) => request<InstallationLifecycleResponse>(
    'POST',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/reopen`,
    input,
    false,
    undefined,
    undefined,
    authority,
  ),

  putInstallationActiveTimeSession: (
    installationId: string,
    sessionId: string,
    input: ActiveTimeSessionInput,
    authority?: CloudSessionAuthority,
  ) => request<ActiveTimeSessionResponse>(
    'PUT',
    `/v1/installhub/installations/${encodeURIComponent(installationId)}/active-time/sessions/${
      encodeURIComponent(sessionId)
    }`,
    input,
    false,
    undefined,
    undefined,
    authority,
  ),

  putNotificationDevice: (
    deviceId: string,
    input: NotificationDeviceInput,
    signal?: AbortSignal,
  ) =>
    request<unknown>(
      'PUT',
      `/v1/notifications/devices/${encodeURIComponent(deviceId)}`,
      input,
      false,
      undefined,
      signal,
    ),

  deleteNotificationDevice: (
    deviceId: string,
    registrationGeneration: number,
    signal?: AbortSignal,
  ) =>
    request<unknown>(
      'DELETE',
      buildNotificationDeviceDeletePath(deviceId, registrationGeneration),
      undefined,
      false,
      undefined,
      signal,
    ),

  checkPhoto: (
    identity: PhotoIdentity & { checksum: string },
    authority?: CloudSessionAuthority,
  ) =>
    request<{ exists: boolean; remoteUrl?: string; treeRevision?: number }>(
      'POST',
      '/v1/installhub/sync/check-photo',
      identity,
      false,
      undefined,
      undefined,
      authority,
    ),

  createUploadSession: (
    input: PhotoIdentity & {
      checksum: string;
      filename: string;
      fileSizeBytes: number;
    },
    authority?: CloudSessionAuthority,
  ) =>
    request<{
      sessionId: string;
      uploadUrl: string | null;
      alreadyExists: boolean;
      remoteUrl?: string;
      treeRevision?: number;
    }>(
      'POST',
      '/v1/installhub/sync/create-upload-session',
      input,
      false,
      undefined,
      undefined,
      authority,
    ),

  uploadPhoto: async (
    uploadUrl: string,
    bytes: ArrayBuffer,
    mimeType: string,
  ): Promise<void> => {
    try {
      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: bytes as unknown as BodyInit,
      });
      if (!response.ok) {
        const parsed = await parseError(response);
        throw new ApiError(parsed.message, response.status, parsed.code);
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new NetworkError(error instanceof Error ? error.message : String(error));
    }
  },

  confirmUpload: (
    sessionId: string,
    checksum: string,
    authority?: CloudSessionAuthority,
  ) =>
    request<{ remoteUrl: string; treeRevision: number }>(
      'POST',
      '/v1/installhub/sync/confirm-upload',
      { sessionId, checksum },
      false,
      undefined,
      undefined,
      authority,
    ),

  startFormPdfJob: (
    installationId: string,
    formId: string,
    version: ReportJobVersionInput,
  ) => {
    return request<ExportJobStartResponse>(
      'POST',
      `/v1/installhub/installations/${encodeURIComponent(installationId)}/forms/${encodeURIComponent(formId)}/report/pdf/jobs?${formReportVersionQuery(version)}`,
      {},
    );
  },

  startInstallationPdfJob: (
    installationId: string,
    formSubmissionIds: string[] | undefined,
    version: ReportJobVersionInput,
    detailMode: InstallationReportDetailMode = 'by-electrical-hierarchy',
  ) =>
    request<ExportJobStartResponse>(
      'POST',
      `/v1/installhub/installations/${encodeURIComponent(installationId)}/report/pdf/jobs`,
      {
        formSubmissionIds:
          formSubmissionIds?.length
            ? [...new Set(formSubmissionIds)].sort()
            : undefined,
        detailMode,
        ...installationReportVersionFields(version),
      },
    ),

  getExportJobStatus: (jobId: string) =>
    request<ExportJobStatus>(
      'GET',
      `/v1/export/jobs/${encodeURIComponent(jobId)}`,
    ),

  getLatestExportJob: (entityId: string) => {
    const params = new URLSearchParams({ entityId, artifactType: 'pdf' });
    return request<{ job: ExportJobStatus | null }>(
      'GET',
      `/v1/export/jobs/latest?${params}`,
    );
  },

  listUsers: () =>
    request<{ data: ManagedCloudUser[] }>('GET', '/v1/installhub/users'),

  getInventoryAccess: () =>
    request<{ userId: string; isMaintainer: boolean }>('GET', '/v1/installhub/inventory/me'),

  listInventoryMeters: (scope: 'mine' | 'company' = 'mine', q = '') => {
    const params = new URLSearchParams({ scope });
    if (q.trim()) params.set('q', q.trim());
    return request<{ data: InventoryMeter[] }>(
      'GET',
      `/v1/installhub/inventory/meters?${params}`,
    );
  },

  scanInventoryMeter: (input: InventoryMeterInput) =>
    request<InventoryMeter>('POST', '/v1/installhub/inventory/meters/scan', input),

  createInventoryMeter: (
    input: InventoryMeterInput & { custodianUserId?: string | null },
  ) => request<InventoryMeter>('POST', '/v1/installhub/inventory/meters', input),

  updateInventoryMeter: (
    id: string,
    input: Partial<InventoryMeterInput> & {
      expectedRevision: number;
      custodianUserId?: string | null;
    },
  ) => request<InventoryMeter>(
    'PATCH',
    `/v1/installhub/inventory/meters/${encodeURIComponent(id)}`,
    input,
  ),

  deleteInventoryMeter: (id: string) => request<void>(
    'DELETE',
    `/v1/installhub/inventory/meters/${encodeURIComponent(id)}`,
  ),

  createUser: (input: {
    email: string;
    password: string;
    fullName: string;
    role: ManagedCloudUser['role'];
  }) =>
    request<ManagedCloudUser>('POST', '/v1/installhub/users', input),

  getUser: (id: string) =>
    request<ManagedCloudUser>(
      'GET',
      `/v1/installhub/users/${encodeURIComponent(id)}`,
    ),

  updateUser: (
    id: string,
    patch: Partial<Pick<ManagedCloudUser, 'email' | 'fullName' | 'role' | 'isActive'>>,
  ) =>
    request<ManagedCloudUser>(
      'PATCH',
      `/v1/installhub/users/${encodeURIComponent(id)}`,
      patch,
    ),

  changeUserPassword: (
    id: string,
    input: { currentPassword?: string; newPassword: string },
  ) =>
    request<ManagedCloudUser>(
      'PATCH',
      `/v1/installhub/users/${encodeURIComponent(id)}/password`,
      input,
    ),

  deactivateUser: (id: string) =>
    request<void>(
      'DELETE',
      `/v1/installhub/users/${encodeURIComponent(id)}`,
    ),

  getInstallationAccess: (installationId: string) =>
    request<InstallationAccess>(
      'GET',
      `/v1/installhub/installations/${encodeURIComponent(installationId)}/access`,
    ),

  setInstallationAccess: (
    installationId: string,
    assignedInspectorUserId: string | null,
    authority?: CloudSessionAuthority,
  ) =>
    request<InstallationAccess>(
      'PATCH',
      `/v1/installhub/installations/${encodeURIComponent(installationId)}/access`,
      { assignedInspectorUserId },
      false,
      undefined,
      undefined,
      authority,
    ),

  listInstallationFiles: (installationId: string) =>
    request<InstallationFilesResponse>(
      'GET',
      `/v1/installhub/installations/${encodeURIComponent(installationId)}/files`,
    ),

  listInstallationVersions: (installationId: string) =>
    request<{
      app: 'installhub';
      entityType: 'installation';
      entityId: string;
      versions: InstallationVersionSummary[];
    }>(
      'GET',
      `/v1/installhub/installations/${encodeURIComponent(installationId)}/versions`,
    ),

  getInstallationVersion: (
    installationId: string,
    versionNumber: number,
  ) =>
    request<InstallationVersionRecord>(
      'GET',
      `/v1/installhub/installations/${encodeURIComponent(installationId)}/versions/${versionNumber}`,
    ),
};

export function cloudConnectionErrorMessage(error: unknown): string {
  if (error instanceof NetworkError) return 'Offline. Cloud Backup will retry automatically.';
  if (error instanceof AuthError) return error.message;
  if (error instanceof ApiError) return `Cloud Backup API error ${error.status}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
