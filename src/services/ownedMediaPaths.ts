/** Stable identities for media created by this app. Never match a basename or
 * an arbitrary Documents directory: old iOS data-container roots alone qualify. */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const IOS_DOCUMENTS = new RegExp(`^file:///((?:private/)?var/mobile/Containers/Data/Application/${UUID}/Documents)(?:/|$)`, 'i');

export function ownedDocumentMediaPath(uri: string): string | null {
  const root = IOS_DOCUMENTS.exec(uri);
  if (!root) return null;
  const relative = uri.slice(root[0].length).replace(/\/$/, '');
  const parts = relative.split('/');
  if (!parts.every((part) => /^[a-z0-9_.-]+$/i.test(part) && part !== '.' && part !== '..')) return null;
  if (parts[0] === 'form-media' && parts.length >= 1 && parts.length <= 3) return relative;
  if (parts[0] === 'installhub-media' && parts.length >= 1 && parts.length <= 2) return relative;
  return null;
}

/** Resolve only managed files into the current sandbox. The persisted URI is
 * deliberately unchanged, preserving queue identities and immutable archives. */
export function resolveOwnedMediaUri(uri: string, currentDocumentsUri?: string): string {
  if (uri.endsWith('/')) return uri;
  const relative = ownedDocumentMediaPath(uri);
  if (!relative) return uri;
  const parts = relative.split('/');
  if ((parts[0] === 'form-media' && parts.length !== 3)
    || (parts[0] === 'installhub-media' && parts.length !== 2)) return uri;
  // Kept lazy so pure store/domain modules do not load native file-system I/O.
  const current = currentDocumentsUri ?? (require('expo-file-system') as typeof import('expo-file-system')).Paths.document.uri;
  const match = IOS_DOCUMENTS.exec(current);
  if (!match || current.slice(match[0].length)) return uri;
  return `${current.replace(/\/$/, '')}/${relative}`;
}

export function mediaReferenceIdentity(uri: string): string {
  const relative = ownedDocumentMediaPath(uri);
  return relative ? `owned-document:${relative}` : uri;
}

/** A deleted UI attachment may remain referenced by an amendment, pending
 * receipt, another record or an immutable recovery envelope. Those references
 * protect the same file even when they contain an older sandbox root. */
export function storedMediaIsReferenced(uri: string, document: unknown): boolean {
  const expected = mediaReferenceIdentity(uri);
  const visited = new Set<object>();
  const visit = (value: unknown): boolean => {
    if (typeof value === 'string') return mediaReferenceIdentity(value) === expected;
    if (!value || typeof value !== 'object' || visited.has(value)) return false;
    visited.add(value);
    return Object.values(value).some(visit);
  };
  return visit(document);
}
