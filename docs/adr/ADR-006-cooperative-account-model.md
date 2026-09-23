# ADR-006: Cooperative Account Model

## Status

Accepted (pilot scope implemented in `backend/src/lib/cooperativeAccess.ts`,
`backend/src/routes/cooperative.routes.ts`, `backend/src/config/env.ts`;
full relational model below is the migration path, not yet applied).

## Context

Trades today are wallet-to-wallet: `Trade.buyerAddress`/`sellerAddress`
reference `User.walletAddress` directly (`backend/prisma/schema.prisma`),
and authentication is a Stellar challenge/response per wallet
(`backend/src/services/auth.service.ts` — `POST /challenge`, client signs
with Freighter, `POST /verify` mints a JWT bound to that single address).
There is no grouping primitive, so a pilot with regional agricultural
cooperatives has no way to report "all trades of Kebbi cooperative" or to
scope an admin to one cooperative's farmers.

Constraints for the pilot:

1. No wallet-auth change — farmers keep signing with their own wallets;
   grouping must be off-chain metadata, never custody or key-sharing.
2. No migration in the pilot PR — onboarding is ops-driven for a handful of
   cooperatives, so an env allowlist is enough to start.
3. The model must still answer `GET /cooperatives/:id/trades` from member
   wallets alone, without touching `Trade`'s existing indexes.

## Decision

**Pilot: env-scoped membership; production: two tables plus one column.**

- **Pilot (shipped):** `COOPERATIVE_ADMINS` and `COOPERATIVE_MEMBERS` env
  vars hold `coop-id:wallet` pairs (`backend/src/config/env.ts`).
  `getCooperativeMembers(coopId)` resolves the wallet set and
  `TradeService.listCooperativeTrades` scopes `Trade` by
  `buyerAddress/sellerAddress IN members` — no schema change, no new
  indexes, existing composite indexes cover the query.
- **Migration path (not yet applied):** add `Cooperative`
  (`id/slug @unique`, `name`, `region`, `cohort`) and `CooperativeMember`
  (`cooperativeId`, `walletAddress` FK to `User`, `role: MEMBER|ADMIN`,
  `@@unique([cooperativeId, walletAddress])`), plus nullable
  `Trade.cooperativeId` FK set at creation for direct attribution. Member
  onboarding then becomes a row insert by ops instead of an env edit, and
  `getCooperativeMembers` reads the table behind the same function
  signature — route and permission code do not change.
- **Wallet-auth interaction:** none. Membership is resolved server-side from
  the JWT's `walletAddress` on each request; the challenge/verify flow,
  token shape, and revocation (`token_version:<addr>`) are untouched. A
  farmer leaving a cooperative loses visibility at the access layer only —
  their trades and keys are unaffected.

## Consequences

- **Positive:** Pilot ships with zero migration risk and zero auth-surface
  change; the route layer is already written against the future table
  shape, so migration is a data-source swap, not a rewrite.
- **Positive:** Per-trade attribution stays opt-in and verifiable
  (caller must belong to the labelled cooperative), so metrics cannot be
  mislabelled by a stray `cooperativeId`.
- **Negative:** Env allowlists do not scale past a handful of cooperatives
  and require a redeploy per membership change — acceptable for the pilot
  cohort, not for general availability.
- **Negative:** Until `Trade.cooperativeId` lands, single-trade creation
  carries no cooperative label; only the bulk-import path is attributed
  (see ADR-009).
