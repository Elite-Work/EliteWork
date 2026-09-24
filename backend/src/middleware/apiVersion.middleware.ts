import { NextFunction, Request, Response } from "express";

/** The current public API major version (matches the /api/vN mount). */
export const API_VERSION = "v1";

/** Marker for requests served by the deprecated legacy alias. */
export const LEGACY_PATH_PREFIX = "/api/legacy";

/** HTTP header that advertises the resolved API version of a response. */
export const API_VERSION_HEADER = "X-Api-Version";

/**
 * HTTP header that tells clients this response was served by a deprecated
 * (legacy, unversioned) alias path and will be removed at some point.
 * Per RFC 8594 the value is `true` when deprecated.
 */
export const DEPRECATION_HEADER = "Deprecation";

/** HTTP header carrying the RFC 8594 date (RFC 1123) the alias is removed. */
export const SUNSET_HEADER = "Sunset";

/**
 * The legacy alias base paths served for backwards compatibility while the
 * versioned /api/v1 lane exists. A request whose path begins with one of these
 * (and is not under /api/v1) is served by a deprecated alias and receives
 * deprecation signalling.
 *
 * Consumer-facing route groups only — admin (/admin, /api/admin) and health
 * (/health) routes are internal/infra and are intentionally NOT included so
 * they are never marked deprecated.
 */
export const PUBLIC_API_BASE_PATHS: readonly string[] = [
  "/auth",
  "/wallet",
  "/users",
  "/trades",
  "/goals",
  "/disputes",
  "/dispute-categories",
  "/stellar",
  "/contract",
  "/treasury",
  "/webhooks",
  "/evidence",
];

/** Marker placed on the request so downstream logging can distinguish traffic. */
export interface ApiVersionedRequest {
  /** The resolved API version served ("v1", "/api/legacy", or "unversioned"). */
  apiVersion: string;
}

/**
 * The deprecation/sunset timeline for the legacy alias. When this date passes
 * the alias mount should be removed and v1 becomes the only lane.
 */
export const LEGACY_SUNSET_DATE = "Thu, 01 Jan 2027 00:00:00 GMT";

function isVersionedPath(path: string): boolean {
  const normalized = path.startsWith("/api/") ? path.slice(4) : path;
  return normalized === `/${API_VERSION}` || normalized.startsWith(`/${API_VERSION}/`);
}

function isLegacyPublicPath(path: string): boolean {
  return PUBLIC_API_BASE_PATHS.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );
}

/**
 * Global middleware that records which API version served a request and emits
 * version/deprecation signalling:
 *
 * - `/api/v1/*` -> `X-Api-Version: v1` (current version, no deprecation).
 * - legacy public alias (`/auth`, `/trades`, ...) -> `X-Api-Version: v1` plus
 *   `Deprecation: true` and `Sunset`.
 * - everything else (health, admin) -> unversioned, no version headers.
 *
 * Behaviour is identical on both lanes (parity is guaranteed by construction:
 * they share the same routers).
 */
export function apiVersionMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const path = req.path;

  if (isVersionedPath(path)) {
    (req as unknown as ApiVersionedRequest).apiVersion = API_VERSION;
    res.setHeader(API_VERSION_HEADER, API_VERSION);
    next();
    return;
  }

  if (isLegacyPublicPath(path)) {
    (req as unknown as ApiVersionedRequest).apiVersion = LEGACY_PATH_PREFIX;
    res.setHeader(API_VERSION_HEADER, API_VERSION);
    res.setHeader(DEPRECATION_HEADER, "true");
    res.setHeader(SUNSET_HEADER, LEGACY_SUNSET_DATE);
    next();
    return;
  }

  // Admin / health / unmatched: leave unversioned with no version headers.
  next();
}

/**
 * Read the resolved API version recorded on the request. Returns "v1", the
 * legacy marker, or "unversioned" for non-public requests.
 */
export function apiVersionFrom(req: Request): string {
  return (req as unknown as Partial<ApiVersionedRequest>).apiVersion ??
    "unversioned";
}
