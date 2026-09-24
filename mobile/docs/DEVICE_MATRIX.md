# Supported Device Matrix

This document defines the minimum and recommended OS versions for Amana Mobile.
The Detox CI jobs enforce these via `.detoxrc.js` device configuration.

## iOS

| Device class     | Min iOS | Target iOS | CI simulator         |
| ---------------- | ------- | ---------- | -------------------- |
| iPhone (modern)  | 16.0    | 17.5       | iPhone 15 / iOS 17.5 |
| iPad (optional)  | 16.0    | 17.5       | iPad Pro 12.9"       |

**Enforcement:** The `.detoxrc.js` `simulator` device config pins `iPhone 15 / iOS 17.5`.
To test a new iOS major version, update both `.detoxrc.js` and this table in the same PR.

## Android

| Device class          | Min API | Target API | CI emulator       |
| ---------------------- | ------- | ---------- | ------------------ |
| Phone (default/target) | 31 (12) | 34 (14)    | Pixel 6 API 34      |
| Phone (low-end, min)   | 31 (12) | 31 (12)    | Pixel 3a API 31     |
| Tablet                 | 31 (12) | 34 (14)    | —                   |

**Enforcement:** The `.detoxrc.js` `emulator` device config pins `Pixel_6_API_34` (AVD name),
and the `emulatorLowEnd` device config pins `Pixel_3a_API_31` — a representative low-end
device at the *minimum* supported API, run with a constrained memory allocation
(`-memory 2048`) to approximate real low-end hardware rather than the CI runner's default.
This matters for this project specifically: rural pilot cooperative members (see the
Phase 4 pilot program in the README) are more likely to own older, lower-spec Android
phones than the CI default's modern Pixel 6 profile — a regression that only shows up
under memory/CPU pressure (dropped frames, OOM, jank) would otherwise go undetected.
Both AVDs must exist on the CI runner; the CI workflow creates them via `avdmanager` if absent
(see `.github/workflows/mobile-e2e-nightly.yml`'s `mobile-e2e-android-nightly` and
`mobile-e2e-android-lowend-nightly` jobs).

## Adding a new device configuration

1. Add the device entry to the `devices` section of `.detoxrc.js`.
2. Add a corresponding configuration under `configurations`.
3. Update this table.
4. Add the new CI job step in `.github/workflows/mobile-e2e-nightly.yml` under the correct matrix entry.

## Why these versions?

- **Android API 31 (12):** Exact-alarm permission changes; our push-notification path requires this minimum.
- **iOS 16:** SwiftUI and Expo SDK 52 minimum.
- We drop support for OS versions < 2 years old from the current release date.

## React Native / Expo version compatibility

| react-native | expo sdk | Detox    |
| ------------ | -------- | -------- |
| 0.76.x       | 52.x     | ≥ 20.x   |

See `mobile/package.json` for pinned versions.
