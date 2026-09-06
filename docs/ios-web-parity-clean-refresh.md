# Same-record portal to iOS clean refresh

Source audit and local regression evidence, 2026-09-05. Device verification is recorded separately in the main parity audit; source tests do not establish a device PASS.

## Confirmed root causes

`syncAssignedInstallations` materialized absent or differently owned checkouts, but only ran a metadata/lifecycle merge for an existing same-owner record. `mergeAssignedInstallationServerState` deliberately treats changed child fingerprints as a conflict, even when the local checkout has no unsynced changes. Therefore an ordinary portal zone/board/asset/meter/form edit could never refresh into an existing clean iOS checkout.

`applyServerTreeRevision` also clears the stored child fingerprint after a push advances the server revision. If another portal edit arrives before an equal-revision pull reseeds that fingerprint, the next revision has an unknown child baseline and is blocked. The observed “Assigned work tree changed on the server” message alone therefore does not establish whether the portal test added a zone concurrently.

## Implemented scope

- Initial canonical assigned/owned materialization and final confirmed backup record an exact local/server revision pair. A metadata-stage acknowledgement alone never establishes that pair. Final confirmation requires the accepted server revision to match the installed server revision.
- Before a pull, capture the same actor's opted-in, original Draft checkout only when its local and server revisions still match that confirmed pair, timestamps are backed up, no completion/final-backup/CAS/forced-dirty state exists, and all live local media references have cleared, confirmed queue rows. Hash the entire scoped tree, upload queue, and synced watermark.
- Before replacement, the same actor/session and storage-process authority are rechecked in the existing serialized materialization transaction. The exact prefetch hash, revision pair, and current eligibility must still match. The canonical mapper validates the server tree and retains server IDs. Replacement accepts only a strictly newer same-ID, same-owner canonical Draft; foreign child ownership, duplicate/colliding IDs, and incoming local-file references are rejected.
- Any installation screen retained anywhere in the navigation stack prevents replacement, even if covered by another screen. The registry reads live navigation both before fetch and in the commit. Missing/unready navigation also defers replacement. Persisted asset editor drafts separately prevent replacement.
- Confirmed local photo originals survive when the same entity still references the same confirmed remote URL. Queue identities are rebound after remote ordering changes, including repeated URLs. Canonical meter photo retention is reprojected into nested compatibility meters. No filesystem originals are deleted by refresh.
- Replacement updates only the exact installation-scoped records, advances the local mutation counter, persists the new confirmed pair/watermark, preserves naming high-water marks, invalidates stale derived data, and reconciles assigned-work change notices/prestart acknowledgement.
- An ordinary accepted metadata-only merge while a workspace is retained advances the server half of an already-proven clean pair only when the previously accepted child fingerprint remains identical and no merge conflict exists. Legacy, pending, and dirty checkouts never gain a new clean baseline from that path. This keeps a later child refresh eligible after returning Home.

## Local verification

`tests/assignedWorkCleanRefresh.test.ts` exercises the pure replacement boundary and executes the actual production pull/orchestration and canonical mapper with controlled network/store/session I/O. Coverage includes root and child adoption, duplicate-refresh refusal, foreign IDs, legacy baselines, same-timestamp dirty edits, pending completion/backup/media, forced dirty/CAS state, retained covered editors, missing navigation, late in-flight edits, same-user session replacement after fetch and inside the queued commit, photo reorder/duplicate URL identity, nested meter originals, final backup acceptance, and metadata-only baseline continuity without inventing a legacy/dirty baseline.

## Explicit recovery for an old or dirty conflict

An old checkout with no confirmed revision pair and an already-recorded child-change conflict remains protected. Such a conflict blocks backup dispatch, so “back up once” is not a recovery instruction for that record. This change must not be described as automatic recovery for every existing installation.

The current `Keep Local-Only` action retains the same local canonical ID. `Import Copy` creates a copy of the server tree, not a preserved copy of unsynced local work. These actions let the user retain local data and inspect a separate server copy, but do not reconcile the existing canonical checkout.

`assignedWorkConflictRecovery.ts` now provides a separate, explicit `Review sync conflict` action. Preparation captures the exact local and freshly fetched server versions. After the user selects `Preserve and use server`, confirmation refetches and compares both review hashes, checks actor/session/ownership/Draft state, and takes a synchronous installation recovery lock. Cancel performs no adoption. A changed review must be prepared again.

The canonical materializer atomically stores the complete original local tree, unknown fields, media references, queued uploads, drafts, receipts and informational time snapshot before adopting the same-ID server tree. Its `same_actor_reconciliation` envelope is read-only and local-only: it is excluded from ordinary editable copies, financial summaries and upload replay. Settings `Inspect recovery copy` displays the stored sections and original evidence. Existing active-time session/outbox identities retain ordinary same-actor delivery; the snapshot does not claim that time was delivered. Cross-actor quarantine retains its separate support-only policy.

The implementation fences recovery against backup startup, receipt replay and queue commits, skips locked thumbnail work, and rechecks archive media references immediately before cache deletion. Whole-record deletion also preserves originals referenced by a recovery archive. Canonical ID checks reject foreign nested channels while allowing an amendment's legitimate attachment reuse. Tests execute the actual prepare/confirm/materialize path and real chunked-storage reload/failure rollback; independent review covered these concurrency and retention boundaries.

These recovery changes are FIXED in source and included in the fourth frozen Release build. The exact synthetic old Web checkout remains protected until the explicit physical-device Cancel/preserve/adopt/archive/relaunch test. Device recovery is RETEST; source tests alone do not close that gate.
