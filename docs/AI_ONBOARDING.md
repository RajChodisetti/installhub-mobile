# InstallHub Mobile: AI Onboarding and Architecture

## 1. Purpose and current maturity

InstallHub Mobile is an iOS-first field workflow for installers who document a customer's
electrical site and commission Wattwatcher metering hardware. It mirrors an InstallHub web
workflow, but this repository is a self-contained Expo app.

The implemented journey is:

```text
InstallHub API login
  -> installation dashboard
  -> installation
     ├─ edit details / Draft <-> Completed
     ├─ zones
     │  ├─ zone photos
     │  ├─ electrical boards
     │  │  └─ A3RM/A6M meters and commissioning channels
     │  └─ site assets (HVAC, lighting, solar, EV, etc.)
     └─ views/reports
        ├─ six new field-form families with draft/completed/amendment lifecycle
        ├─ form-specific A4 PDFs with embedded evidence photos
        │  └─ local quality retries -> durable API job fallback
        ├─ merged installation pack (summary + completed form PDFs)
        ├─ Data View and TBC resolver
        ├─ metering table
        ├─ client report placeholder
        └─ photo-selection placeholder
```

The app is production-connected for authentication, opt-in Cloud Backup, explicit cloud-copy
imports, user administration, installation access assignment, and server PDF jobs while remaining
local-first for field work. Local records live in AsyncStorage; secure tokens live in SecureStore.
Installation trees and evidence are backed up only after the user enables backup on that
installation. Zone-summary sending and client-report UI remain placeholders.

## 2. Repository tree

```text
installhub-mobile/
├── AGENTS.md                  # canonical rules for AI coding agents
├── CLAUDE.md                  # Claude compatibility; imports AGENTS.md
├── README.md                  # short human quick start
├── App.tsx                    # provider composition and status bar
├── index.ts                   # Expo root registration
├── app.json                   # Expo identity, native permissions, plugins
├── eas.json                   # EAS preview/simulator/production profiles
├── babel.config.js            # Expo Babel preset
├── tsconfig.json              # strict TS, Expo base config, JSON imports
├── package.json               # scripts and direct dependencies
├── package-lock.json          # authoritative dependency lock
├── assets/                    # app, splash, favicon, Android adaptive icons
├── docs/
│   └── AI_ONBOARDING.md       # this detailed project map
└── src/
    ├── components/
    │   ├── BarcodeScanField.tsx # camera barcode/QR scanner + manual fallback
    │   ├── ui/index.tsx         # theme-aware generic primitives
    │   ├── domain/index.tsx     # installation/zone/board/asset cards
    │   └── forms/index.tsx      # domain forms and Wattwatcher workflow
    ├── context/
    │   └── AppProviders.tsx     # auth and theme contexts + persistence
    ├── data/
    │   ├── seed.ts              # in-memory store, persistence, subscriptions
    │   └── fixtures/
    │       ├── user.json
    │       ├── installations.json
    │       ├── zones.json
    │       ├── electricalAssets.json
    │       └── siteAssets.json
    ├── hooks/index.ts            # reactive aggregate read hooks
    ├── forms/catalog.ts          # six form definitions, conditions and validation
    ├── navigation/
    │   ├── types.ts              # typed route parameter lists
    │   └── RootNavigator.tsx     # auth gate, tabs, stack registration
    ├── repositories/index.ts     # repository contracts + local implementations
    ├── screens/                  # workflows plus users, access, diagnostics and storage UI
    ├── services/                 # media, local/API reports, sync, thumbnails and diagnostics
    ├── theme/index.ts            # light/dark tokens, spacing, radii, typography
    ├── types/index.ts            # complete domain model and value lists
    └── utils/index.ts            # IDs, dates, search
```

There are no checked-in native Xcode/Gradle projects. Expo generates `ios/` and `android/`, and
both are gitignored.

## 3. Runtime architecture

### App startup

