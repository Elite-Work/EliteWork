# feat: trade search (backend + frontend), biometric PIN fallback, backend contributing guide

Closes #504
Closes #505
Closes #511
Closes #515

## Summary

Four issues in one reviewable change set, split by package so each part can be
reviewed on its own:

| Issue | Area | What shipped |
| --- | --- | --- |
| #504 | backend | `q` full-text search on `GET /api/trades`, backed by a Supabase `trade_search` index over commodity + counterparty name, with a SQL-substring fallback when the index is unavailable |
| #505 | frontend | 300 ms debounced search input on the trades list, wired to `q`, with search-aware empty state and reset |
| #511 | mobile | Face ID / fingerprint unlock that falls back to a PIN after 3 failed biometric attempts, with PIN setup and a forgotten-PIN escape hatch |
| #515 | docs | `backend/CONTRIBUTING.md` covering setup, test commands, service-layer conventions and PR expectations |

---

## #504 — backend: full-text search for `GET /api/trades`

### Behaviour

`GET /api/trades?q=maize` now narrows the caller's trade list by a free-text
query. The existing scoping is unchanged: the result set is still only trades
where the authenticated wallet is buyer or seller, still honours `status`,
`page`, `limit`, `sort`, and still puts the caller's watchlisted trades first.

- `q` is trimmed, capped at 100 characters, and blank values are treated as "no
  filter" (400 for anything longer).
- Matching covers the trade's **commodity** label and the **counterparty
  display name** (buyer and seller), plus the trade id.
- `commodity` is now persisted on trade creation so the feature has data to
  index. It is **off-chain metadata only** — it never reaches the escrow
  contract and stays optional, so existing clients keep working.

### How it works

1. `backend/src/services/tradeSearch.service.ts` (`SupabaseTradeSearchIndex`)
   queries the Supabase `trade_search` table with
   `textSearch("search_vector", q, { config: "english", type: "websearch" })`,
   which resolves to `search_vector @@ websearch_to_tsquery('english', :q)`.
   Websearch syntax (quotes for phrases, `-term`) is kept intact; control
   characters are stripped and whitespace collapsed before the query.
2. `TradeService.listUserTrades` intersects those ids with the Prisma query
   (`tradeId: { in: ids }`), keeping the caller/status filter and pagination in
   one query. Zero matches short-circuit to an empty page without hitting the
   database.
3. **Graceful degradation:** if Supabase is not configured, errors, or a
   caught exception occurs, `searchTradeIds` returns `null` (not `[]`) and the
   service falls back to a Prisma substring filter on `commodity` / `tradeId`,
   so local dev and CI still get sensible results.
4. On `createPendingTrade`, the new trade is written to the index
   fire-and-forget (`indexTrade` never throws), so a slow or unavailable index
   never adds latency to the escrow creation path.

### Files

- `backend/src/services/tradeSearch.service.ts` *(new)* — query
  normalisation, Supabase index read/write, display-name lookup from the
  `users` table.
- `backend/src/services/trade.service.ts` — `q` filter, fallback, index write
  on create; search index is injected (3rd constructor arg) so tests use a fake.
- `backend/src/schemas/trade.schemas.ts` — `q` validation on
  `listTradesQuerySchema`.
- `backend/src/routes/trade.routes.ts` — forwards `q`.
- `backend/src/controllers/trade.controller.ts` — normalises and persists
  `commodity` for single and bulk creation.
- `backend/src/schemas/domain/trade.ts` + `frontend/src/lib/domain-schemas/trade.ts`
  — optional `commodity` on the shared create schema (kept byte-identical;
  `node scripts/check-schema-parity.mjs` passes).
- `backend/prisma/schema.prisma` + `prisma/migrations/20261120000000_add_trade_commodity/migration.sql`
  — nullable `Trade.commodity` column (additive, safe rollback).
- `backend/supabase/migrations/20261120000000_create_trade_search_index.sql`
  *(new)* — `trade_search` table, GIN index on `search_vector`, address
  indexes, RLS enabled with service-role-only grants.
- `backend/scripts/backfill-trade-search.ts` *(new)* — idempotent cursor-based
  backfill of pre-existing trades into the index, with `--limit=` support.
- `backend/src/docs/openapi.yaml` + `openapi.json` — documented `q` parameter
  and the optional `commodity` request field (JSON/YAML kept in sync; the
  docs test passes).

