# Field App electrical workflow parity — 2026-09-05

This is a work-in-progress inventory of the portal `/installhub` electrical workflow against the native iOS app. Portal source is `sustainability-wise-api/apps/ecoaudit/src/modules/installhub`; API source is `sustainability-wise-api/src/routes/installhub`. Mobile counterparts are listed below. No page is marked PASS from source inspection or unit tests alone.

## Architecture and contract

Portal page -> `useInstallationTree` writer -> `api/installhub.ts` -> `GET /v1/installhub/sync/pull?installationId=...` and `POST /v1/installhub/sync/push` -> canonical normalization and persisted installation tree.

Mobile screen -> repository transactional local store -> canonical compatibility projection -> opt-in Cloud Backup -> the same pull/push contract. IDs, exact channel references, revisions, and evidence upload identities must survive this route. The direct API `GET /v1/installhub/installations/:id/readiness` remains authoritative. Local draft editing and server persistence are separate verification gates.

The current API contract (`src/routes/installhub/AGENTS.md` and canonical validator `installation-readiness-v2.3-tbc-only`) makes business capture optional. Completion is blocked only by explicit TBC electrical supply, asset metering, or measurement target. Structural writes still preserve stable ownership, unique channel usage, and safe explicit reassignment. Missing optional data is not implicitly a readiness failure.

## Inventory

