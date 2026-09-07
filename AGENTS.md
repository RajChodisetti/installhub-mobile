# Field App Complete Agent Guide

This is the canonical operating guide for AI coding agents working in this repository. Read
[`docs/AI_ONBOARDING.md`](docs/AI_ONBOARDING.md) before making a non-trivial change; it contains the
full architecture, route, data-model, dependency, and workflow reference.

## Product in one paragraph

Field App Complete is an iOS-first Expo/React Native field app for documenting electrical
installations. An installation contains zones; zones contain electrical boards and site assets;
boards can contain Wattwatcher A3RM/A6M meters and channel commissioning data. Installations also
own versioned submissions for six field-form families, with durable local evidence and PDF export.
The app is local-first: fixture JSON seeds an in-memory store persisted as verified, chunked
AsyncStorage generations, while authenticated installation trees and evidence are backed up to the
Sustainability Wise API. Client reports include locally selected evidence and native PDF sharing;
administrator finance/invoices and meter history use dedicated APIs. Zone-summary sending remains
unavailable until an authenticated destination contract exists.

The functional web reference is the UI portal's `/installhub` module in
`sustainability-wise-api/apps/ecoaudit`, not the legacy standalone `installhub` web repository.
See the [master parity audit](docs/ios-web-parity-audit.md),
[field catalog audit](docs/ios-web-parity-forms.md),
[form actions and historical reports](docs/ios-web-parity-form-actions.md),
[photo selection and client reports](docs/ios-web-parity-client-report.md),
[electrical workflow and meter history](docs/ios-web-parity-electrical.md), and
[commercial and support workflows](docs/COMMERCIAL_AND_SUPPORT_PARITY.md).
These audits distinguish implemented fixes from device/live verification still required.

## Start here

```bash
npm ci
npm run typecheck
npm run ios
```

- Package manager: npm (`package-lock.json` is authoritative).
- Runtime: Expo SDK 57, React Native 0.86, React 19, strict TypeScript.
- Use a React Native-supported Node release: `^20.19.4`, `^22.13.0`, or `>=24.3.0`. Avoid Node
  23; React Native 0.86 and Metro reject it in their engine ranges.
- Login uses the Sustainability Wise API with the isolated `installhub` auth namespace. JWT and
  rotating refresh tokens are stored with Expo SecureStore. A rejected login must
  never create or update a local user; successful login replaces the cached
  profile with the exact API user ID and never stores the password.
- All builds default to `https://api.sustainabilitywise.com.au`.
  `EXPO_PUBLIC_SYNC_API_URL` is only an explicit local/test override. The mobile
  login flow does not bootstrap or register rejected credentials.
- Native `ios/` and `android/` directories are generated and intentionally ignored. Make native
  configuration changes in `app.json` or Expo config/plugins unless the project deliberately moves
  to a checked-in prebuild workflow.
- Form-domain tests are available through `npm test`; there is no lint or device E2E script.
  At minimum, run both tests and `npm run typecheck`, then manually exercise the affected flow.

## Architecture boundary

```text
screen
  ├─ shared/domain component
  ├─ query hook ──────────────┐
  └─ repository mutation ─────┼─> repository interface/implementation
                              └─> data/seed.ts -> AsyncStorage

device/report side effects: screen -> services/index.ts -> Expo module
cloud backup/import: local store -> cloudSyncRepository/remoteInstallationsRepository
                   -> syncService/thumbnailCache -> apiClient -> /v1/installhub
```

Keep these boundaries:

- Screens and components must not import fixture JSON or access AsyncStorage directly.
- Put domain types and allowed-value lists in `src/types/index.ts`.
- Put persistence CRUD behind interfaces in `src/repositories/index.ts`.
- Put camera/photo/report/share/external side effects in `src/services/index.ts`.
- Use hooks in `src/hooks/index.ts` for reactive aggregate reads. Repository writes call
  `persistStore()`, which notifies hook subscribers.
- Register every screen and its typed params in both `src/navigation/types.ts` and
  `src/navigation/RootNavigator.tsx`.
- Reuse `src/components/ui`, `src/components/domain`, `src/components/forms`, and theme tokens.
  Do not hard-code a parallel design system in a screen.

## Domain invariants

```text
Installation (id)
├── FormSubmission[] (installation_id, optional entity links, immutable when completed)
└── Zone (audit_id -> Installation.id)
    ├── ElectricalAsset / board (audit_id, zone_id)
    │   ├── optional parent board (electrical_parent_id)
    │   └── Meter[] embedded inside the board
    └── SiteAsset (audit_id, zone_id)
        ├── optional supplying board (electrical_board_id)
        └── optional meter board/channels (meter_switchboard_id, meter_channels)
```

- `audit_id` means installation ID; preserve that legacy naming until an intentional migration.
- Deleting an installation cascades to forms, zones, boards, and site assets in the repository;
  the screen cleanup path also removes owned form-media directories and generated local reports.
- Deleting a zone cascades to its boards, site assets, linked forms, upload
  queue rows, owned form media and generated form reports. Surviving
  cross-zone board references are cleared and marked TBC.
- Deleting an individual board or site asset retains completed forms and their evidence;
  affected draft forms lose the deleted board/meter or site-asset context. Board deletion removes
  its active meters and assignments, while surviving supply/metering relationships are cleared
  and marked TBC. Do not apply the installation/zone form cascade to individual boards/assets.
- `meterDevices`, `gridSupplies`, and `measurementAssignments` are canonical store arrays.
  Nested board `meters` and legacy site-asset channel fields are compatibility projections;
  update them together through the existing domain/repository transactions.
