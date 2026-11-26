# OpenAPI coverage audit: evidence route group

Issue: Elite-Work/EliteWork#417
Scope: `backend/src/routes/evidence.routes.ts` and the evidence list route in
`backend/src/routes/trade.evidence.routes.ts`, compared against
`backend/src/docs/openapi.yaml`, `backend/src/docs/openapi.json` and
`docs/api/evidence.md`.

## Summary

All three served evidence endpoints have a path entry in the spec:

| Method | Path | In `openapi.yaml` | In `openapi.json` |
|---|---|---|---|
| GET | `/trades/{id}/evidence` | yes | yes |
| GET | `/evidence/{cid}/stream` | yes | yes |
| POST | `/evidence/video` | yes | yes |

So there is no missing path. The gaps are in what each entry says: the response
schema for the list endpoint is wrong, and several documented-in-code error
responses are missing. One gap is a security issue, not a doc issue (see G1).

Ranked by impact.

## Gaps

### G1. `GET /evidence/{cid}/stream` has no ownership check (security, not docs)

`evidence.routes.ts` only checks that the caller is authenticated. The handler
calls `evidenceService.streamFromIPFS(cid, range)`, which takes no caller or
trade argument. Any authenticated wallet that knows or obtains a CID can stream
the file, including a dispute video from a trade it is not a party to.
The spec has no `403` for this route because the code never produces one.
Fix needs a design decision (map CID to trade and check party or admin, as the
list endpoint does). Not fixed in this PR.

### G2. `GET /trades/{id}/evidence` documents the wrong response schema

- Spec: `200` → `EvidenceListResponse` = `{ evidence: [...] }`
  (`openapi.yaml` ~L1082).
- Served: `{ items: [...], pagination: { page, limit, total, totalPages } }`
  (`trade.evidence.service.ts` `paginationResponse`), which matches
  `docs/api/evidence.md`.
- `openapi.drift.test.ts` (~L385-392) asserts the wrong `$ref`. Correcting the
  spec requires changing that assertion too. Not done here, since this PR does
  not change tests.

### G3. `GET /trades/{id}/evidence` query parameters are not documented

`disputeEvidenceQuerySchema` accepts `type` (`video` | `manifest`), `page`
(default 1, min 1) and `limit` (default 20, 1-100). The spec lists only
`TradeIdPath`. Invalid values return `400` in code, which is also not documented
on this route's params.

### G4. `GET /trades/{id}/evidence` `409` is missing from the spec

`TradeNotDisputedError` → `409` (`trade.evidence.routes.ts`). It is documented in
`docs/api/evidence.md` but not in `openapi.yaml`.

### G5. The served list route is shadowed by a second handler

`publicApi.router.ts:80` mounts `createTradeEvidenceRouter()` on `/trades`
before `createEvidenceRouter()` at `:93`. The `GET /trades/:id/evidence` handler
in `evidence.routes.ts` (which returns `{ evidence }`) is never reached over HTTP.
This is why the spec's `EvidenceListResponse` is wrong and nothing failed.
Recommend removing the dead handler and its tests, in a separate PR.

### G6. `POST /evidence/video` is missing `429`

`evidenceUploadLimiter` (`config/rateLimit.ts`: 20 uploads per hour per wallet)
returns `429`. Not in the spec, not in `docs/api/evidence.md`.

### G7. `POST /evidence/video` is missing `409` for idempotency

`idempotencyMiddleware` returns `409` for a key that is in progress or reused
with a different body (`middleware/idempotency.ts` ~L98, ~L129). The spec only
says "supports optional `Idempotency-Key`".

### G8. `POST /evidence/video` `503` is missing from the spec

`EvidenceScanError` has `status = 503` (`evidence.service.ts` L32-38) and is
returned when `EVIDENCE_SCAN_REQUIRED=true` and the scanner is unavailable. The
spec's `400` `oneOf` does not cover it. `docs/api/evidence.md` does list `503`.

### G9. `GET /evidence/{cid}/stream` does not document the `Range` request header

The description mentions the inbound `Range` header, but it is not a declared
parameter. A `206` is documented but has no example for the request that
produces it.

### G10. No `500` response on any evidence path

Other paths in the spec use `$ref: "#/components/responses/InternalError"`. None
of the three evidence paths do.

### G11. `openapi.json` was not checked against `openapi.yaml`

Both files contain the same three paths, but I did not diff their contents.
Whether they are generated from one another is not verified.

## Not gaps

- `401` is documented on all three routes.
- `413` and `415` on the upload route match the handler.
- `502` on the stream route matches the handler.
- Tag `Evidence` is defined and used.

## Suggested follow-up order

1. G1 (security): decide the authorization rule for stream, then add the check and the `403`.
2. G5: remove the shadowed handler and its tests.
3. G2 + drift test: correct the list schema in the spec and update the assertion together.
4. G3, G4, G6-G10: spec-only additions, low risk.
