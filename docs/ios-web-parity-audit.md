# Portal Field App ↔ iOS parity audit

Started 2026-09-05. **In progress; the repaired form and backup path is verified, while full product parity still has open workflow rows.**

## Current verification checkpoint

Build fifteen is installed and authenticated against the lower-lane QA origin on
the attached iPad. Its [source manifest](../../tmp/field-parity-build15.json)
records 122 runtime hashes unchanged during the build, version 1.0.0/build 15,
bundle identifier `com.tuvi.installhub`, and bundle SHA-256
`5482d8fbf46868052a2a6192a865f045a857118cbc01adf5038256c42e126d60`.
The integrated source passed **936/936 tests**, zero skips, strict typecheck,
Release build, signature and diff checks. Build fifteen adds the canonical
Wattwatchers switchboard-label correction found during physical re-entry.

The approved 20-file API correction is commit
`2f0e11268d361eac4ac45072a9fcc74a64059e44`, pushed with GitHub Actions Verify
run `34004184070` passing the exact commit. Release checks passed 752 API tests,
28 explicitly gated skips, three PostgreSQL 17.2 integration tests, typecheck,
context and diff checks. The QA API runs the immutable release at
`/opt/sw-lanes/ecoaudit-fixes/releases/2f0e11268d361eac`; its health check returns
200. The portal process was not redeployed and production was untouched.

The exact fixture `inst_mtonubpj_cmdfqc` is now fully reconciled for the repaired
backup/form path. The preserved original archive remains unchanged. Normal native
re-entry produced seven forms, two meters, one site asset and one assignment;
Completed Captis and supported Wattwatchers records retain their intended status,
and ACE, Honeywell, SUMS, Wattwatchers and Comms records remain Draft. A final
device export and independent API pull compare with **zero differences**: local
revision 237 equals its synchronized local watermark, server revision 65 equals
the synchronized server watermark and API revision, queues are empty, and no
backup conflict remains. The protected comparison report is
`tmp/field-parity-private-device/qa-build15-final-roundtrip-comparison.json` with
SHA-256 `921972cac68decd3285fd0809309de2439e79e52e91151baf7708bc018ff5521`.

Mandatory portal → iPad → portal checks passed for the exact ACE, SUMS,
Wattwatchers Draft and Comms Draft records. They verified decimal/signed values,
conditional cleanup, retained serials/tags, CT ratings, antenna gates and restart
persistence. The final backup test passed, and the portal read-back showed the
returned native values. These checks close the previous main-fixture backup and
form-roundtrip block. Broader completion, report, finance, inventory, access and
other workflow rows remain `RETEST` unless their own evidence below says otherwise;
one representative roundtrip does not certify every action on a page. See the
[support matrix](ios-web-parity-support-matrix.md).

## Historical checkpoints (superseded where later evidence is recorded)

Build-eight checkpoint: 110 runtime hashes, bundle
`5cee052f2424929530df3992df01bf5ad33094ae42810f8a38396f4cf46b3dde`,
728/728 tests and typecheck. Native atomic meter/asset/channel capture, WW
tag/model branches and restart persistence passed on that batch. Captis
original-photo retention/two-page PDF passed on build seven and CSV on build six.
The later build-nine recovery continuation verifies the previously preserved Web
fixture archive after relaunch; it does not resolve the main iOS fixture's newly
inspected conflict. The earlier finance-control finding is now source-fixed in
both clients, with deployed/native mutation gates still outstanding.

Build-five ACE, Honeywell Q400 and SUMS representative
draft branches passed save/relaunch checks (143.297 s, 69.322 s and 108.974 s).
The same four-test run failed only the Wattwatchers distinct asset-tag check:
startup replaced the tag with the serial. The three startup fallback assignments
are corrected locally; three regression tests and typecheck pass. The known
synthetic tag must be re-entered and checked on the next installed build. No
unknown historical tag can be reconstructed by this fix. Evidence:
`../tmp/FieldAppParityHarness/qa-build5-form-branches-r1.xcresult`.

Recovery checkpoint: build-five physically passed review and Cancel preservation,
then refused adoption with `Device work changed after the recovery review`.
The original checkout remained protected. A production-flow regression reproduced
the sole change: identical background pulls reset the conflict's `detected_at`.
Repeated identical conflicts now retain their first detection time; changed
conflict content still gets a new timestamp and actual local/server changes still
invalidate confirmation. Both focused recovery/policy suites pass, 57/57. Native
adoption and archive/relaunch remain RETEST on the next build. Evidence:
`../tmp/FieldAppParityHarness/qa-build5-recovery-r1.xcresult` and
`../tmp/field-parity-recovery-repeat-before.log` / `-after.log`.

Support checkpoint: My inventory loaded/search-empty/restored passed on the iPad
(54.186 s); Settings and the actual cloud-backup list/search/reload passed
(45.048 s). The test only enters Company inventory if that capability is exposed
and does not infer maintainer access from the admin role. CSV export was initially
stopped by the test harness's navigation allowlist before any export action; that
harness omission is corrected for a separate rerun. Evidence:
`../tmp/FieldAppParityHarness/qa-build5-support-r2.xcresult`.

Follow-up recovery coverage includes externally assigned jobs: an identical job
summary now retains its original `pulled_at`, while an actual schedule/content or
actor/assignee change invalidates the review. Both owner-created and assigned
fixtures advance pull timestamps in the regression. Updated focused suites:
59/59 passed, no skips.

The CSV rerun reached the actual download and exposed an HTTP boundary failure:
`Authenticated download content length did not match the streamed file`.
No CSV was shared. The downloader is under investigation; the correctly loaded
financial page is not an export PASS. Evidence:
`../tmp/FieldAppParityHarness/qa-build5-csv-r1.xcresult`.

## Scope and evidence

The functional source is the Field App in the shared UI portal, not the legacy
InstallHub website. The target is the iOS application in this repository.
Compare current portal behavior with the dedicated API before changing iOS.
`PASS` requires the page's full validation, persistence, bidirectional and device
checks; source similarity alone does not establish it. `FIXED` records an
implemented discrepancy, while `RETEST` means verification is still outstanding.

Both source checkouts were clean at the start. Mobile was on `master`, two commits
ahead of its tracking branch; API/portal was on `main`. Existing commits are retained.
Implementation work is separated into non-overlapping worktrees and reviewed here.

## Documented Scheduler and job-detail bug recheck

Current-source review found five live defects and one already-fixed zone issue.
The local repair makes the Scheduler calendar span 00:00–24:00, preserves the
created Field job title in the job pool and assigned calendar event, and lets an
administrator edit the title in both creation and assignment. Field creation now
captures job notes and shows a required Existing device ID only for
`M2 - Faults / COMMS fault`. The additive API field round-trips through canonical
and legacy sync, while Electricity NMI remains on the default grid supply. The
iOS Job details and assigned-work review show notes, NMI, and existing device ID.
The Installation outcome card and edit section are removed from iOS while their
stored fields remain compatible with older clients.

The reported zone issue was already fixed before this recheck: new zone names
generate a unique short code, and the optional description is saved from its own
input rather than copied from the name. Regression coverage now records both
behaviors. Source verification passed 410 portal tests, 755 API tests with 28
environment-gated skips, 936 iOS tests, strict typechecks, and the complete
API/portal verification build. A QA-targeted Release build then installed on the
paired iPad, authenticated, refreshed the exact `QA Parity Web 20260905` fixture,
displayed its saved Job comments / scope, and passed an accessibility assertion
that Installation outcome is absent. The retained screenshots are
`../tmp/FieldAppParityHarness/qa-20260906-authenticated-dashboard.png` and
`../tmp/FieldAppParityHarness/qa-20260906-job-details-without-outcome.png`.
NMI and Existing device ID remain `RETEST` on hardware because the retained QA
fixtures have no values for those fields and this batch's additive migration/API
has not been deployed. Scheduler portal interaction also remains `RETEST` until
the new portal/API release is installed in the lower lane.

## Architecture

| Client | UI / state | Transport | Data authority |
| --- | --- | --- | --- |
| Portal | `../sustainability-wise-api/apps/ecoaudit/src/modules/installhub`, routes `/installhub`; `/field` entry | Typed `api/installhub.ts`, tree writer; dedicated `/v1/installhub` routes | Fastify `src/routes/installhub`, canonical-v2 trees, `ih_*` tables; shared evidence registry and immutable versions |
| iOS | `src/screens`, `src/components/forms`, `src/forms/catalog.ts`; local repositories and durable AsyncStorage store | `src/api/apiClient.ts`, sync/assigned-work/media services; same `installhub` auth namespace | Local working copy; explicit Cloud Backup and assigned-work reconciliation with the same API |

The API and portal are in `../sustainability-wise-api`. iOS is Expo SDK 57 /
React Native 0.86, with a generated native project. Cloud-first portal storage
and iOS offline storage are established architectural differences; they do not
excuse missing business actions or incompatible saved values.

## Master workflow inventory

