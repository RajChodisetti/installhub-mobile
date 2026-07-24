declare const __DEV__: boolean;

const DEFAULT_SYNC_API_URL = 'https://api.sustainabilitywise.com.au';
const configuredApiUrl = process.env.EXPO_PUBLIC_SYNC_API_URL?.trim();
const isDevelopment = typeof __DEV__ !== 'undefined' && __DEV__;
const fallbackApiUrl = isDevelopment ? 'http://170.64.154.143' : DEFAULT_SYNC_API_URL;

export const SYNC_API_URL = (configuredApiUrl || fallbackApiUrl).replace(/\/$/, '');

// Bootstrap is a one-off migration bridge. Normal release builds must leave
// this flag disabled so no registration credential is embedded in the bundle.
const legacyBootstrapEnabled =
  process.env.EXPO_PUBLIC_ENABLE_LEGACY_BOOTSTRAP === 'true';
const configuredRegistrationSecret =
  process.env.EXPO_PUBLIC_REGISTRATION_SECRET?.trim() || null;

export const REGISTRATION_SECRET = legacyBootstrapEnabled
  ? configuredRegistrationSecret
  : null;

if (!isDevelopment && !SYNC_API_URL.startsWith('https://')) {
  throw new Error('EXPO_PUBLIC_SYNC_API_URL must use HTTPS in release builds.');
}
