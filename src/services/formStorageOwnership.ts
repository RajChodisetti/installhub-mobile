import { mediaReferenceIdentity } from './ownedMediaPaths';
/**
 * A cloned amendment can intentionally reference evidence stored in the
 * completed form's directory. Keep that directory while any surviving form
 * still points inside it.
 */
export function evidenceDirectoryIsReferenced(
  directoryUri: string,
  protectedAttachmentUris: readonly string[],
): boolean {
  const directory = mediaReferenceIdentity(directoryUri);
  const prefix = directory.endsWith('/') ? directory : `${directory}/`;
  return protectedAttachmentUris.some(
    (uri) => mediaReferenceIdentity(uri) === directory || mediaReferenceIdentity(uri).startsWith(prefix),
  );
}
