const DEFAULT_SYNC_API_URL = 'https://api.sustainabilitywise.com.au';

export function resolveSyncApiUrl(configuredApiUrl?: string): string {
  const candidate = configuredApiUrl?.trim() || DEFAULT_SYNC_API_URL;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error('EXPO_PUBLIC_SYNC_API_URL must be a valid HTTPS origin.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('EXPO_PUBLIC_SYNC_API_URL must be a credential-free HTTPS origin.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('EXPO_PUBLIC_SYNC_API_URL must contain only a credential-free HTTPS origin.');
  }
  return url.origin;
}

export const SYNC_API_URL = resolveSyncApiUrl(
  process.env.EXPO_PUBLIC_SYNC_API_URL,
);
