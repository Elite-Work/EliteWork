# Shared domain schemas (backend ⇄ frontend)

Backend request validation and frontend form validation used to maintain the
same rules twice and drift apart (e.g. the trade-creation form sent `amountCngn`
while the backend required `amountUsdc` — a guaranteed late 400). Domain
validation rules now live in **one canonical schema** consumed by both sides.

## What exists today

| Location | Role |
| --- | --- |
| `frontend/src/lib/domain-schemas/trade.ts` | Canonical schema (zod-only, framework-free) |
| `backend/src/schemas/domain/trade.ts` | Byte-identical mirror consumed by the backend |
| `scripts/check-schema-parity.mjs` | CI guard — fails if the two files diverge |
| `frontend/src/lib/domain-schemas/__tests__/parity.test.ts` | fast-check fuzz proving accept/reject parity vs an independent reference predicate (3000 runs) |

- **Backend:** `createTradeSchema` = `createTradeInputSchema` + a backend-only
  checksum-accurate `StrKey` public-key check.
- **Frontend:** `Step3Review.tsx` validates the payload with
  `createTradeInputSchema.safeParse` before calling the API, and
  `CreateTradeInput` / `CreateTradeRequest` types derive from it.

### Why a mirrored file instead of a workspace package (yet)

The repo is not a pnpm workspace — `frontend/` and `backend/` install
independently and build with different toolchains (`next build` vs `tsc` with
`rootDir: src`). A real shared package needs `pnpm-workspace.yaml`, per-app
`tsconfig` path wiring, and `transpilePackages` in `next.config`. The mirrored
file + CI diff is the low-risk first step that removes the drift **today**.

## CI wiring

Add to the lint/test workflow:

```yaml
- run: node scripts/check-schema-parity.mjs
```

The fuzz parity test runs as part of `cd frontend && pnpm test`.

> **OpenAPI examples:** extend `check-schema-parity.mjs` (or a sibling script) to
> `safeParse` every `POST /trades` request example in `docs/api/` against
> `createTradeInputSchema` so published examples can't describe a rejected body.

## Adding a form to the shared-schema model

1. Add the schema to `frontend/src/lib/domain-schemas/<area>.ts` and copy it
   verbatim to `backend/src/schemas/domain/<area>.ts`.
2. Register the pair in `PAIRS` in `scripts/check-schema-parity.mjs`.
3. Backend: build the route validator from the shared schema (layer
   infra-specific refinements with `.superRefine`).
4. Frontend: `safeParse` in the form's submit handler; derive TS types with
   `z.infer`.
5. Add a fuzz parity test mirroring `parity.test.ts`.

## Rollout plan for remaining forms