```text
index.ts
  -> registerRootComponent(App)
     -> SafeAreaProvider
        -> AppProviders
           ├─ initStore()
           ├─ restore installhub.theme and resolve system appearance
           └─ restore ih_cloud_jwt / ih_cloud_refresh
              -> AppShell
                 ├─ StatusBar follows theme
                 └─ RootNavigator
                    ├─ Login when signed out
                    └─ MainTabs + feature stack when signed in
```

`AppProviders` owns:

- `AuthContext`: current user, boot/loading state, API login/session restore, and logout.
- `ThemeContext`: light/dark/system preference, resolved colors, toggle/setters, and persistence.

Do not access these contexts outside their provider. Use `useAuth()` and `useTheme()`, which fail
fast when misused.

### Read and write flow

```text
Read:
screen -> useInstallations/useInstallation/useZoneWorkspace
       -> repository list/get methods
       -> initStore/getStore

Write:
screen/form -> repository create/update/remove
            -> updateStore(mutator)
            -> persistStore -> AsyncStorage
                            -> notify subscribers
                            -> hooks refresh
```

Most mutations call repositories directly from screens. Hooks are currently read-oriented and
aggregate related entities with `Promise.all`. This is intentional for the small local store, but
an API implementation may need a query/cache layer.

### Storage details

AsyncStorage keys:

| Key | Owner | Value |
| --- | --- | --- |
| `installhub.mobile.store.v2` | `data/seed.ts` | entire serialized `AppDataStore`, including forms |
| `installhub.theme` | `AppProviders.tsx` | `light`, `dark`, or `system` |
| `installhub.active-report-jobs.v1` | `reportJobs.ts` | active form/installation API PDF job IDs |
| `ih_cloud_jwt` | Expo SecureStore | short-lived InstallHub access token |
| `ih_cloud_refresh` | Expo SecureStore | rotating refresh token |
| `ih_cloud_user` | Expo SecureStore | cached offline session identity |
| `ih_last_synced_at` | Expo SecureStore | last successful backup timestamp |

The store initializes once per process. It loads v2, migrates a saved v1 document when needed, or
deep-clones fixtures and persists them. `cloudSync` in the same document stores installation
watermarks, the durable upload queue, and the durable imported-thumbnail queue. A reset replaces it
with fresh fixture clones. Business records are not encrypted at rest. Existing records normalize
to `cloud_backup_enabled=false`, so no installation is uploaded without explicit consent.

The fixtures currently seed one demo user, three installations, four zones, four electrical
boards, and four site assets.

### Cloud backup architecture

```text
local repository write
  -> AsyncStorage store notification
  -> SyncStatusProvider debounce / foreground / 15-minute trigger
  -> syncService
     1. build complete installation tree
     2. push metadata with local paths removed
     3. checksum + deduplicate + session upload + confirm every evidence file
     4. push metadata again with confirmed remote URLs
     5. advance the installation watermark
```

`listInstallationsNeedingBackup()` excludes installations whose per-record opt-in is disabled.
Turning backup off stops future pushes but does not silently delete an existing server backup.

Cloud import is intentionally separate from continuous sync:

```text
Browse Cloud Backups
  -> list creator/assigned-inspector/admin-visible trees
  -> fetch the selected complete tree
  -> remap installation, zone, board, meter, asset, form, and attachment IDs
  -> persist the source installation/form server IDs
  -> name the local copy "<source> cp1", then cp2, cp3, ...
  -> preserve original remote evidence URLs
  -> durably cache authenticated 400 px previews
  -> expose the copy on Home after required previews are ready
```

Imported copies default to local-only. If one is later opted into backup, the API reconciles
`photo_copy_references` so it retains immutable originals without duplicating photo bytes. Preview
files live in the Expo cache; missing, evicted, or interrupted jobs return to the queue on foreground.
An imported form or installation pack can use persisted source IDs only while the complete cpN
tree has an explicit import-provenance watermark matching its import-time timestamp anchor, every
imported form retains a unique source ID, and there is no force-dirty or local-sync watermark.
The import also stores a stable hash of the exact source tree; the app re-pulls and compares that
hash immediately before reusing source IDs. Older copies without both markers are treated as
locally divergent. Any changed remote source, missing provenance, local edit, addition, amendment,
deletion, or prior local backup conservatively requires opt-in backup of the cpN copy under its own
ID. Server report jobs are keyed by target plus a tree revision so an interrupted source job cannot
be resumed after local data changes.

