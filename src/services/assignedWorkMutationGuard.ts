import type { Installation } from '../types';
import { assignedWorkPrestartActionIsLocked } from './assignedWorkPrestart';
import type { AuditWorkResumeAuthority } from './auditWorkTrackingResume';

export const ASSIGNED_WORK_ACCESS_REQUIRED_MESSAGE =
  'Assigned job details changed. Return to the job, review the current details, and acknowledge them before continuing.';
export const AUTHENTICATED_SESSION_CHANGED_MESSAGE =
  'Your authenticated session changed. Sign in again before continuing.';
export const LOCAL_CHECKOUT_OWNER_CHANGED_MESSAGE =
  'This local checkout belongs to another signed-in account. Refresh assigned work or sign back in before continuing.';

export class AssignedWorkAccessRequiredError extends Error {
  readonly code = 'ASSIGNED_WORK_ACCESS_REQUIRED';

  constructor(message = ASSIGNED_WORK_ACCESS_REQUIRED_MESSAGE) {
    super(message);
    this.name = 'AssignedWorkAccessRequiredError';
  }
}

const authorityBrand: unique symbol = Symbol('assigned-work-mutation-authority');

export interface AssignedWorkMutationAuthority {
  readonly actorUserId: string | null;
  readonly generation: number;
  readonly [authorityBrand]: symbol;
}

export interface AssignedWorkMutationAuthorityRuntime {
  replaceAuthenticatedActor(actorUserId: string | null): void;
  bootstrapHeadlessActor(
    cloudActorUserId: string,
    persistedActorUserId: string,
  ): AssignedWorkMutationAuthority;
  capture(): AssignedWorkMutationAuthority;
  actorForCurrentAuthority(
    authority: AssignedWorkMutationAuthority,
  ): string | null;
  assertCurrentAuthority(
    authority: AssignedWorkMutationAuthority,
    expectedActorUserId: string,
  ): string;
  assertMutationAllowed(
    installation: Installation,
    authority: AssignedWorkMutationAuthority,
  ): void;
}

/**
 * Creates a process-local session fence. Repository callers capture the fence
 * before any asynchronous work, then validate it again inside the serialized
 * store mutation. Actor IDs supplied by screens are never trusted.
 */
export function createAssignedWorkMutationAuthorityRuntime(): AssignedWorkMutationAuthorityRuntime {
  const runtimeIdentity = Symbol('assigned-work-mutation-runtime');
  let actorUserId: string | null = null;
  let generation = 0;

  const authorityIsCurrent = (
    authority: AssignedWorkMutationAuthority,
  ): boolean => (
    authority[authorityBrand] === runtimeIdentity
    && authority.generation === generation
    && authority.actorUserId === actorUserId
  );

  const actorForCurrentAuthority = (
    authority: AssignedWorkMutationAuthority,
  ): string | null => {
    if (!authorityIsCurrent(authority)) return null;
    return actorUserId;
  };

  const assertCurrentAuthority = (
    authority: AssignedWorkMutationAuthority,
    expectedActorUserId: string,
  ): string => {
    const currentActorUserId = actorForCurrentAuthority(authority);
    if (!currentActorUserId || currentActorUserId !== expectedActorUserId) {
      throw new AssignedWorkAccessRequiredError(
        AUTHENTICATED_SESSION_CHANGED_MESSAGE,
      );
    }
    return currentActorUserId;
  };

  return {
    replaceAuthenticatedActor(nextActorUserId) {
      if (nextActorUserId === actorUserId) return;
      actorUserId = nextActorUserId;
      generation += 1;
    },

    bootstrapHeadlessActor(cloudActorUserId, persistedActorUserId) {
      if (
        !cloudActorUserId
        || persistedActorUserId !== cloudActorUserId
      ) {
        throw new AssignedWorkAccessRequiredError(
          AUTHENTICATED_SESSION_CHANGED_MESSAGE,
        );
      }
      if (actorUserId === cloudActorUserId) {
        return {
          actorUserId,
          generation,
          [authorityBrand]: runtimeIdentity,
        };
      }
      // Only a truly fresh headless process may establish its first actor.
      // A null actor after logout/replacement has a non-zero generation and
      // must never be revived by a stale background task.
      if (actorUserId !== null || generation !== 0) {
        throw new AssignedWorkAccessRequiredError(
          AUTHENTICATED_SESSION_CHANGED_MESSAGE,
        );
      }
      actorUserId = cloudActorUserId;
      generation += 1;
      return {
        actorUserId,
        generation,
        [authorityBrand]: runtimeIdentity,
      };
    },

    capture() {
      return {
        actorUserId,
        generation,
        [authorityBrand]: runtimeIdentity,
      };
    },

    actorForCurrentAuthority,

    assertCurrentAuthority,

    assertMutationAllowed(installation, authority) {
      // Every local mutation is actor-owned, including non-assigned and
      // Completed records. Validate the captured process generation before
      // inspecting lifecycle fields so a held operation cannot cross logout,
      // same-user re-login, or an account switch.
      if (!authorityIsCurrent(authority)) {
        throw new AssignedWorkAccessRequiredError(
          AUTHENTICATED_SESSION_CHANGED_MESSAGE,
        );
      }
      const currentActorUserId = authority.actorUserId;
      if (
        !currentActorUserId
        || installation.local_owner_user_id !== currentActorUserId
      ) {
        throw new AssignedWorkAccessRequiredError(
          LOCAL_CHECKOUT_OWNER_CHANGED_MESSAGE,
        );
      }
      if (installation.assigned_work_state === 'inactive') {
        throw new AssignedWorkAccessRequiredError();
      }
      if (
        installation.assigned_work_state !== 'active'
        || installation.status !== 'Draft'
      ) {
        return;
      }

      if (assignedWorkPrestartActionIsLocked(installation, currentActorUserId)) {
        throw new AssignedWorkAccessRequiredError();
      }
    },
  };
}

