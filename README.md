# Field App Complete

Production-structured Expo React Native (iOS-first) app that mirrors the Field App Complete web field installation workflow.

Location: `Tuvi/installhub-mobile` (sibling of `installhub/`, not nested inside it).

## Project onboarding

- AI coding agents: start with [`AGENTS.md`](AGENTS.md).
- Detailed architecture, dependencies, domain tree, routes, and implementation playbooks:
  [`docs/AI_ONBOARDING.md`](docs/AI_ONBOARDING.md).
- macOS/Xcode, simulator, and physical-device scanner setup:
  [`docs/MACOS_IOS_SETUP.md`](docs/MACOS_IOS_SETUP.md).
- `CLAUDE.md` imports the canonical agent guide so project instructions stay in sync across tools.

## Run

```bash
cd installhub-mobile
npm install
npx expo start
# then press i for iOS simulator, or scan QR with Expo Go
```

Sign in with a Field App Complete account provisioned on the Sustainability Wise API.

Optional development configuration:

```bash
EXPO_PUBLIC_SYNC_API_URL=http://localhost:3000 npx expo start
```

## Architecture

```
screens / hooks → repositories → local JSON store (AsyncStorage)
                       ├──────→ durable backup queue → Sustainability Wise API
                       └──────→ local PDF → retry tiers / async API PDF fallback
```

- Screens never import fixture JSON directly.
- Local writes remain usable offline.
- Authentication tokens are held in SecureStore.
- Installation trees and all evidence families back up through `/v1/installhub`.

## Features

- Dashboard: list / search / create installations
- Installation detail: zones, status, report entry points
- Zone workspace: boards, site assets, send summary stub
- Board detail + Wattwatcher A3RM/A6M forms
- Data View + TBC resolver
- Metering table
- Branded local form PDFs with Standard, Reduced, and Compact evidence tiers
- Full installation-pack PDF: summary plus all completed form reports merged
- Durable API PDF fallback for large/remote-evidence reports, with progress,
  resumable job polling, authenticated download, and native sharing
- Six resumable field forms with evidence photos and form-specific PDF export:
  Installation (dynamic A3RM/A6M), Comms Fault, ACE Switchboard,
  Honeywell Q400, Captis Logger, and SUMS Logger
- Barcode/QR ingestion for device, switchboard, water-meter, Captis, and SUMS
  identifiers
- Installation channels require a load; `Not Used` clears/hides sensor rating,
  description, evidence, polarity, and current. Used channels allow only the
  A3RM Rogowski or A6M CT values for the selected device type.
- Client report + photo preview placeholders
- Per-installation opt-in Cloud Backup, automatic retry, and foreground/background
  triggers
- Creator/assigned-user/admin cloud browsing and fresh-ID imports named `cp1`,
  `cp2`, and so on; source IDs let eligible copies report from the original backup
- Per-installation Cloud Files & History browser for authenticated evidence/report
  downloads and immutable backup-version inspection
- Creator/admin-only permanent Cloud Backup deletion with an explicit destructive
  confirmation; local cpN copies are not silently removed
- Admin user management and backed-up installation access assignment
- Settings: backup controls, light/dark/system appearance, storage accounting,
  protected cache cleanup, password change, admin diagnostics, about, and logout

## Fixtures

`src/data/fixtures/*.json` — seed data for 3 sample installations.

## Scripts

- `npm start` — Expo
- `npm run ios` — iOS
- `npx tsc --noEmit` — typecheck
- `npm test` — form catalog, validation, conditional logic, and report HTML tests
