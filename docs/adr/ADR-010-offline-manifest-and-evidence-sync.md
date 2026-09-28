# ADR-010: Offline-First Manifest and Evidence Sync

## Status

Proposed (issue #50 — pilot roadmap item, Phase 4).

## Context

Both apps already handle offline trade drafting:

- **Web:** `frontend/src/app/trades/create/TradeContext.tsx` persists the
  in-progress trade form to `localStorage` (`amana:draft-trade`) so a
  refresh or connectivity drop doesn't lose the draft, and
  `frontend/src/stores/offlineQueueStore.ts` queues JSON API calls
  (`create-trade`, `deposit`, `release`, `dispute`) with an idempotency
  key, replayed once `isOnline` flips back on (see
  `ConnectivityBanner.tsx`). Notably, `QueuedActionType` already reserves
  a `"manifest"` value — it's just never enqueued anywhere today.
- **Mobile:** `mobile/src/screens/EvidenceCaptureScreen.tsx` captures a
  photo/video to a local `file://` URI (persists on-disk regardless of
  connectivity) but uploads it immediately and irrecoverably — a failed
  `handleUpload` just sets `uploadState: 'error'` with a "Retry" that
  re-runs the same one-shot POST; there's no queue, so backgrounding the
  app or losing the network mid-upload drops the attempt.

Two gaps stand between here and "a full trade lifecycle can be drafted
offline and synced once connectivity returns":

1. **Manifest submission** (`DriverManifestForm.tsx`) is JSON-only and
   would fit the existing web queue mechanism as-is — it's just never
   wired up.
2. **Evidence upload** is binary (photo/video), and the existing queue's
   `body?: unknown` is JSON-serialized into `localStorage` — it cannot
   hold a `Blob`/`File`/large base64 payload without blowing the
   ~5–10 MB `localStorage` quota per origin, and on mobile a `file://` URI
   is already durable on-disk, so it doesn't need re-serializing at all.

## Decision

**Two different storage strategies for the two payload shapes, unified by
one queue-entry shape:**

- **Manifest (web, JSON):** enqueue via the existing
  `useOfflineQueueStore().enqueue({ type: "manifest", endpoint, method:
  "POST", body })` from `DriverManifestForm`'s submit handler when
  `navigator.onLine` is false or the POST itself fails with a network
  error (not a 4xx — those are real rejections, not connectivity gaps).
  No new storage layer: this is wiring an already-reserved queue type
  into its call site, plus a `replay` handler registration in
  `ConnectivityBanner` alongside the existing trade/deposit/release ones.

- **Evidence (mobile, binary):** don't route the file through
  `offlineQueueStore` at all. `EvidenceCaptureScreen` already writes to a
  `file://` URI that survives app restarts; the fix is to persist *queue
  metadata* (trade ID, media type, file URI, name) to `expo-sqlite`
  (already a mobile dependency, used elsewhere in the app) instead of
  attempting the upload inline, and drain that table on reconnect via the
  same `NetInfo` listener pattern the mobile app already uses elsewhere
  (`@react-native-community/netinfo` is a dependency). The captured file
  itself never moves — only a row pointing at it does.

- **Evidence (web, if/when web gains capture):** out of scope for this
  ADR — web currently has no capture UI to extend, only the eventual
  upload target. If added, apply the mobile approach's shape (IndexedDB
  for the blob + queue metadata) rather than `localStorage`, since
  `localStorage` cannot hold binary payloads at any reasonable size.

- **Shared conflict/idempotency rule:** every queued mutation (existing
  and new) reuses `generateIdempotencyKey()` already in
  `offlineQueueStore.enqueue`, so a manifest or evidence-upload retried
  after a partial success on the backend is a no-op, not a duplicate —
  same guarantee the trade-creation queue already relies on.

## Consequences

- **Positive:** No new queue abstraction — manifest reuses the exact
  mechanism `create-trade`/`deposit`/`release` already use end to end
  (enqueue → `ConnectivityBanner` replay → idempotent POST).
- **Positive:** Evidence capture stops being irrecoverable on a dropped
  connection; the expensive part (the recording itself) is never
  re-done, only the upload step retries.
- **Negative:** Two different persistence mechanisms (`localStorage` JSON
  queue vs. `expo-sqlite` file-reference queue) for what's conceptually
  one "offline mutation queue" — acceptable because they're on different
  platforms with different constraints, but worth a shared TypeScript
  interface (`QueuedMutation`) so `ConnectivityBanner`-equivalent replay
  logic looks the same on both, even though storage differs.
- **Negative:** Evidence uploads queued for a long time reference a
  `file://` URI that the OS can reclaim under storage pressure (iOS in
  particular). The drain step needs to handle "file no longer exists" as
  a terminal failure (surface to the user to recapture) rather than an
  infinite retry.

## Scope for the follow-up implementation PR

Kept small and reviewable, split from this ADR:

1. `frontend`: wire `DriverManifestForm` submit → `enqueue({ type:
   "manifest", ... })` on network failure; register a `manifest` replay
   case in `ConnectivityBanner`. ~1 file + 1 call site.
2. `mobile`: add an `evidenceQueue` table (via `expo-sqlite`, mirroring
   the schema other mobile features already use it for), a
   `useEvidenceQueueDrain()` hook wired to `NetInfo.addEventListener`,
   and change `EvidenceCaptureScreen.handleUpload` to enqueue-then-drain
   instead of uploading inline.
