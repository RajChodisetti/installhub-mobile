export type DownloadAuthorization = 'api-bearer' | 'none';

export interface TrustedDownloadRequest {
  url: string;
  authorization: DownloadAuthorization;
}

function validApiOrigin(apiUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new Error('The configured InstallHub API URL is invalid.');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error('The configured InstallHub API URL must use credential-free HTTPS.');
  }
  return parsed;
}

function isExplicitSignedExternalUrl(url: URL): boolean {
  const capabilitySignature = url.searchParams.get('signature');
  const capabilityExpiry = url.searchParams.get('expires');
  const installHubCapability =
    /^\/v1\/(?:files|thumbnails)\//.test(url.pathname) &&
    Boolean(capabilityExpiry && /^\d+$/.test(capabilityExpiry)) &&
    Boolean(capabilitySignature && /^[a-f0-9]{64}$/i.test(capabilitySignature));

  const awsSigned =
    url.searchParams.get('X-Amz-Algorithm') === 'AWS4-HMAC-SHA256' &&
    Boolean(url.searchParams.get('X-Amz-Credential')) &&
    Boolean(url.searchParams.get('X-Amz-Date')) &&
    Boolean(url.searchParams.get('X-Amz-Expires')) &&
    /^[a-f0-9]{64}$/i.test(url.searchParams.get('X-Amz-Signature') ?? '');
  const googleSigned =
    url.searchParams.get('X-Goog-Algorithm') === 'GOOG4-RSA-SHA256' &&
    Boolean(url.searchParams.get('X-Goog-Credential')) &&
    Boolean(url.searchParams.get('X-Goog-Date')) &&
    Boolean(url.searchParams.get('X-Goog-Expires')) &&
    /^[a-f0-9]{64,1024}$/i.test(url.searchParams.get('X-Goog-Signature') ?? '');
  const azureSigned =
    /^[a-z0-9+/=_-]{32,1024}$/i.test(url.searchParams.get('sig') ?? '') &&
    Boolean(url.searchParams.get('se')) &&
    Boolean(url.searchParams.get('sp')) &&
    Boolean(url.searchParams.get('sv'));
  return installHubCapability || awsSigned || googleSigned || azureSigned;
}

/**
 * Resolves a server-provided file URL without ever forwarding InstallHub
 * credentials across an origin boundary.
 */
export function trustedDownloadRequest(
  candidate: string,
  configuredApiUrl: string,
): TrustedDownloadRequest {
  const api = validApiOrigin(configuredApiUrl);
  const raw = candidate.trim();
  if (!raw || raw.includes('\\')) throw new Error('The download URL is invalid.');

  let url: URL;
  try {
    url = /^https?:\/\//i.test(raw)
      ? new URL(raw)
      : new URL(raw.startsWith('/') ? raw : `/${raw}`, api.origin);
  } catch {
    throw new Error('The download URL is invalid.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Downloads must use credential-free HTTPS.');
  }
  if (url.origin === api.origin) {
    return { url: url.toString(), authorization: 'api-bearer' };
  }
  if (!isExplicitSignedExternalUrl(url)) {
    throw new Error('The external download URL is not an explicitly signed HTTPS URL.');
  }
  return { url: url.toString(), authorization: 'none' };
}