| Stage | Page / section / features | iOS counterpart | Principal API | Status | Evidence / remaining checks |
| --- | --- | --- | --- | --- | --- |
| Access | Login, session restore, logout | Login / providers | `/v1/auth/login`, refresh | RETEST | Namespace, identity and expired session |
| Work | Dashboard, installations, search/filter, scheduled jobs | Dashboard / assigned work | installations, sync pull | RETEST | Lists, dates, visibility, job review |
| Work | New/edit installation: client, site, address, scope, contact, access, outcomes | InstallationForm | sync push full tree | RETEST | Optional identity capture, defaults, unchanged legacy site codes and load/save errors corrected. The API correction is deployed in QA; broader device interaction remains open. |
| Work | Installation workspace, completion notes, complete/reopen | InstallationDetail | validation, complete, reopen | RETEST | The main tree now matches QA without loss; authoritative completion/reopen lifecycle remains open. |
| Work | Daily route | DailyRoute | route-suggestions | RETEST | Origin, stops, errors, date |
| Stock | Inventory, claim/manual/barcode, refresh | Inventory | inventory / claim | RETEST | Custody and model mappings |
| Survey | Zones: list/add/edit/delete/photos | InstallationDetail / ZoneWorkspace | sync push | RETEST | Fields, cascade, photos and read-only lifecycle |
| Electrical | Grid supplies: add/edit/NMI/default/delete | InstallationDetail grid editor | grid-supplies / sync push | RETEST | Existing editor confirmed. Blank names and deterministic reassignment when deleting/changing the default corrected. Native explicit Convert-to-TBC removal remains an existing additional operation with confirmation. |
| Electrical | Switchboard create/edit/delete/source/photos | BoardDetail / forms | sync push | RETEST | Source relationships, default names, optional capture |
| Electrical | WW device commissioning and channel mappings | FormEditor / MeterForm | sync push / assignments | RETEST | Models, purpose, sensors, targets, conditions |
| Electrical | Other device creation/edit | MeterForm | sync push | RETEST | Channel structure and optional capture |
| Electrical | Device search, replacement/history/rollback | DeviceSearch / meter screens | meter history / rollback | RETEST | Actions and immutable provenance |
| Electrical | Site asset CRUD/source/metering/photos | SiteAssetDetail / forms | sync push / reconciliation | RETEST | Categories, branches, values, drafts |
| Electrical | Data View, electrical tree, TBC reconciliation | DataView | canonical views / validation | RETEST | Local reads/capture and the main-fixture canonical backup now pass; saved-layout/CAS and authoritative pin checks remain open. |
| Electrical | Metering table and display values | MeteringTable | canonical metering view | RETEST | All-asset/physical readings, export actions |
| Forms | List, new picker, draft/edit/delete/complete/amend | FormsList / FormTypePicker / FormEditor | sync push | RETEST | Optional metadata, exact answer-key filtering, caught actions, historical marker and retained-version report lookup implemented; 392-field inventory linked below |
| Forms | WW Installation (A3RM/A6M) | FormEditor catalog | form contract / sync | RETEST | Bounded Draft and Completed native/portal checks pass; every remaining field, option and attachment still applies. |
| Forms | Comms Fault | FormEditor catalog | sync / meter history | RETEST | Bounded Draft antenna/replacement roundtrip passes; completion/history and other branches remain open. |
| Forms | ACE Switchboard | FormEditor catalog | form contract / sync | RETEST | Bounded decimal/CT roundtrip passes; every remaining field and evidence action still applies. |
| Forms | Honeywell Q400 | FormEditor catalog | form contract / sync | RETEST | Every field and evidence collection |
| Forms | Captis Logger | FormEditor catalog | form contract / sync | RETEST | Every field and evidence collection |
| Forms | SUMS Logger | FormEditor catalog | form contract / sync | RETEST | Bounded signed/decimal roundtrip passes; remaining fields and barcode/QR behavior stay open. |
| Forms | Legacy A3RM/A6M records | Read-only legacy catalog | compatibility sync | RETEST | Reload/render, excluded from new picker |
| Evidence | Consolidated photos, preview, captions/removal | PhotoPreview / gallery | scoped upload / files | RETEST | Multi-photo, ownership, optional uploads |
| Reports | Form PDF, installation pack, electrical map, versions/detail mode | InstallationReport / FormEditor | PDF jobs / export jobs | RETEST | Tree reconciliation now passes; pinned source, authoritative pack/map, live diagnostic and download/share still need their own checks. Existing local PDF checks remain narrow evidence. |
| Reports | Client report | ClientReport | Local canonical tree / native PDF | RETEST | Actual sections, selected evidence, native PDF and share implemented; preview choices intentionally remain installation-local as browser choices do |
| Cloud | Files, versions/detail, sync and conflicts | CloudStorage / backup | files / versions / sync | RETEST | Exact main-fixture upload and bounded form roundtrip pass with zero differences; inspect/version/download permissions remain open. |
| Administration | Installation access | InstallationAccess | access GET/PATCH | RETEST | Admin assignment and stale access |
| Administration | Users list/create/edit/deactivate/password | UserManagement / UserEditor | users / password | RETEST | Own password versus admin reset |
| Administration | Settings/diagnostics | Settings / Diagnostics | health/auth checks | RETEST | Error and permission states |
| Commercial | Financial Summary/header/cost lines/CSV | FinancialSummary | financial-summary / finance / cost-lines | RETEST | Both clients omit rejected hours/manual-invoice-state controls; audited hours and statuses remain read-only. Read/CSV evidence exists; mutations still require authoritative completion. |
| Commercial | Invoices/list/detail/draft/issue/void/PDF | Invoices / InvoiceDetail | invoices | RETEST | Exact-ID guarded harness is prepared; draft/issue/void/PDF still requires authoritative completion, and no live financial mutation has run. |

## Verification gates

| Gate | State | Evidence |
| --- | --- | --- |
| Attached hardware | Available | `xcrun devicectl list devices`: paired iPad (A16); Xcode resolves physical destination |
| Toolchain | Available | Xcode 26.6, existing workspace and Pods |
| QA target | Configured | `eas.json` preview/testflight target `https://ecoaudit-qa.170.64.154.143.sslip.io` |
| Combined typecheck/tests | PASS | Build-fifteen frozen source: 936/936 tests, 0 skipped; strict typecheck, Release build, signature and diff checks passed. |
| Backend release-source checks | PASS | Approved 20-file commit `2f0e11268d361eac4ac45072a9fcc74a64059e44` passed 752 API tests, 28 explicit gated skips, three PostgreSQL 17.2 checks, typecheck/context/diff and exact-commit CI run `34004184070`. The immutable QA API release is healthy. Portal checks remain separately recorded; the portal was not redeployed. |
| Installed-source iOS build | PASS | Build fifteen is installed and signed in on the physical iPad with 122 unchanged runtime hashes, QA origin embedded and bundle `5482d8fbf46868052a2a6192a865f045a857118cbc01adf5038256c42e126d60`. [Manifest](../../tmp/field-parity-build15.json). |
| Later runtime changes | PASS | Canonical Wattwatchers switchboard labels, manual metadata retry, Inventory scope/scanner handling and Installation Access guards are included in the installed binary. Broader workflow interaction gates retain their own rows. |
| Physical install/launch | PASS | Build fifteen installed over the retained app data and authenticated to the exact QA origin on iPad15,7. |
| Physical interactions | PARTIAL PASS | Re-entry, restart persistence, backup and selected form branches passed on the exact fixture; unexercised page actions remain RETEST. |
| Portal → iOS → portal | PASS (bounded) | ACE, SUMS, Wattwatchers Draft and Comms Draft portal changes were read on iPad, changed back natively, backed up and verified in the portal. |
| iOS → portal → iOS | PASS (bounded) | Seven-form/two-meter tree and selected form values survived backup, portal edits, native return edits and relaunch. Final independent device/API comparison reports zero differences at local/server revisions 237/65. |

The approved API commit/push and QA-only deployment are complete. No production
mutation, portal deployment, App Store upload or mobile commit/push was performed.
Source/API tests do not substitute for device and live bidirectional evidence.

## Installation identity field comparison

Portal reference: `InstallationFormPage.tsx`; native: `InstallationForm` and
`InstallationFormScreen`; transport: canonical `sync/push` installation fields.
All rows remain RETEST until device and both-direction persistence checks pass.

