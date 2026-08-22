export async function dispatchAndAcknowledgeActiveTimeForAuthority<T>(
  assertCurrent: () => void,
  dispatch: () => Promise<T>,
  responseIsAccepted: (response: T) => boolean,
  acknowledge: (response: T, assertCurrent: () => void) => Promise<void>,
): Promise<boolean> {
  assertCurrent();
  let response: T;
  try {
    response = await dispatch();
  } catch {
    // A replacement authority aborts this flight; an ordinary same-authority
    // network/server failure remains durable for retry.
    assertCurrent();
    return false;
  }
  assertCurrent();
  if (!responseIsAccepted(response)) return false;
  assertCurrent();
  await acknowledge(response, assertCurrent);
  assertCurrent();
  return true;
}