The API prefix is `/v1/installhub`. Protected routes require a valid token and the
`installhub` app claim. Installation-scoped reads/writes additionally require an
inspector-or-higher role and creator, assigned-inspector, or elevated access to
the parent installation; user administration requires admin.
Backend storage is separated into `ih_users`, `ih_installations`, `ih_zones`,
`ih_electrical_assets`, `ih_site_assets`, and `ih_form_submissions`. Meter arrays, form answers,
and form attachments intentionally remain JSON because they are embedded/versioned mobile values.
Photo bytes use the shared `photo_registry`, but every row is isolated by `app=installhub`.

Additional InstallHub API capabilities (some are current UI flows and others
are administrative/storage inspection contracts) are:

```text
/v1/installhub/users/*                         admin user management / password change
/v1/installhub/installations/:id/access        assigned-inspector access
/v1/installhub/installations/:id/files         stored originals and generated reports
/v1/installhub/installations/:id/versions/*    immutable sync snapshots
/v1/installhub/installations/:id/.../pdf/jobs  form and installation-pack jobs
/v1/export/jobs/*                              durable status and authenticated download
```

### Administration, diagnostics, and storage

The current user can change their password from Settings. Administrators also see User
Management, Diagnostics, fixture reset, and installation access assignment:

- User Management lists InstallHub-scoped accounts and can create users, edit name/email/role,
  deactivate/reactivate accounts, and reset another user's password. The API prevents
  self-demotion/self-deactivation and removal of the last active admin.
- Access assignment gives one active user access to a backed-up installation. The creator and
  admins retain access; clearing the assignment removes only the additional user's access.
- Cloud Files & History lists the installation's confirmed originals and completed report PDFs,
  supports authenticated download/share, and exposes immutable complete-sync snapshots for
  inspection. It applies the same creator/assignee/elevated access rules as cloud import.
- The remote browser exposes permanent Cloud Backup deletion only to the installation creator or
  an administrator, behind an explicit destructive confirmation. Assigned-only inspectors can
  import and inspect but cannot delete another creator's backup.
- Diagnostics checks API health, runs/retries Cloud Backup, and counts local entities, upload
  queue states, preview queue states, and tracked storage.
- Settings and Diagnostics can clear generated-report cache or imported 400 px preview cache.
  They never delete original form evidence, form records, or remote originals. Clearing previews
  resets their durable queue items to pending so they can be downloaded again.

## 4. Domain model and relationships

```text
AppDataStore
├── user: User
├── installations: Installation[]
│   └── status: Draft | Completed
├── formSubmissions: FormSubmission[]
│   ├── six current types plus two readable legacy installation types
│   ├── optional zone/board/meter/site-asset links
│   ├── answer map + semantic evidence attachments
│   ├── import_source_server_id? for an imported cloud form
│   └── Draft -> immutable Completed -> optional amendment
├── zones: Zone[]
│   └── audit_id -> Installation.id
├── electricalAssets: ElectricalAsset[]
│   ├── audit_id -> Installation.id
│   ├── zone_id -> Zone.id
│   ├── electrical_parent_id? -> ElectricalAsset.id
│   └── meters: Meter[]
│       ├── identity/classification/coverage
│       ├── ww_prestart
│       ├── ww_switchboard
│       ├── ww_channels[3 for A3RM, 6 for A6M]
│       ├── ww_verification
│       ├── ww_commissioning
│       └── ww_photos
└── siteAssets: SiteAsset[]
    ├── audit_id -> Installation.id
    ├── zone_id -> Zone.id
    ├── electrical_board_id? -> ElectricalAsset.id
    ├── meter_switchboard_id? -> ElectricalAsset.id
    └── meter_channels?
```

