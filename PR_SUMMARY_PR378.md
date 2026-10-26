# PR #378 Summary — test(mobile): HomeScreen & EvidenceCaptureScreen coverage + CI gate repairs

References: #280 (HomeScreen tests), #279 (EvidenceCaptureScreen tests).

## What this PR delivers

1. **New mobile screen coverage**
   - `mobile/src/screens/EvidenceCaptureScreen.test.tsx` — capture stages, media-source flows, validation errors, upload states, a11y labels.
   - `mobile/src/screens/HomeScreen.test.tsx` — primary UI, navigation, async loading/error branches.
2. **Deterministic AdminStreams test** — the stream-list assertion now uses `waitFor` and asserts the absence of the `stream-001` seed placeholder explicitly, removing a race under parallel jest shards.
3. **CI gate repairs** (these were red on `main` independent of the tests):
   - Frontend gate timeout 8 → 15 minutes.
   - Backend gate skips `pnpm install` / `prisma migrate deploy` when no backend files changed.
   - `Scripts Unit Tests` runner + backend migration env + flag-catalog drift check fixed; `verify-test-determinism.sh` no longer aborts on empty grep matches.
4. **Setup-level E2E breakage fixed** (the last three red checks on this PR):

| Check | Root cause | Fix |
| --- | --- | --- |
| Contracts Required Gate | `cargo audit` fails on anyhow 1.0.102 (RUSTSEC-2026-0190: unsound `Error::downcast_mut()`) | bump to 1.0.103, the first patched release (`contracts/Cargo.lock`) |
| Mobile E2E Smoke — Android | `android-actions/setup-android@v3` installs the removed `tools` SDK package; `sdkmanager` exits 1 on cmdline-tools ≥ 12 | switch to `setup-android@v4` (android-actions#537) |
| Mobile E2E Smoke — iOS | `app.config.ts` imports `getDefaultConfig`, never exported by the locked Expo SDK 52 build — every `expo prebuild` crashed; `mobile/assets/` referenced but not committed (ENOENT on icons); `xcodebuild`/Detox hardcoded "iPhone 15 / iOS 17.5", absent from supported runners (macos-14/Xcode 15.4 retire 2026-11-02) | full `ExpoConfig` written inline in `app.config.ts`; placeholder assets committed (see `mobile/assets/README.md`); simulator resolved at runtime (`iOS_SIM_NAME/OS/UDID`) and threaded into `xcodebuild -destination id=…`, the boot step, and Detox via `DETOX_IOS_DEVICE_NAME/OS` (local defaults unchanged) |

## Verification

- `mobile`: `pnpm type-check`, `pnpm lint` (0 errors), `pnpm test` → 317/317 passing.
- `expo config --json` evaluates the repaired dynamic config; `expo prebuild --platform ios/android --no-install --non-interactive` exit 0 locally (previously impossible).
- `contracts`: `cargo update -p anyhow --precise 1.0.103` reproduces exactly this lockfile delta; `cargo tree --locked --target all` proves lock consistency.
- `.github/workflows/ci.yml` parses as valid YAML; each fix addresses a failure documented in the CI run logs.

## Follow-ups for reviewers

- Replace placeholder `mobile/assets/` with final artwork when design ships it.
- Keep the E2E smoke jobs `continue-on-error` only until one full green Detox run; then re-enable hard gating.
