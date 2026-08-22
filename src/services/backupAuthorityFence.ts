/**
 * A signed PUT is intentionally unauthenticated. Recheck the initiating
 * authority after it settles and before the bearer-authenticated confirmation
 * request can capture credentials.
 */
export async function uploadThenConfirmForAuthority<T>(
  assertCurrent: () => void,
  upload: () => Promise<void>,
  confirm: () => Promise<T>,
): Promise<T> {
  assertCurrent();
  await upload();
  assertCurrent();
  return confirm();
}
