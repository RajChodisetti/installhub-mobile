# macOS iOS Development Setup

Field App Complete is an Expo iOS-first app. Metro can validate the JavaScript bundle
without Xcode, but a simulator run, native compile, archive, and device install
require the full Xcode app.

## Current machine status

Verified on July 28, 2026:

- Xcode 26.6 is installed and selected.
- Node.js 22.23.1, npm, CocoaPods, Watchman, EAS CLI, and the Expo
  dependencies are installed.
- `Sri Raj’s iPad` (iPadOS 26.5) is paired and connected by cable.
- The iPad has Developer Mode enabled and Developer Disk Image services are
  available.
- Xcode created a valid Apple Development certificate and managed provisioning
  profile for the Personal Team.
- A signed `FieldAppComplete.app` has been built and installed on the iPad.
- The iPad still needs to trust the local developer profile before first
  launch.
- Xcode currently shows only a Personal Team. A paid Apple Developer Program
  team must appear before App Store/TestFlight distribution.

## Finish the remaining interactive prerequisites

On the iPad:

1. Open **Settings > General > VPN & Device Management**.
2. Open the developer profile for the signed-in Apple Account.
3. Tap **Trust**, confirm, and keep the iPad unlocked for the first launch.

On the Mac:

1. Unlock the Mac.
2. For TestFlight, open **Xcode > Settings > Apple Accounts** and make sure the
   paid Apple Developer Program team appears in addition to the Personal Team.
   If it does not, verify that this exact Apple Account completed enrollment or
   add the enrolled Apple Account.

Never paste an Apple Account password, two-factor code, recovery key, or macOS
administrator password into source, chat, a script, or an `.env` file.

## Generate and run Field App Complete on the iPad

```bash
cd /Users/rajchodisetti/base44/installhub-mobile
npm ci
npx expo prebuild --clean --platform ios
open ios/FieldAppComplete.xcworkspace
```

In Xcode, select the **FieldAppComplete** app target, open **Signing &
Capabilities**, enable **Automatically manage signing**, and select a team.
The Personal Team is sufficient for a directly connected device; TestFlight
requires the paid team. Then run:

```bash
npx expo run:ios --device "Sri Raj’s iPad"
```

The native `ios/` project is generated and ignored by Git. A clean prebuild
replaces it, so perform the signing selection after prebuild. Once the Apple
Team ID is known, add it as `expo.ios.appleTeamId` in `app.json` to preserve
the selection across regeneration. Do not hand-edit or commit the generated
project. The stable bundle identifier remains `com.tuvi.installhub` so
existing signing, installed data, and update continuity are preserved.

## Scanner validation

The simulator validates navigation, permissions UI, manual-entry fallback, and
form behavior. Barcode and QR autofocus/recognition must also be exercised on a
physical iPhone or iPad:

1. allow camera permission;
2. scan the Installation and Comms Device Number and Device ID fields;
3. scan ACE and Captis standard barcode fields;
4. scan the Honeywell Q400 serial barcode;
5. test both QR and barcode modes on every SUMS ingestion field;
6. deny camera permission once and confirm manual entry remains available.

The mobile login never embeds a registration secret or creates an account after
the API rejects credentials.

## TestFlight for a remote tester

The `production` EAS profile creates an App Store build and automatically
increments the iOS build number. The app config declares that it does not use
non-exempt encryption, which maps to Apple's
`ITSAppUsesNonExemptEncryption=false`.

1. Verify the linked Expo EAS project with `eas project:info`; it should report
   `@rajchodisetti1/field-app-complete`.
2. Create an App Store Connect app record named **Field App Complete** whose
   bundle ID is `com.tuvi.installhub`.
3. Run `eas build --platform ios --profile production`.
4. Upload the successful build with
   `eas submit --platform ios --profile production --latest`.
5. In App Store Connect, complete the TestFlight beta information, create an
   internal group, then create an external group and add the build.
6. Submit the first external build for TestFlight Beta App Review.
7. After approval, invite the remote tester by email or enable a public link.

The external tester installs Apple's TestFlight app and does not need their
device UDID registered. They do need a valid Field App Complete account to pass
the app's sign-in screen.

## Non-native preflight

When Xcode is temporarily unavailable, this still validates iOS module and
asset resolution:

```bash
npm run typecheck
npm test
npx expo export --platform ios --output-dir /tmp/field-app-complete-ios-export --clear
```

An Expo export is not a substitute for a native simulator/device build; it is
the deterministic preflight used before the administrator-authorized Xcode
step.