| Order | Form | Backend schema | Notes |
| --- | --- | --- | --- |
| 1 ✅ | Trade creation | `createTradeSchema` | Done — reference implementation |
| 2 | Dispute initiation | `initiateDisputeSchema` | Align `category` / `categoryId`; preserve error-message localization hooks (#72) |
| 3 | Driver manifest | (frontend `ManifestSchema`) | No backend counterpart yet — add one |
| 4 | Evidence upload | `evidence.schemas.ts` | CID + mime validation |
| 5 | Treasury / vault ops | `treasury.schemas.ts` | Highest financial risk — do last, most test coverage |
| 6 | Notification preferences | `NotificationPreferencesSchema` | Frontend-only today |

**Promotion milestone:** extract `frontend/src/lib/domain-schemas/` to
`packages/domain-schemas` (`@eziagric/domain-schemas`) once the remaining
forms have shipped through the shared-schema model. See
[Promotion milestone status](#promotion-milestone-status) and the
[extraction plan](#extraction-plan-execute-once-the-gate-is-met) below.

## Bundle impact (current)

`createTradeInputSchema` is ~60 lines of zod that the trade-create route already
pulled in transitively. Measured delta on the `/trades/create` route chunk:
negligible (< 1.5 KB min, ~0.5 KB gz) — acceptable.

## Promotion milestone status

The doc previously targeted the extraction at *"after form 3 (driver manifest)"
ships*. **As of 2026-09-27 the milestone has not been reached.** The gate —
*all remaining rollout forms onboarded to the shared-schema model* — is still
open:

| Gate condition | State | Evidence (checked 2026-09-27) |
| --- | --- | --- |
| Driver manifest (order 3) migrated | ❌ Not done | `ManifestSchema` still lives in the legacy `frontend/src/lib/validation/schemas.ts`; no `driver-manifest.ts` under `frontend/src/lib/domain-schemas/`, no backend counterpart, not registered in `PAIRS` |
| Evidence upload (order 4) migrated | ❌ Not done | Evidence fields remain ad-hoc (`evidenceCids` inside `DisputeSchema`; backend-only `backend/src/schemas/evidence.schemas.ts`); no evidence pair in `PAIRS` |
| Treasury / vault ops (order 5) migrated | ❌ Not done | `treasury.schemas.ts` exists backend-only; no frontend counterpart or `PAIRS` entry |
| Notification preferences (order 6) migrated | ❌ Not done | `NotificationPreferencesSchema` is frontend-only in the legacy validation module |
| Workspace prerequisites in place | ❌ Not done | No `pnpm-workspace.yaml`, no `packages/` directory, backend `tsconfig` still uses `rootDir: src`, `next.config` has no `transpilePackages` |

`scripts/check-schema-parity.mjs` still guards exactly **one** pair (trade),
which is the quickest observable signal that only rollout order 1 is complete.

Do **not** delete the mirror file or the parity script before every gate row
above is ✅ — until then the mirror + CI diff remains the drift guard. When the
gate is met, execute the plan below and update this section to record the
promotion date and bundle measurement.

## Extraction plan (execute once the gate is met)

Concrete steps, ordered, roughly one reviewable PR each:

1. **Create the workspace.** Add `pnpm-workspace.yaml` at the repo root with
   `packages/*`, `frontend`, `backend`, and re-lock (`pnpm install`) so the
   single lockfile covers all four. Root `package.json` already pins
   `packageManager: pnpm@10`.
2. **Create the package.** Move `frontend/src/lib/domain-schemas/` to
   `packages/domain-schemas/src/` verbatim (framework-free zod, no change to
   schema code) and add `packages/domain-schemas/package.json`:

   ```json
   {
     "name": "@eziagric/domain-schemas",
     "version": "0.1.0",
     "private": true,
     "type": "module",
     "main": "./src/index.ts",
     "types": "./src/index.ts",
     "dependencies": { "zod": "3.25.76" }
   }
   ```

   Pin zod to the exact version both apps already use so the two installed
   copies cannot diverge.
3. **Wire the frontend (Next.js).** In `frontend/package.json` add
   `"@eziagric/domain-schemas": "workspace:*"`; in `next.config` add
   `transpilePackages: ["@eziagric/domain-schemas"]`; in `frontend/tsconfig.json`
   add paths (keeps `rootDir`-style compile targets working during the switch):

   ```json
   {
     "compilerOptions": {
       "baseUrl": ".",
       "paths": { "@eziagric/domain-schemas": ["../packages/domain-schemas/src/index.ts"] }
     }
   }
   ```

   Rewrite `frontend/src/lib/domain-schemas` imports to the package specifier
   (a one-line re-export shim at the old path keeps any missed import alive
   during review, then delete the shim in a follow-up commit).
4. **Wire the backend.** Add the same `workspace:*` dependency. The backend
   builds with `tsc` and `rootDir: src`, so either (a) lift the constraint to
   allow out-of-root sources, or (b) compile the package separately and consume
   its `dist/` via the `main`/`types` fields. Option (a) is preferred: set
   `rootDir: ".."`, add `include: ["src/**/*", "../packages/domain-schemas/src/**/*"]`,
   and emit under `dist/backend` so `main`/`start` paths stay consistent. Route
   validators then import `createTradeSchema`'s input schema from the package
   and keep backend-only refinements layered with `.superRefine`.
5. **Relocate the tests.** Move `frontend/src/lib/domain-schemas/__tests__/parity.test.ts`
   into the package and keep it in the frontend Jest run initially (simplest);
   once the backend test runner is pointed at the package, it covers both
   consumers from one suite.
6. **Delete the drift guards.** Remove `backend/src/schemas/domain/trade.ts`
   (the mirror) and `scripts/check-schema-parity.mjs` plus its CI invocation,
   then remove the mirror row from the table at the top of this doc.
7. **Verify.** `pnpm -r build && pnpm -r test`, run the parity fuzz suite, and
   re-measure the `/trades/create` route chunk — record the bundle delta in the
   [Bundle impact](#bundle-impact-current) section. Track bundle impact at
   promotion; today the shared schema adds ~1.2 KB min+gz to the frontend (zod
   is already bundled).

### Rollback

Every step is additive until step 6. If the workspace switch breaks a consumer,
revert that PR: the mirror file and parity script are untouched until the final
step, so reverting restores the exact pre-promotion drift guard.
