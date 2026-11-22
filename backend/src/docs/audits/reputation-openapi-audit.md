# OpenAPI coverage audit: reputation route group

Scope: `backend/src/routes/reputation.routes.ts`, mounted in `backend/src/routes/publicApi.router.ts` at `/users` (served on both `/api/v1` and the legacy `/` lane). Spec: `backend/src/docs/openapi.yaml` and `openapi.json` (kept in sync by `openapi.docs.test.ts`).

## Routes in scope

| Method | Path (as mounted) | Auth | Documented before this audit |
|---|---|---|---|
| GET | `/users/me/reputation` | Bearer (`authMiddleware`) | No |
| GET | `/users/:address/reputation` | None (public) | No |

## Gaps found

1. **`GET /users/me/reputation` missing from the spec.** Fixed: path added with 200/401/500.
2. **`GET /users/{address}/reputation` missing from the spec.** Fixed: path added with 200/400/500.
3. **Response schemas undocumented.** `ReputationResponse` and `ReputationEvent` (types in `reputation.service.ts`) added to `components/schemas`, including the `type` enum and `history` capped at 20 items.
4. **Drift test route list not updated.** `IMPLEMENTED_ROUTES` in `openapi.drift.test.ts` is hand-maintained; both paths added so the spec and implemented-route checks stay green.
5. **Open: 401 body shape.** The spec's `UnauthorizedError` points to `ErrorEnvelope` (`{ error }`). The route throws `AppError`, which the spec's own description says returns `{ code, message, details }`. The 401 entry may document the wrong body. Not changed here; needs a check against the real response.
6. **Open: unreachable 400 branch.** The `/:address/reputation` handler's empty-address check and `Array.isArray` branch are effectively dead under Express param routing. The 400 is documented anyway as defensive. Could be removed from both code and spec.
7. **Open: no address validation.** The route passes any string to `getUserReputation`, which lowercases it and queries. Stellar key format is not checked, so malformed addresses return a zeroed 200 instead of 400. Behaviour is documented as-is; validation is a code change, out of scope.
8. **Open: unknown address returns 200.** No 404 path exists. An address with no trades gets `trustScore: 50` and `successRate: 100`. Documented as 200 only, which matches the code.

## Not changed

- No route code, service code, or runtime behaviour changed.
- Gaps 5–8 are behavioural or need a runtime check, so they are listed, not fixed.
