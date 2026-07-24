# InstallHub Mobile Agent Guide

This is the canonical operating guide for AI coding agents working in this repository. Read
[`docs/AI_ONBOARDING.md`](docs/AI_ONBOARDING.md) before making a non-trivial change; it contains the
full architecture, route, data-model, dependency, and workflow reference.

## Product in one paragraph

InstallHub Mobile is an iOS-first Expo/React Native field app for documenting electrical
installations. An installation contains zones; zones contain electrical boards and site assets;
boards can contain Wattwatcher A3RM/A6M meters and channel commissioning data. Installations also
own versioned submissions for six field-form families, with durable local evidence and PDF export.
The app is local-first: fixture JSON seeds an in-memory store persisted as one AsyncStorage JSON
document, while authenticated installation trees and evidence are backed up to the Sustainability
Wise API. Client reports and zone-summary sending remain placeholders.

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
  rotating refresh tokens are stored with Expo SecureStore.
- `EXPO_PUBLIC_SYNC_API_URL` overrides the API URL. A one-off controlled migration
  requires both `EXPO_PUBLIC_ENABLE_LEGACY_BOOTSTRAP=true` and
  `EXPO_PUBLIC_REGISTRATION_SECRET`; normal release builds must contain neither.
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
- Deleting a board or site asset cascades to every form linked to that entity
  (including embedded meter links), while surviving board/site-asset
  relationships are cleared and marked TBC.
- Meters are embedded values, not top-level store records. Update them by replacing the parent
  board's `meters` array.
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
- Form definitions, visibility rules, and required evidence live in `src/forms/catalog.ts`.
- The six new-form families are WW Installation, Comms Fault, ACE
  Switchboard, Honeywell Q400, Captis Logger, and SUMS Logger. Legacy
  `a3rm-installation`/`a6m-installation` submissions remain readable but must not
  return to the new-form picker.
- WW Installation and Comms Fault use exact dependent sensor choices:
  A3RM permits only `3000A - 9cm`, `3000A - 20cm`, and `3000A - 29cm`; A6M
  permits only `60A`, `120A`, `200A`, `400A`, and `600A`.
- Scanner requirements are field metadata in the form catalog. Preserve manual
  entry as a fallback and keep SUMS serial fields enabled for both barcode and
  QR scanning.
- Completed form snapshots are read-only; corrections use `cloneAmendment`.

## Change recipes

### Add or change a persisted field

1. Update the interface in `src/types/index.ts`.
2. Update all relevant fixture records in `src/data/fixtures/`.
3. Update form state and submit mapping in `src/components/forms/index.tsx`.
4. Update repository defaults/normalization if needed.
5. Update all consumers, reports, and cards.
6. Consider storage migration. The current store key is `installhub.mobile.store.v2`; `seed.ts`
   migrates v1 once, but later schema changes still need an explicit migration.

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
