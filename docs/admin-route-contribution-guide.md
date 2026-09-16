# Admin Route Contribution Guide

This guide covers everything a developer needs to know to add or modify admin
routes in the EliteWork backend.

## Directory and module structure

Admin routes live in `backend/src/routes/admin.*.routes.ts`:

```
backend/src/routes/
  admin.auth.routes.ts          # GET /api/admin/auth/claims, POST /api/admin/sessions/revoke
  admin.audit.routes.ts         # GET /admin/audit
  admin.contract.routes.ts      # POST/DELETE /admin/contract/mediators, PATCH /admin/contract/fee
  admin.features.routes.ts      # GET /admin/features, PATCH /admin/features/:name
  admin.streams.routes.ts       # /api/admin/streams/* (list, clawback, suspend, terminate, etc.)
  admin.trades.batch.routes.ts  # POST /api/admin/trades/batch/status
```

Supporting code:

- **Middleware**: `src/middleware/admin.middleware.ts`, `auth.middleware.ts`, `adminFeatureGate.middleware.ts`, `adminQuota.middleware.ts`, `adminTimeout.middleware.ts`
- **Services**: `src/services/adminStreams.service.ts`, `adminAudit.service.ts`, `adminNotification.service.ts`, `contract.service.ts`
- **Errors**: `src/errors/adminSubmissionError.ts`
- **OpenAPI**: `src/docs/openapi.yaml`

## Authentication and authorization middleware

Every admin route must stack these middleware in order:

```typescript
router.get(
  "/admin/example",
  authMiddleware,        // 1. JWT validation — returns 401 on invalid/expired token
  adminMiddleware,       // 2. Wallet allowlist — returns 403 if not in ADMIN_STELLAR_PUBKEYS
  adminRateLimit,        // 3. Per-identity rate limit
  handler,               // 4. Route handler
);
```

### authMiddleware (`src/middleware/auth.middleware.ts`)

- Calls `AuthHelper.authenticateRequest()` which verifies the JWT signature,
  checks expiry, and decodes the token.
- On success, attaches `req.user` with `{ walletAddress, jti, exp, iat, ... }`.
- On failure, returns `401 Unauthorized`.

### adminMiddleware (`src/middleware/admin.middleware.ts`)

- Reads `req.user.walletAddress` and checks it against `ADMIN_STELLAR_PUBKEYS`
  via `isMediatorAddress()` from `src/lib/accessControl.ts`.
- If not on the allowlist → `403 Forbidden: admin access required`.
- Also checks token freshness (`exp`) and revocation (`jti` via `AuthService.isTokenRevoked()`).
- On success, sets `req.user.isAdmin = true` and annotates the OpenTelemetry span.

### adminFeatureGate (`src/middleware/adminFeatureGate.middleware.ts`)

- Applied at the router mount level in `app.ts` (not per-route).
- Returns `404` when `ADMIN_ROUTES_ENABLED` is not `"true"`.
- All admin routers are mounted through this gate in `app.ts`:

```typescript
app.use(adminFeatureGate, createAdminFeaturesRouter());
```

### adminQuota (`src/middleware/adminQuota.middleware.ts`)

- Per-operation in-memory fixed-window counters.
- Applied selectively to expensive operations (batch trades, treasury withdrawals).

### adminTimeout (`src/middleware/adminTimeout.middleware.ts`)

- Hard wall-clock timeout (default `ADMIN_ROUTE_TIMEOUT_MS = 15000`).
- Returns `504` if the timeout elapses.

## How admin routes are registered

All admin routes are registered in `backend/src/app.ts`:

