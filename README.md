# InstallHub Mobile

Production-structured Expo React Native (iOS-first) app that mirrors the InstallHub web field installation workflow.

Location: `Tuvi/installhub-mobile` (sibling of `installhub/`, not nested inside it).

## Run

```bash
cd installhub-mobile
npm install
npx expo start
# then press i for iOS simulator, or scan QR with Expo Go
```

Demo login: any email + password `password123`

## Architecture (API-ready)

```
screens / hooks  →  repositories (interfaces)  →  mock JSON store (AsyncStorage)
                                              ↘ later: Api*Repository + HTTP client
```

- Screens never import fixture JSON directly.
- Swap point: implement the same interfaces in `src/repositories/` against your API.

## Features

- Dashboard: list / search / create installations
- Installation detail: zones, status, report entry points
- Zone workspace: boards, site assets, send summary stub
- Board detail + Wattwatcher A3RM/A6M forms
- Data View + TBC resolver
- Metering table
- Installation PDF export/share
- Client report + photo preview placeholders
- Settings: theme toggle, reset demo data, logout

## Fixtures

`src/data/fixtures/*.json` — seed data for 3 sample installations.

## Scripts

- `npm start` — Expo
- `npm run ios` — iOS
- `npx tsc --noEmit` — typecheck
