# Field App Complete: AI Onboarding and Architecture

## 1. Purpose and current maturity

Field App Complete is an iOS-first field workflow for installers who document a customer's
electrical site and commission Wattwatcher metering hardware. It mirrors a Field App Complete web
workflow, but this repository is a self-contained Expo app.

The implemented journey is:

```text
Field App Complete API login
  -> installation dashboard
  -> installation
     ├─ edit details / Draft <-> Completed
     ├─ zones
     │  ├─ zone photos
     │  ├─ electrical boards
     │  │  └─ A3RM/A6M meters and commissioning channels
     │  └─ site assets (HVAC, lighting, solar, EV, etc.)
     └─ views/reports
        ├─ installation-scoped device search across all zones, with Open and Replace actions
        ├─ six new field-form families with draft/completed/amendment lifecycle
        ├─ form-specific A4 PDFs with embedded evidence photos
        │  └─ local quality retries -> durable API job fallback
        ├─ merged installation pack (summary + completed form PDFs)
        ├─ Data View with explicit TBC reconciliation and separate completion checks
        ├─ metering table
        └─ compact tools/reports drawer
```

The app is production-connected for authentication, opt-in Cloud Backup, explicit cloud-copy
imports, user administration, installation access assignment, and server PDF jobs while remaining
local-first for field work. Local records live in AsyncStorage; secure tokens live in SecureStore.
Installation trees and evidence are backed up only after the user enables backup on that
installation. Zone-summary sending is intentionally unavailable until an
authenticated API destination is defined; client-report UI remains a placeholder.

The Inventory tab is cloud-authoritative and shows the authenticated user's
current meter list and total. Add meter offers barcode scan and manual Device ID
entry. Both paths claim an existing company-stock meter in one API transaction;
they do not create unregistered stock. A confirmed barcode claim reopens the
scanner for batch intake. Scheduler company and per-user counts reflect the
same custody rows, and completed installation projection removes installed
meters from active stock without deleting movement history.

The authenticated technician can also request a transient daily route from the
Dashboard. The API orders the day's eligible Field App Scheduler stops from either a
one-time foreground location or an entered Australian starting address. Selecting a
suggestion reuses its known coordinates; otherwise the API geocodes the typed address
server-side.
The app displays stop order, distances, travel times, warnings and unroutable jobs;
it does not provide maps, navigation, background tracking or persisted route history.

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
                 └─ PushNotificationProvider
                    └─ AuditWorkTrackingProvider
                       └─ RootNavigator
                          ├─ Login when signed out
                          └─ MainTabs + feature stack when signed in
