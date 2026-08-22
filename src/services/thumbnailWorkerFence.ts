/**
 * Keeps a downloaded cache attempt tied to the initiating authenticated
 * generation. Cleanup is attempt-specific and may run after invalidation, but
 * validation and the durable ready-state commit may not.
 */
export async function fetchAndCommitThumbnailForAuthority<Result>(
  assertCurrent: () => void,
  fetchAttempt: () => Promise<Result>,
  validateAttempt: (result: Result) => Promise<void>,
  commitAttempt: (result: Result) => Promise<void>,
  cleanupAttempt: () => void,
): Promise<void> {
  assertCurrent();
  try {
    const result = await fetchAttempt();
    assertCurrent();
    await validateAttempt(result);
    assertCurrent();
    await commitAttempt(result);
    assertCurrent();
  } catch (error) {
    cleanupAttempt();
    // Throw the authority error before an outer caller can record an A failure
    // or retry with credentials captured from B.
    assertCurrent();
    throw error;
  }
}