Important terminology:

- A code name of `audit_id` is the installation foreign key.
- An electrical asset is a board such as MSB, MSSB, DB, HVAC-DB, LX-DB, PV-DB, or MCC.
- A site asset is a load/equipment item such as HVAC, lighting, solar/PV, EV charger, or hot water.
- TBC flags explicitly track unresolved board relationships; they are not generic validation
  errors.
- Wattwatcher meters are embedded in boards. They do not have a repository of their own.
- An imported installation also stores `import_source_server_id`, the import timestamp/hash
  provenance anchors, `copy_index`, and thumbnail readiness. These are identity/provenance fields,
  not editable customer data.

Delete behavior is implemented manually:

- Installation deletion removes child forms, zones, electrical assets, and site assets, then the
  repository cleanup path removes the deleted forms' owned media directories and generated form
  reports. It deliberately does not delete an existing Cloud Backup.
- Zone deletion removes electrical assets, site assets, and forms linked through the zone, a child
  board, an embedded meter, or a child site asset.
- Board and site-asset deletion removes directly linked forms. Board deletion also clears surviving
  parent-board and site-asset references, marks them TBC, and clears meter-channel links that no
  longer have a board.
- Every cascade prunes removed entities from upload/thumbnail queues and updates imported-thumbnail
  counts. Form evidence cleanup removes only the deleted form's owned directory; it preserves a
  directory while any surviving amendment still references a file inside it.

## 5. Navigation and screen responsibility

The root stack is auth-gated. Signed-in users see `MainTabs`, which contains Home/Dashboard and
Settings. Feature screens sit above the tabs in the root native stack.

| Route | Params | Responsibility |
| --- | --- | --- |
| `Login` | none | InstallHub API credentials, session restore and auth state |
| `MainTabs` | none | Dashboard/Settings bottom tabs |
| `InstallationForm` | optional `installationId` | Create or edit an installation |
| `InstallationDetail` | `installationId` | Site summary, status, zones, report entry points |
| `ZoneWorkspace` | `zoneId`, `installationId` | Zone edit/photos, boards, site assets, summary stub |
| `BoardDetail` | `boardId`, `installationId`, `zoneId` | Board edit/delete and meter list |
| `SiteAssetDetail` | `assetId`, `installationId`, `zoneId` | Site asset edit/delete |
| `MeterForm` | `boardId`, optional `meterId`, optional `deviceType` | A3RM/A6M commissioning |
| `DataView` | `installationId` | Counts, meter registry, heuristic TBC resolution |
| `MeteringTable` | `installationId` | Combined board-meter/site-asset metering rows |
| `InstallationReport` | `installationId` | Summary and PDF export/share |
| `ClientReport` | `installationId` | Placeholder client-facing summary |
| `PhotoPreview` | `installationId` | Local photo inventory and non-persisted inclusion toggles |
| `FormsList` | `installationId` | List drafts/completed forms, export or amend |
| `FormTypePicker` | installation plus optional entity links | Central/contextual six-form catalog |
| `FormEditor` | `formId` | Autosave, validation, location, evidence, completion and PDF |
| `RemoteInstallations` | none | Browse accessible Cloud Backups and import a fresh-ID `cpN` copy |
| `UserManagement` | none | Admin-only InstallHub account list |
| `UserEditor` | optional `userId` | Admin create/update/deactivate/reactivate/password reset |
| `ChangePassword` | none | Current user's password change |
| `InstallationAccess` | `installationId` | Admin assign/clear one active user's backup access |
| `CloudStorage` | installation ID/name | Browse authenticated originals/reports and inspect immutable versions |
| `Diagnostics` | none | Admin API health, sync, entity, queue and storage diagnostics |