| Section | Native → API | Control / values / rule |
| --- | --- | --- |
| Identity | client_name → clientName; client_id → clientId; client_site_id → clientSiteId | Optional client text or saved client/site; changing client/address clears obsolete selection |
| Identity | site_name → siteName | Optional text; defaults to Untitled installation |
| Address | site_address → siteAddress | Optional display/street text, manual or provider/saved address |
| Address | site_locality → siteLocality | Optional text, maximum 120 |
| Address | site_state → siteState | Empty, ACT, NSW, NT, QLD, SA, TAS, VIC, WA |
| Address | site_postcode → sitePostcode | Empty or exactly four digits |
| Address | site_country_code → siteCountryCode | Read-only Australia (AU) |
| Address provenance | site_latitude/longitude, site_geocode_provider/place_id, site_address_source/geocoding_status/fingerprint | Preserved typed metadata; manual changes invalidate stale coordinate provenance |
| Contact | site_contact_name/phone/email → siteContactName/Phone/Email | Optional text/phone/email; maximum 300/50/320 |
| Access | access_information → accessInformation | Optional sensitive operational text; maximum 5000 |
| Plan | service_type → serviceType | New record requires M1 New install, M2 Faults/COMMS fault, M3 Inspection, M4 BD/Upselling, M5 Other with text; unchanged historical values retained |
| Plan | metering_solution_type → meteringSolutionType | Empty, NEM meter, Revenue metering, Monitoring / sub-meter, Water meter, Other with required custom value when selected |
| Plan | maas → maas | Not recorded/null, Yes/true, No/false |
| Plan | custom_job_number → customJobNumber | Optional text, maximum 100 |
| Plan | job_comments → jobComments | Optional notes, maximum 5000 |
| Field context | inspector_name → inspectorName | Optional; new record prefills current user name/email |
| Field context | audit_date → auditDate | Empty defaults today; supplied value must be a real YYYY-MM-DD date |
| Field context | site_code → siteCode | Empty generated from name; new/changed code uppercase alphanumeric groups and hyphens, maximum 16; unchanged legacy code preserved byte-for-byte |
| Field context | timezone → timezone | Empty defaults Australia/Sydney; supplied IANA zone validated |
| Outcomes (edit only) | warranty_device/monitoring_installed/hardware_installed/additional_monitoring_required | Each maps to corresponding camelCase API boolean; null/true/false |
| Outcomes (edit only) | solar_capacity_kw → solarCapacityKw | Optional finite number, 0–1,000,000 kW |
| Outcomes (edit only) | additional_monitoring_hardware → additionalMonitoringHardware | Optional text, maximum 5000 |
| Grid context | Electricity NMI → default gridSupply.electricityNmi | Optional existing native shortcut to the same incoming-connection data |

## Live QA evidence — 2026-09-05

- Portal authenticated with the existing user session; no credentials extracted.
- Minimal new M3 record with name but blank client/address failed with
  `address.displayAddress is required`. No record was accepted; abandoned
  form recovery was discarded. Root cause is the InstallHub directory-learning
  boundary calling the shared required-address directory API unconditionally.
- Created synthetic `QA Parity Web 20260905`, ID
  `installation-33e2d7e6-a251-4cec-9583-8d1dc0644b39`, with client
  `QA Parity Test 20260905`, address `QA TEST DATA - Not a customer site`,
  M3 Inspection and explicit synthetic test notes. Portal navigated to the
  persisted record and displayed Saved to cloud, Draft, exact fields and notes.
- These observations establish portal persistence only. Device roundtrip remains
  outstanding and is not inferred from source tests.

## Detailed inventories and integrated changes

- [Every form family, field, option and conditional](ios-web-parity-forms.md).
- [Electrical pages and remaining field/action gaps](ios-web-parity-electrical.md).
- [Form actions and historical report selection](ios-web-parity-form-actions.md).
- [Photo selection and real client report](ios-web-parity-client-report.md).
- [Finance, invoices, inventory, users, access and versions](COMMERCIAL_AND_SUPPORT_PARITY.md).
- [Support and commercial fields, actions, APIs and current dispositions](ios-web-parity-support-matrix.md).
- [Inventory account/query scope and typed scanner fallback](ios-web-parity-inventory.md).
- [Installation Access request and assignment scope](ios-web-parity-installation-access.md).
- [Work lists, daily route, auth, settings and exact API comparisons](ios-web-parity-work-access.md).
- [Clean same-record refresh and protected legacy conflicts](ios-web-parity-clean-refresh.md).

First integrated batch contains optional installation/grid defaults; board/site
removal retains immutable completed forms and detaches editable drafts; electrical
TBC/partial captures and focus refresh; all supported form families filtered to
API-supported answer keys; historical-version reporting; real client summary/PDF;
cloud inventory/access/version parsing; unified users and maintainer permissions;
admin financial/invoice routes; and meter history/restore with actor, revision,
assignment and immutable-identity fences. Diagnostics is available to all logged-in
Field users; user administration remains admin-only.

The electrical gaps in typed custom channel values, quick assets from meter groups,
and explicitly approved exact reassignment are now fixed in canonical source.
Stale mapping edits are rejected atomically, including site-asset changes without
a takeover. These changes require the next device/cross-client pass.
Board/site deletion FAIL rows in that subtask inventory are resolved by root's
integrated deletion tests; remaining device and both-direction checks still apply.

Device evidence so far: app launch succeeded; the first form harness incorrectly
queried native radios as buttons, and the second attempt reached/filled scope and
site but tried to scroll over the keyboard. Both are harness issues, with corrected
radio query and keyboard dismissal under test. Neither attempt saved a record.

## First device / cloud results

- Initial build 15 (QA bundle SHA-256
  `88b27c87411fec4d83c83c0e9d2ba341b57a9f9c08874b7588a265b12c3c65f1`)
  installed and ran on attached iPad. Corrected XCTest optional-create test passed
  in 20.965 seconds: M3 + site name + blank client/address saved, then survived
  termination/relaunch. Local fixture: `QA Parity iOS 20260905`.
- Integrated build 15 (QA bundle SHA-256
  `bd7fca186aa5c4cf5bbcc1729c022cfe4e8d81d7f46031ff3e58d58c2da8e1dd`)
  built and installed successfully. Source hash manifests and native build logs
  are under workspace `tmp/field-parity-*`.
- Device XCTest `testQAPortalRecordRoundTrip` passed in 47.084 seconds: the exact
  portal-created ID was pulled, client/site/address equality asserted, M3 and
  notes rendered, native note edit saved. A portal refresh then showed the exact
  note rendered in the iPad screenshot. The harness inserted the new marker at
  the beginning (its delete keystrokes ran at the start of the text), so this
  proves an insertion roundtrip, not text replacement. The fixture was then
  explicitly replaced through the portal with a clean return marker.
- Portal return values now being tested: custom job number
  `QA-WEB-RETURN-20260905`, MaaS false/No, and the clean return-marker note.
- Full-screen screenshots are in
  `../tmp/FieldAppParityHarness/evidence-web-to-ios-r1/`. Earlier app-window
  screenshots had orientation cropping; the harness now captures XCUIScreen.
- Device screenshot exposed date-only display shifting 2026-09-05 to Sep 4 in
  the device timezone. `formatDate` now preserves calendar dates in UTC while
  timestamp values retain device-local formatting. New regression passes for
  Phoenix, Honolulu and Sydney. This source fix awaits the next binary retest.

No stage is marked fully PASS from this limited representative walkthrough.
Typed capability/quick-asset and zone/error-state follow-ups are newer than the
second installed binary and require another build/device pass.

## Additional device findings and fixes

- `testQAIOSOriginBackup` passed (53.344 seconds). Local fixture
  `QA Parity iOS 20260905` was enriched and backed up, then appeared in the portal
  as `inst_mtonubpj_cmdfqc`. Portal confirmed the client, M3, and custom job number
  `QA-IPAD-ORIGIN-20260905`. This establishes native-origin identity persistence.
- Address typing exposed a P1 defect: `manualAustralianAddressEdit` normalized and
  trimmed a controlled input on every keystroke, removing spaces before the next
  word was entered. Portal persisted exactly the corrupted text shown on-device:
  `QATESTDATA-iPadorigin,notacustomersite`. The helper now retains authored draft
  parts, invalidates old geocoding, and leaves normalization at the write boundary.
  Character-by-character multiword address/locality regression passes; device
  replacement and portal equality remain RETEST.
- Returning later portal root values to an existing local record failed:
  `Assigned work tree changed on the server. Cloud Backup is paused.` The portal
  fixture now also contains `QA Plant Room`, zone
  `zone-ed5d4d8f-50fd-4211-a523-8659eeb8c850`. Existing same-actor trees did not adopt
  clean remote changes; successful pushes could also clear their tree fingerprint
  before the next pull established a baseline. A clean-tree adoption fix is in
  progress with explicit synced-local-revision, actor, queue, media and editor
  fences. The clean-refresh fix is now integrated and independently reviewed;
  100 focused checks passed, including the actual production pull/mapper. Dirty
  and old unknown-baseline conflicted copies remain protected. Existing conflict
  recovery now has an explicit reviewed version-choice and preservation workflow
  in source, described below; physical recovery verification is still RETEST.
  Backing up once cannot recover an already blocked old checkout.
- API corrections are locally validated: optional directory learning for partial
  capture, zone-before-display-claim persistence for new nested trees, and shared
  site revision allocation when an existing source job changes sites. Evidence:
  `../tmp/field-parity-api-verification.md`. Live QA still runs the old backend.
- Captis draft `form_mtoojprm_4h7kf6` passed the physical save/relaunch test
  (`qa-captis-draft-r1.xcresult`, 54.065 seconds). The portal then displayed exact
  location `QA Plant Room - Water Loop A`, serial `QA-CAPTIS-20260905-01`, reading
  `1234.50`, prefilled client, installer and date/time. The initial harness intended
  Honeywell but selected Captis because context filters exclude Comms from this
  picker; it created one Captis draft and was corrected to reuse that draft.
