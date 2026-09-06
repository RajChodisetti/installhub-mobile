# Durable metadata backup recovery

The iOS metadata stage previously persisted no original request before POST. A server acceptance
followed by a lost response, failed canonical read or app termination could leave an old local CAS
base. An ordinary assigned pull then correctly paused the different child tree, even though the
mobile request may have introduced that difference.

## Implemented behavior

- Before POST, capture a detached local tree and its metadata wire payload. For an existing server
  base, fetch exactly that installation at that revision and bind the canonical preimage too.
  Recheck the current local tree, actor/session and dispatch guards inside the persistence transaction.
- Store SHA-256 hashes and a content-bound attempt ID in `pending_metadata_attempts`. Persist the
  accepted installation/revision/version receipt before any canonical merge.
- If an accepted receipt is saved, confirm with GET only; do not POST it again. Without a saved
  receipt, replay the exact original payload after ambiguous failure. The API's normalized no-op
  comparison must include its own generated display-code allocation: the API20 source correction
  covers that case, with deployment still a separate gate at this handoff. A different live tree
  still conflicts. This is a bounded no-op contract, not a new idempotency key or permission to rebase.
- Require an exact installation/schema/revision response and verify captured semantics. Completed
  forms and pending Comms replacement meters may retain server state only when the bound preimage
  proves the API's documented retention. Never accept arbitrary older meter state.
- Confirm unchanged original capture in place. For later local capture, require Home with no retained
  installation screen or persisted site-asset draft and use a three-way merge of server-owned
  identity, generated display codes and directory/address resolution. Keep later local fields,
  membership, forms, answers, evidence and upload queues.
- Recover pending metadata before ordinary assigned work refresh, inside the process singleflight.
  Pending/archived intents block new backup, completion, clean adoption and competing map/history
  server mutations. Ambiguous intent also blocks deletion and explicit version-choice recovery.
- A definitive metadata POST 409 archives the full original and receipt in
  `conflicted_metadata_attempts`. Explicit reviewed preserve-copy recovery may archive that intent
  with all local work; account reassignment also quarantines both maps under the original actor.
- Metadata alone never marks a full backup, advances its watermark, clears forced dirty state or
  establishes the confirmed local/server revision pair. Only the existing exact complete stage does.

## Limits and evidence

The original main QA checkout predated the journal; its explicit archive/adoption passed on build12.
The later electrical request has an accepted revision12 receipt followed by a replay conflict, which
is a separate journaled case. Build13 installed from unchanged source after 858 passing tests; its
first native recovery check stopped at sign-in, so no recovery device PASS is claimed here. No
legacy attempt is reconstructed from current capture and no server version is chosen without proof.
The implementation and source tests below use no live API calls or device operations.

Production helper and orchestration tests exercise lost acknowledgement, accepted-then-lost-read,
restart serialization, exact body replay, later local capture, active-editor/session/race rejection,
canonical preimage retention, definitive conflict preservation, actor quarantine and recovery-before-
assigned-pull ordering. Final command results are recorded in the task handoff; native QA remains a
separate gate.

API references: `src/routes/installhub/sync.ts` metadata retention and normalized no-op branch;
`treeService.ts::retainCompletedFormsDuringMetadata`;
`meterHistory.ts::retainPendingCommsReplacementMeterState`.


## Validation rejection recovery (local source; native gate pending)

A frozen metadata request could remain pending after a deterministic HTTP 400. Editing the local
capture then could not replace that request, and explicit recovery also refused the pending receipt.
A production-orchestration probe reproduced the deadlock with `comms_replacement_meter_missing`.

The mobile correction recognizes only current `/push` precommit/rolled-back validation detail codes:
`invalid_canonical_tree`, `unsupported_tree_schema`, the three `comms_replacement_*` errors,
`metadata_stage_cannot_complete_form`, `multiple_comms_replacements_per_meter`, and
`CANONICAL_EVIDENCE_UNRESOLVED`. HTTP 400 alone never proves rejection. The current API emits these
codes in the detail prefix (not a separate typed code). Its canonical validation precedes persistence;
transaction errors are mapped after rollback. Post-commit photo-reference reconciliation is outside
that transaction, so unknown errors remain ambiguous.

For an existing installation, retirement additionally requires a fresh authenticated, exact-ID,
validated canonical read whose full JSON SHA and revision equal the durable preimage. The request
must have no accepted receipt. A serialized commit rechecks actor/session, installation owner and
status, recovery/completion state, local server base, and the complete original durable attempt.
Later local edits are preserved. No server revision, full-backup watermark, or confirmed clean pair
advances. A server change, malformed/foreign/failed read, accepted receipt, unknown 400, transport
failure or 5xx leaves the original request pending.

For a newly prepared first-create request, only its first dispatch in the same engine process may
use the scoped API's exact `404 Installation not found` as proof of no live canonical preimage.
Empty list responses and generic 404 responses are not sufficient. A restarted or previously replayed
first-create request cannot use this path: absence cannot exclude a prior accepted request followed
by deletion. Those ambiguous cases remain protected for support/recovery review.

