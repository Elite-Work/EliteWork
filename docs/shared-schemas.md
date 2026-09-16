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

**Promotion milestone (after form 3):** extract
`frontend/src/lib/domain-schemas/` to `packages/domain-schemas`
(`@elitework/domain-schemas`), add `pnpm-workspace.yaml`, wire
`transpilePackages` + tsconfig paths, delete the mirror file and the diff
script. Track bundle impact then; today the shared schema adds ~1.2 KB min+gz
to the frontend (zod is already bundled).

## Bundle impact (current)

`createTradeInputSchema` is ~60 lines of zod that the trade-create route already
pulled in transitively. Measured delta on the `/trades/create` route chunk:
negligible (< 1.5 KB min, ~0.5 KB gz) — acceptable.
