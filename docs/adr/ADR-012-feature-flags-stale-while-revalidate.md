# ADR-012: Feature Flags - Catalog Defaults, Kill-Switch, and Stale-While-Revalidate Cache

## Status

Accepted (implemented in `frontend/src/lib/featureFlags.ts`,
`frontend/src/hooks/useFeatureFlags.ts`, and
`frontend/src/components/FeatureFlagsProvider.tsx`).

## Context

Some features (admin UI, clawback UI, advanced reporting, the trade-creation
wizard) must be switchable without a redeploy, and some (the offline banner)
must be removable quickly if they misbehave. Flags are decided on the server
but read all over the client, including during the first render.

Constraints that shape the design:

- Reading a flag must never block or flicker the first render.
- A backend or network failure must not crash the app, and must not
  accidentally turn a risky feature **on**.
- Every component that asks for flags should not trigger its own request.
- The flag names must stay aligned with the backend definitions.

## Decision

1. **A typed catalog is the single source of truth.** `FLAG_CATALOG` lists
   every flag with its **fail-safe default**: the value used when the server
   cannot be reached or does not mention the flag. By convention, UI-facing
   flags default to `false` (off until enabled) and kill-switch flags default
   to `true` (on unless disabled; today `offlineBanner`). `FlagName` and
   `FeatureFlags` are derived from the catalog, so adding a flag is a
   one-place edit. The file's own comment states that the catalog must stay
   in sync with the backend's feature-flags service, checked by
   `scripts/check-flag-catalog-drift.ts`.

2. **Synchronous env-var snapshot for first render.** `getFeatureFlags()`
   resolves each flag from `NEXT_PUBLIC_*` variables, falling back to the
   catalog default. `useFeatureFlags` seeds its state from it, so there is no
   loading flash and SSR, jest, and build time have a value.

3. **Server flags via `/api/flags` with a module-level SWR cache.**
   `fetchServerFlags()` keeps one `CacheEntry` (`flags`, `fetchedAt`,
   `revalidating`) with a 30 s TTL (`SERVER_FLAGS_TTL_MS`):
   - no cache: await the fetch, and share one in-flight promise so
     concurrent cold-start callers make a single request;
   - cache younger than the TTL: return it immediately;
   - cache older than the TTL: return the stale value immediately and
     revalidate once in the background (guarded by `revalidating`).
   The request uses `cache: "no-store"`, so this in-process cache is the only
   caching layer and browser or Next.js caching cannot serve older flags.

4. **Kill-switch on failure.** `fetchFlagsFromServer()` never throws. A
   non-OK response, a network error, or a parse error logs a warning and
   returns `catalogDefaults()`. Flags missing from a successful response are
   filled from the catalog by `mergeFlagsWithDefaults`. A backend outage
   therefore reverts to the catalog defaults, which turns off the risky
   features that default to `false` and leaves kill-switch flags at their
   default.

5. **One hook, one provider.** `useFeatureFlags` triggers a fetch on mount
   and exposes `isLoading`, `isFeatureEnabled`, and `refresh`.
   `FeatureFlagsProvider` shares one hook result through context, and
   `useFlags()` throws if used outside it. `invalidateFlagCache()` resets the
   cache for tests.

## Consequences

- **Positive:** Flags are readable synchronously on first render, and a
  fresh cache makes later reads instant.
- **Positive:** Failure behavior is uniform and safe: fall back to the
  catalog, never throw, never enable a UI-facing flag by accident.
- **Positive:** Stale flags are served while the refresh runs, so flag
  reads do not add latency after the first load.
- **Negative:** A flag change can take up to the 30 s TTL plus one
  revalidation to reach a running client, and the first read after expiry
  still returns the old value. `refresh()` is the manual override.
- **Negative:** When a background revalidation fails, its result is the
  catalog default and it replaces the cache. A transient outage can briefly
  turn a server-enabled flag back to its default for one TTL period, which is
  the fail-safe trade-off chosen here.
- **Negative:** The cache is per tab and in memory, and the env-var snapshot
  and server values can differ between first render and the fetch result,
  so a flag can change value shortly after mount.
- **Negative:** The catalog must be edited in two places (client and
  backend); the drift check is the only guard.