```

`AppProviders` owns:

- `AuthContext`: current user, boot/loading state, API login/session restore, and logout.
- `ThemeContext`: light/dark/system preference, resolved colors, toggle/setters, and persistence.

Login is API-authoritative. The app sends the identifier and unchanged password
to `POST /v1/auth/login` with `app=installhub`; it writes the returned user
profile into the local store only after the API issues a valid Field App
Complete session. The API user ID replaces the fixture/profile ID. Passwords
and password hashes are never stored locally. Tokens and the cached server
identity remain in SecureStore. The optional account-source selector converts a
plain username to the explicit Eco Audit or Solar Sense local identity when the
same username exists in both source applications.

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
| `installhub.mobile.store.v3.manifest` | `data/storePersistence.ts` | atomic pointer to one verified immutable store generation |
| `installhub.mobile.store.v3.generation.*` | `data/storePersistence.ts` | bounded chunks of the generation document |
| `installhub.mobile.store.v3.recovery` | `data/seed.ts` | metadata for a temporary encrypted pre-migration recovery copy; never its key |
| `installhub.mobile.operational-diagnostics.v1` | `operationalDiagnostics.ts` | bounded local-only, privacy-projected reliability events |
| `installhub.mobile.active-time.v1` | `activeTimeOutbox.ts` | versioned, actor-partitioned active installation session checkpoints and acknowledgements |
| `installhub.theme` | `AppProviders.tsx` | `light`, `dark`, or `system` |
| `installhub.active-report-jobs.v1` | `reportJobs.ts` | active form/installation API PDF job IDs |
| `ih_cloud_jwt` | Expo SecureStore | short-lived Field App Complete access token |
| `ih_cloud_refresh` | Expo SecureStore | rotating refresh token |
| `ih_cloud_user` | Expo SecureStore | cached offline session identity |
| `ih_last_synced_at` | Expo SecureStore | last successful backup timestamp |
| `installhub.notifications.device-id.v1` | Expo SecureStore | stable random device identity used to upsert/delete this installation's push token |
| `installhub.notifications.registration-generation.v1` | Expo SecureStore | monotonic lifecycle fence shared by notification registration and logout |

The store initializes once per process. A v3 write stages and verifies every chunk before one
manifest-pointer flip, then verifies the active document before retiring the prior generation.
Migration first seals the prior bytes with AES-256-GCM; the key is stored with the
`installhub.local-recovery.v1` keychain service using this-device-only/when-unlocked access. The
recovery metadata and its exact-key cleanup journal survive crashes. They are retired early only
when the exact migration generation survives the next verified startup reload or when recovery is
exercised. If an ordinary save advances the manifest first, cleanup fails safe by retaining the
copy until the seven-day expiry gate. Startup never replaces an unreadable store with fixtures; it
exposes retry/recovery UI instead. Legacy v1/v2 keys are accepted only as migration sources.

`cloudSync` in the same document stores installation
watermarks, the durable upload queue, and the durable imported-thumbnail queue. A reset replaces it
with fresh fixture clones. Business records are not encrypted at rest. Existing records normalize
to `cloud_backup_enabled=false`, so no installation is uploaded without explicit consent.

The fixtures currently seed one demo user, three installations, four zones, four electrical
boards, and four site assets.

### Active installation time

Active installation time is collected without user-facing logs. `RootNavigator` reports only the
currently focused leaf route from `NavigationContainer.onReady`/`onStateChange`; it never infers an
installation from a covered route lower in the native stack. Every installation-scoped child route,
including `MeterForm` and `FormEditor`, therefore carries and validates `installationId` directly.

`AuditWorkTrackingProvider` counts only an authenticated user's local `Draft` installation while
React Native `AppState` is exactly `active`. Android `blur` also pauses the clock while the
notification drawer or another non-interactive surface has focus. Navigation to another
installation, a non-installation route, completion, deletion, logout, inactive/background, or
Android blur closes the current session at that event's captured monotonic cutoff. Moving between
screens for the same installation keeps one session. Reopening a completed installation as Draft
starts a fresh session.

An externally assigned Draft is additionally gated by a local pre-start review of the currently
available client/customer, site and structured Australian address, scheduled date, technician,
service/scope, site contact, job references, and access instructions. The acknowledgement is not a
JSA and does not replace site safety controls. The latest assigned pull stores those displayed values in a
local-only scheduler-summary snapshot, separate from editable installation fields and the canonical
tree/CAS revision. Sensitive access information remains installation-scoped and must not be copied
into broad job-option labels, invoices, or notifications. The acknowledgement binds to the
authenticated actor, remote assignee, and hash
of that snapshot; routine work backup therefore does not invalidate it, while another login, a
changed pulled summary, reopening, or an inactive/reassigned checkout cannot inherit it. Until it
is acknowledged, both active-time tracking and all Installation Detail work controls/navigation are
locked and any attempted work action opens the review. Locally created and non-assigned Drafts keep
the existing behavior. A root store observer also returns an already-open child route to
Installation Detail if a later pull invalidates its acknowledgement. Local repository writes capture
a process-local authenticated-actor session fence before asynchronous work and validate that fence
plus the latest persisted acknowledgement inside the serialized store mutation; queued autosaves,
form completion, and other tree changes therefore cannot commit after invalidation or logout/login.
The acknowledgement write additionally compares the current summary with the exact summary hash
displayed when the user tapped acknowledge. Server pull/reconciliation writes deliberately bypass
this local work guard so they can invalidate access without overwriting offline tree edits.

The tracker checkpoints about every 15 seconds into the separate
`installhub.mobile.active-time.v1` outbox. It never changes `Installation.updated_at`,
`tree_revision`, the canonical backup payload, or immutable record versions. A restart closes any
interrupted session at its last durable checkpoint and never infers the background/restart gap.
Rows are partitioned by API actor and use increasing client revisions; an acknowledgement retires
only the exact revision sent, so a heartbeat written while a request is in flight stays pending.

Delivery uses
`PUT /v1/installhub/installations/:installationId/active-time/sessions/:sessionId` with cumulative
active milliseconds and stable start/end boundaries. Sessions remain local until Cloud Backup is
enabled and a server installation revision confirms the parent exists. Network, authorization,
missing-parent, and lifecycle failures remain pending. Delivery retries after checkpoints,
foregrounding, and Cloud Backup; the API update does not mutate the installation tree revision.

### Canonical installation v2

Installation metadata carries nullable customer/MaaS/scope/metering-type fields, structured
Australian address parts, site contact and access details, a custom job number, job scope comments,
and job-level installation-outcome summaries. New authoring uses M1-M5 scope values and controlled
NEM/revenue/monitoring/water metering choices with free-text Other. Planned-meter, Fergus, and quote
values remain readable and syncable for older records but are not offered by current creation forms.
Missing values from older clients mean
“not supplied”; explicit `null` means “clear this value”. Boolean outcomes are tri-state so unknown
is never silently converted to No. `planned_meter_type` is scheduling intent only: actual NMI,
installed meter/device identity, and channel topology remain authoritative in `gridSupplies`,
`meterDevices`, and `measurementAssignments`. Status, scheduled assignment, and completion metadata
remain their existing lifecycle authorities rather than user-editable duplicates.

`gridSupplies`, `meterDevices`, and `measurementAssignments` are first-class arrays and are the
authoritative model. Nested legacy board meters and site-asset channel strings are compatibility
projections only. Every board and site asset has an explicit `GRID`, `BOARD`, or `TBC` electrical
source; absence never means Grid. Site-asset coverage is exactly `METERED`, `UNMETERED`, or `TBC`,
and only the atomic reconciliation action may change it.

New-installation entry collects identity, planning, contact, access, and job-reference data. The
job-level outcome summaries are intentionally shown only after an installation exists, so creation
does not ask installers to predict completed hardware or monitoring results. New field forms prefer
the end-customer name and fall back to the contracting client and then the site name.

A3RM/A6M devices have exact 3/6 positive channel ordinals. An Other meter instead requires its
manufacturer, model, at least one explicitly numbered channel, and non-empty capabilities for each
channel; it is never defaulted to three. Wattwatchers commissioning-form evidence is required only
for A3RM/A6M. Fixed A3RM/A6M channels use their model contract and do not require custom capability
objects. Each WW commissioning channel records explicit `MAIN_SUPPLY`, `SUB_CIRCUIT`, or `SPARE`
purpose; active channels require a load, and `Other` requires a separate custom load label.
Choosing `SPARE` clears incompatible load, custom label, sensor, description, and evidence details. Measurement assignments
retain explicit channel order, phase mode, direction, target, and stable identity.

The mobile commissioning workflow now enforces the canonical sequence: choose or create a physical
zone and switchboard, start the WW form against that exact board, complete the validated form, then
map active channels. Form completion and operational-meter materialization are one store
transaction: the immutable Completed form receives the same stable `board_id` and `meter_id` that
the canonical `meterDevices` row uses. Canonical switchboard name/type/zone/location/NMI are shown
once as concise read-only context in the form, while the same prefilled answers remain stored for
PDF/reporting and are normalized again at completion.

When a visible `prestart.safe_to_proceed` field is present, only the exact `yes` value counts toward
required progress or permits form completion. Missing, No, or N/A values remain a prominent red
STOP state, and the domain completion transaction rejects them before mutating the store so screen
or future repository callers cannot bypass the safety gate.

An assignment may target `BOARD`, `GRID_BOUNDARY`, `SITE_ASSET`, or explicit `TBC`. Main-supply
channels may identify their installed-on board, an upstream Grid boundary, or TBC; sub-circuit
channels may identify a downstream board, a site asset on the same source path, or TBC. One
assignment cannot mix purposes, phase counts are explicit, and one channel cannot be assigned
twice. New asset entry requires an explicit `METERED` or `UNMETERED` decision. A legacy asset
already stored as `TBC` remains readable but prompts the installer to correct it before saving.
The Metered branch
uses dependent source-path/device/channel/phase/direction choices and can detour to commissioning
without discarding the partially entered asset draft. Moving an existing Metered asset to
Unmetered/TBC previews the exact assignments and channels removed before the atomic save.

The asset source picker also has a quick switchboard detour. Its popup asks only
for switchboard name/type, inherits the asset's existing upstream or incoming-grid
relationship, creates and auto-selects the board, then restores the protected asset
draft. “Commission a new device” similarly returns to the draft and always opens
the detailed WW installation form for the selected source board.

Meter deletion is Draft-only for the active installation tree: the meter and its assignments are
retired and affected assets return to explicit `TBC`. Immutable Completed forms and their evidence
remain readable with the original meter ID. That historical exception is deliberately narrow—a
missing meter reference is valid only when the form status is exactly Completed and `completedAt`
is a valid ISO timestamp.

Offline generated-name allocations are provisional. A successful push alone cannot finalize them:
the app fetches and reconciles the exact canonical server tree. Once a code is server-confirmed it
is immutable across later site/type/rule changes; only the explicit custom-name action may alter it.
Rule-version metadata is preserved. Virtual/residual definitions and mapping exports are
server-owned; local residuals are advisory shared/unallocated previews with no per-asset quantity.

### Cloud backup architecture

```text
local repository write
  -> AsyncStorage store notification
  -> SyncStatusProvider debounce / foreground / 15-minute trigger
  -> syncService
     1. build complete installation tree
     2. push metadata with local paths removed
     3. checksum + deduplicate + session upload + confirm every evidence file
     4. push the complete tree with confirmed remote URLs
     5. fetch and merge that exact canonical revision
     6. advance the installation watermark only after the re-read matches
