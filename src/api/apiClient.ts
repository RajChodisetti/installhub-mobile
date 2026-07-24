import * as SecureStore from 'expo-secure-store';
import { REGISTRATION_SECRET, SYNC_API_URL } from '../constants/syncConfig';

const ACCESS_TOKEN_KEY = 'ih_cloud_jwt';
const REFRESH_TOKEN_KEY = 'ih_cloud_refresh';
const CLOUD_USER_KEY = 'ih_cloud_user';

export class AuthError extends Error {
  readonly type = 'auth' as const;
}

export class NetworkError extends Error {
  readonly type = 'network' as const;
}

export class ApiError extends Error {
  readonly type = 'api' as const;
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface CloudUser {
  id: string;
  email: string;
  fullName: string | null;
  role: 'admin' | 'inspector';
  app: 'installhub';
}

export interface ManagedCloudUser {
  id: string;
  email: string;
  fullName: string | null;
  role: 'admin' | 'inspector';
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
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
}

export interface InstallationAccess {
  installationId: string;
  assignedInspectorUserId: string | null;
  assignedInspector: Pick<
    ManagedCloudUser,
    'id' | 'email' | 'fullName' | 'role' | 'isActive'
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

interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: CloudUser;
}

async function saveTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken),
    SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}

async function saveCloudUser(user: CloudUser): Promise<void> {
  await SecureStore.setItemAsync(CLOUD_USER_KEY, JSON.stringify(user));
}

async function getCachedCloudUser(): Promise<CloudUser | null> {
  const raw = await SecureStore.getItemAsync(CLOUD_USER_KEY).catch(() => null);
  if (!raw) return null;
  try {
    const user = JSON.parse(raw) as CloudUser;
    return user.app === 'installhub' && user.id ? user : null;
  } catch {
    return null;
  }
}

export async function clearCloudTokens(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY).catch(() => {}),
    SecureStore.deleteItemAsync(CLOUD_USER_KEY).catch(() => {}),
  ]);
}

export async function getStoredCloudJwt(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY).catch(() => null);
}

async function parseError(response: Response): Promise<string> {
  const text = await response.text().catch(() => response.statusText);
  try {
    const parsed = JSON.parse(text) as { error?: string; detail?: string };
    return parsed.detail || parsed.error || text;
  } catch {
    return text || response.statusText;
  }
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  try {
    const response = await fetch(url, init);
    if (!response.ok) throw new ApiError(await parseError(response), response.status);
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new NetworkError(error instanceof Error ? error.message : String(error));
  }
}