| Stage | Portal page / section | Field or action and wire identity | iOS counterpart / finding | Status | Evidence and next gate |
| --- | --- | --- | --- | --- | --- |
| Physical survey | ZonesPage list | Zone name, short code, description, board/asset/photo counts; open/add/edit/delete | InstallationDetail + ZoneWorkspace existing controls | RETEST | Reload, duplicate code, new/old store and device interaction still required |
| Physical survey | Zone editor | `zoneName`, `zoneCode`, `zoneDescription`; blank name defaults to Zone; blank code generated | ZoneWorkspace edit incorrectly required both nonempty | FIXED | Blank name/default-code save enabled; create-zone surface audited by root |
| Physical survey | Zone evidence | Repeated `photos`; upload/remove, completed lock | ZoneWorkspace library/camera/removal exists | RETEST | Physical camera/photo permissions, reload and bidirectional sync not run by this subtask |
| Switchboards | BoardPage identity | `assetName` <=64, board `typeCode`, conditional `customTypeName`, generated `displayCodeMeta` | ElectricalAssetForm name, type and Other branch exist; cleared name wrongly disabled Save | FIXED | Blank name uses selected type/custom type; device rerun needed |
| Switchboards | BoardPage capture | `locationDescription`, `amperageRating`, `subCircuitsDescription`, `comments`, legacy NMI display | ElectricalAssetForm edit fields exist; BoardDetail omitted the captured values | FIXED | Detail now shows location, amperage, sub-circuits, comments and generated ID |
| Switchboards | BoardPage supply | GRID/BOARD/TBC, exact grid ID, cycle-safe parent search | ElectricalAssetForm has same tagged union and search; empty selection formerly throws | FIXED | Missing/ineligible choice saves explicit TBC; unit test covers absent/exact IDs |
| Switchboards | BoardPage relationships | Parent, downstream boards and supplied assets across zones | BoardDetail omitted relationship navigation | FIXED | Added parent/children links with actual zone IDs; device navigation remains RETEST |
| Switchboards | BoardPage evidence | Main photo and repeated `extraPhotos`; read view when completed | Editing supported; BoardDetail lacked evidence display | FIXED | Read-only thumbnail collection added; image delivery not device-verified |
| Switchboards | BoardPage devices | Commission WW; add Other meter; open meter/channels; counts refresh after return | Buttons exist, but BoardDetail loaded only on mount and could show stale new meters | FIXED | Focus reload with error/not-found handling; native navigation retest needed |
| Switchboards | Board deletion | Retain completed form history; detach draft links; remove active meter/assignments; mark surviving supply TBC | Root integrated completed-form retention fix | FIXED | Root reports integrated test coverage; native delete/reload and cross-client proof still required |
| Site assets | SiteAssetPage identity | `assetName`, asset `typeCode`, conditional Other, generated ID | SiteAssetForm has enums and condition; cleared name prevented Save | FIXED | Selected type/custom type supplies default name |
| Site assets | SiteAssetPage capture/evidence | Location, location photo, comments, repeated extras | Editable fields exist; detail lacked evidence and generated ID | FIXED | Added read-only evidence and generated ID |
| Site assets | SiteAssetPage supply | GRID/BOARD/TBC; exact candidate; quick source board detour | Existing protected draft and quick board route; empty selection incorrectly throws | FIXED | Missing selection saves TBC; quick board blank identity has type fallback |
| Site assets | Metering state | `METERED`, `UNMETERED`, `TBC`; all three selectable on portal | Native picker omitted TBC and rejected saving it | FIXED | All three states selectable; TBC persist path uses existing repository union |
| Site assets | Partial exact metering | Missing/invalid selected device/channel group becomes TBC on save | Native form rejected incomplete optional mapping | FIXED | Pure helper validates exact sub-circuit set, phase count and conflicts; incomplete becomes TBC |
| Site assets | Existing mapping protection | Historical unavailable/cross-board meter mapping retained until deliberate change | Explicit preserved-mapping request checks unchanged source and complete assignment signature in transaction | FIXED | Regression covers unavailable meter, changed source/channel/direction/identity; historical native import/roundtrip still RETEST |
| Site assets | Immediate supply eligibility | Portal authors new mapping from immediate supplying board; old historical mapping remains readable | Picker, save repository and mapping domain now author only immediate-board mappings, with exact historical exception | FIXED | Regression proves new/changed upstream mappings rejected and unchanged historical group retained |
| Site assets | Meter/source navigation | Open supplying switchboard and exact assigned meter | Detail lacked direct links | FIXED | Added links using installed board and asset source IDs |
| Site assets | Explicit reassignment | Portal supports exact channel takeover confirmation | Native confirmation displays existing asset/device/assignment/channel group; repository checks complete signatures before atomic takeover | FIXED | Old asset and remainder channels become TBC; Board/Grid claims blocked; stale/missing/multi-owner consent tests pass |
| Site assets | Delete | Portal retains completed forms and unlinks drafts | Root integrated completed-form retention fix | FIXED | Root reports integrated test coverage; native bidirectional deletion lifecycle remains RETEST |
| Metering | MeterPage identity | Device name/tag, Device ID/serial, model, Other manufacturer/model, classification/coverage | Existing fields; native rejected missing serial/manufacturer/model | FIXED | Optional business capture can save; structural stable IDs still generated/retained |
| Metering | MeterPage capture | WW prestart, board/device, verification, commissioning; custom-only notes and evidence | Native WattwatcherForm separates WW vs Other sections | RETEST | Detailed form family parity is tracked by forms audit; native evidence and legacy values still need live proof |
| Metering | Channels | Stable ID/ordinal, purpose, phase label, load type, conditional sensor, custom capabilities | Arbitrary capability names and Text/JSON value editor replaces labels-only editing | FIXED | Typed values roundtrip; duplicate/blank key and invalid JSON reject edits; initial historical values are never normalized on mount |
| Metering | Assignment group save | Empty rows omitted; first usable same-purpose unique channels retained; malformed group -> TBC | Native demanded every active channel, phase, direction, target and serial | FIXED | Portal structural normalization mirrored; explicit invalid target normalized to TBC; group unit tests pass |
| Metering | Omitted channels | Unassigned active channels are optional capture, remain measurable inventory diagnostics | Native repository required complete assignment coverage | FIXED | Removed blanket coverage-save gate; exact ownership/channel duplication validation remains |
| Metering | Quick asset from group | Portal creates asset from the meter group without losing meter draft | Native stages zone/type/name/custom-type asset with source board and generated-ID preview; final meter save inserts referenced drafts atomically | FIXED | Unreferenced drafts never persist; stale zone/source/identity checks pass; device workflow remains RETEST |
| Metering | Cross-meter reassignment | Portal confirms exact previously-owned asset/channel mapping signature | Native occupied-asset picker requests exact reassignment approval and verifies it again in transaction | FIXED | Released original device channels remain TBC; own mapping baseline also checked to prevent overwriting a concurrent edit |
| Metering | History / restore | MeterPage versions and rollback; GET meters/:id/history and POST history/rollback | Native MeterHistoryScreen and authenticated repository restore added | FIXED | Eight tests cover exact-device merge, concurrent edits, revision mismatch, identity, dirty gate, actor fence, retry wiring, refresh baseline and route scope; native/live retest remains |
| Metering | Meter removal | Draft-only retire active meter; retain completed commissioning record; affected assets TBC | Existing canonical meter removal helper and screen confirmation | RETEST | Existing test covers preservation; server/native bidirectional lifecycle not yet run |
| Data review | DataPage readiness | Only explicit TBC supply/metering/target blocks completion | Local installationV2 generated numerous obsolete optional blockers | FIXED | Local readiness filtered by actual stored tagged union; missing/invalid confirmed values do not masquerade as TBC |
| Data review | DataPage checks | Readiness vs diagnostics and completion language | Mobile copy claimed other mapping diagnostics block completion | FIXED | TBC-only copy updated; quality diagnostics retained separately for coverage rows |
| Data review | DataPage physical/electrical views | Physical zone, electrical supply, measurements separate; search/open actions | DataView diagram/list plus canonical rows exist | RETEST | Full source-to-display mapping and large/dark/native states need device comparison |
| Data review | MeteringTable | Direct, virtual, unmetered, TBC, mapping issue and unassigned channel cohorts | Existing all-asset rows/inventory preserve these distinctions | RETEST | Quality diagnostics kept available after readiness fix so invalid mapping never becomes direct coverage |
| Device lookup | DeviceSearchPage | Search installation-wide name, serial, tag, board, zone; open/replace | DeviceSearchScreen/domain search exists | RETEST | Exact search option/result mapping and replacement walkthrough not device-tested |
| Incoming supply | GridSupplyEditor | Add/edit NMI/default; remove unreferenced connection with default reassignment | Existing InstallationDetail grid editor identified | RETEST | Root default/name fixes source-reviewed. Native additionally retains existing, explicitly confirmed Convert-to-TBC removal of referenced supply; portal blocks that branch. This intentional extra is preserved, not removed for parity |

