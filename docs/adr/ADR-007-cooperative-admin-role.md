# ADR-007: Cooperative-Admin Role

## Status

Accepted (implemented in `backend/src/lib/cooperativeAccess.ts`,
`GET /cooperatives/:id/trades` in `backend/src/routes/cooperative.routes.ts`,
scoped listing in `TradeService.listCooperativeTrades`).

## Context

The permission model has exactly one tier: the `ADMIN_STELLAR_PUBKEYS`
allowlist, enforced by `adminMiddleware` (`backend/src/middleware/admin.middleware.ts`)
and mirrored inline via `getAdminAllowlistLowercase()` in trade controllers
and services. A cooperative admin needs to *see* every trade of their
cooperative's member wallets for reporting and support — but must not gain
global powers (release funds, batch-update statuses, manage streams), and
must not see other cooperatives' trades.

## Decision

**A scoped, read-only role distinct from global admin:**

- **Membership, not rank:** `isCooperativeAdmin(coopId, address)` checks the
  `COOPERATIVE_ADMINS` allowlist for that cooperative only
  (`backend/src/lib/cooperativeAccess.ts`). `canViewCooperativeTrades`
  grants access to a cooperative-admin of *that* cooperative, or to a global
  admin (superset) — never to admins of other cooperatives.
- **Read-only by construction:** the role exists on exactly one endpoint,
  `GET /cooperatives/:id/trades`, which only lists trades where buyer or
  seller is a member wallet. There is no mutation path: `releaseFunds`
  still requires buyer-or-global-admin (`isBuyerOrAdmin`), and all
  `/api/admin/*` routes still require `adminMiddleware`. A cooperative-admin
  who is not a trade party cannot release, dispute, or rotate keys on it.
- **No token change:** the JWT carries no role claim; the role is resolved
  per request from the caller's address, so granting/revoking is an env
  edit (later a `CooperativeMember.role` update per ADR-006) with no
  re-issuance or version bump.

## Consequences

- **Positive:** Least privilege — a compromised cooperative-admin token
  leaks one cooperative's trade list, not funds or other cooperatives.
- **Positive:** Global admins keep full visibility with no extra work, and
  existing `adminMiddleware` behavior is untouched.
- **Negative:** Two allowlists to maintain during the pilot
  (`ADMIN_STELLAR_PUBKEYS` + `COOPERATIVE_ADMINS`); a misconfigured entry
  fails closed (403), which is safe but can look like a broken dashboard
  to the cooperative until ops checks the mapping.
- **Negative:** Frontend has no cooperative-admin gate (membership is not
  exposed client-side); the UI relies on the backend 403. A dedicated
  cooperative dashboard is future work.
