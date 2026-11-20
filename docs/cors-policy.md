# Backend CORS Policy

This document defines the Cross-Origin Resource Sharing (CORS) policy for the
Amana backend API (`backend/`). It is the reference for which browser origins
may call the API, how preflight requests are answered, and how to add a new
client. The implementation lives in `backend/src/app.ts`
(`buildCorsOptions()`), with the allowlist supplied by the `CORS_ORIGINS`
environment variable (`backend/src/config/env.ts`).

CORS is a **browser-enforced** control, not authentication. Non-browser clients
(server jobs, `curl`, native mobile apps) can send requests regardless of the
allowlist. Every route must still authenticate and authorize on its own; see
[`threat-model.md`](./threat-model.md).

---

## 1. Configuration

| Item | Value |
| --- | --- |
| Environment variable | `CORS_ORIGINS` |
| Format | Comma-separated list of exact origins, e.g. `https://app.amana.com,https://staging.amana.com` |
| Parsing | Split on `,`, trimmed, empty entries dropped |
| Default | Empty string (`CORS_ORIGINS=`) |
| Read at | `createApp()` call time — a restart/redeploy is required after changing it |
| Code | `backend/src/app.ts` → `buildCorsOptions()` |

There is no hardcoded production origin list. The deployed allowlist is
whatever `CORS_ORIGINS` contains in that environment:

| Environment | File | Example value |
| --- | --- | --- |
| Local development | `backend/.env` (from `.env.example`) | `CORS_ORIGINS=` (empty) |
| Staging | `backend/.env.staging.example` | `https://staging.amana.com` |
| Production | `backend/.env.production.example` | `https://app.amana.com` |

### Allowed origins

- **Production:** explicit, reviewed origins only. Production deployments must
  set `CORS_ORIGINS` to the public web client origins (for example
  `https://app.amana.com`). Never leave it empty in production: an empty value
  activates the permissive development mode described below.
- **Staging:** staging web client origins (for example
  `https://staging.amana.com`).
- **Local development:** an empty `CORS_ORIGINS` is intentional. It reflects
  the requesting `Origin` back in `Access-Control-Allow-Origin` and allows any
  origin, which keeps `http://localhost:3000` (Next.js dev server) working.
  Do not use an empty value outside local development.
- **Server-to-server and native clients:** requests without an `Origin` header
  are always allowed. React Native/Expo requests normally omit `Origin` and are
  therefore unaffected by the browser allowlist.

Origins are matched with **exact string equality** against the value the browser
sends. Wildcards (`*`), subdomain patterns, regular expressions, and path
prefixes are not supported. Each scheme/host/port combination that needs access
must be listed explicitly.

---

## 2. Response behaviour

### Simple (non-preflight) requests

| Condition | `Access-Control-Allow-Origin` | Request reaches routes |
| --- | --- | --- |
| No `Origin` header | Not set | Yes |
| Origin in `CORS_ORIGINS` | Echoes the request origin (never `*`) | Yes |
| Origin not in `CORS_ORIGINS` | Not set | Rejected by the CORS middleware with an error |

`Access-Control-Allow-Credentials: true` is always sent, because the API accepts
cookie/bearer credentials. The CORS middleware also emits `Vary: Origin` so
shared caches do not serve one origin's response to another.

When `CORS_ORIGINS` is empty (development mode), the middleware uses
`origin: true`, which reflects every requesting origin. This is the only mode
that allows arbitrary origins, and it is why an empty value is unsafe in
production.

### Preflight (`OPTIONS`) requests

The `cors` middleware answers preflight requests before routing, body parsing,
and authentication:

- A preflight from an allowed origin is short-circuited with **`204 No Content`**
  and the headers browsers need: `Access-Control-Allow-Origin` (the request
  origin), `Access-Control-Allow-Credentials: true`, the allowed methods, and
  the requested headers echoed from `Access-Control-Request-Headers`.
- Allowed methods are the package defaults:
  `GET, HEAD, PUT, PATCH, POST, DELETE`. `OPTIONS` is handled by the middleware
  itself.
- No `Access-Control-Max-Age` is configured, so browsers use their own default
  preflight cache lifetime.
- A request from a **non-allowlisted** origin fails the allowlist callback. The
  error (`CORS: origin '<origin>' not allowed`) reaches the error handler and is
  returned as an error response without `Access-Control-Allow-Origin`, so the
  browser blocks the caller from reading it.

The behaviour is covered by `backend/src/__tests__/http.hardening.test.ts`
("CORS allowlist").

---

## 3. Adding a new client

Use this checklist when a new web client (another domain, a partner dashboard,
a new environment) needs to call the API.

1. **Confirm the exact origin.** It must be the serialized origin the browser
   sends: `https://host` or `https://host:port`, with no trailing slash, path,
   query, or wildcard. Note that `http://` and `https://` are different
   origins.
2. **Add it to `CORS_ORIGINS` in the target environment's configuration**, as a
   comma-separated entry. Do not commit a hardcoded origin into application
   code and do not use `*`.
   ```dotenv
   CORS_ORIGINS=https://app.amana.com,https://partner.amana.com
   ```
3. **Update the environment example** (`backend/.env.staging.example` or
   `backend/.env.production.example`) if the new origin represents a
   permanently supported client, so the documented policy stays accurate.
4. **Redeploy or restart the backend.** The allowlist is parsed when
   `createApp()` runs; live config changes are not picked up without a restart.
5. **Verify the preflight** from the new origin:
   ```bash
   curl -i -X OPTIONS https://api.amana.com/api/v1/trades \
     -H 'Origin: https://partner.amana.com' \
     -H 'Access-Control-Request-Method: POST' \
     -H 'Access-Control-Request-Headers: content-type,authorization'
   ```
   Expect `204` and `Access-Control-Allow-Origin: https://partner.amana.com`.
6. **Rollback** by removing the origin from `CORS_ORIGINS` and redeploying;
   no code change or migration is involved.

Because the allowlist is data in the deployment environment, adding or removing
a client is an operational configuration change — it requires the same review
as any other production config change, but no backend release.

---

## 4. Related documentation

- [Threat model](./threat-model.md) — CORS is listed in the §4 Security
  Controls Summary and is not a substitute for route-level authorization.
- [Backend reliability layer](./backend.md) — validation and error handling.
- [API versioning](./api-versioning.md) — versioned and legacy API lanes.