- Photo testing seeded one clearly labelled synthetic image through the separate
  XCTest harness, without fetching existing Photos assets. The harness runner
  prompted for full Photos access despite the test requesting `.addOnly`; this
  test-only runner is separate from the Field App and should be removed after QA.
  The Field App's current binary also requests full library access before opening
  the picker. Source now uses iOS's picker directly, so denied broad library
  permission does not prevent selected evidence; camera permission and non-iOS
  permission behavior are retained. This is verified against the installed Expo
  native implementation and current Expo documentation, pending device retest.
- Camera denial now reports a usable error. Zone acquisition errors are caught;
  a refresh failure after a successful photo save no longer deletes the committed
  original. The actual zone handler has four failure-boundary regression cases.
- Missing/read-failed boards, zones, assets, data, meters, form pickers and form
  editors show Retry/Back instead of indefinite loading. Loaded editing modals
  remain mounted on refresh failure. Deleted meter references no longer create
  blank replacements; legitimate new-meter creation remains available. Validation
  includes 19 focused screen-state checks plus five initial-form-loader tests.
- Dashboard now combines status and text filters, shows actor-visible local
  installation/Draft/Completed/form totals and per-card zone/board/asset/form counts.
  Cloud Backups retains/searches inspector names. Route date starts blank as in
  the portal; the preserved native shortcut is accurately labelled Use device date.
  These source changes have focused tests and real mapper/JSX checks, and await the
  next physical build.
- The next Release build is using a frozen set of 76 changed runtime-file hashes
  (`../tmp/field-parity-final-build.json`). QA API release approval was requested
  only after source/build/PG checks and the exact API-only switch/rollback plan were
  prepared. No commit, push or API restart has yet occurred.

## Third installed binary: device verification

- Build 15, version 1.0.0, exact QA bundle SHA-256
  `b288a2709a310a15d979d20f5fbdbb498506a59a0b9a03353e3db7c4632088d9`
  is now installed. All source changes described above are included; the earlier
  “next build” notes describe superseded intermediate gates.
- `testQAAddressSpacesAndDate` passed on the physical iPad in 56.722 seconds
  (`qa-final-address-photo-r2.xcresult`). It asserted Sep 5, 2026 without timezone
  shift; replaced the address through the keyboard with
  `QA TEST DATA - iPad origin, not a customer site`; asserted spaces before save;
  and asserted the exact address and date after termination/relaunch. A fresh
  portal read then showed the same address on `inst_mtonubpj_cmdfqc`.
- Broad Photos permission for the Field App was explicitly denied. The final
  binary's `testQACaptisPhotoPicker` passed (23.856 seconds), opening the native
  private selection picker, whose UI states the app can access only selected
  items. This closes the denied-library picker gate, not camera permission.
- The first synthetic photo save attempt selected and displayed the correct QA
  image. Its assertion failed because iOS appends the empty caption placeholder
  to the accessibility label. The harness now matches the stable label prefix;
  the existing selected image is reused so retry does not create duplicates.

- `testQACaptisSyntheticPhotoPersistence` passed on-device (48.515 seconds,
  `qa-final-photo-save-r2.xcresult`): the selected synthetic image and exact caption
  survived navigation flush and termination/relaunch. The portal then displayed
  one evidence photo and `Synthetic QA evidence 20260905 - no customer data`.
- `testQACaptisCompleteAndPDF` passed completion (51.678 seconds,
  `qa-final-captis-pdf-r1.xcresult`). Native share-sheet evidence identifies the
  458 KB Captis PDF; no share recipient/action was invoked. The exact native file
  was copied read-only from the app cache and both pages rendered. Text/image
  inspection confirms the serial, physical location, 1234.50, image and caption.
  Visual QA found a label/value row split between pages. Independent rerender and
  text-coordinate inspection confirmed all Logger values are present; an initial
  impression of crowded or missing values was not a PDF defect. The shared `formReportHtml.ts` now gives each field row its
  own fixed-layout table with wrapping and page-break avoidance. All 31 existing
  form/report tests passed; this later CSS correction requires a new native export
  before the PDF layout gate can pass. Captis stored address intentionally remains
  the earlier form capture; root installation edits do not rewrite form answers.

- Electrical `testQA01ZoneAndBoardPersistence` passed (81.105 seconds,
  `qa-electrical-zone-board-r2.xcresult`): created/reopened `QA iPad Plant Room`
  with code QAPR and exact synthetic description; created `QA Main Board` as Main
  Switchboard using the default Grid supply; omitted optional location/amperage/
  sub-circuits/comments; verified display and editor values after process restart.
  First attempt had a noninteractive heading accessibility assertion failure after
  the zone was already saved. Corrected harness reused it and created one board.
  Fresh portal read independently confirmed the zone; nested board/cloud checks
  continue with the meter and mapped-asset workflow.

- `testQAClientReportEvidenceSelectionAndPDF` passed (39.169 seconds,
  `qa-client-report-r1.xcresult`): excluded the known synthetic photo, confirmed
  exclusion survived termination/relaunch, included it again, and opened the native
  PDF share sheet. Exact PDF copied read-only from the newly created cache file:
  62,685 bytes, two pages, one embedded image. Installation/client/zone values
  matched; full visual inspection is recorded separately. No share was sent.
- Device testing exposed another P1 usability defect: meter capability and zone
  search inputs at y620 remained behind the iPad keyboard starting at y453.
  Unlike InstallationForm, those ScrollViews did not enable native keyboard inset
  handling. Shared `FormScrollView` now applies iOS keyboard insets and handled
  taps to editable page/modal containers. Installed React Native 0.86 source
  confirms this path moves the active input region above the keyboard. This fix
  awaits rebuild and an explicit focused-input visibility assertion.
- Stable native test identifiers now use canonical form field/option keys and
  record identities, allowing repeated sections and form actions to be exercised
  without relying on flattened accessibility hierarchy or numeric picker indexes.
  Visible labels and saved values are unchanged.

  Independent client PDF review confirms all text stays inside page bounds;
  the photo/date/caption are intact and the photo matches Captis evidence.
  SHA-256: `70d2c74815ba5552508a4f0813d14a592473f85848e32b3476340831ccb2aebe`.
  The whole photo/caption moves to page two; no evidence is omitted.

## Fourth build: recovery and keyboard verification

- Explicit conflict recovery is FIXED in source. Home reviews exact local/server
  revisions and requires `Preserve and use server`; Cancel leaves the working
  copy unchanged. Confirmation refetches and verifies the review hashes, actor,
  ownership, Draft status and recovery lock before a single atomic local commit.
  The exact original tree, queues, drafts, receipts, time snapshot and media
  references are archived under `same_actor_reconciliation`; canonical server
  identities become the working copy. No server tree mutation is performed.
- Recovery copies are local-only, read-only support records, excluded from normal
  job lists, finance and upload replay. Settings `Inspect recovery copy` exposes
  their stored sections and original evidence. Time-delivery identities remain
  unchanged; archived snapshots are informational. Recovery/backup concurrency,
  thumbnail/cache deletion boundaries and archive-media retention have focused
  regression tests and independent review. Device Cancel/adopt/archive/relaunch
  checks remain RETEST until the fourth binary is installed.
- Build-four full suite: 555 passed, zero failed/skipped; typecheck and diff check
  exit 0. Evidence: `../tmp/field-parity-mobile-tests-build4.log` and
  `../tmp/field-parity-mobile-typecheck-recovery-keyboard.log`.
- Third-binary support tests passed dashboard text/status/no-match states and
  explicit route date (33.701 seconds), plus read-only Financial Summary and
  Invoices for the synthetic installation (41.838 seconds). No financial records
  were created, issued or voided.
- The inventory test incorrectly equated admin with maintainer. API, portal and
  native all require the separate `isMaintainer` flag for Company inventory.
  The failed heading/button assertion does not establish either live permission
  or successful loading. The revised device test checks My inventory and inline
  load errors independently, preserving the existing authorization boundary.
- Fresh portal inspection independently confirms the native-created zone ID
  `zone_mtopnoxe_6dd8d1` and board ID `board_mtopqsi7_tfazdq`, exact names,
  `Main switchboard`, Grid supply / default Grid selection and omitted optional
  location, amperage, sub-circuits and comments. The board's generated asset ID is
  `QPI2-QAPR-01-MSB-QA-MAIN-BOARD`. This closes those field roundtrip assertions;
  meter/asset, deletion, photo and broader page action gates remain separate.

## Fifth build and residual re-audit

- Fourth-build electrical testing passed the explicit focused-input-above-keyboard
  assertions, including the formerly obscured zone search and capability name.
  It then found a separate native accessibility defect: switching capability Text
  to JSON replaced the native input but lost its accessible label. Installed RN
  0.86.2 `_setMultiline` copies text/traits but not accessibility properties, and
  the unchanged label is not reapplied. Shared TextField now keys its native input
  by multiline mode; the parent controlled value and capability row remain intact.
  The fifth binary includes this independently reviewed correction. Switching mode
  resets native focus/selection/undo, while the stored draft value survives.
- Fifth-build source suite remains 555/555, zero failed/skipped; typecheck exits 0.
  The native meter/channel/asset test is being rerun against this exact binary.
