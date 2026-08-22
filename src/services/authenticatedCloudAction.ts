import {
  AuthError,
  assertCurrentCloudSessionAuthority,
  captureCloudSessionAuthority,
  type CloudSessionAuthority,
} from '../api/apiClient';
import {
  actorForCurrentAssignedWorkAuthority,
  assertCurrentAssignedWorkAuthority,
  AUTHENTICATED_SESSION_CHANGED_MESSAGE,
  captureAssignedWorkMutationAuthority,
  type AssignedWorkMutationAuthority,
} from './assignedWorkMutationGuard';
import {
  captureExactCloudActionLease,
  type ExactCloudActionLease,
} from './cloudActionLease';

export type AuthenticatedCloudActionLease = ExactCloudActionLease<
  AssignedWorkMutationAuthority,
  CloudSessionAuthority
>;

export function bindAuthenticatedCloudActionLease(
  actorUserId: string,
  processAuthority: AssignedWorkMutationAuthority,
  cloudAuthority: CloudSessionAuthority,
): AuthenticatedCloudActionLease {
  const assertCurrent = () => {
    assertCurrentAssignedWorkAuthority(processAuthority, actorUserId);
    assertCurrentCloudSessionAuthority(cloudAuthority, actorUserId);
  };
  assertCurrent();
  return {
    actorUserId,
    processAuthority,
    cloudAuthority,
    assertCurrent,
  };
}

export function captureAuthenticatedCloudActionLease(): Promise<
  AuthenticatedCloudActionLease
> {
  return captureExactCloudActionLease({
    captureProcessAuthority: captureAssignedWorkMutationAuthority,
    actorForCurrentProcessAuthority: actorForCurrentAssignedWorkAuthority,
    captureCloudAuthority: captureCloudSessionAuthority,
    assertCurrentProcessAuthority: assertCurrentAssignedWorkAuthority,
    assertCurrentCloudAuthority: assertCurrentCloudSessionAuthority,
    missingProcessAuthorityError: () => new AuthError(
      AUTHENTICATED_SESSION_CHANGED_MESSAGE,
    ),
    missingCloudAuthorityError: () => new AuthError(
      'Cloud Backup is not connected.',
    ),
  });
}