## Conditional and save behavior changed in this batch

- Board/site name blank -> selected type/custom type becomes stored name; <=64 control remains.
- Missing or invalid exact board/grid selection -> `electrical_source: {kind: 'TBC'}` and matching compatibility flags.
- Site metering TBC -> can save draft, remains readiness blocker.
- Site Metered with incomplete, duplicate, wrong-purpose or conflicting channel group -> saves TBC, never steals another assignment.
- Fully specified site metering -> exact channel IDs and phase grouping retained; omitted direction defaults to CONSUMPTION as on portal.
- Meter group with zero usable channels -> omitted; duplicate/unknown/spare/mixed-purpose entries trimmed deterministically; changed grouping -> explicit TBC.
- Unassigned active channel -> retained in channel inventory without preventing unrelated meter save or installation readiness.
- Explicit TBC target -> remains blocking even if other optional values are absent.
- Bad confirmed reference or malformed optional capture -> remains a diagnostic for mapping presentation, not a completion gate.
- Completed installation -> canonical local export eligibility follows server completion/TBC policy; pinned server export requirements are still enforced by export API callers.

## Verification evidence

- `rtk npm run typecheck`: exit 0 after all batch-one changes.
- `rtk proxy node node_modules/tsx/dist/cli.mjs --test --test-reporter=dot tests/electricalCapture.test.ts tests/installationV2.test.ts tests/meterCommissioning.test.ts tests/reconciliationWorkflow.test.ts`: exit 0, 51 tests.
- Full worktree suite before final presentation additions: 417/419. Expected policy-dependent failure in `tests/formCompletion.test.ts` needs the new `installationValidationIssues` helper for unassigned-channel diagnostics. Pre-existing configured iOS build 15 vs hardcoded expected 14 failure in `tests/pushNotificationRegistration.test.ts`. Root/forms owner notified and will validate integrated suite.
- No API network mutation, native installation, physical-device interaction, screenshot capture, or cross-client save/reload executed by this subtask. Those gates must be supplied by the root task before page PASS.

## Required device and compatibility retest

1. Existing Web-created board with comments/photos -> open iOS detail -> edit blank optional name -> save -> backup -> verify portal persisted value/evidence.
2. New/edited board -> add WW/custom meter -> return -> meter list must refresh without reopening board.
3. Site asset -> choose TBC -> save/reopen; verify exact tagged union in both clients and completion blocker.
4. Partial Metered asset -> save -> verify TBC, retained evidence and no competing channel ownership changes.
5. Existing complete meter -> save optional blank serial/custom metadata and partial group -> verify canonical tree and original completed form history.
6. Mapping diagnostics from bad confirmed old data -> review remains visible while completion only blocks explicit TBC.
7. Parent/child/source/device links crossing zones -> native Back and read-only Completed states.
8. Camera/library evidence, offline/relaunch, dirty draft navigation, dark mode, keyboard, and accessibility.


## Batch two — device history