When adding a route, update both the route type and navigator registration. Use
`NativeStackScreenProps`/typed navigation rather than untyped route objects. `SettingsScreen`
still includes an `any` escape hatch; treat that as existing debt, not a preferred pattern.

## 6. Components and styling

Component layers:

```text
components/ui
  Button, TextField, TextArea, Card, Badge, EmptyState, LoadingState,
  SectionHeader, SearchBar, ListRow, PhotoThumbnailGrid

components/domain
  InstallationCard, ZoneCard, ElectricalAssetCard, SiteAssetCard, StatusChip

components/forms
  InstallationForm, ElectricalAssetForm, SiteAssetForm, WattwatcherForm, FormModal

components/BarcodeScanField
  text input + Expo Camera modal + supported barcode formats
```

The theme defines semantic light/dark colors plus `spacing`, `radii`, and `typography`. Consume
colors through `useTheme()` so dark mode keeps working. Prefer shared primitives over recreating
controls in screens.

The Wattwatcher and field-form workflows have product-specific behavior worth
preserving:

- A3RM creates three channels and uses Rogowski coil-size choices.
- A6M creates six channels and uses CT-rating choices.
- Legacy saved choices remain selectable through `withLegacyOption`.
- Device number, device ID/serial, and optional auditor serial can be barcode/QR scanned.
- Manual entry always remains available when camera access is denied.
- The new-form picker contains Installation (WW), Comms Fault, ACE
  Switchboard, Honeywell Q400, Captis Logger, and SUMS Logger. The old
  `a3rm-installation` and `a6m-installation` types remain in the catalog only so
  stored submissions and PDFs remain readable.
- Installation uses one `device.type` controller. A3RM exposes three channels
  with exactly `3000A - 9cm`, `3000A - 20cm`, or `3000A - 29cm`; A6M exposes six
  channels with exactly `60A`, `120A`, `200A`, `400A`, or `600A`.
- Every visible Installation channel requires a Load. Choosing `Not Used` is a
  channel state, not a sensor size: rating, description, nameplate evidence,
  polarity and current are hidden and cleared. The API rejects a stored rating
  on a `Not Used` channel. Choosing a real load requires the exact
  type-compatible rating.
- Comms Fault applies the same dependent choice rule to both the
  existing and replacement device; replacement identity, sensor and
  recommissioning fields are shown only when replacement is selected.
- ACE job/CT identifiers, Honeywell serial, and Captis meter/logger serials use
  barcode scanning. SUMS has the same stored fields as Captis and accepts both
  barcode and QR input for its serial fields.
- Changing a controlling device type clears incompatible selections and values
  (including A6M-only channels 4-6) from newly hidden sections before autosave.

## 7. Direct dependencies

Versions below are the declared versions in `package.json`; `package-lock.json` resolves the exact
tree.

| Dependency | Role in this app |
| --- | --- |
| `expo ~57.0.8` | Expo runtime, dev server, and native build foundation |
| `react 19.2.3` | Component runtime |
| `react-native 0.86.0` | Native UI/runtime |
| `@react-navigation/native ^7.3.12` | Navigation container and themes |
| `@react-navigation/native-stack ^7.18.4` | Root native stack |
| `@react-navigation/bottom-tabs ^7.18.12` | Dashboard/Settings tabs |
| `react-native-safe-area-context ~5.7.0` | Root safe-area provider |
| `react-native-screens ~4.26.0` | Native navigation screen integration |
| `@react-native-async-storage/async-storage 2.2.0` | Domain store, theme and active report-job persistence |
| `expo-camera ~57.0.3` | Barcode/QR scanning |
| `expo-image-picker ~57.0.6` | Camera capture and photo-library selection |
| `expo-print ~57.0.1` | Render report HTML to a PDF file |
| `expo-sharing ~57.0.7` | Open the native PDF share sheet |
| `expo-status-bar ~57.0.1` | Theme-aware status bar |
| `expo-file-system ~57.0.1` | Durable form-media storage and PDF image embedding |
| `expo-image-manipulator ~57.0.6` | Resize/compress evidence before durable storage |
| `expo-location ~57.0.6` | Capture installation coordinates with manual fallback |
| `expo-secure-store ~57.0.1` | Store JWT, refresh token, and cached cloud identity |
| `expo-background-task ~57.0.6` | Opportunistic OS-scheduled Cloud Backup |
| `expo-task-manager ~57.0.6` | Define the background task at module scope |
| `js-sha256 ^0.12.0` | Evidence checksum calculation and deduplication |
| `pdf-lib ^1.17.1` | Merge the local installation summary and form PDFs into one pack |
| `typescript ~6.0.3` | Strict static checking |
| `@types/react ~19.2.2` | React types |
| `babel-preset-expo ~57.0.3` | Expo Babel transforms |