### Deploy order

1. `pnpm prisma migrate deploy` (adds `Trade.commodity`).
2. Apply `supabase/migrations/20261120000000_create_trade_search_index.sql`.
3. Run `npx tsx scripts/backfill-trade-search.ts` so historical trades are
   searchable. Until it runs, only newly created trades are indexed.

---

## #505 — frontend: debounced search input on the trades list

### Behaviour

- Search box above the filter tabs, labelled
  `Search trades by commodity or counterparty`.
- Debounced at **300 ms** via a new `useDebouncedValue` hook, so typing three
  characters produces one request, not three.
- The query is sent as `q` alongside `status`/`page`/`limit`; the page resets to
  page 1 as soon as the input changes (the request still waits for the
  debounce).
- Searching state is reflected in analytics (`hasSearch` on both the page-view
  funnel step and API-failure event).
- Empty state distinguishes "No trades yet" (with the existing create CTA) from
  "No matching trades" (with the query echoed and a **Clear search** button).

### Files

- `frontend/src/hooks/useDebouncedValue.ts` *(new)*.
- `frontend/src/app/trades/page.tsx` — input, query param, empty states.
- `frontend/src/lib/api/trades.ts`, `frontend/src/lib/api/types.ts` — `q`
  parameter and optional `commodity` on trade responses.
- `frontend/src/app/trades/create/steps/Step3Review.tsx` — sends the commodity
  already collected in step 1 so new trades are searchable.

---

## #511 — mobile: biometric unlock with PIN fallback

The mobile app previously required pasting a wallet address on every unlock.
Biometric unlock existed, but a user whose biometrics failed had no way back
into the wallet — the premise of this issue ("unlock requires a PIN") is now
made true, with biometrics as the primary path.

### Behaviour

- Returning users with biometric hardware/enrolment still see
  **🔐 Unlock as GDNM…SXMU**; the prompt text is unchanged.
- Failed attempts are counted: `1` → "Please try again. PIN entry unlocks after
  2 more failed attempts", `2` → "…after 1 more failed attempt", `3` → PIN entry
  replaces the biometric button.
- Only genuine failures count. A dismissed prompt (`user_cancel`,
  `system_cancel`, `app_cancel`) is ignored; OS lockout / not-enrolled /
  passcode-not-set fall back to PIN immediately.
- Devices **without** biometrics but with a configured PIN go straight to PIN
  entry.
- PIN entry is an accessible form (numeric keyboard, secure entry, `role=alert`
  error, 4–6 digit validation, constant-time comparison) with a
  **Forgot PIN? Use a different wallet** escape hatch.
- A **Set up a PIN as a backup** link appears for returning biometric users who
  have no PIN yet; **Unlock with PIN instead** appears once one exists.
- The PIN lives in `expo-secure-store` (iOS Keychain / Android Keystore) and is
  only a local unlock convenience for the remembered address — on-chain signing
  still happens in the user's wallet app. This is documented in the module.

### Files

- `mobile/src/utils/walletPin.ts` *(new)* — format validation, set/verify/clear,
  constant-time compare, fail-closed on keystore errors.
- `mobile/src/utils/biometrics.ts` — `BIOMETRIC_ATTEMPTS_BEFORE_PIN`,
  `classifyBiometricFailure`, `shouldFallBackToPin`.
- `mobile/src/components/WalletPinUnlock.tsx` *(new)* — presentational PIN form.
- `mobile/src/screens/WalletConnectScreen.tsx` — failure counting, fallback
  switch, PIN setup, PIN unlock, manual-connect escape hatch.

---

## #515 — backend: `CONTRIBUTING.md`

`backend/CONTRIBUTING.md` *(new)* is scoped to the backend package and links to
the root guide instead of duplicating it. It documents:

- **Setup** — `pnpm@10.33.0` (the README/QUICK_START `npm install` note is
  flagged as legacy), env vars that actually matter, Prisma migrate/generate.
- **Tests** — `pnpm test`, single-file/single-test invocations, coverage
  thresholds, where test files live, the "no real DB in unit tests" rule, and
  the ephemeral stack (`./scripts/test-up.sh` → `DATABASE_URL=…:5433`).
- **A model service test** — `tradeSearch.service.test.ts` as the reference for
  the house style.