Added `MeterHistoryScreen` linked from each board meter row, with paginated cloud history, current/replacement/rollback labels, serial/model/tag/switchboard/channel count, timestamp and rollback reason. The restore dialog takes the API-authoritative 3–1000 character reason and holds one idempotency key and unchanged input for ambiguous retries.

Restore requires a clean, backed-up Draft checkout with no pending backup confirmation or cloud conflict. It captures the exact authenticated actor/session, local revision, server base revision, and whole local tree before dispatch. After server acceptance it fetches the exact new revision, verifies stable device ID, installation, board placement, display metadata and retained assignments, then projects only the returned device into local canonical storage inside the same account/tree fence. Forms, other devices, zones, comments and current mapping are preserved. An accepted request whose pull fails is retried by pulling/applying its saved result, without issuing a second restore operation. A changed server/local tree is blocked rather than overwritten.

The canonical-to-legacy projection now refreshes `device_type` from `deviceModel`, fixing stale model display after a server restore/replacement.

The portal-only `lifecycleState` property is **not** a demonstrated backend contract: the portal declares PLANNED/ACTIVE/INACTIVE and sets ACTIVE on save, but current API canonical parsing/storage omits it. No independent activate/deactivate UI exists. This is a source/contract discrepancy, so this batch does not invent a new persisted lifecycle or unsupported toggle. Existing active device deletion and immutable history restore remain the actual business operations.

Batch-two verification: the initial six `tests/meterHistory.test.ts` tests passed, then route scope and accepted-refresh regression coverage were added. A read-only review identified and fixed accepted restore retaining the previous assigned-work fingerprint: the accepted server revision, fingerprint, metadata baseline and cleared refresh conflict now advance in one store commit. The next refresh of the same revision succeeds without falsely reporting an unversioned server edit. The combined history/assigned-work/fence run passes 33 tests. Integrated typecheck/device and live backup/rollback confirmation are required before PASS. The in-memory retry matches portal dialog behavior; interrupting the app while a cloud operation is ambiguous still requires refreshing history and resolving any resulting CAS conflict before editing/backing up.

## Batches four and five — custom channels, quick assets and exact reassignment

The custom channel editor now exposes arbitrary keys with Text or JSON values. Existing arrays, objects, numbers, booleans and null values remain typed. Merely opening a device leaves its capabilities unchanged, including historical capture that is no longer valid for authoring. Edited blank/duplicate keys and invalid JSON block Save until corrected.

The meter editor can create a site asset for a sub-circuit group, choosing any physical zone, type, conditional custom type and optional name. It shows a generated asset-ID preview and stages the new record until Save device. The save transaction validates the zone, installation, source and stable ID, then inserts only assets still referenced by saved groups, avoiding orphan records from abandoned groups.

Both assignment editors now support explicit takeovers. The confirmation shows the displaced asset and meter, exact assignment ID, physical channel IDs, phase and flow. Consent stores the portal-compatible signature of every approved assignment. A missing, changed, foreign, unavailable or newly competing mapping aborts before changing active state. Site-channel takeover cannot claim a board or grid-boundary attachment. Approved partial group takeovers leave unclaimed channels as TBC groups and mark the displaced asset TBC. Cross-meter takeover preserves the former device's channel group as TBC. Completed forms and evidence stay outside these mutations.

New direct site-asset measurements now require a device installed on the asset's immediate supplying switchboard. An unchanged historical mapping remains readable and savable even if its device is unavailable or lies on another board. Any deliberate source, device, channel, phase or flow change must meet current authoring rules. Repository and domain checks enforce this independently of picker visibility. Meter saves also compare the editor's original measurement collection against current local state before replacing it. Meter and site editor mutations validate on a cloned store before publishing changes, so rejected staged writes do not mutate objects held by the visible UI.

Verification: batch four typecheck exit 0 and 48 focused tests passed. Batch five typecheck exit 0 and 69 focused tests passed, including 13 independently authored takeover planner regressions plus integrated atomic projection and historical-preservation tests. No new network endpoint or lifecycle field was introduced. Native interactions, interruption recovery, Web-to-iOS/iOS-to-Web sync and backend acceptance remain separate RETEST gates.

Final review added the same original-owned-mapping baseline fence to every site editor save state, including Unmetered and TBC transitions. A concurrent changed, removed or newly added mapping now requires reopening the editor; unrelated mappings and channel ordering do not block it. An unchanged missing supply may normalize to TBC while preserving the historical device mapping, matching the portal's normalization/preservation order. Batch-six typecheck exits 0, 72 focused tests pass and diff whitespace checks pass.