`cloudSync.rejected_metadata_attempts` is an additive, nonblocking history keyed by the original
attempt ID. It retains the exact payload, original local tree, canonical preimage and hashes,
rejection code/message/proof, and queue snapshots. An identical intent is not repeatedly dispatched;
a corrected local request may prepare with its own ID. The history survives store reload and follows
the owning actor into preserved recovery copies. Local deletion and preview cleanup retain referenced
originals and cached evidence. Rejection is never reported as a confirmed full backup.

The companion API change permits an originally captured A3RM/A6M meter plus a linked Comms Draft to
stage together on an existing installation when that meter has no prior server/form history. It
keeps the incoming original meter unchanged and does not project `works.new_*`. Matching optional
original identity/context captures are checked without requiring a WW form. Mobile acknowledgement
mirrors this exact-payload exception; existing-meter operational retention is unchanged.

Validation: focused production handler/commit tests cover rejection, corrected later capture,
restarts, ambiguity, changed canonical state, first-create scope, session/recovery races, queue/media
preservation and old/new Comms meter acknowledgement. Native/API delivery remains a separate gate.


## Acknowledged conflicts and exact pull projection

The build12 electrical fixture retained an accepted metadata receipt (revision12/version9) followed
by `snapshot_conflict` on replay. The exact durable payload and preimage pass the captured-field
comparison. Passing the result through the API's real `projectLegacyInstallationTree` reproduces
the first finish failure: boards/assets expose scalar `displayCode` plus object `displayCodeMeta`,
while the old code reconciliation read only the scalar as an object. This was not a user capture or
retained-editor failure. Dedicated code reconciliation and saved-receipt GET-only corrections address
that path; a canonical-object-only probe had missed the pull compatibility representation.

Actor-owned, intact **accepted** metadata conflicts can now be recovered from Home using only an
exact authenticated GET of the accepted canonical revision and record version. The current checkout
must remain Draft at the saved base, with no retained installation screen, persisted editor draft,
new pending/completed receipt, foreign actor, or incompatible conflict. A local edit may have reset
the visual conflict to NONE; the durable original still supplies proof. An existing CONFLICT marker
must match the original base and accepted remote revision when specified. Other assigned-work
conflicts remain subject to the existing exact remote fingerprint check.

The entire acknowledgement is planned on a detached store through the existing semantic recovery
helper. Only after all content, identity, lifecycle, Home/editor, session and snapshot checks pass is
the plan committed atomically. The original raw conflict and its SHA move to nonblocking
`cloudSync.resolved_metadata_conflicts` history with canonical SHA, receipt and queue snapshots.
History remains actor scoped and continues owning evidence through deletion and quarantine.
This advances only the proved metadata base; it does not mark the current tree fully backed up.
Unaccepted conflicts, Completed checkouts, changed server content/revision/version, and ambiguous
receipts remain blocked. API receipt null is checked against canonical version0 (no finalized version).

## Manual retry of an identical known rejection (build14 source; native gate pending)

The existing Settings backup button always uses `retrySync()`. At the press, it freezes the current
actor's visible, opted-in rejected request IDs and complete rejection-record hashes before awaiting
anything. Its private foreground run waits behind an automatic flight and retains the initiating
assigned-work authority. Automatic `triggerSync()` remains argument-free and has no rejection retry
permission; failed-upload retry retains its existing ownership/session checks.

The repository grants one in-memory exception per captured descriptor only after verifying the
original request identity, rejection code and no-mutation proof, current payload/local snapshot and
exact freshly read remote preimage. A first-create retry requires a new scoped `404 Installation not
found`; an empty response is insufficient. Changed local capture uses the ordinary new-request path,
while changed preimage, stale history/session, foreign or opted-out checkout, pending completion,
conflict, or active recovery cannot use the exception. The normal pending journal is durable before
POST. The original rejection history and its evidence are never deleted or overwritten.

A repeated definitive400 proves no mutation again and restores automatic suppression. A new manual
press can authorize a further attempt after a server-side fix, without falsifying captured answers.
Response loss leaves the normal pending intent; after restart it recovers under the original request,
and a saved accepted receipt resumes GET-only. Failed persistence sends nothing and requires another
press. This changes no CAS/full-backup semantics and adds no persisted permission or new UI flow.

Focused production-function tests cover descriptor scope/immutability/one-use, exact preparation,
rejection repeats, response loss/reload, saved receipt GET-only, canonical confirmation, and unchanged
full-backup markers. Separate production Context tests cover queued manual and automatic flights.
The integrated build-fourteen source passed 935/935 tests, typecheck and Release build.
Its native installation and verification await the pending QA sign-in; build thirteen
remains installed. See the master audit for the exact source/bundle manifests.
