export interface AuditWorkResumeAuthority {
  actorUserId: string;
  isCurrent(): boolean;
}

export type AuditWorkSuspensionReason =
  | 'assignment-sync'
  | 'completion'
  | 'delete'
  | 'logout'
  | 'other';

/** Opaque, process-local ownership of one tracker suspension. */
export interface AuditWorkSuspensionToken {
  tokenId: string;
  installationId: string;
  actorUserId: string;
  reason: AuditWorkSuspensionReason;
}

export type AuditWorkSuspensionRegistry = Map<string, AuditWorkSuspensionToken>;

function authorityIsCurrent(
  authority: AuditWorkResumeAuthority,
  currentActorUserId: () => string | null,
): boolean {
  return authority.isCurrent()
    && currentActorUserId() === authority.actorUserId;
}

export function registerAuditWorkSuspension(
  suspended: AuditWorkSuspensionRegistry,
  installationId: string,
  actorUserId: string,
  tokenId: string,
  reason: AuditWorkSuspensionReason = 'other',
): AuditWorkSuspensionToken {
  const token = { tokenId, installationId, actorUserId, reason };
  suspended.set(tokenId, token);
  return token;
}

export function auditWorkIsSuspendedForActor(
  suspended: AuditWorkSuspensionRegistry,
  installationId: string | null,
  actorUserId: string | null,
): boolean {
  if (!installationId || !actorUserId) return false;
  return [...suspended.values()].some((token) => (
    token.installationId === installationId
    && token.actorUserId === actorUserId
  ));
}

export function discardAuditWorkSuspensionsForOtherActors(
  suspended: AuditWorkSuspensionRegistry,
  actorUserId: string | null,
): void {
  for (const [tokenId, token] of suspended) {
    if (!actorUserId || token.actorUserId !== actorUserId) {
      suspended.delete(tokenId);
    }
  }
}

/**
 * Adds a suspension only for the captured actor generation. A generation
 * replacement while tracker eligibility is being persisted removes only this
 * operation's token and cannot disturb a newer actor's same-installation lock.
 */
export async function suspendAuditWorkForAuthority(
  suspended: AuditWorkSuspensionRegistry,
  installationId: string,
  authority: AuditWorkResumeAuthority,
  currentActorUserId: () => string | null,
  createTokenId: () => string,
  applyEligibility: () => Promise<unknown>,
  reason: AuditWorkSuspensionReason = 'other',
): Promise<AuditWorkSuspensionToken | null> {
  if (!authorityIsCurrent(authority, currentActorUserId)) return null;

  const token = registerAuditWorkSuspension(
    suspended,
    installationId,
    authority.actorUserId,
    createTokenId(),
    reason,
  );
  try {
    await applyEligibility();
    if (authorityIsCurrent(authority, currentActorUserId)) return token;
    suspended.delete(token.tokenId);
    await applyEligibility().catch(() => undefined);
    return null;
  } catch (error) {
    suspended.delete(token.tokenId);
    await applyEligibility().catch(() => undefined);
    throw error;
  }
}

/**
 * Releases only process-local suspension reasons proven obsolete by an
 * authoritative lifecycle reconciliation. Unrelated delete/logout locks stay
 * installed even when they share the same actor and installation.
 */
export async function resumeAuditWorkSuspensionsByReasonForAuthority(
  suspended: AuditWorkSuspensionRegistry,
  installationId: string,
  reasons: ReadonlySet<AuditWorkSuspensionReason>,
  authority: AuditWorkResumeAuthority,
  currentActorUserId: () => string | null,
  applyEligibility: () => Promise<unknown>,
): Promise<number> {
  if (!authorityIsCurrent(authority, currentActorUserId)) return 0;
  const removed = [...suspended.values()].filter((token) => (
    token.installationId === installationId
    && token.actorUserId === authority.actorUserId
    && reasons.has(token.reason)
  ));
  if (!removed.length) return 0;
  removed.forEach((token) => suspended.delete(token.tokenId));
  let safelyResumed = false;
  try {
    await applyEligibility();
    if (!authorityIsCurrent(authority, currentActorUserId)) return 0;
    safelyResumed = true;
    return removed.length;
  } finally {
    if (!safelyResumed && currentActorUserId() === authority.actorUserId) {
      removed.forEach((token) => suspended.set(token.tokenId, token));
      await applyEligibility().catch(() => undefined);
    }
  }
}

function matchingSuspensions(
  suspended: AuditWorkSuspensionRegistry,
  target: string | AuditWorkSuspensionToken,
  actorUserId: string,
): AuditWorkSuspensionToken[] {
  if (typeof target !== 'string') {
    const current = suspended.get(target.tokenId);
    return current
      && current.installationId === target.installationId
      && current.actorUserId === target.actorUserId
      && current.actorUserId === actorUserId
      ? [current]
      : [];
  }
  const legacyToken = [...suspended.values()].find((token) => (
    token.installationId === target
    && token.actorUserId === actorUserId
  ));
  return legacyToken ? [legacyToken] : [];
}

/**
 * Removes only suspension tokens owned by the captured actor generation. If
 * that authority changes while eligibility persistence is in flight, the old
 * tokens are restored only while the provider still represents that actor.
 */
export async function resumeSuspendedAuditWorkForAuthority(
  suspended: AuditWorkSuspensionRegistry,
  target: string | AuditWorkSuspensionToken,
  authority: AuditWorkResumeAuthority,
  currentActorUserId: () => string | null,
  applyEligibility: () => Promise<unknown>,
): Promise<boolean> {
  if (!authorityIsCurrent(authority, currentActorUserId)) return false;

  const removed = matchingSuspensions(
    suspended,
    target,
    authority.actorUserId,
  );
  if (!removed.length) return true;
  removed.forEach((token) => suspended.delete(token.tokenId));
  let safelyResumed = false;
  try {
    await applyEligibility();
    if (!authorityIsCurrent(authority, currentActorUserId)) return false;
    safelyResumed = true;
    return true;
  } finally {
    if (!safelyResumed && currentActorUserId() === authority.actorUserId) {
      removed.forEach((token) => suspended.set(token.tokenId, token));
      await applyEligibility().catch(() => undefined);
    }
  }
}