- Fourth-build Captis re-export FAILED with `Evidence is missing for
  meter.face_photo`, incorrectly described as an oversized PDF. Read-only device
  inspection confirms the original `Documents/form-media/form_mtoojprm_4h7kf6/
  photo_mtopfg2c_jlz88i.jpg` is still present, readable, 103,031 bytes, unchanged
  modification time. A checksum-verified stored record retains its exact photo ID,
  caption, MIME type and an absolute previous iOS container URI. Access via that
  saved path fails after the update. Root-cause media-path portability and truthful
  missing-evidence errors are being fixed; the photo is not replaced. The PDF row
  layout retest remains open until evidence access is restored.
- Final source re-audit found report and metering-table loaders still hiding read
  errors behind indefinite/empty states, plus installation-pack historical-form
  version selection and some metering table/export operations. These are active
  residual fixes, not accepted platform exceptions. Their isolated changes will
  receive a separate source/native build gate before integration is called done.
- Fifth-build electrical rerun did not resolve the JSON input accessibility
  failure. A remount alone is insufficient with native view recycling. That
  ineffective shared key has been removed. The capability control now includes
  its selected Text/JSON format in its accessible label, so a mode change forces
  RN to apply the new label to the replacement control. Structured value input
  also disables automatic capitalization/correction. This correction is RETEST
  pending the next binary; no meter or asset has been saved by failed attempts.
- WW branch test on the fifth binary exercised A3RM/A6M channel/rating clearing,
  safe-to-proceed No, custom load capture and save/reopen, then FAILED because the
  site tag `QA-WW-TAG-01` had become `QA-WW-SERIAL-20260905` after restart. The test
  had asserted the correct tag immediately after typing. Actual startup migration
  in `data/seed.ts` unconditionally overwrote WW and Comms tag fields from serials.
  It now seeds missing legacy values only, preserving distinct and explicit blank
  tags. All three production-normalizer tests failed before the fix and passed
  after it, including a second restart. WW device retest remains required.
- ACE `testQA03ACENumericAndManualSerialDraftPersistence` PASSED on the fifth
  binary (143.297 seconds): exact QA job marker/number, CT installation No, CT ratio
  100/5, manual phase-A CT serial, 230.25 V, 12.50 primary current and 0.625 secondary
  current survived normal save navigation and app restart. Portal equality remains
  a separate gate for these newly created records.
- The media-path correction is now integrated. Strict managed relative paths are
  resolved against the current iOS documents directory at display, original/reduced
  PDF, upload and deletion boundaries. Serialized attachment, queue, archive and
  revision identities stay unchanged. Cleanup protects equivalent old/current URI
  references; missing originals produce a truthful nonretryable evidence error.
  Independent review and 23 focused checks passed; the isolated full suite passed
  572/572. Native original-photo/PDF proof awaits the next combined build.

## Sixth-build integration in progress

- Final integration gate: 717/717 canonical mobile tests passed with no skips
  (47.413 seconds, exit 0), strict typecheck exit 0, and `git diff --check`
  exit 0. The source manifest froze 108 changed runtime files before the sixth
  Release build. Native build, install and device checks are separate gates.
- Sixth Release build and attached-iPad installation both passed (exit 0).
  The before/after source manifest matched, QA origin was embedded, and the
  installed bundle SHA-256 is
  `0523aea7448685074019878ddfbffa8ee254307c5081cd9d4d09b9134da731d7`.
  Physical regression results follow separately; installation alone is not PASS.
- Sixth-build recovery QA01: Cancel preserved the original checkout, explicit
  preserve/adopt succeeded, and the server job/zone opened. After relaunch the
  exact original fields/counts and all eleven archive sections were independently
  parsed from the retained native accessibility snapshot. No local photos existed
  in this fixture, so this is not a photo-retention assertion. XCTest subsequently
  failed at its ambiguous live selector for repeated empty JSON arrays (325.349
  seconds, exit 65), not at adoption or archive creation. The reader now parses
  one coherent native snapshot; a read-only continuation will verify another
  relaunch without repeating adoption. Evidence:
  `tmp/FieldAppParityHarness/qa-build6-recovery-r1.xcresult` and protected exact
  fixture `tmp/field-parity-private-device/qa-web-recovery-build6.json`.
- Integrated the final electrical arrangement lifecycle delta. The exact pending
  document survives a temporary unavailable-record branch; Retry restores it and
  explicit Discard permits leaving. Navigation protection applies only to the
  current authorized actor/record, so logout or access withdrawal cannot trap
  navigation. Sixteen focused checks passed, including actual-screen lifecycle
  coverage and a mutation-during-map-read save rejection.
- Integrated report read/preview errors, scoped photo preferences, retained pack
  version selection and report action lifetime fixes. Main patch SHA-256:
  `703b55d40d97238984c8244b5e8f61f3fd0b541a6e1406f1e8bb9f05d964c72d`;
  lifecycle delta `c187fdae2f588b9a5bed31e9c088ac354492535067c036e51a0a4c7c3ab1368d`.
  Isolated focused tests: 84/84; typecheck 0.
- Integrated metering table/history read states, exact per-channel targets,
  optional diagnostics and pinned mapping JSON export. Patch SHA-256:
  `72325f92ecdd238b5bb376837928245fdf9415beadb8dcbb4d48a62e5a2801b3`.
  Independent focused tests: 18/18. Generic channel navigation no longer falsely
  reports that an installation form was completed.
- Integrated saved electrical-map arrangement display and Draft Arrange / move /
  Save / Discard, backed by the portal's layout endpoint and tree/layout revision
  checks. Pending positions survive rejected saves, and confirmed retries do not
  repeat the mutation. Patch SHA-256:
  `dbbc628318adc76c78154d929303768679283f4d0c777c3347e391dfa5499e6d`.
  Isolated diagram/layout tests: 24/24; typecheck 0. Native and portal layout
  roundtrip remain RETEST.
- Corrected board and site-asset deletion confirmations to describe retained
  completed forms/evidence and detached Draft links, matching the existing
  corrected deletion transaction.
- Integrated commercial actor/installation/invoice/focus scoping. A prior
  invoice's values cannot remain attached to a newly opened invoice's actions;
  retained confirmations and delayed continuations stop after account, route or
  focus changes. CSV/PDF downloads reuse that same lease. Patch SHA-256:
  `02b24970abc2f040d03680f8e47443f7518667c3d6a9658e9fde61ffec9417ad`.
  Focused tests: 20/20; isolated full suite: 592/592, typecheck 0. Negative tests
  reproduce the prior stale-screen behavior. No live invoice or pricing mutation
  was performed for these source checks.
- Integrated authenticated download handling for decoded compressed responses.
  Identity responses still require exact declared length; all responses require
  successful stream/writer completion and counted decoded bytes equal to saved
  file size. Partial, malformed, redirected, wrong-MIME and corrupt transfers
  remain rejected. Patch SHA-256:
  `5e7dbfc51d4633432a16b90d096d7155fa8fe820954c7c206ed381dab3383462`.
  Independent focused checks: 36/36, including compressed UTF-8 CSV transfers and
  the installed Expo stream runtime. The old implementation fails 20 checks.
  Actual iPad CSV export/share remains RETEST.
- Sixth-build CSV retest PASSED (27.537 seconds, exit 0). The authenticated QA
  financial summary opened the native share sheet. Its exact downloaded CSV was
  copied read-only before dismissal: 760 bytes, valid UTF-8 CSV, matching the
  synthetic installation/client and AUD charge-up totals. SHA-256:
  `6242f4fdf689afdbe2dce0d925d5a79f6fe9e4cb32c12c199a87e08711261439`.
  Artifact: `tmp/FieldAppParityHarness/QA-Financial-Summary-iPad-build6.csv`.
  No recipient or outbound sharing target was selected.
- Removed the task's temporary full-device-store and AsyncStorage manifest
  copies after diagnosis. Only the exact synthetic Captis record, original QA
  image and nonsecret app/file metadata remain as protected local evidence.

## Seventh-build device search closure

- Final coverage review found native device search still used one contiguous
  substring and omitted distinct custom names/family. It now matches the portal's
  case-insensitive AND of whitespace-separated tokens, includes those identities
  and human switchboard type labels, and retains exact installation join checks
  and deterministic bounded results. A new test reproduced the missing match
  before the fix.
- Replacement actions now match the portal's WATTWATCHERS A3RM/A6M restriction.
  The UI hides unsupported-device replacement, and serialized form creation
  revalidates the current meter family/model/installation/board/zone before writing.
  Stale screen or actor continuations cannot navigate or create a replacement
  after a context change. General device editing remains available.
- Device search distinguishes loading, missing installation and failed reads;
  Retry retains only same-scope successful rows, blocks stale row actions, and
  rejects late account/route/unmounted callbacks. Thirteen focused search,
  actual-hook, actual-screen and serialized-repository tests passed. The full
  canonical suite passed 727/727 with no skips (41.053 seconds), typecheck 0 and
  diff check 0. Seventh Release build is in progress from 110 frozen runtime hashes.
- Seventh Release build and attached-iPad install PASSED, both exit 0. The
  before/after source manifest matched; QA origin embedded. Bundle SHA-256:
  `72ff10e2da0a549664e2c0648529bf4536e049d1df8cef89f9ddc5f7caf46d0c`.
  Combined native persistence/report/recovery regression batch is running.