- Keep `ElectricalAsset.meter_present` synchronized with `meters.length > 0`.
- A `*_tbc` flag represents an intentionally unresolved relationship; clearing it should also set
  the corresponding ID when applicable.
- Repository updates preserve record IDs and refresh `updated_at`.
- Persisted working photo paths remain local `file://` URIs. The durable upload queue maps them to
  confirmed cloud URLs without replacing the local editing copy.
- Cloud Backup is opt-in per installation. New and migrated installations default to local-only.
- Remote imports are local-only copies named `<site> cp1`, `cp2`, and so on. Keep their original
  remote photo URLs immutable; cache only authenticated 400 px previews.
- Reuse imported source IDs for API PDFs only after both the local import-provenance invariants and
  the stored source-tree hash match a fresh pull. Any uncertainty must opt in and sync the cpN tree.
- Form media is copied into the app document directory; amendments must not delete files referenced
  by the completed record they supersede.
- Form definitions, visibility rules, accepted values, and completion gates live in
  `src/forms/catalog.ts`. Business answers and photo evidence are optional capture. A visible
  `prestart.safe_to_proceed` must still be exactly `yes`; Comms Fault with replacement selected
  still requires a supported new device type, Device ID/serial, and matching sensor rating.
- Installation readiness blocks explicit TBC supply, asset metering, or measurement targets.
  Missing optional answers, serials, photos, and unassigned active channels remain capture or
  diagnostic concerns rather than blanket completion blockers. Structural ownership, channel
  uniqueness, lifecycle, and API report-version checks remain enforced.
- The six new-form families are WW Installation, Comms Fault, ACE
  Switchboard, Honeywell Q400, Captis Logger, and SUMS Logger. Legacy
  `a3rm-installation`/`a6m-installation` submissions remain readable but must not
  return to the new-form picker.
- WW Installation and Comms Fault use the model-dependent choices in the catalog:
  A3RM uses `3000A – 9cm`, `3000A – 20cm`, and `3000A – 29cm`; A6M uses `60A`, `120A`,
  `200A`, `400A`, and `600A`. Model-scoped older ratings remain readable through the catalog's
  compatibility validation but are not displayed in the current dropdowns.
- Scanner requirements are field metadata in the form catalog. Preserve manual
  entry as a fallback and keep SUMS serial fields enabled for both barcode and
  QR scanning.
- WW authoring exposes one optional Device ID/serial field; Comms Fault requires the new serial
  only when replacement is selected. The optional `device_number` value is a distinct site/asset
  tag, remains readable and is mirrored for compatibility only while blank; never
  describe it as a second serial identity.
- Board, asset, and device names use type-based defaults when blank and accept up to 64 visible characters. Stable record
  IDs and serials remain separate identities, while duplicate names are rejected
  installation-wide.
- A WW form may be created/completed without board context. With a valid board and supported
  device type, completion creates or updates its stable operational meter atomically and opens
  channel mapping. Without that context, completion preserves the form without inventing a meter.
- Schema-v2 form answers sent to the API must use that family's supported non-photo catalog keys;
  do not leak cross-family prefill keys. Preserve schema-v1 answers and immutable local snapshots.
- Client-report evidence choices are local per-installation preferences, separate from the tree
  and formal report pack. They do not sync between iOS, other devices, and the portal.
- Every evidence-photo field is a multi-photo collection. Keep the visible
  “another photo” camera/library affordance after the first attachment.
- Meter presence on a switchboard is derived from its installed devices. Do not
  add a separate yes/no question; use the detailed WW commissioning action.
- The site-asset source-board detour is intentionally minimal: collect only the
  switchboard name/type, inherit the asset's upstream/grid source, auto-select
  the created board, and return to the protected asset draft.
- Completed form snapshots are read-only; corrections use `cloneAmendment`.

## Change recipes

### Add or change a persisted field

1. Update the interface in `src/types/index.ts`.
2. Update all relevant fixture records in `src/data/fixtures/`.
3. Update form state and submit mapping in `src/components/forms/index.tsx`.
4. Update repository defaults/normalization if needed.
5. Update all consumers, reports, and cards.
6. Consider storage migration. The current store uses the
   `installhub.mobile.store.v3.manifest` pointer plus immutable chunked generations;
   `seed.ts` migrates legacy v1/v2 documents through an encrypted recovery copy.
   Later schema changes still need an explicit, crash-safe migration.

### Add a screen

1. Add its params to `RootStackParamList` (or `MainTabParamList`).
2. Create the screen under `src/screens/`.
3. Register it in `RootNavigator.tsx`.
4. Use typed React Navigation props and theme tokens.

### Change Cloud Backup

Keep screens local-first. API calls belong in `src/api`, orchestration in `src/services`, and durable
queue/tree reads in `src/repositories/cloudSyncRepository.ts`. Update the mobile wire mapper,
`/v1/installhub` contract, `ih_*` schema/migration, tests, and this guide together.

## Before handing off

- Run `npm run typecheck`.
- Run `npm test`.
- Exercise the changed route on iOS or explain why it was not run.
- For persistence changes, test both seeded/reset data and previously persisted data.
- For camera/photo/PDF changes, test on a real device when the native capability matters.
- Update `docs/AI_ONBOARDING.md` when architecture, dependencies, routes, storage, or known gaps
  change.
- Do not commit secrets, signing files, `.env*.local`, generated native folders, or `node_modules/`.