- **Service-layer conventions** — routes/controllers/services/repositories,
  Zod validation, `AppError` taxonomy, BigInt money math, structured logging
  without PII, best-effort external dependencies, non-idempotent writes are not
  retried.
- **PR expectations** — one issue per PR, state the commands you ran, call out
  migrations/env vars/new Supabase objects.

---

## Verification

Environment: Node 24, pnpm 10.33.0. Backend suite run against the repo's
ephemeral test stack (`./scripts/test-up.sh`, Postgres :5433 + Redis :6381).

### Backend (`backend/`)

| Command | Result |
| --- | --- |
| `npx jest` on touched areas (`trade.routes`, `trade.service`, `trade.search.service`, `tradeSearch.service`, `trade.bulk.routes`, `trade.export.routes`, `trade.repository`, `trade.watchlist.service`, `trades.pact.verify`, `outbox.completeness`, `openapi.docs`, `migration-safety`) | **12/12 suites, 271/271 tests pass** |
| Full `npx jest` (with test stack) | 186 suites pass, **55 fail**, 3188 tests pass, 45 fail |
| Full `npx jest` at `HEAD` (stashed changes, same stack) | 177 suites pass, **62 fail**, 3105 tests pass, 45 fail |

**No new failures.** The 45 failing tests are identical before and after; the
failing-suite count drops from 62 → 55 because the `Trade` fixtures in seven
suites had to include the new nullable column and now compile. The remaining
failures are pre-existing and unrelated to these issues — e.g.
`src/__tests__/trade.controller.test.ts` calls an undefined `makeTrade()`,
`schemas.formatter.test.ts` uses a 55-character "public key", several suites
reference Prisma types they never import, and `src/routes/stellar.ledger.ts`
uses `LedgerRecord.total_operations`, which does not exist in the installed
Stellar SDK typings. `pnpm test` is therefore still red on `main`'s existing
failures; the acceptance criterion "`pnpm test` passes in `backend/`" is met by
every suite these issues touch, not by the whole repo. Fixing the rest is
separate work.

`npx tsc --noEmit` — 11 errors, all in pre-existing test helpers /
`stellar.ledger.ts`; none in files changed here.

### Frontend (`frontend/`)

| Command | Result |
| --- | --- |
| `npx jest --config jest.config.ts` (full suite) | **109/109 suites, 1297/1297 tests pass** |
| `node ../scripts/check-schema-parity.mjs` | ✓ backend ≡ frontend trade schema |

New tests: `src/__tests__/tradesSearch.test.tsx` (debounce → one request with
the final query, empty state + clear, whitespace ignored) and
`src/hooks/__tests__/useDebouncedValue.test.ts`.

`npx tsc --noEmit` reports only pre-existing errors in untouched test files
(`Toast.test.tsx`, accessibility fixtures, admin/assets page tests).

### Mobile (`mobile/`)

| Command | Result |
| --- | --- |
| `npx jest --runInBand` (full suite) | **39/39 suites, 451/451 tests pass** |
| `npx tsc --noEmit` | clean |

New/updated tests: `utils/__tests__/walletPin.test.ts` (format, store, exact
match, fail-closed), `utils/__tests__/biometrics.test.ts` (classification,
threshold), `components/__tests__/WalletPinUnlock.test.tsx` (disabled state,
submit, wrong/throws errors, input sanitisation), and
`screens/WalletConnectScreen.test.tsx` (failure counting, PIN fallback after 3,
successful/wrong PIN).

---

## Review notes

- The search index is written by the app, not by a database trigger, to keep
  the schema in one place and let tests inject a fake. Consequence: display
  names are copied into the document when a trade is created/backfilled, so a
  later profile rename is not reflected until that trade is re-indexed. A
  follow-up could add a Supabase trigger or re-index on profile update.
- `TradeService` gained an optional third constructor argument
  (`tradeSearch: TradeSearchIndex`); existing call sites are unaffected.
- The `q` fallback intentionally keeps working without Supabase so local
  development and the existing tests don't require credentials.
- Mobile PIN is stored in SecureStore rather than hashed in JS: the keystore is
  the security boundary and there is no crypto dependency in the app. If the
  PIN should protect a signing key later, move verification into
  `expo-crypto`/native and gate the key export there.
- `Alert.prompt` (used for the address and PIN setup prompts) is iOS-only; this
  matches the pre-existing connect flow. Android PIN setup needs a modal
  follow-up.
