# Electrical residual parity fixes

Functional reference: `sustainability-wise-api/apps/ecoaudit/src/modules/installhub/pages/CanonicalDataPage.tsx`, dedicated `/v1/installhub` APIs, and the current native source. Source inspection alone does not prove physical interaction or portal roundtrips.

## Implemented in residual batch 1

- Metering table separates initial loading, missing installation and failed reads; Retry/Back are explicit. Failed derived refreshes retain the previous complete rows/inventory/diagnostics snapshot. Effect cleanup rejects late results and errors.
- Meter registry has independent device/name/serial/model/tag search, exact channel purpose/load/sensor/description/identity rows, all recorded channel assignment targets, and navigation to devices, channel editor, board, site asset or installation grid supplies. Missing or foreign target IDs remain visible and do not link to another record.
- Confirmed-unmetered filter includes virtual residual coverage. Registry diagnostics use `installationValidationIssues`; explicit readiness TBC blockers remain separate. Unassigned channels and invalid mapping diagnostics are described as optional follow-up outside confirmed topology.
- Meter history distinguishes installation loading/failure/missing from a legitimately local-only record and retains loaded cloud history during refresh errors. Existing actor/revision/restore request fences remain intact.
- Data View mapping guidance now states immediate supplying-board eligibility, matching `eligibleMetersForAsset`.
- Data View offers Download pinned mapping for eligible completed canonical records. The service retrieves the exact saved record version via the existing API, validates installation/version/readiness and SHA256 against the server canonical JSON contract, rechecks backed-up local identity and actor/screen lifetime, shares the original JSON with its contentHash, and removes only the temporary export file. Draft/imported advisory copies, dirty/conflicted records, mismatched versions/hashes and changed records cannot export.

## Verification

18 focused tests cover actual screen guards and derived read effects; stale/unmounted promises; target identities/search/coverage; mapping hash/version/eligibility and actual service behavior with native I/O doubles. The native sharing double proves ordering and rejection behavior, not real iOS share-sheet delivery. Isolated strict typecheck passed. Canonical apply/whitespace checks passed before handoff.

## Remaining physical gates

Exercise table scroll/search/target navigation and missing/error retry on device. Complete an authorized synthetic record and verify the saved JSON's hash/version on device; no customer installation was completed for this patch. Saved electrical arrangement is implemented in batch 2 below; physical save/relaunch and portal roundtrip remain unperformed gates. Existing explicit native grid Convert-to-TBC action is retained functionality, not a parity defect.

## Implemented in residual batch 2: saved electrical arrangements

- Native Data View loads the exact current Draft or pinned Completed electrical view. It checks installation/revision/pin and the exact confirmed grid-reachable symbol IDs against the displayed local model. Offline/read/identity errors are explicit and preserve the automatic local diagram. Saved arrangement data remains view state; the server owns durable persistence, and reopen/relaunch refetches it. It is deliberately excluded from ordinary backup, matching the portal and API contract.
- Draft Arrange symbols exposes stable-symbol selection plus Move left/right/up/down, Save arrangement and explicit Discard. Pending positions survive rejected saves; mode/search/node navigation and back navigation are guarded until Save or Discard. Completed views are read-only. Native card rendering preserves relative saved portal centres while allowing padding around larger native cards.
- PUT carries both baseTreeRevision and baseLayoutRevision. When GET hides an obsolete arrangement because topology changed, a same-revision pull retrieves the existing layout revision instead of incorrectly using zero. Source: API canonicalRoutes.ts778–942 and electricalMapLayout.ts64–213.
- Save checks the same actor-owned local tree, full content snapshot, sync watermark, dirty state, pending backup/completion and conflicts. It verifies the response document/revisions and exact subsequent pull before updating its local receipt. Local changes without a timestamp/revision bump are also rejected.
- A prior exact confirmed local/server revision pair advances together. Missing or stale legacy pairs remain missing/stale; the operation does not invent proof that an old checkout is clean. Only server revision metadata/derived cache/confirmed receipt change; captured child records and forms remain intact.
- Retry keeps original positions and CAS values. A lost successful PUT response is recovered only when both server revisions are exactly +1 and the saved layout is identical. Once confirmed, retries only finish the receipt. Other drift preserves local work and pending positions and requires explicit reload.

Verification: 15 new focused cases exercise production repository orchestration with real content/fence helpers, native control handlers with renderer doubles, geometry/schema rules, and legacy/stale/current baseline continuity. Nine existing diagram/layout cases also pass. Strict isolated typecheck and canonical patch apply/whitespace checks are required at handoff. No device, browser, customer data or production action was performed by this agent for these batches. Server installation PDF generation already receives its stored electricalMapLayout (API pdf.ts226); the existing server report connection therefore uses the saved arrangement.