export async function loginToCloud(input: {
  email: string;
  password: string;
  localUserId: string;
  fullName: string;
  role: 'admin' | 'inspector';
}): Promise<CloudUser> {
  let response: AuthResponse;
  try {
    response = await fetchJson<AuthResponse>(`${SYNC_API_URL}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: 'installhub',
        email: input.email.trim().toLowerCase(),
        password: input.password,
      }),
    });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401 || !REGISTRATION_SECRET) {
      throw error;
    }
    response = await fetchJson<AuthResponse>(`${SYNC_API_URL}/v1/auth/bootstrap-local`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Registration-Secret': REGISTRATION_SECRET,
      },
      body: JSON.stringify({
        app: 'installhub',
        localUserId: input.localUserId,
        username: input.email.trim().toLowerCase(),
        password: input.password,
        fullName: input.fullName,
      }),
    });
  }
  if (!response.accessToken || !response.refreshToken || response.user.app !== 'installhub') {
    throw new AuthError('The API returned an invalid InstallHub session.');
  }
  await saveTokens(response.accessToken, response.refreshToken);
  await saveCloudUser(response.user);
  return response.user;
}

let activeRefresh: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY).catch(() => null);
  if (!refreshToken) return null;
  try {
    const response = await fetch(`${SYNC_API_URL}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    if (!response.ok) {
      if ([400, 401, 403].includes(response.status)) await clearCloudTokens();
      return null;
    }
    const tokens = await response.json() as {
      accessToken?: string;
      refreshToken?: string;
    };
    if (!tokens.accessToken || !tokens.refreshToken) return null;
    await saveTokens(tokens.accessToken, tokens.refreshToken);
    return tokens.accessToken;
  } catch {
    return null;
  }
}

export async function refreshStoredCloudJwt(): Promise<string | null> {
  if (activeRefresh) return activeRefresh;
  activeRefresh = performRefresh();
  try {
    return await activeRefresh;
  } finally {
    activeRefresh = null;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  retried = false,
): Promise<T> {
  const token = await getStoredCloudJwt();
  if (!token) throw new AuthError('Cloud Backup is not connected.');
  try {
    const response = await fetch(`${SYNC_API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (response.status === 401 && !retried) {
      const refreshed = await refreshStoredCloudJwt();
      if (refreshed) return request<T>(method, path, body, true);
      throw new AuthError('Cloud session expired. Sign in again.');
    }
    if (response.status === 401) throw new AuthError('Cloud session expired. Sign in again.');
    if (!response.ok) throw new ApiError(await parseError(response), response.status);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return text.trim() ? JSON.parse(text) as T : undefined as T;
  } catch (error) {
    if (error instanceof ApiError || error instanceof AuthError) throw error;
    throw new NetworkError(error instanceof Error ? error.message : String(error));
  }
}

export async function restoreCloudSession(): Promise<CloudUser | null> {
  const cachedUser = await getCachedCloudUser();
  if (!await getStoredCloudJwt() && !await refreshStoredCloudJwt()) return cachedUser;
  try {
    const user = await request<CloudUser>('GET', '/v1/auth/me');
    await saveCloudUser(user);
    return user;
  } catch (error) {
    if (error instanceof AuthError) return null;
    if (error instanceof NetworkError) return cachedUser;
    throw error;
  }
}

export async function logoutFromCloud(): Promise<void> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY).catch(() => null);
  if (refreshToken) {
    await fetch(`${SYNC_API_URL}/v1/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {});
  }
  await clearCloudTokens();
}

export interface PhotoIdentity {
  installationId: string;
  entityType: string;
  entityId: string;
  fieldName: string;
}

export interface RemoteInstallationTree {
  installation: Record<string, unknown>;
  zones: Record<string, unknown>[];
  electricalAssets: Record<string, unknown>[];
  siteAssets: Record<string, unknown>[];
  formSubmissions: Record<string, unknown>[];
}

export interface InstallHubPullResponse {
  installations: RemoteInstallationTree[];
  pulledAt: string;
}

export const apiClient = {
  health: () => fetchJson<{ status: string }>(`${SYNC_API_URL}/health`, { method: 'GET' }),

  push: (payload: unknown) =>
    request<{
      installationId: string;
      versionNumber: number | null;
    }>('POST', '/v1/installhub/sync/push', payload),

  pull: (since: string, installationId?: string) => {
    const params = new URLSearchParams({ since });
    if (installationId) params.set('installationId', installationId);
    return request<InstallHubPullResponse>('GET', `/v1/installhub/sync/pull?${params}`);
  },

  deleteInstallationCloud: (installationId: string, purge = false) =>
    request<void>(
      'DELETE',
      `/v1/installhub/installations/${encodeURIComponent(installationId)}${
        purge ? '?purge=true' : ''
      }`,
    ),

  checkPhoto: (identity: PhotoIdentity & { checksum: string }) =>
    request<{ exists: boolean; remoteUrl?: string }>(
      'POST',
      '/v1/installhub/sync/check-photo',
      identity,
    ),

  createUploadSession: (
    input: PhotoIdentity & {
      checksum: string;
      filename: string;
      fileSizeBytes: number;
    },
  ) =>
    request<{
      sessionId: string;
      uploadUrl: string | null;
      alreadyExists: boolean;
      remoteUrl?: string;
    }>('POST', '/v1/installhub/sync/create-upload-session', input),

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
      if (!response.ok) throw new ApiError(await parseError(response), response.status);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new NetworkError(error instanceof Error ? error.message : String(error));
    }
  },

  confirmUpload: (sessionId: string, checksum: string) =>
    request<{ remoteUrl: string }>('POST', '/v1/installhub/sync/confirm-upload', {
      sessionId,
      checksum,
    }),

  startFormPdfJob: (installationId: string, formId: string) =>
    request<{ jobId: string; reused?: boolean }>(
      'POST',
      `/v1/installhub/installations/${encodeURIComponent(installationId)}/forms/${encodeURIComponent(formId)}/report/pdf/jobs`,
      {},
    ),

  startInstallationPdfJob: (installationId: string, formSubmissionIds?: string[]) =>
    request<{ jobId: string; reused?: boolean }>(
      'POST',
      `/v1/installhub/installations/${encodeURIComponent(installationId)}/report/pdf/jobs`,
      {
        formSubmissionIds:
          formSubmissionIds?.length ? [...new Set(formSubmissionIds)] : undefined,
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
  ) =>
    request<InstallationAccess>(
      'PATCH',
      `/v1/installhub/installations/${encodeURIComponent(installationId)}/access`,
      { assignedInspectorUserId },
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