- The combined seventh-build run was interrupted after repeated 60-second native
  animation-quiescence waits while editing only a zone search query. No meter or
  asset save had occurred. Its result is INTERRUPTED (exit 73), not a product PASS
  or a demonstrated application failure. Restarting the app/test session restored
  normal interaction speed for the next test.
- Captis re-export then PASSED on build seven (32.276 seconds, exit 0), after
  correcting the harness to recognize visible read-only caption text. The exact
  Completed form, original photo/caption and native PDF share sheet were verified.
  The downloaded PDF has two pages, all expected captured values and evidence,
  and keeps the Pulse / flow rate label and value together on page 2. Both pages
  were rendered and visually checked. PDF: 457,142 bytes, SHA-256
  `53fd61488184f145d36a00cb0a391afa8026cacefcbb07c02d30ccab3c325e8e`;
  `tmp/FieldAppParityHarness/QA-Captis-iPad-native-build7.pdf`.
  A fresh read-only copy of the original JPEG after the updates still has SHA-256
  `cf22fdf3da0faa85266d0948a2228e345767636bdee5b74e20d556fa1c6828f1`,
  exactly matching the pre-repair original. The historical captured address is
  intentionally unchanged; the corrected current installation address is separate.
- Final device-result display audit also restored the portal's human manufacturer/
  model heading, distinct Device name and Asset ID, plus the supported-model
  replacement explanation. Fourteen focused checks passed, followed by 728/728
  full mobile tests without skips (38.881 seconds), typecheck 0 and diff check 0.
  Eighth Release build is in progress from 110 frozen runtime hashes.
- The previous Comms XCTest prerequisite used the synthetic OTHER meter. That
  route would reproduce the portal mismatch and is no longer a valid replacement
  test. A supported synthetic WW device must be established before that scenario;
  no Comms replacement or meter mutation has been performed by it.

- Eighth Release build and attached-iPad installation PASSED (both exit 0).
  All 110 runtime hashes matched before/after the build, QA origin embedded.
  Bundle SHA-256: `5cee052f2424929530df3992df01bf5ad33094ae42810f8a38396f4cf46b3dde`.
  The preceding complete mobile suite remains 728/728, typecheck 0.

- Eighth-build electrical persistence PASSED (188.759 seconds, exit 0): the native
  atomic Save persisted QA Electrical Meter (`QA-ELECTRICAL-20260905-01`),
  its typed JSON capability, SUB_CIRCUIT/L1 sensor capture, the new QA Ventilation
  Load HVAC asset, and its single-phase consumption assignment. After process
  restart the exact values, selected target and reverse asset-to-meter navigation
  matched. No takeover or replacement was performed. Result:
  `tmp/FieldAppParityHarness/qa-build8-electrical-r2.xcresult`.
  The preceding r1 invocation selected a nonexistent XCTest method and executed
  zero tests; its exit 0 is excluded from verification evidence.

- Eighth-build WW Draft branches PASSED (283.095 seconds, exit 0). A6M → A3RM
  → A6M clears incompatible ratings and channels 4–6; retained Channel 1 custom
  load, CT-250A, Not Connected capture, final comments, serial
  `QA-WW-SERIAL-20260905` and separate `QA-WW-TAG-01` all survive restart.
  Safe-to-proceed No remains a visible completion block. This closes the earlier
  startup tag-overwrite reproduction; it does not reconstruct unknown old tags.
  Result: `tmp/FieldAppParityHarness/qa-build8-ww-r1.xcresult`.

- The dedicated supported Comms fixture PASSED (185.101 seconds, exit 0).
  Exactly one new synthetic WW form commissioned A3RM `QA-COMMS-OLD-20260905`,
  name QA Comms Meter and separate tag QA-COMMS-TAG-OLD on QA Main Board.
  All three channels are Spare / unused. The Completed form opened channel
  measurements; Save and restart preserved the device. Exact serial search
  returned one supported result with Replace device enabled. The installation
  remains Draft; the original WW branch Draft was preserved. Result:
  `tmp/FieldAppParityHarness/qa-build8-supported-ww-r1.xcresult`.

- Eighth-build Comms Draft branches PASSED (232.026 seconds, exit 0): exact
  supported A3RM context, replace Yes → No cleanup → Yes, A6M serial/tag and
  CT-400A, external-antenna and extension branch cleanup, signal selections and
  final comments survive restart. Safe-to-proceed No remains the completion
  block. No device replacement was completed by this test. Result:
  `tmp/FieldAppParityHarness/qa-build8-comms-r1.xcresult`.
- Native finance control correction integrated. Combined suite PASSED 731/731
  without skips (64.708 seconds), typecheck 0; ninth Release build and attached
  iPad install both exit 0. All 110 runtime hashes matched before/after build;
  QA origin embedded. Bundle SHA-256:
  `9f3a61308dc865465f6fd350074258b729001275fca6ab68183946f718f3f9a0`.
  A wording review is checking the source of displayed hours; no ledger/API
  behavior is changed. The portal companion remains awaiting local integration.

- Ninth-build Device Search PASSED (44.012 seconds, exit 0): reverse-order
  whitespace tokens, OTHER family, custom name and human Main Switchboard label
  locate the exact synthetic meter; name/model/Asset ID render separately.
  Unsupported replacement is absent, no-match hides Open device, and exact serial
  search opens the correct saved meter. Result: `qa-build9-search-r1.xcresult`.
- Ninth-build client-report selection and native PDF share PASSED (40.127 seconds,
  exit 0). Excluding the one known Captis photo persists across app restart;
  reinclusion restores the original caption/image and enables the actual PDF
  export. Result: `qa-build9-client-r1.xcresult`; PDF artifact inspection follows.

- Ninth-build read-only recovery continuation PASSED (118.337 seconds, exit 0).
  The preserved recovery copy's complete eleven-section data was unchanged across
  two relaunches, and the adopted canonical Web fixture still shows the expected
  server job/zone. This supplements the earlier successful preserve/adopt and
  baseline equality evidence; it never repeated adoption. Result:
  `tmp/FieldAppParityHarness/qa-build9-recovery-r1.xcresult`.
- The corrected finance-hours explanation passed 12 focused tests. Tenth Release
  build passed with unchanged source and QA origin, SHA-256
  `a47259c8d64e7650b62168ddce485fa96b864452c9962a70940bfdaad033fdc1`;
  it was not installed because the client-report pagination fix was then ready.
- Ninth-build client PDF: 64,373 bytes, two pages, SHA-256
  `8be1bcbd0a0aef204736172193acdc5749e1d1c1f80d2a02b108f72a9940b673`.
  Exact values include two meters, one directly metered asset and two Completed
  forms; original caption/photo retained. Rendered review found Selected evidence
  heading orphaned at page 1 bottom. Heading/rule/next-text pagination is now
  corrected locally; photo collection remains free to span pages. Native re-export
  remains RETEST. Artifact: `QA-Client-report-iPad-native-build9.pdf`.

- Ninth-build global backup controls/timestamp/queue assertions PASSED
  (12.437 seconds, exit 0). The global last-success timestamp advanced and the UI
  reported Pending 0 / Failed 0 / Evidence backed up; the app returned Home.
  Result: `tmp/FieldAppParityHarness/qa-build9-backup-r1.xcresult`.
  This test did not assert the main installation's server revision, accepted tree
  or record counts. The later comparison shows that installation was silently
  skipped by the global run because it is paused with a conflict. This checkpoint
  is **not a main-tree backup PASS**; at that checkpoint its full upload/roundtrip
  remained blocked.
- The revised portal finance correction is integrated locally (one component,
  five regression cases and contract documentation); canonical portal suite
  PASSED 409/409 without skips (20.192 seconds), typecheck, targeted ESLint and
  optimized Next.js build all exit 0. The live QA portal has not been redeployed.

- Eleventh Release batch is installed, with 110 runtime hashes unchanged during
  its build and matching canonical at the initial documentation check. It includes the corrected finance-hours
  wording and client-report pagination source fix. QA origin is embedded;
  version 1.0.0/build 15; bundle SHA-256
  `2aea4d5ee5172eefd712764e0d66592cc90304d65366afdb92ef7af3fe3b9b51`.
  Evidence: [manifest](../../tmp/field-parity-build11.json) and
  [build log](../../tmp/field-parity-build11.log). Build ten remains a successful
  uninstalled intermediate batch; historical device observations above retain
  their original batch attribution.
- Build-eleven exact-installation backup-state inspection PASSED its read-only
  observation assertions (24.687 seconds), while revealing the operational
  blocker: `Assigned work tree changed on the server. Cloud Backup is paused.`
  It did not dispatch backup, clear the conflict or adopt a server tree.
  Evidence: [inspection log](../../tmp/field-parity-build11-backup-state-r1.log)
  and [result](../../tmp/FieldAppParityHarness/qa-build11-backup-state-r1.xcresult).
  Root's same-fixture comparison reports native seven forms/two meters/one asset
  versus QA one form/no meters/no assets. These are separate retained states.
  Subsequent checksum-verified exact-fixture extraction confirms local revision
  121, base server 10, last synced local/server 19/10, existing child fingerprint
  and metadata baseline. Conflict is server 10 → 11, changed child fingerprint,
  no root conflicting fields, detected 2026-09-05T19:30:54.800Z. Missing baseline
  is ruled out for this record; the server-change operation is still being traced.
  At that checkpoint the main-tree upload and both directions of roundtrip,
  saved-map/CAS, complete/pin/export/reopen, and the dependent finance/invoice
  mutation sequence remained blocked. Existing Web-fixture recovery and local evidence successes are
  retained; they do not certify this different installation's cloud tree.