```

During the metadata stage, every locally Completed form is deliberately sent as Draft without
mutating local status—including zero-attachment forms and forms whose URLs were already remote.
Only the explicit complete stage may transmit Completed, after every attachment has a confirmed
remote URL. This avoids commissioning an immutable form from any metadata pass.

`tree_revision` is the offline mutation counter; it is never used as the server CAS base. A separate
persisted `server_tree_revision` starts absent for first offline capture, advances from the metadata
push, advances again after every successful upload confirmation, and supplies the exact base for the
complete push. Portal conflicts therefore report the last server base rather than a local edit count.

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

Scheduler/portal assignment uses a separate checkout path. On authenticated
mount, foreground, manual refresh, and the normal sync interval, the app pulls
the caller's accessible owned/assigned inventory. Draft installations that
are not already local are materialized with the exact server installation,
child, form, attachment, and tree-revision identities; they are not renamed or
converted into `cpN` copies. They are immediately cloud-enabled and their pull
watermark prevents an unchanged checkout from being pushed back. Offline edits
then follow the normal Cloud Backup path. If a later complete inventory no
longer contains an externally assigned Draft installation, a local-only
visibility tombstone removes it from the dashboard and stops timing/uploads
while retaining the entire tree and any unsent edits for recovery. Completed
work remains visible as history even if it drops out of the active assignment
inventory. A later reassignment to the same actor reactivates that checkout.

Authoritative installation completion accepts an optional `completionNotes` string. Mobile trims
blank input to `null`, enforces a 2,000-character limit, and persists the exact normalized value
(including explicit `null`) beside the completion idempotency key before sending. Every retry for
that pending attempt reuses the same value; older pending attempts without the field continue to
omit it for backward-compatible fingerprints. The accepted note is stored locally, displayed on
the Completed record, and included—HTML-escaped and only when nonblank—in the installation pack.
Successful reopen clears the live Draft note and never prefills the next sign-off; the prior
immutable server version retains its original note.

Before any ID remapping or local write, import validates the complete canonical-v2 graph: stable IDs
must be non-empty and unique, canonical arrays must be present, source/target/status/phase/direction
enums must be explicit, channel sets must be non-empty and duplicate-free, asset metering state must
exactly match assignment targets, every reference must resolve, and the returned installation ID must
exactly match the request. Canonical-v2 values are mapped without TBC/OTHER/CONSUMPTION fallbacks.
Attachment-copy IDs are deterministic SHA-256 identities, so retries are idempotent.

Imported copies default to local-only. If one is later opted into backup, the API reconciles
`photo_copy_references` so it retains immutable originals without duplicating photo bytes. Preview
files live in the Expo cache; missing, evicted, or interrupted jobs return to the queue on foreground.
Preview queue selection, download credentials, file commits, and status updates are partitioned by
the current actor's installation visibility (including active assignment state) and one exact
process/cloud session generation, so a later login or revoked checkout never joins or commits an
earlier thumbnail worker.
An imported form or installation pack can use persisted source IDs only while the complete cpN
tree has an explicit import-provenance watermark matching its import-time timestamp anchor, every
imported form retains a unique source ID, and there is no force-dirty or local-sync watermark.
The import also stores a stable hash of the exact source tree; the app re-pulls and compares that
hash immediately before reusing source IDs. Older copies without both markers are treated as
locally divergent. Any changed remote source, missing provenance, local edit, addition, amendment,
deletion, or prior local backup conservatively requires opt-in backup of the cpN copy under its own
ID. Server report jobs are keyed by target plus a tree revision so an interrupted source job cannot
be resumed after local data changes.

Authoritative form and installation-pack jobs always request an immutable `recordVersionNumber`;
unchanged imports retain and use the source installation's version. An unpinned diagnostic must opt
in explicitly with `liveMode=true`. Remembered-job keys include the record version and exact local
tree hash, and the app verifies the version plus server payload hash echoed by job creation/status
before it downloads a PDF. Later Draft edits never silently retarget an older authoritative report
to mutable live rows.

The API prefix is `/v1/installhub`. Protected routes require a valid token and the
`installhub` app claim. Installation-scoped reads/writes additionally require an
inspector-or-higher role and creator, assigned-inspector, or elevated access to
the parent installation; user administration requires admin.
Backend storage is separated into `ih_users`, `ih_installations`, `ih_zones`,
`ih_electrical_assets`, `ih_site_assets`, and `ih_form_submissions`. Meter arrays, form answers,
and form attachments intentionally remain JSON because they are embedded/versioned mobile values.
Photo bytes use the shared `photo_registry`, but every row is isolated by `app=installhub`.
Native Field App Complete accounts remain authoritative in `ih_users`; the additive
`unified_users` registry contains every Eco Audit, Solar Sense, and Field App Complete account so
source credentials can receive Field App Complete access without changing any installed app login
or user-management API contract.

Additional Field App Complete API capabilities (some are current UI flows and others
are administrative/storage inspection contracts) are:

```text
/v1/installhub/users/*                         admin user management / password change
/v1/installhub/installations/:id/access        assigned-inspector access
/v1/installhub/installations/:id/files         stored originals and generated reports
/v1/installhub/installations/:id/versions/*    immutable sync snapshots
/v1/installhub/installations/:id/.../pdf/jobs  form and installation-pack jobs
/v1/installhub/route-suggestions               signed-in technician's transient daily route
/v1/export/jobs/*                              durable status and authenticated download
```

### Administration, diagnostics, and storage

The current user can change their password from Settings. Administrators also see User
Management, Diagnostics, fixture reset, and installation access assignment:

- User Management lists Field App Complete-scoped accounts and can create users, edit
  name/email/role, deactivate/reactivate accounts, and reset another user's password. The API
  prevents self-demotion/self-deactivation and removal of the last active admin.
- Accounts granted shared Field App Complete access from Eco Audit or Solar Sense are identified by
  source metadata.
  They remain selectable for installation access, but their profile, role, status, and
  administrator password resets are read-only in Field App Complete and must be managed in the
  source app.
  A deleted source leaves a read-only registry tombstone for audit history and is labeled "Source
  unavailable". A linked source-managed user can
  still change their own shared credential after confirming the current password. The change
  clears that device's local session immediately and revokes source-app and Field App Complete
  refresh sessions; already-issued access tokens may remain valid for up to 15 minutes.
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
├── siteAssets: SiteAsset[]
    ├── audit_id -> Installation.id
    ├── zone_id -> Zone.id
    ├── electrical_board_id? -> ElectricalAsset.id
    ├── meter_switchboard_id? -> ElectricalAsset.id
│   └── meter_channels? (compatibility projection)
├── gridSupplies: GridSupply[]
├── meterDevices: MeterDevice[]
│   └── channels[] with stable ID, ordinal, purpose and capabilities
└── measurementAssignments: MeasurementAssignment[]
    └── meter/channel group -> BOARD | GRID_BOUNDARY | SITE_ASSET | TBC
```

Important terminology:

- A code name of `audit_id` is the installation foreign key.
- An electrical asset is a board such as MSB, MSSB, DB, HVAC-DB, LX-DB, PV-DB, or MCC.
- A site asset is a load/equipment item such as HVAC, lighting, solar/PV, EV charger, hot water,
  refrigeration, or compressed air. `REFRIGERATION` and `COMPRESSED_AIR` are first-class
  `type_code` values for new records. Historical records whose legacy display type was
  Refrigeration or Compressed Air remain `OTHER` unless an explicit canonical code was stored.
- TBC flags explicitly track unresolved board relationships; they are not generic validation
  errors.
- `meterDevices` owns canonical meter identity and channels. Embedded board meters are a legacy UI
  compatibility projection updated only through repository/domain transactions.
- An imported installation also stores `import_source_server_id`, the import timestamp/hash
  provenance anchors, `copy_index`, and thumbnail readiness. These are identity/provenance fields,
  not editable customer data.

Delete behavior is implemented manually:

- Each editable installation card on the Dashboard exposes a local delete action. It confirms the
  exact cascade counts before deletion and states that an existing Cloud Backup is retained.
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
| `Login` | none | Field App Complete API credentials, session restore and auth state |
| `MainTabs` | none | Dashboard/Settings bottom tabs |
| `InstallationForm` | optional `installationId` | Create or edit an installation |
| `InstallationDetail` | `installationId` | Site summary, status, zones, report entry points |
| `DeviceSearch` | `installationId` | Search every device in one installation across all of its zones by ID/serial, optional site/asset tag, name, zone, board, or type; open or start a prefilled replacement form |
| `ZoneWorkspace` | `zoneId`, `installationId` | Zone edit/photos, boards/assets, coverage and unresolved summary |
| `BoardDetail` | `boardId`, `installationId`, `zoneId` | Board edit/delete and meter list; start WW commissioning or add an Other Meter |
| `SiteAssetDetail` | `assetId`, `installationId`, `zoneId` | Site asset edit/delete |
| `MeterForm` | `installationId`, `boardId`, optional `meterId`, optional `deviceType` | Device details plus full channel measurement assignments; Other Meter captures manufacturer, model, classification, coverage and explicit channel capabilities |
| `DataView` | `installationId`, optional `initialMode` | Explicit TBC reconciliation, separate non-TBC completion checks, coverage, FED_FROM tree, MEASURES overlay and physical inventory |
| `MeteringTable` | `installationId` | Combined board-meter/site-asset metering rows |
| `InstallationReport` | `installationId` | Summary and PDF export/share |
| `ClientReport` | `installationId` | Legacy placeholder route; not exposed from the installation workspace |
| `PhotoPreview` | `installationId` | Legacy placeholder route; not exposed from the installation workspace |
| `FormsList` | `installationId` | List drafts/completed forms, export or amend |
| `FormTypePicker` | installation plus optional entity links | Central/contextual six-form catalog |
| `FormEditor` | `installationId`, `formId` | Autosave, validation, location, evidence, completion and PDF |
| `RemoteInstallations` | none | Browse accessible Cloud Backups and import a fresh-ID `cpN` copy |
| `UserManagement` | none | Admin-only Field App Complete account list |
| `UserEditor` | optional `userId` | Admin create/update/deactivate/reactivate/password reset |
| `ChangePassword` | none | Current user's password change |
| `InstallationAccess` | `installationId` | Admin assign/clear one active user's backup access |
| `CloudStorage` | installation ID/name | Browse authenticated originals/reports and inspect immutable versions |
| `Diagnostics` | none | Admin API health, sync, entity, queue and storage diagnostics |
| `DailyRoute` | none | Map-free ordered stops and travel estimates for the signed-in technician |

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
  InstallationForm, ElectricalAssetForm, SiteAssetForm, WattwatcherForm, FormModal;
  board/site-asset editors include camera/library attachments, and boards include sub-circuit notes

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
- The WW form exposes a required Device ID/serial and an optional, barcode-scannable
  site/asset tag. A blank compatibility value is seeded from the serial, but an
  explicitly different site/asset tag is preserved through editing, backup, and
  reports. Replacement details in Comms Fault expose the same optional distinct tag.
- Manual entry always remains available when camera access is denied.
- The new-form picker contains Installation (WW), Comms Fault, ACE
  Switchboard, Honeywell Q400, Captis Logger, and SUMS Logger. The old
  `a3rm-installation` and `a6m-installation` types remain in the catalog only so
  stored submissions and PDFs remain readable.
- Comms Fault is replacement-only: it is not offered as an unlinked generic
  form. Device Search creates it directly with the stable device, board, zone,
  installation, and existing serial already linked.
- A WW form cannot be created or completed without a real board in the same installation. The
  installation-wide picker has searchable board choices plus an inline add-board detour.
- New-board entry derives meter presence from installed devices and offers a clear
  detailed WW commissioning action; it does not ask a separate meter-present yes/no.
  Parent-board search includes name/type/zone and excludes the edited board and every
  descendant, preventing cycles.
- Zones own an editable uppercase `zone_code` (maximum 16 characters). New boards,
  site assets, and meters share one per-zone naming-rule-v2 sequence and receive
  `<INSTALL>-<ZONE>-<NN>-<CUSTOMNAME>` codes. `NN` is at least two digits and the
  local high-water mark prevents reuse after an offline delete; the server resolves
  concurrent-device collisions. Rule-v1 and server-confirmed codes stay frozen.
- Installations own a required editable uppercase `site_code` (maximum 16 characters). It is
  derived from the site name while pristine and becomes the `<INSTALL>` prefix used by the naming
  rule above.
- New board/asset names default from their selected type but remain editable. WW
  `device.name` similarly defaults to `A3RM Meter` or `A6M Meter` and advances on a
  type change only while still pristine. Stable IDs, optional site/asset tags, and
  generated display codes remain separate searchable identities.
- Board-level `Add Other Meter` opens the canonical custom-meter editor with its
  type fixed to `Other`; switching into A3RM/A6M must use the full Installation
  form. It captures identity, manufacturer/model, classification/coverage, custom
  channels/capabilities, notes, canonical assignments, and durable local evidence,
  without Wattwatchers pre-start, duplicate switchboard, verification, or
  commissioning questions. Its optional site/asset tag is not copied from the
  serial, and persisted legacy values remain readable.
- Installation uses one `device.type` controller. A3RM exposes three channels with exactly
  `10cm-200A`, `10cm-333mV`, `20cm-3000A`, `30cm-3000A`, `45cm-3000A`, or `Not Used`;
  A6M exposes six channels with exactly `CT-60A`, `CT-120A`, `CT-250A`, `CT-400A`,
  `CT-600A`, or `Not Used`. A6M current observations also accept the explicit text value
  `Not Connected`; A3RM current observations remain numeric.
- Signal authoring uses `Low`, `Medium`, or `High`. Antenna authoring uses `Internal`,
  `External`, `CSM550 - External High Gain`, or `Other`. Known saved values from the previous
  mobile catalogs remain selectable for compatibility, but arbitrary new values are rejected.
- Every visible Installation channel first requires a purpose: Main board supply,
  Sub-circuit / asset, or Spare / unused. Active purposes require a Load; choosing
  `Other` also requires a separate custom load label. Spare channels hide and
  clear load, custom label, rating, description, nameplate evidence, polarity,
  and current. Historical drafts that used `Not Used` remain readable through
  the bounded legacy mapper, while current authoring uses the explicit purpose.
- Comms Fault applies the same dependent choice rule to both the
  existing and replacement device; replacement identity, sensor and
  recommissioning fields are shown only when replacement is selected.
- ACE job/CT identifiers, Honeywell serial, and Captis meter/logger serials use
  barcode scanning. SUMS has the same stored fields as Captis and accepts both
  barcode and QR input for its serial fields.
- Changing a controlling device type clears incompatible selections and values
  (including A6M-only channels 4-6) from newly hidden sections before autosave.
- Completing any non-WW field form returns to its parent page after the save succeeds. A completed
  WW installation form instead continues to the required channel-mapping step.

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
| `expo-location ~57.0.7` | One-time foreground capture for form coordinates and daily-route origins |
| `expo-constants ~57.0.11` | Read the configured EAS project ID used for Expo push-token exchange |
| `expo-device ~57.0.1` | Prevent remote push registration on simulators and emulators |
| `expo-notifications ~57.0.11` | Notification permission, Expo push tokens, Android channel, rotation listener and foreground presentation |
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

- App name `Field App Complete`, slug `field-app-complete`, version `1.0.0`;
  the notification-enabled native build is iOS build `3` / Android versionCode `2`.
- iOS bundle identifier and Android package: `com.tuvi.installhub`.
- Portrait orientation, automatic system appearance, tablet support on iOS.
- Camera and photo-library usage descriptions.
- Expo plugins for sharing, camera/barcode scanning, image picker, and notifications. Notifications
  reuse the existing monochrome Android asset and declare `scheduler` as the default channel.
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

### Push notifications

`PushNotificationProvider` is mounted for the app lifetime but performs remote registration only
for an authenticated user on a physical iOS or Android device while the app is active. Android
creates the high-importance `scheduler` channel before checking permission. The provider requests
notification permission, reads the existing EAS `projectId`, exchanges the native device token for
an Expo push token, and securely creates or reuses one random
`installhub.notifications.device-id.v1` value. Each authenticated provider lifecycle also
serially increments and securely persists
`installhub.notifications.registration-generation.v1` before registration. Retries and native
token rotations within that lifecycle reuse the same positive integer; a remount, later login, or
process restart increments it again. The app then calls
`PUT /v1/notifications/devices/:deviceId` with `expoPushToken`, `platform`, `projectId`, and
`registrationGeneration`.

Permission denial, simulators/emulators, missing project configuration, and registration/network
errors are silent, non-auth failures. An unsuccessful registration is eligible for another attempt
on a later foreground; a successful registration is not repeated on every foreground. Expo's
native push-token listener is treated only as a rotation signal: the supplied native token is
explicitly re-exchanged through `getExpoPushTokenAsync({ projectId, devicePushToken })` before the
new Expo token is PUT. It is never uploaded directly.

Foreground notifications show a banner/list entry and play sound; there is no notification log or
history UI and no deep-link behavior. Logout first captures that lifecycle's generation,
invalidates/aborts pending registration work, and makes a bounded best-effort
`DELETE /v1/notifications/devices/:deviceId?registrationGeneration=N` while credentials still
exist. This generation fence prevents a delayed logout from disabling a newer login's device
registration. A rejected same-generation retry does not mint another generation; only a new
provider lifecycle does. Registration queue or DELETE failures/timeouts never prevent credential
clearing or logout.

### Photos

`pickLocalPhoto()` and `takeLocalPhoto()` request permission at the point of use and return a local
URI. The app stores that URI directly in the domain record. Cloud Backup keeps the local working
URI and records the confirmed remote URL in its durable upload queue; API payloads never contain
`file://` paths.

Board and site-asset editors expose both camera and photo-library actions. Boards persist one
location photo, additional photos, and sub-circuit notes; site assets persist one location photo
and additional photos. Removing an attachment requires confirmation.

Every form photo slot accepts multiple attachments. After the first image, the
active editor keeps explicit “Take another photo” and “Choose another photo” actions,
with an optional caption and individual remove action for each image. Completed WW
installation evidence explicitly reminds the installer to include the antenna.

### Barcode scanning

`BarcodeScanField` uses a full-screen `CameraView`, supports common QR/1D formats, and closes after
the first scan. Permission denial falls back to manual typing.

### Daily route location

`DailyRouteScreen` requests one foreground position only when the technician taps Plan route. If
permission is denied, location is unavailable, or the device is outside Australia, the technician
can enter an Australian starting address instead. A selected suggestion sends its known coordinates;
free-form text is sent as `startingAddress` for server-side Australian geocoding. Those mutually
exclusive origin inputs are sent to `POST /v1/installhub/route-suggestions` for that calculation and
are not persisted by the app or API as attendance, location history or route history. Route responses
are also transient. The current backend response contains eligible Field App installation stops. The
transient wire types remain source-aware for forward compatibility, but only a visible local Field
App installation can be opened. Opening it still passes through the assigned-work pre-start and
access guards.

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

No user-facing send action is exposed. The reference app's external handoff has
no authenticated destination contract in this repository, so the mobile app
must not claim that a summary was sent or queued.

## 10. Known gaps and sharp edges

An agent should distinguish deliberate demo behavior from accidental architecture:

- Business data is one logical JSON document, durably stored as verified v3 generations and chunks.
- Cloud browsing imports a fresh-ID copy; there is no in-place overwrite/restore operation.
- OS background scheduling is opportunistic and unavailable in Expo Go and iOS Simulator;
  foreground and explicit backup triggers remain authoritative for testing.
- Remote push registration requires a physical development/EAS build; Expo Go and simulators are
  not authoritative notification-delivery test environments.
- Board and site-asset photos remain local working copies after backup; clearing the app sandbox
  still requires a future restore workflow to bring them back.
- Client report and photo inclusion are placeholders; toggles do not feed the exported PDF.
- Reconciliation lists only deliberately unresolved/TBC choices and uses explicit searchable,
  path-safe choices; other readiness failures remain blocking under the separate Checks view.
  Candidates are capped deterministically
  and large coverage/meter lists are virtualized. The physical view lists zone-contained boards and
  assets, while the electrical view keeps FED_FROM hierarchy separate from the MEASURES overlay.
- A completed Wattwatchers installation form creates the stable operational meter and immediately
  routes to commissioning step 2. The installer must represent every non-spare channel exactly once
  and explicitly choose phase, direction, and a Board/Grid/Site Asset/TBC target. Current schema-v2
  authoring records channel purpose and a conditional custom load label; older drafts without those
  answers remain readable and must supply the missing explicit values before completion.
- Site-asset editor recovery drafts are local-only records inside the encrypted transactional store.
  They are bound to user and installation, checksum-verified, expire after seven days, are cleared
  on logout/success/explicit discard, and require explicit review if the base tree or asset changed.
- Zone summary sending needs an authenticated API destination and delivery contract.
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

The August 2026 electrical-mapping hardening requires no API database migration and does not change
the canonical-v2 installation envelope. It uses existing `board_id`, `meter_id`,
`meterDevices`, `measurementAssignments`, and `metering_state` fields. The only new persisted value
is the optional, local-only `siteAssetEditorDrafts` recovery array. Existing v3 stores normalize a
missing array to empty, so no store-key reset or destructive migration is required; this field is
excluded from `InstallationBackupTree` and never sent to the API. WW forms add forward-compatible
string answers for channel purpose and conditional custom load label inside the existing JSON answer
map, so neither the mobile store nor API database needs a structural migration.

### Installation and mapping workflow

```text
login
  -> create/open installation (identity, audit date, IANA timezone)
  -> walk physical zones
  -> add a switchboard and explicitly choose Grid / parent board / TBC
  -> choose whether a meter device is installed
  -> complete the immutable WW evidence form
  -> app opens the stable meter's assignment editor
  -> map every active channel exactly once (phase + direction + target)
  -> add site assets as encountered and classify Metered / Unmetered / TBC
  -> reconcile supply, channel, and metering issues in Data View
  -> Cloud validate and complete only when no blocking readiness issues remain
```

Physical containment answers “where is this record?” Electrical `FED_FROM` answers “what supplies
it?” Measurement assignments answer “what does this exact meter channel measure?” These are
separate relationships. A virtual meter is only an immediate-boundary residual (one total minus
directly measured immediate children); it never propagates through an already measured child board.

`UNMETERED` is an explicit, valid asset classification, not an orphan or an incomplete record. A
confirmed-unmetered asset stays in All-asset metering, and that metering state alone does not block installation completion;
it may also show `VIRTUAL` coverage when an immediate-boundary residual exists. `TBC`, a declared
`METERED` asset whose exact assignment is missing or contradictory, and every non-spare channel
without a target remain blocking reconciliation states. A device with every channel explicitly
marked `SPARE` has no active measurements and does not create an unassigned-channel error. Web and
iOS status surfaces must keep these cohorts visibly separate and must use “Confirmed unmetered,”
“Mapping issue,” and “Unassigned active channel” rather than the ambiguous label “orphan.”

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
