# macOS iOS Development Setup

InstallHub is an Expo iOS-first app. Metro can validate the JavaScript bundle
without Xcode, but a simulator run, native compile, archive, and device install
require the full Xcode app.

## Current machine status

The following tools are already installed:

- Apple Command Line Tools
- Node.js and npm
- CocoaPods
- Watchman
- EAS CLI
- Expo dependencies for this repository

The remaining prerequisite is the full Xcode app. Installing it is an
administrator-authorized macOS operation; never paste the administrator
password into an issue, chat, script, or `.env` file.

## Finish the Xcode installation

Run this interactively in Terminal and enter the macOS administrator password
only into the local password prompt:

```bash
sudo mas install 497799835
sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer
sudo xcodebuild -license accept
sudo xcodebuild -runFirstLaunch
```

Alternatively, install Xcode from the Mac App Store, then run the last three
commands. Open Xcode once and use its Settings to install an iOS Simulator
runtime if one is not already available.

Verify the native toolchain:

```bash
xcodebuild -version
xcode-select --print-path
xcrun simctl list devices available
pod --version
watchman --version
```

`xcode-select --print-path` must return
`/Applications/Xcode.app/Contents/Developer`, not
`/Library/Developer/CommandLineTools`.

## Run InstallHub

```bash
cd /Users/rajchodisetti/base44/installhub-mobile
npm install
npm run ios
```

Expo generates the native `ios/` project when needed. Select an available iOS
Simulator when prompted.

## Scanner validation

The simulator validates navigation, permissions UI, manual-entry fallback, and
form behavior. Barcode and QR autofocus/recognition must also be exercised on a
physical iPhone:

1. allow camera permission;
2. scan the Installation and Comms Device Number and Device ID fields;
3. scan ACE and Captis standard barcode fields;
4. scan the Honeywell Q400 serial barcode;
5. test both QR and barcode modes on every SUMS ingestion field;
6. deny camera permission once and confirm manual entry remains available.

Do not configure `EXPO_PUBLIC_REGISTRATION_SECRET` in a normal simulator,
device, preview, or App Store build.

## Non-native preflight

When Xcode is temporarily unavailable, this still validates iOS module and
asset resolution:

```bash
npm run typecheck
npm test
npx expo export --platform ios --output-dir /tmp/installhub-ios-export --clear
```

An Expo export is not a substitute for a native simulator/device build; it is
the deterministic preflight used before the administrator-authorized Xcode
step.
