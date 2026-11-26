# OpenAPI coverage audit: user route group

Scope: every route served under `/users` (and the user-owned notification
preference routes), compared against `backend/src/docs/openapi.yaml`, which is
the spec the drift test (`backend/src/__tests__/openapi.drift.test.ts`) checks.

## Routes found

| Method | Path | Source | Documented before | Documented after |
|---|---|---|---|---|
| GET | `/users/me` | `user.routes.ts` | yes | yes |
| PUT | `/users/me` | `user.routes.ts` | yes | yes |
| DELETE | `/users/me` | `privacy.routes.ts` | **no** | yes |
| GET | `/users/me/export` | `privacy.routes.ts` | **no** | yes |
| GET | `/users/me/reputation` | `reputation.routes.ts` | **no** | yes |
| GET | `/users/:address` | `user.routes.ts` | yes | yes |
| GET | `/users/:address/reputation` | `reputation.routes.ts` | **no** | yes |
| GET | `/notifications/preferences` | `notifications.preferences.routes.ts` | **no** | yes |
| PUT | `/notifications/preferences` | `notifications.preferences.routes.ts` | **no** | yes |
| PUT | `/notifications/sms-settings` | `notifications.preferences.routes.ts` | **no** | yes |

Mount note: `publicApi.router.ts` mounts `user.routes` and `reputation.routes`
at `/users`, `privacy.routes` at root, and the preference routes at root. All of
them are also mounted under `/api/v1`. The spec's `servers` entries cover both.

## Gaps found (ranked by impact)

1. **DELETE /users/me is undocumented.** It erases the caller's data with no
   confirmation step. Clients and reviewers cannot see it in the spec. Fixed:
   documented as irreversible, with 401, 404, and 500 responses.
2. **Notification preferences (GET/PUT) and SMS settings (PUT) are undocumented.**
   These are the paths the issue flagged. They are mounted at root, not under
   `/users`, so they are easy to miss in a `/users` review. Fixed: documented,
   with the request schema (channel enum, max 4 channels per event, E.164 phone
   pattern) and the merge semantics of PUT preferences.
3. **GET /users/me/export is undocumented.** It returns the caller's stored data,
   including trades. Fixed: documented, with the response shape left open.
4. **Reputation routes are undocumented** (`/users/me/reputation`,
   `/users/:address/reputation`). Fixed: documented with a
   `UserReputationResponse` schema taken from `ReputationService`.
5. **Drift-test list out of sync.** `IMPLEMENTED_ROUTES` in the drift test had to
   gain the five new paths, or the "every spec path is implemented" check fails.
   Fixed.

## Known gaps not fixed here (out of scope or needing a decision)

- **`/notifications` (in-app list), `/notifications/:id/read`, and
  `/notifications/read-all`** are mounted by `notifications.inapp.routes.ts` and
  are not in the spec. They are user-owned, but outside the `/users` group.
  Recommend a separate issue.
- **`backend/src/docs/openapi.json` is stale.** It has 50 paths against roughly
  70 in the YAML. It does have `GET`/`PUT /users/me`, but none of the new paths
  above. The drift test only reads the YAML. Decide whether `.json` is a
  generated artifact or a leftover before editing it.
- **PUT /users/me schema is looser than the validator.** `UpdateProfileRequest`
  omits the `displayName` regex (`^[a-zA-Z0-9 _-]+$`) and the `minLength`
  semantics are described only partly. The 400 is documented as
  `LegacyValidationError`, but the service throws `VALIDATION_ERROR`. Doc-only
  drift; not changed.
- **GET /users/{address}** does not document 400. The handler has an empty-address
  branch, but Express routing means it cannot be reached through this path.
  Low impact.
- **Rate limiting** is not described for any user route. `user.routes` applies
  the wallet limiter to everything under `/users`, which includes reputation and
  export. The preference routes at root do not show a limiter in this router.
  Confirm before documenting.
- **The YAML was not parsed by a tool in this change.** No YAML parser is
  installed in the backend and the test suite was not run, per the task. Indentation
  was checked by reading. Run `openapi.drift.test.ts` before merging.