No state-management, server-state, HTTP-client, lint, formatting, analytics, crash-reporting, or
backend SDK dependency is currently configured. Pure form, report, copy-naming and storage
diagnostics tests use Node's test runner via `tsx`.

## 8. Native and build configuration

`app.json` defines:

- App name `InstallHub`, slug `installhub-mobile`, version `1.0.0`.
- iOS bundle identifier and Android package: `com.tuvi.installhub`.
- Portrait orientation, automatic system appearance, tablet support on iOS.
- Camera and photo-library usage descriptions.
- Expo plugins for sharing, camera/barcode scanning, and image picker.
- App/splash/favicon/Android adaptive-icon assets.

`eas.json` defines:

- `preview`: internal physical-device distribution.
- `simulator`: iOS Simulator build.
- `production`: iOS App Store distribution.

Common commands:

```bash
npm ci                 # deterministic install from lockfile
npm start              # Expo dev server
npm run ios            # generate/run native iOS project
npm run android        # generate/run native Android project
npm run web            # Expo web server; web support is secondary
npm run typecheck      # strict TypeScript validation
npm test               # form definitions, validation, conditions and report HTML
```

React Native 0.86 and its Metro toolchain declare Node `^20.19.4`, `^22.13.0`, `^24.3.0`, or
`>=25.0.0`. Prefer the current Node 20 or 22 LTS line that satisfies that range; Node 23 is outside
the supported engine range.

EAS CLI commands are not wrapped as package scripts. Signing credentials and local environment
files must never be committed.

## 9. Device capabilities and side effects

### Photos

`pickLocalPhoto()` and `takeLocalPhoto()` request permission at the point of use and return a local
URI. The app stores that URI directly in the domain record. Cloud Backup keeps the local working
URI and records the confirmed remote URL in its durable upload queue; API payloads never contain
`file://` paths.

### Barcode scanning

`BarcodeScanField` uses a full-screen `CameraView`, supports common QR/1D formats, and closes after
the first scan. Permission denial falls back to manual typing.

### PDF

Form reports use the Sustainability Wise logo, navy/blue palette, A4 page frame, repeated
header/footer and the same conditional field rules as the form catalog. Dynamic text is escaped
before it enters report HTML. Local generation uses Expo Print and tries three evidence strategies:

| Tier | Evidence handling |
| --- | --- |
| Standard quality | Embed the original local evidence files |
| Reduced quality | Resize to 1200 px wide and encode JPEG at 0.68 |
| Compact quality | Resize to 800 px wide and encode JPEG at 0.52 |

The local renderer stops before an unsafe HTML/base64 payload (120 MiB) and rejects a missing,
empty or undersized PDF. A retryable render failure offers the next lower tier and an API-server
option. A cloud URL in an imported form is intentionally not fetched into local report HTML; that
case goes directly to server generation so the confirmed original is used.

`createInstallationPackPdf()` renders one branded installation summary, renders every completed
form through the same form renderer/tier, and merges the pages with `pdf-lib`. The installation
pack exposes the same reduced-quality and API fallback choices as an individual form.

Server generation is a durable workflow:

