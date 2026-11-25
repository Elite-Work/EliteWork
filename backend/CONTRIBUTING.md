# Contributing to the Amana backend

This guide covers everything specific to `backend/`: local setup, the test
commands that actually work here, and the service-layer conventions this
package follows. Read the repo-wide [`CONTRIBUTING.md`](../CONTRIBUTING.md)
first for issue claiming, branch naming, PR scope and review expectations —
this file only adds what is different inside `backend/`.

> **Use pnpm.** `backend/package.json` pins `pnpm@10.33.0` via `packageManager`.
> The `npm ...` snippets in older docs (including `README.md` and
> `QUICK_START_TESTING.md`) still work, but the lockfile and CI use pnpm, so
> pnpm is what you should run locally.

## 1. Setup

Prerequisites: Node.js 20+ and pnpm 10 (Corepack: `corepack enable`).

```bash
cd backend
pnpm install --frozen-lockfile   # postinstall runs `prisma generate`
cp .env.example .env             # then fill in the values below
```

Environment variables that matter for local development:

| Variable | Needed for |
| --- | --- |
| `DATABASE_URL` | Prisma / Postgres access (trades, disputes, outbox, …) |
| `JWT_SECRET` (32+ chars), `JWT_ISSUER`, `JWT_AUDIENCE` | Auth middleware and token tests |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase-backed reads/writes (profiles, trade search index) |
| `REDIS_URL` | BullMQ workers, rate limiting, caching |
| `STELLAR_*` | Contract transaction building |

Supabase is optional for unit tests: the code paths that use it degrade
gracefully (for example `GET /api/trades?q=` falls back to a SQL substring
match when the search index is unreachable), so a missing key must never make
`pnpm test` fail.

### Database

```bash
pnpm prisma migrate dev        # apply pending migrations to your dev database
pnpm prisma generate           # regenerate the client after editing schema.prisma
pnpm prisma db seed            # optional seed data
```

Every schema change needs a checked-in migration directory under
`prisma/migrations/` (`migration.sql`). Prefer additive, nullable changes; the
`migration-safety.test.ts` guard flags destructive DDL. If a migration also
needs Supabase-side objects, put the SQL under `supabase/migrations/` and say
in the PR which order to apply them.

## 2. Running the backend

```bash
pnpm dev          # tsx watch server
pnpm build        # prisma generate + tsc
pnpm start        # run dist/index.js
pnpm lint         # eslint src/
```

## 3. Tests

The quick local check (no external services):

```bash
pnpm test                                        # full Jest suite + coverage
pnpm test -- src/__tests__/trade.routes.test.ts  # one file
pnpm test -- -t "returns 201"                    # one test name
```

Notes:

- Jest runs with `--forceExit --detectOpenHandles`, and enforces global
  coverage thresholds (60% branches, 65% functions, 70% lines/statements). A
  change that drops coverage fails CI; add tests with the code.
- Test files live next to the code in `__tests__/` (e.g.
  `src/services/__tests__/tradeSearch.service.test.ts`) or in `src/__tests__/`
  for route/integration coverage. Name them `<subject>.test.ts`.
- Unit tests must not need a real database, Redis or network. Mock Prisma
  delegates, the Supabase client (`jest.mock("../../lib/supabase")`) and
  `fetch`-style clients. `mockFactories.ts` in `src/__tests__/factories/` and
  the `makeTrade(...)` helpers are good starting points.
- Integration tests that do touch infrastructure expect the ephemeral test
  stack from the repo root:

  ```bash
  ./scripts/test-up.sh          # tmpfs Postgres :5433 + Redis :6381, migrations applied
  DATABASE_URL=postgresql://postgres:password@localhost:5433/amana_test \
  REDIS_URL=redis://localhost:6381 \
    pnpm test
  ./scripts/test-up.sh --down
  ```

Full CI checks additionally run `pnpm build` and `pnpm lint` (see
`docs/branch-protection-policy.md`). Repo-root checks that touch this package:

```bash
node ../scripts/check-schema-parity.mjs   # shared domain schema must match frontend
```

### Model service test

`src/services/__tests__/tradeSearch.service.test.ts` is a compact example of
the house style: a hand-written PostgREST chain double, one `describe` per
public function, explicit assertions on the query built (not just the result),
and coverage of the "dependency unavailable" branch.

## 4. Service-layer conventions

- **Layers.** `routes/` wire middleware + validation only; `controllers/`
  translate HTTP to service calls and map domain errors to `AppError`;
  `services/` own business rules and external calls; `repositories/` hold
  reusable queries. Do not put Prisma queries in a route.
- **Validation.** Request bodies/queries/params are validated with Zod through
  `validateRequest(...)`; schemas live in `src/schemas/`. Domain schemas shared
  with the frontend (`src/schemas/domain/trade.ts`) are byte-identical mirrors
  of `frontend/src/lib/domain-schemas/trade.ts` — edit both or CI's parity
  check fails.
- **Errors.** Throw `new AppError(ErrorCode.X, message, status)` from
  `src/errors/errorCodes.ts`; never respond with ad-hoc error shapes. The
  central `errorHandler` adds `code`, `details` and `timestamp`.
- **Money.** Amounts are decimal strings; convert with `src/lib/money.ts`
  (BigInt-based). Never do fee/loss arithmetic with JavaScript floats — see
  `docs/shared-schemas.md` and the money-math mutation suite.
- **Logging.** Use `appLogger` with a structured object and an operation name.
  Never log wallet addresses, secrets or raw request bodies without
  `sanitizeLogField` (see `docs/pii-log-scanning.md`).
- **External dependencies.** Treat Supabase/Redis/IPFS as best-effort where
  the request can still succeed: catch, log a warning with an `operation`, and
  degrade. Indexing side effects (e.g. the trade search index) must not add
  latency to the critical path — fire-and-forget from the service, and make
  the writer itself never throw.
- **Transactions and retries.** Writes are not auto-retried unless they are
  idempotent. Use `src/lib/retry.ts` (`maxRetries: 0` for inserts) and read
  `docs/retry-classification.md` before adding retries.
- **Comments.** Explain *why* a branch exists (link the issue/ADR), not what
  the next line does. Keep the existing `// #123:` reference style.

## 5. PR expectations for `backend/`

- One issue per PR. Include `Closes #<issue>` in the description.
- State the commands you ran (`pnpm test`, `pnpm build`, `pnpm lint`) and any
  check you could not run locally.
- New behaviour needs a test that fails without the change; bug fixes need a
  regression test that reproduces the report.
- Call out migrations, new environment variables, new Supabase objects, and
  anything that changes an API response shape in the PR description so
  reviewers can check deploy ordering.