- Root's current portal Files & history observation shows Backup Version 9 at
  11:23:10 with one zone, no boards, no assets and one form; the live portal has
  one board. An accepted metadata push with an incomplete full backup is a
  possible explanation, not an established causal conclusion. Preserve this
  distinction while tracing revision 10 → 11.
- Build-eleven client-report r2 physical test PASSED (39.267 seconds). Root
  inspected both exported PDF pages; Selected evidence heading, rule, count,
  original photo and caption are together on page 2. Exact artifact SHA-256
  `d6ef6adc272f3b5232f48a3221b74e9a68c6426be2b48506fa5f20e0f1a1fefd`.
  This closes the reproduced pagination gate for that PDF, not cloud-tree parity.
  The earlier wrong-selector r1 executed zero tests and is excluded from evidence.
- Actual manual-origin route harness is prepared and selectively addressable as
  `FieldAppMetricsHarnessUITests/RoutePlannerParityUITests/testQA01ManualAustralianOriginActualRequestAndResult`.
  It submits explicit date 2026-09-05 and public Australian starting address once,
  requests no GPS and never opens a returned job. Provider/account failure yields
  a recorded BLOCKED skip, not route success. Opening a fixture remains BLOCKED
  without an eligible exact-source QA stop; the main installation's ownership or
  local content does not make it an eligible Scheduler event. See the
  [route harness handoff](../../tmp/field-parity-route-harness-handoff.md). The
  completed r3 empty-route result is recorded below; opening a returned QA job
  remains unavailable without an eligible synthetic Scheduler stop.


## Build-eleven route and follow-up reporting corrections

- The actual typed-address route request passed on the attached iPad in 28.138 s,
  zero skips (`qa-build11-route-r3.xcresult`). Inputs were date `2026-09-05` and
  `1 Martin Place, Sydney NSW 2000`; the result showed Australia/Sydney, zero
  routable jobs, zero distance/time, no warnings and the empty-state card. No
  GPS, suggestion selection, scheduling mutation or returned-job opening occurred.
  R1 stopped on an incorrect Home-tab button selector; R2 received an empty result
  but failed to recognize the native uppercase overline label. These are harness
  failures, not evidence of an authentication or API outage.
- Source tracing found a shared portal/native P2 explanation mismatch for empty
  routes: the backend does not request a road matrix when there are no routable
  events, yet both clients called the default straight-line enum a road-provider
  failure. Both now say no travel estimates are needed for an empty route.
  Device retest and portal release remain outstanding; normal nonempty road and
  fallback explanations remain unchanged.
- Native installation detail also no longer tells users that optional unassigned
  active channels must be mapped before completion. It labels this as optional
  review while explicit TBC/broken-target relationships retain their blocking action.
- Backup reporting now distinguishes last check from confirmed installation backup,
  and reports confirmed/deferred/remaining installation counts independently of
  evidence upload counters. The new timestamp cannot advance for zero confirmed
  trees or a run with remaining/deferred work. Legacy check timestamps are not
  reinterpreted as proof. Settings/Diagnostics native verification awaits the next
  installed binary.
- A separate P0 recovery gap is source-confirmed: metadata-stage push had no durable
  intent before dispatch. Server acceptance followed by a failed/interrupted
  confirmation pull can leave the old device CAS and manufacture a later child
  conflict. The main fixture's mutable server board versus older finalized version
  is consistent with that failure window; its original dispatch receipt is absent,
  so it is not safe to auto-advance this old fixture from timestamps or shape alone.
  The frozen-intent recovery path for new requests is now implemented and locally
  verified; its native checks remain pending.

- Camera-denial fallback passed on build eleven in 144.383 s with zero skips
  (`qa-build11-camera-r2.xcresult`): the exact existing Comms Draft
  `form_mtovq2f0_1gwus5` opened the OS camera-permission prompt, Don't Allow led
  to the actionable Photo error, Choose photo still opened the private picker,
  Cancel added no evidence, and the same draft marker/empty photo slot survived
  restart. No camera image was captured or library image selected. The first
  attempt failed only because native AX flattens photo buttons as siblings of
  their field container; r2 binds the action to the observed exact field bounds.
  Camera permission is currently denied following this test.
- The portal empty-route wording batch passed 409/409 tests, typecheck, targeted
  RoutePage ESLint and optimized Next.js build (all exit 0). Evidence logs are
  `../tmp/field-parity-portal-route-{tests,typecheck,lint,build}.log`. No portal
  deployment occurred.

## Durable metadata recovery and preserved main fixture

- The new metadata journal freezes the exact actor-bound payload, original local
  tree and existing canonical preimage before POST. Accepted receipts persist
  before canonical verification. Recovery precedes assigned pulls, preserves later
  capture, and never counts metadata as a complete backup. A definitive POST 409
  preserves the original attempt for explicit recovery. The legacy main conflict
  has no journal and is not auto-cleared. See
  [implementation and limits](ios-web-parity-metadata-recovery.md).
- Root review caught the scoped pull route's first-create behavior: a missing ID
  produces `404 Installation not found`, not an empty list. The client now treats
  only that exact no-base response as absence; existing-base 404, forbidden,
  unrelated 404, server failure and unexpected existing ID remain errors. These
  production execution paths are covered in the final 805/805 suite (50.106 s,
  zero skips), with typecheck and diff check exit 0.
- The read-only stop-at-Home test passed on build eleven (4.687 s), leaving the
  app stopped for a stable extraction. The full exact-QA capture includes all ten
  preserved sections, seven forms, two meters, one site asset/assignment, no
  editor drafts and no pending metadata/complete request. Its protected JSON
  SHA-256 is `f860483e2b1b1a5da5b2054d0e0775c6a9886b09f21f0a2d4d42a57b250aed7b`.
  The active-time outbox was read successfully and had zero currently queued
  sessions for this fixture; that does not claim zero historical work.
- Its one original photo was copied and independently verified: 103,031 bytes,
  SHA-256 `cf22fdf3da0faa85266d0948a2228e345767636bdee5b74e20d556fa1c6828f1`.
  Full-store and unrelated outbox rows were transient and not retained. The earlier
  running-app attempt correctly rejected a moving outbox and created no artifact.
  At this historical preflight recovery had not yet executed. The subsequent
  build-twelve adoption and archive checks are recorded below.
- Build-twelve backup outcome r2 passed on the attached iPad in 30.060 s,
  zero skips. An explicit check reported zero installations confirmed, one still
  needing backup and one paused, despite the separate evidence counter showing
  Pending 0 / Failed 0 / Backed up 1. The new confirmation timestamp stayed
  `Not yet` through restart and the original conflict remained. Root visually
  inspected the exact Settings screenshot. R1 reached the correct outcome but
  failed a harness-only StaticText selector for a native alert container; r2 uses
  its actual accessibility role. No conflict was cleared or main-tree upload proved.
- Build-twelve empty-route retest passed in 25.013 s, zero skips, with the same
  explicit public Australian origin/date. It displayed the corrected neutral
  empty-route explanation and neither road-provider failure nor estimated order.
  The companion stop test passed separately; the two-test run exited 0. Evidence:
  `qa-build12-route-r1.xcresult` and `qa-build12-backup-outcome-r2.xcresult`.
- Fresh build-twelve preservation artifact SHA-256
  `0a6a595efcb0a287e862c3586e15ddfd1101f4129327f2ebeb8b154cb77a2937`
  matched all ten sections of the full build-eleven artifact and reverified its
  original image. The explicit review showed the exact main ID/name, seven/two/one
  local capture and server revision 11 with one/zero/zero. R1 stopped before any
  choice on a whitespace-sensitive alert assertion; the observed actual counts
  and revision matched. R2 normalized whitespace, verified Cancel preservation,
  then performed one explicit Preserve and use server action, received `Device
  copy preserved`, and verified the adopted job/zone. It then stopped on a
  harness-only flattened-AX archive button association. Adoption must not be repeated.
  The separate read-only continuation now uses the observed exact-title column
  and unique associated button, and still compares all original JSON sections.
- Read-only continuation r3 PASSED in 208.638 s, zero skips. All ten original
  capture sections matched the complete preflight; all eleven archive/proof
  sections were identical across two restarts. The exact archive operation is
  `conflict_recovery_mtoyi13z_xrbvuq`. Root viewed the original synthetic image
  inside the recovery viewer and then independently extracted that exact archive.
  Post-restart artifact SHA-256 is
  `58033ae4a5896db087bb20e6a968916982baefd2c6e50c30635533b6d453ac62`.
  Typed JSON comparison and original-photo byte/hash comparison passed. Time
  outbox/proof contained zero pending sessions; no historical time was replayed.