```typescript
import { adminFeatureGate } from "./middleware/adminFeatureGate.middleware";
import { createAdminFeaturesRouter } from "./routes/admin.features.routes";
import { createAdminAuthRouter } from "./routes/admin.auth.routes";
// ... other imports

// Feature flags (admin-managed) — gated by ADMIN_ROUTES_ENABLED
app.use(adminFeatureGate, createAdminFeaturesRouter());

// Admin action audit history
app.use(adminFeatureGate, createAdminAuditRouter());

// Admin contract maintenance/governance
app.use(adminFeatureGate, createAdminContractRouter());

// Admin auth diagnostics
app.use(adminFeatureGate, createAdminAuthRouter());

// Admin trade batch operations
app.use(adminFeatureGate, createAdminTradeBatchRouter());

// Admin stream management
app.use("/api", adminFeatureGate, createAdminStreamsRouter());
```

Note: `admin.streams.routes.ts` is mounted with the `/api` prefix because its
route definitions include the full `/api/admin/streams` path.

## OpenAPI documentation

The OpenAPI spec lives at `backend/src/docs/openapi.yaml`. Every admin endpoint
must have an entry under the `paths` section with:

- `tags: ["Admin"]`
- `security: [{ BearerAuth: [] }]`
- A description of the request/response schema

The backend writes `openapi.json` from the YAML spec in non-production runs so
reviewers can inspect either format. Dev Swagger UI is available at
`http://localhost:4000/api/docs`.

## Required tests for admin route changes

All admin route changes must include tests. The test file pattern is:

```
backend/src/__tests__/admin.<feature>.test.ts
```

### Test conventions

1. **Mock `auth.service`** to decode JWTs without external dependencies:

```typescript
jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      const jwt = require("jsonwebtoken");
      return jwt.decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));
```

2. **Use `StellarSdk.Keypair.random().publicKey()`** for test admin addresses.

3. **Set `process.env.ADMIN_STELLAR_PUBKEYS`** in `beforeAll`.

4. **Test both auth and non-auth paths**:
   - Unauthenticated requests → `401`
   - Non-admin wallets → `403`
   - Admin wallets → success

5. **CI regression suite**: The dedicated test file
   `src/__tests__/admin.auth.ci-regression.test.ts` covers core auth middleware
   behavior. Run it with:

```bash
npx jest --config jest.config.js --forceExit --detectOpenHandles --testPathPatterns='admin\.auth\.ci-regression' --verbose
```

### Authentication/authorization test expectations

Every admin endpoint test must cover:

| Scenario | Expected Status |
|----------|----------------|
| No token | 401 |
| Malformed token | 401 |
| Expired token | 401 |
| Valid token, non-admin wallet | 403 |
| Valid token, admin wallet | 200 (or appropriate success code) |
| Revoked session | 401 |

## Running test suites locally

```bash
# Run all backend tests
cd backend && npm test

# Run admin auth regression suite only
cd backend && npx jest --config jest.config.js --forceExit --detectOpenHandles --testPathPatterns='admin\.auth\.ci-regression' --verbose

# Run a specific admin test file
cd backend && npx jest --config jest.config.js --forceExit --detectOpenHandles --testPathPattern='admin.features.routes' --verbose
```

## How to add a new admin endpoint (example)

This example adds a hypothetical `POST /admin/streams/:id/approve` endpoint.

### 1. Create the route

Create or extend `backend/src/routes/admin.streams.routes.ts`:

```typescript
import { authMiddleware } from "../middleware/auth.middleware";
import { adminMiddleware } from "../middleware/admin.middleware";
import { createWalletRateLimiter } from "../lib/rateLimit";
import { RATE_LIMIT_CONFIG } from "../config/rateLimit";

const adminRateLimit = createWalletRateLimiter(RATE_LIMIT_CONFIG.admin);

// Inside createAdminStreamsRouter():
router.post(
  "/api/admin/streams/:id/approve",
  authMiddleware,
  adminMiddleware,
  adminRateLimit,
  validateRequest({ params: streamIdParamSchema }),
  async (req: AuthRequest, res: Response, next) => {
    try {
      const { id: streamId } = req.params as { id: string };
      const result = await adminStreamsService.approveStream(streamId, req.user!.walletAddress);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  },
);
```

### 2. Implement the service method

In `backend/src/services/adminStreams.service.ts`:

