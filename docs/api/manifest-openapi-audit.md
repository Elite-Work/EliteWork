# OpenAPI coverage audit: manifest route group

Issue: Elite-Work/EliteWork#418

Scope: `POST` and `GET /trades/:id/manifest`, served by
`backend/src/routes/trade.manifest.routes.ts` and
`backend/src/routes/manifest.routes.ts`, mounted together in
`backend/src/routes/publicApi.router.ts`. Documented in
`backend/src/docs/openapi.yaml` (the drift tests read this file; `openapi.json`
is not checked by them).

Method: read both routers, the mount order, `ManifestService`, the spec
section for `/trades/{id}/manifest` and its component schemas, and the drift
tests that reference the path. Tests were not run.

## Key finding

Both routers are mounted on the same path, and `trade.manifest.routes.ts` is
mounted first. It answers `GET` and `POST`. So:

- The `POST` body the spec documents (`ManifestRequest`) comes from
  `manifest.routes.ts`, which is never reached over HTTP. The live body is
  different (see gap 1).
- `manifest.routes.ts` only runs if the first router calls `next()`. Its
  `GET` handler is a duplicate of the live one, and its `POST` handler is
  effectively dead code.

`docs/api/manifest.md` (Implementation notes) already records the shadowing,
but the OpenAPI spec was written against the dead router.

## Gaps

Ranked by impact on API consumers.

1. **POST request body is wrong.** The spec's `ManifestRequest` requires
   `driverName`, `driverIdNumber`, `vehicleRegistration`, `routeDescription`,
   `expectedDeliveryAt`. The live handler requires `driverName`, `phone`
   (min 5), `licensePlate`, `vehicleType`, and `estimatedDeliveryWindow`
   `{ from, to }` (`to` must be after `from`). A client generated from the
   spec sends a body that gets a `400`.
2. **POST `201` response is incomplete.** The spec's
   `ManifestSubmissionResponse` has `manifestId` and `unsignedXdr`. The live
   response also returns `ipfsHash`.
3. **POST `503` is not documented.** The handler returns `503` when IPFS is
   unavailable (`ServiceUnavailableError`), and nothing is stored in that
   case. The spec lists 400, 401, 403, 404, 409, 500.
4. **POST `400` is under-specified.** The spec points to
   `LegacyValidationError`, which is a `oneOf` of two envelopes. It does not
   say that field validation returns `{ "error": { <field>: [messages] } }`,
   or that the trade-not-FUNDED case returns `{ "error": "<string>" }`.
   Neither case is described on the operation.
5. **POST ignores the trade-status rule.** Submitting a manifest is only
   allowed when the trade is `FUNDED`. The spec does not say this, so a
   `400` for the wrong status is not explained.
6. **GET `200` `ManifestView` is an unstructured stub.** The schema has
   `tradeId` and `roleView` with `additionalProperties: true`. It does not
   list `driverName`, `driverIdNumber`, `driverNameHash`, `driverIdHash`,
   `vehicleRegistration`, `routeDescription`, `expectedDeliveryAt`,
   `createdAt`, or `retentionExpired`. It also does not say which of these
   appear in each role view (seller, buyer, mediator).
7. **Retention behaviour is not in the spec.** When `retentionExpired` is
   `true`, the seller view returns `"REDACTED"` for `driverName` and
   `driverIdNumber`. The spec does not mention this.
8. **GET `403` description is generic.** The spec uses `ErrorEnvelope` with
   no description. The live message is "Access denied: you are not allowed to
   view this manifest".
9. **Shadowed router is still in the spec's source of truth.** The spec was
   written from the dead `manifest.routes.ts` POST body (gap 1). Nothing in the
   repo links the spec to the live router.
10. **Drift tests miss this.** `openapi.drift.test.ts` checks that the path is
    documented and that the GET `200` refs `ManifestView`. It has no check on
    the POST request body, the POST responses, or the `ManifestView` fields.
    A body mismatch like gap 1 passes today.
11. **`openapi.json` is not covered by the drift tests.** The JSON copy has
    the same manifest operations as the YAML. I did not diff the two files
    field by field, so whether they have drifted from each other is unverified.

## Suggested fixes (not in this change)

- Replace `ManifestRequest` with the live body and add `ipfsHash` to the
  `201` response. Add `503` to POST.
- Describe `ManifestView` per role with a `oneOf`, or one schema per view.
- Add a drift test that compares the spec's POST request schema to the Zod
  `tradeManifestBodySchema` fields. Ideally, delete `manifest.routes.ts` after
  confirming nothing imports it, which removes the dead `POST` and duplicate
  `GET`.
- Regenerate or diff `openapi.json` against `openapi.yaml`.

## Not checked

- Whether `/api/v1/trades/{id}/manifest` is documented separately. The spec
  has a versioned-prefix note, but I did not check its `servers` entries
  against the route mount.
- Whether any client in the repo (frontend or SDK) uses the legacy
  `ManifestRequest` body.