- The working canonical tree is separately verified as Draft, local revision 125,
  server revision 11, confirmed pair 125/11, no conflict, same grid/zone/board IDs,
  and only Captis `form_mtoojprm_4h7kf6`. Its answers, completion timestamp and
  attachment metadata exactly match the preserved original. Its current photo URI
  matches the original cleared upload receipt; the original file remains archived.
  No new capture ID has yet been presented as a restoration of an old ID.
- The offline payload probe composed the actual preserved capture, production
  native payload builder and backend pure canonical/retention functions. All
  seven forms, two meters/four channels, one assignment and the Captis attachment
  passed recovery representation comparison; changed caption, SUMS numeric string
  and typed capability were rejected. This is a pure contract check with controlled
  prior-state parameters, not a live server receipt or proof of the old failure.
- That probe exposed another concrete offline dependency: an existing server
  installation rejects a newly captured supported meter plus linked Comms
  replacement Draft before the meter's first backup (`comms_replacement_meter_missing`).
  The device re-entry sequence will confirm the supported meter's full backup
  before creating Comms. A compatible API correction is being reviewed separately;
  the sequence is a workaround, not closure of that offline API discrepancy.
  A source-confirmed new-journal validation-400 retry deadlock is also being fixed;
  that subsequent mobile change is not in installed build twelve.
- Electrical re-entry passed on build twelve in 239.753 s, zero skips
  (`qa-build12-electrical-reentry-r1.xcresult`). It created the OTHER meter with
  typed custom channel capabilities and the HVAC asset with a confirmed single-
  phase measurement assignment, then verified both mapping directions after
  restart. Portal Device search showed the same synthetic serial, manufacturer,
  model, board/zone and resolved code `QPI2-QAPR-02-OTHER-QA-ELECTRICAL-METER`;
  its installation showed one meter and one asset. These are new capture IDs,
  not restoration of archived identities.
  A subsequent read-only portal meter-detail check verified the blank separate
  site tag, operational notes, channel purpose/description/phase/sensor,
  `qa_characteristics={ratingA:100,synthetic:true}`, and the same single-phase
  Consumption assignment to QA Ventilation Load with Channel 1 selected.
  The portal explicitly showed no finalized device version yet. No portal Save
  or other mutation was performed during this check.
- The following explicit backup check failed its full-confirmation assertion
  after 101.494 s: Settings correctly reported zero confirmed, one still needing
  backup, one paused and `Last confirmed installation backup: Not yet`.
  `qa-build12-electrical-backup-r1.xcresult` and its after-check screenshot/AX
  retain the observed result. The stop-at-Home test passed in 4.618 s before a
  stable exact-fixture extraction, SHA-256
  `509bd4f43ff507d463ec9e97d3459a03d2d61496b4018b4f4f5308ff8697859b`.
  The request was prepared from local 126/base 11, received tree revision 12 /
  record version 9, then was archived with `snapshot_conflict` on retry. The
  local baseline stayed 125/11. All original archived capture remains separate.
  The canonical-confirmation mismatch and replay behavior are being diagnosed;
  no second preserved-copy adoption has been performed.
- A saved accepted metadata receipt now resumes with an exact canonical GET
  instead of sending the old POST again. Focused durability checks pass 15/15,
  including lost response versus lost pull, changed remote revision and incomplete
  receipts. This correction is source-only and does not yet recover the already
  conflicted build-twelve receipt or prove physical backup success.
- The same saved-receipt read path is applied to complete-backup confirmation;
  local revision/watermark, actor/session, canonical merge and final commit guards
  stay enforced. Combined receipt/durability/revision checks passed 37/37, zero
  skips. The API's generated-display-code fingerprint mismatch independently
  reproduces from the actual frozen electrical payload; losing a POST response
  before any local receipt still requires a server-side replay correction.
  That API correction and exact accepted-conflict recovery are in progress.
- The first electrical confirmation failure is now reproduced from the exact
  frozen request through the API's production `projectLegacyInstallationTree`
  pull projection. Captured-field comparison passes, but the code reconciler
  rejected board/asset `displayCode` strings despite their complete sibling
  `displayCodeMeta` objects (`Canonical server tree is missing displayCode`).
  The initial pure-canonical probe missed this wire projection and therefore did
  not reproduce the failure. The shared reconciler now supports both canonical
  objects and the actual pull scalar/metadata pair, requires their values to
  agree, and rejects missing/invalid metadata before any identity/base commit.
  The new wire-shape regression failed before the fix with the exact error.
- Build thirteen installed successfully from the unchanged 120-file runtime
  manifest. Its first backup test failed the initial Home assertion in 36.901 s,
  before reaching Settings or any explicit backup action. The subsequent launch-
  state capture/stop test passed in 14.010 s and showed the actual Sign in screen;
  it is diagnostic evidence, not a backup success. The app was reopened for the
  user to authenticate, and no credentials were requested in chat or read from
  storage. A stable exact-fixture extraction after installation, SHA-256
  `86598b44e08059e5244ae086ab2f79de9bacb0cacf736f27507943f269fba874`,
  matched every captured snapshot field and its digest to the build-twelve
  electrical artifact. The accepted/conflicted receipt and current work are
  unchanged. Native receipt recovery and full backup remain unverified.
- Build-thirteen original-archive verification passed independently of the
  active tree's unresolved backup. Protected extraction SHA-256
  `7f66dc683e7d381b302d956ec979fccc485c7b673d7a2c234345dab3d132df6a`
  preserves all ten original capture sections, exact archive identity and
  reconciliation proof, and the original 103,031-byte Captis photo. The retained
  archive comparator was used because the earlier post-adoption comparator
  correctly rejects today's edited/conflicted active tree; its active-tree
  assertions were not relaxed. Evidence:
  `tmp/field-parity-private-device/qa-ios-original-archive-build13-signin-verification.json`.
  This is preservation evidence only, not authentication, recovery or full-backup
  acceptance.
- Build-fourteen adds manual retry of an unchanged proven-rejected metadata body
  after a backend correction, without changing automatic suppression or the
  original rejected history. It also fixes Installation Access stale route/account
  selections and Inventory account/query/action scope. Typed scanner fallback can
  now review a serial directly or switch to manual mode without losing it. Both
  scanner regressions failed against the original screen and passed after the fix;
  the source batch passed 935/935 tests, typecheck and Release build. No device
  installation or new interaction is claimed. The prepared selective native
  inventory fallback test was Swift-typechecked outside the active harness and
  intentionally stops before an affirmative stock claim:
  `tmp/field-parity-prepared/INVENTORY-MANUAL-FALLBACK.md`.

## Build-fifteen QA closure for backup and form roundtrips

- The API compatibility correction was committed as
  `2f0e11268d361eac4ac45072a9fcc74a64059e44`, pushed, verified by successful
  exact-commit CI run `34004184070`, and deployed to the immutable QA API release.
  Health returned 200. The portal process stayed on its prior release and
  production was untouched.
- Build fourteen first authenticated successfully and recovered the saved accepted
  conflict. Normal re-entry restored the six non-Captis records. A physical run
  then exposed one remaining mismatch: native stored the hidden Wattwatchers board
  type code while the portal canonicalized it to its label. Build fifteen maps the
  code to the portal label before creating the form. Its 122-file source manifest
  is unchanged from the compiled input, and 936/936 tests plus typecheck pass.
- Build fifteen installed over the retained application data and completed re-entry:
  Captis `form_mtoojprm_4h7kf6`, WW Draft `form_mtp5o5gu_xx4rsv`, ACE Draft
  `form_mtp5wx2s_m9phy5`, Honeywell Draft `form_mtp62a45_o9vqks`, SUMS Draft
  `form_mtp65uby_lyvlsx`, supported WW Completed `form_mtp6ails_xgvvz2`, Comms
  Draft `form_mtp6w9cv_vf0bub`, and supported meter `meter_mtp6qk44_ks29xr`.
- ACE portal → iPad → portal passed in
  `qa-build15-ace-portal-ipad-roundtrip-r1.xcresult`; SUMS passed in
  `qa-build15-sums-portal-ipad-roundtrip-r1.xcresult`; exact WW Draft passed in
  `qa-build15-ww-draft-portal-ipad-roundtrip-r2.xcresult`; exact Comms Draft passed
  in `qa-build15-comms-portal-ipad-roundtrip-r1.xcresult`. The WW r1 result is a
  harness-only selector failure before mutation and is excluded.
- Final backup passed in `qa-build15-all-roundtrip-return-backup-r1.xcresult`.
  The stable device export SHA-256 is
  `6a571a30c226724bf0677f07141b6c1e43f0c9976fe7b7d501fd82d5d8f96001`.
  The independent device/API comparison passed with zero differences, local
  revision 237, server revision 65, empty queues and no conflict. Its report
  SHA-256 is
  `921972cac68decd3285fd0809309de2439e79e52e91151baf7708bc018ff5521`.
- The original archive operation `conflict_recovery_mtoyi13z_xrbvuq` remains
  protected. Its retained extraction SHA-256 is
  `7f66dc683e7d381b302d956ec979fccc485c7b673d7a2c234345dab3d132df6a`.