```typescript
async approveStream(streamId: string, adminAddress: string): Promise<ApproveResult> {
  const stream = await this.getStreamOrThrow(streamId);
  // ... business logic ...
  return { streamId, status: "approved" };
}
```

### 3. Update the router factory

If the route is in a new file, export a factory function:

```typescript
export function createAdminStreamApprovalRouter(): Router {
  const router = Router();
  // ... routes ...
  return router;
}
```

### 4. Register in app.ts

```typescript
import { createAdminStreamApprovalRouter } from "./routes/admin.streams.routes";
app.use(adminFeatureGate, createAdminStreamApprovalRouter());
```

### 5. Add tests

Create `backend/src/__tests__/admin.streams.approve.test.ts`:

```typescript
import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import * as StellarSdk from "@stellar/stellar-sdk";
import { createAdminStreamApprovalRouter } from "../routes/admin.streams.routes";
import { errorHandler } from "../middleware/errorHandler";

jest.mock("../services/auth.service", () => ({
  AuthService: {
    validateToken: jest.fn(async (token: string) => {
      return require("jsonwebtoken").decode(token);
    }),
    isTokenRevoked: jest.fn().mockResolvedValue(false),
  },
}));

const adminAddress = StellarSdk.Keypair.random().publicKey();
const outsiderAddress = StellarSdk.Keypair.random().publicKey();

function signToken(wallet: string): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { walletAddress: wallet, jti: "test", iss: "amana", aud: "amana-api", iat: now, exp: now + 3600 },
    process.env.JWT_SECRET || "test-secret-at-least-32-characters-long",
    { algorithm: "HS256" },
  );
}

beforeAll(() => { process.env.ADMIN_STELLAR_PUBKEYS = adminAddress; });

describe("POST /admin/streams/:id/approve", () => {
  it("returns 401 when unauthenticated", async () => { /* ... */ });
  it("returns 403 for non-admin", async () => { /* ... */ });
  it("returns 200 for admin", async () => { /* ... */ });
});
```

### 6. Update OpenAPI

Add the endpoint to `backend/src/docs/openapi.yaml`:

```yaml
paths:
  /admin/streams/{id}/approve:
    post:
      tags:
        - Admin
      summary: Approve a stream
      security:
        - BearerAuth: []
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        '200':
          description: Stream approved
        '401':
          $ref: '#/components/responses/Unauthorized'
        '403':
          $ref: '#/components/responses/Forbidden'
```

### 7. Commit and verify

```bash
# Run the specific test
npx jest --config jest.config.js --forceExit --detectOpenHandles --testPathPattern='admin.streams.approve' --verbose

# Run admin auth regression suite
npx jest --config jest.config.js --forceExit --detectOpenHandles --testPathPatterns='admin\.auth\.ci-regression' --verbose

# Run full backend tests
npm test
```

## Key environment variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `ADMIN_ROUTES_ENABLED` | Feature gate for all admin routes | `"false"` |
| `ADMIN_STELLAR_PUBKEYS` | Comma-separated allowlist of admin wallet addresses | `""` |
| `ADMIN_SECRET_KEY` | Stellar Soroban signing key for admin operations | required |
| `ADMIN_ROUTE_TIMEOUT_MS` | Hard timeout for admin Soroban operations | `15000` |
| `ADMIN_QUOTA_CLAWBACK_WINDOW_MS` | Rate limit window for clawback operations | `3600000` |
| `ADMIN_QUOTA_CLAWBACK_MAX` | Max clawback operations per window | `10` |

## Security checklist

- [ ] Never hard-code `ADMIN_SECRET_KEY` in source, tests, or documentation
- [ ] Never log `ADMIN_SECRET_KEY` or wallet addresses in production logs
- [ ] All admin routes go through `authMiddleware` + `adminMiddleware`
- [ ] Error responses do not leak the admin allowlist
- [ ] Tests use `test-admin-secret-key-value` as the `ADMIN_SECRET_KEY` placeholder
- [ ] OpenTelemetry spans are annotated with `admin.verdict` for auditing
