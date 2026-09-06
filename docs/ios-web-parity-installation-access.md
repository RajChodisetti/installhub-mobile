# Installation access request scope

Updated 2026-09-05. Source **FIXED**; physical native/API assignment remains **RETEST**. This correction changes only the access screen and its local regression tests. No installation assignment was changed through a device or live API during this work.

## Confirmed discrepancy

The former native `InstallationAccessScreen` retained a single access/selection state across route changes. Reads had no generation or focus guard. A delayed read for installation A could replace the displayed assignment after the route had moved to installation B; Save then combined the current route ID with the retained selection. A previous Save callback could also dispatch after blur or refocus, and two taps before a render dispatched twice. Actor-role equality alone did not identify an account or credential session.

The portal `apps/ecoaudit/src/modules/installhub/pages/AccessPage.tsx:50` keys its query by installation ID and administrator capability, and its loading/error branches prevent using unavailable access data. The dedicated API returns `installationId`, `assignedInspectorUserId`, and `assignedInspector`; `src/routes/installhub/installations.ts:233` permits authorized inspector reads, while PATCH at line 251 requires an administrator. Server permission and active Scheduler assignment constraints remain authoritative. The client defect did not bypass those server permissions, but an administrator could apply a stale selection to the wrong installation.

## Current behavior

[InstallationAccessScreen](../src/screens/InstallationAccessScreen.tsx) binds each read, selection and Save callback to the exact installation, current principal, and focused screen instance. It captures an authenticated cloud-action lease, validates returned installation and assigned-user identity, and rejects late access or directory results. Refocus requires a fresh read; unavailable data shows Retry instead of assignment controls. Inspectors still load only access, and only administrators fetch the user directory and see assignment controls.

Save binds its installation and selected user before awaiting, checks the successful read's original lease, and uses a synchronous in-flight flag to suppress duplicate taps. Blur, route changes, account replacement, credential expiry and role changes make old callbacks inert. Save responses must match both the requested installation and assignee before success is shown. Results/errors from an already-started request cannot overwrite another screen or emit stale alerts; this does not claim cancellation or rollback of an HTTP operation already entered.

The screen reuses the existing `loadInstallationAccessView` and authenticated lease helpers. It passes the exact captured cloud authority to both `getInstallationAccess(id, authority)` and `listUsers(authority)`, using the backward-compatible API-client signatures added by root. The required caller authority is checked inside `request()` after its stored-session read; it cannot silently adopt a replacement account during that await. No HTTP contract, backend schema, local installation tree, active-time, backup, or Settings retry behavior changed.

## Verification

[installationAccessScope.test.ts](../tests/installationAccessScope.test.ts) executes the production TSX and support loader with controlled React/focus scheduling and native/auth/network I/O. Sixteen tests cover wrong-ID reads and responses, reordered access/directory reads, route/actor/session/role transitions, blur/unmount/refocus, pending lease capture, duplicate Save dispatch, late mutation cleanup, inspector capability separation and current-session retry/success.

- Previous screen saved at workspace `tmp/field-parity-access-before.tsx`: the final sixteen tests produced **2 pass / 14 fail**, exit 1. Failures included the old screen retaining a saving state on a new route, so that case failed at its missing expected action rather than reaching the later race assertion.
- Current access tests plus support and commercial scope regressions: **36/36 pass**, zero failures/skips, exit 0.
- Full canonical `npm test` checkpoint: **914/914 pass**, zero failures/skips, exit 0 (37.686 seconds). Other agents' concurrent changes are included only as they existed at that run.
- Strict TypeScript check and changed-screen whitespace check: exit 0.

Final GET-authority correction: the existing admin production-screen regression now checks object identity of the original captured authority received by both GET methods. That assertion failed before the access GET passed its authority (one selected test, exit 1). All **16/16** focused access tests pass after the one-line correction, exit 0. The preceding full-suite/typecheck checkpoint predates this final change; root owns the combined final verification, and no duplicate full suite was run here.

These are local source/contract checks. They do not certify native focus behavior, live assignment changes, scheduled-job rejection, or another technician's subsequent assigned-work visibility. Those remain physical/deployed verification gates in the [master audit](ios-web-parity-audit.md).