```text
ensure current backed-up source
  -> POST form or installation-pack job
  -> remember job ID in AsyncStorage
  -> poll /v1/export/jobs/:jobId every 3 seconds
  -> authenticated download (refresh JWT once if needed)
  -> native share sheet
```

For a normal local record, choosing the API path prompts for per-installation Cloud Backup opt-in
and requires a complete sync before queuing, so stale answers or evidence are not rendered. An
unchanged imported local-only copy can instead use its installation/form source server IDs only
after its current remote source hash is reverified. Form export from either the editor or the main
Field Forms list uses this same retry, provenance, sync-watermark, and durable-job flow.
Remembered jobs survive navigation/restarts and can be resumed. The API report uses its versioned
manifest, the same Sustainability Wise visual system, confirmed originals, and semantic
section-boundary chunking for reports above 120 photos or 120 MiB raw evidence (targeting about 50
photos per rendered part before merging).

Generated local PDFs live in the cache and are reproducible. Settings can clear only that cache.

### Zone summary

`sendZoneSummaryStub()` only prepends a line to an in-process array. It does not survive an app
restart or contact a server.

## 10. Known gaps and sharp edges

An agent should distinguish deliberate demo behavior from accidental architecture:

- All business data is a single local JSON blob; v1-to-v2 is the only migration currently defined.
- Cloud browsing imports a fresh-ID copy; there is no in-place overwrite/restore operation.
- OS background scheduling is opportunistic and unavailable in Expo Go and iOS Simulator;
  foreground and explicit backup triggers remain authoritative for testing.
- Board and site-asset photos remain local working copies after backup; clearing the app sandbox
  still requires a future restore workflow to bring them back.
- Client report and photo inclusion are placeholders; toggles do not feed the exported PDF.
- The TBC resolver links to the first eligible board rather than asking the user to choose.
- Zone summary sending is an in-memory stub.
- Some async screen operations have minimal error handling.
- Pure form/report/storage tests exist; integration, E2E, lint and formatter commands do not.
- The app is called iOS-first, but Android and web scripts/configuration are present and less
  exercised.

Do not silently “fix” a product placeholder as part of an unrelated task. When implementing one,
define the intended backend or UX contract and update this document.

## 11. Implementation playbooks

### New persistent entity field

```text
types
  -> fixtures
  -> repository create/update defaults
  -> form state/submit mapping
  -> screens/cards/reports
  -> storage migration/version decision
  -> typecheck + reset-data and old-data testing
```

Adding a field only to fixture JSON is insufficient because existing installs load the saved v1
blob. Either normalize old records on read, add a migration, or deliberately increment the storage
key (which resets local data).

### Cloud Backup contract changes

Preserve the local repository interfaces. Update `backupMedia.ts`, `syncService.ts`,
`cloudSyncRepository.ts`, and `apiClient.ts` together with the API route and `ih_*` schema.
Never send a `file://` path over the wire. New media fields need discovery, stable field identity,
remote-URL substitution, API entity validation, and regression coverage. Each backup reconciles
the durable upload queue to the installation's current exact media identities before enqueueing;
removed/replaced rows must not survive to block a retry. The pre-upload tree is sent with
`syncStage: "metadata"` and the confirmed final tree with `syncStage: "complete"`, so only the
final tree becomes a server record version.

### New dependency

Before adding one, confirm Expo SDK compatibility and whether an Expo config plugin/native rebuild
is required. Add it with npm so both manifest and lockfile change. Document its purpose here when
it affects architecture or native capabilities.

## 12. Verification checklist

For every meaningful change:

```text
[ ] npm run typecheck
[ ] affected happy path exercised
[ ] loading, empty, error, and permission-denied states considered
[ ] light and dark themes checked for UI work
[ ] iOS checked; real device used for camera/photo/share when relevant
[ ] seed reset and previously persisted store considered
[ ] route params remain typed
[ ] docs updated if architecture/dependencies/workflows changed
```

When no automated test covers a flow, report the manual path used. Do not claim camera, share-sheet,
or signing behavior was verified from TypeScript alone.
