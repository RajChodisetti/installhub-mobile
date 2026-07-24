/**
 * A cloned amendment can intentionally reference evidence stored in the
 * completed form's directory. Keep that directory while any surviving form
 * still points inside it.
 */
export function evidenceDirectoryIsReferenced(
  directoryUri: string,
  protectedAttachmentUris: readonly string[],
): boolean {
  const prefix = directoryUri.endsWith('/') ? directoryUri : `${directoryUri}/`;
  return protectedAttachmentUris.some(
    (uri) => uri === directoryUri || uri.startsWith(prefix),
  );
}