const runtime = createAssignedWorkMutationAuthorityRuntime();

export function replaceAuthenticatedAssignedWorkActor(
  actorUserId: string | null,
): void {
  runtime.replaceAuthenticatedActor(actorUserId);
}

export function captureAssignedWorkMutationAuthority(): AssignedWorkMutationAuthority {
  return runtime.capture();
}

export function bootstrapHeadlessAssignedWorkAuthority(
  cloudActorUserId: string,
  persistedActorUserId: string,
): AssignedWorkMutationAuthority {
  return runtime.bootstrapHeadlessActor(
    cloudActorUserId,
    persistedActorUserId,
  );
}

/**
 * Captures one authenticated generation for a suspend/resume lifecycle. The
 * returned authority becomes false immediately on logout, same-user re-login,
 * or an account switch.
 */
export function captureAuditWorkResumeAuthority(
  actorUserId: string,
): AuditWorkResumeAuthority {
  const authority = captureAssignedWorkMutationAuthority();
  assertCurrentAssignedWorkAuthority(authority, actorUserId);
  return {
    actorUserId,
    isCurrent: () => {
      try {
        assertCurrentAssignedWorkAuthority(authority, actorUserId);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function actorForCurrentAssignedWorkAuthority(
  authority: AssignedWorkMutationAuthority,
): string | null {
  return runtime.actorForCurrentAuthority(authority);
}

export function assertCurrentAssignedWorkAuthority(
  authority: AssignedWorkMutationAuthority,
  expectedActorUserId: string,
): string {
  return runtime.assertCurrentAuthority(authority, expectedActorUserId);
}

export function assertAssignedWorkMutationAllowed(
  installation: Installation,
  authority: AssignedWorkMutationAuthority,
): void {
  runtime.assertMutationAllowed(installation, authority);
}

export function captureAssignedWorkMutationGuard(): (
  installation: Installation,
) => void {
  const authority = captureAssignedWorkMutationAuthority();
  return (installation) => {
    assertAssignedWorkMutationAllowed(installation, authority);
  };
}

export function isAssignedWorkAccessRequiredError(
  error: unknown,
): error is AssignedWorkAccessRequiredError {
  return error instanceof AssignedWorkAccessRequiredError
    || (
      error instanceof Error
      && (error as Error & { code?: unknown }).code === 'ASSIGNED_WORK_ACCESS_REQUIRED'
  );
}

export function assignedWorkActionIsLocked(
  installation: Installation,
  actorUserId: string | null | undefined,
): boolean {
  return installation.assigned_work_state === 'inactive'
    || assignedWorkPrestartActionIsLocked(installation, actorUserId);
}

export function assignedWorkRouteMustReturnToDetail(
  installation: Installation,
  actorUserId: string | null | undefined,
  routeName: string,
  routeInstallationId: string | null,
): boolean {
  if (
    routeName === 'InstallationDetail'
    || routeInstallationId !== installation.id
  ) {
    return false;
  }
  return assignedWorkActionIsLocked(installation, actorUserId);
}
