export interface ExactCloudActionLease<ProcessAuthority, CloudAuthority> {
  readonly actorUserId: string;
  readonly processAuthority: ProcessAuthority;
  readonly cloudAuthority: CloudAuthority;
  assertCurrent(): void;
}

export interface ExactCloudActionLeaseDependencies<ProcessAuthority, CloudAuthority> {
  captureProcessAuthority(): ProcessAuthority;
  actorForCurrentProcessAuthority(authority: ProcessAuthority): string | null;
  captureCloudAuthority(): Promise<CloudAuthority | null>;
  assertCurrentProcessAuthority(
    authority: ProcessAuthority,
    expectedActorUserId: string,
  ): void;
  assertCurrentCloudAuthority(
    authority: CloudAuthority,
    expectedActorUserId: string,
  ): void;
  missingProcessAuthorityError(): Error;
  missingCloudAuthorityError(): Error;
}

/**
 * Captures the process actor synchronously before the first await, then binds
 * the persisted cloud session to that exact actor and generation. A logout,
 * same-user re-login, or account replacement during SecureStore reads makes
 * the capture fail closed.
 */
export async function captureExactCloudActionLease<ProcessAuthority, CloudAuthority>(
  dependencies: ExactCloudActionLeaseDependencies<ProcessAuthority, CloudAuthority>,
): Promise<ExactCloudActionLease<ProcessAuthority, CloudAuthority>> {
  const processAuthority = dependencies.captureProcessAuthority();
  const actorUserId = dependencies.actorForCurrentProcessAuthority(processAuthority);
  if (!actorUserId) throw dependencies.missingProcessAuthorityError();

  let cloudAuthority: CloudAuthority | null;
  try {
    cloudAuthority = await dependencies.captureCloudAuthority();
  } catch (error) {
    dependencies.assertCurrentProcessAuthority(processAuthority, actorUserId);
    throw error;
  }
  dependencies.assertCurrentProcessAuthority(processAuthority, actorUserId);
  if (!cloudAuthority) throw dependencies.missingCloudAuthorityError();

  const assertCurrent = () => {
    dependencies.assertCurrentProcessAuthority(processAuthority, actorUserId);
    dependencies.assertCurrentCloudAuthority(cloudAuthority!, actorUserId);
  };
  assertCurrent();

  return {
    actorUserId,
    processAuthority,
    cloudAuthority,
    assertCurrent,
  };
}

/**
 * Fences one awaited action boundary. The operation must itself accept the
 * captured authority when it can mutate state, so a replacement that happens
 * while its internal serialization is held also fails before commit.
 */
export async function runLeasedCloudActionStep<
  ProcessAuthority,
  CloudAuthority,
  Result,
>(
  lease: ExactCloudActionLease<ProcessAuthority, CloudAuthority>,
  operation: () => Promise<Result>,
): Promise<Result> {
  lease.assertCurrent();
  try {
    const result = await operation();
    lease.assertCurrent();
    return result;
  } catch (error) {
    lease.assertCurrent();
    throw error;
  }
}

export function applyLeasedCloudActionState<
  ProcessAuthority,
  CloudAuthority,
  Result,
>(
  lease: ExactCloudActionLease<ProcessAuthority, CloudAuthority>,
  apply: () => Result,
): Result {
  lease.assertCurrent();
  const result = apply();
  lease.assertCurrent();
  return result;
}
