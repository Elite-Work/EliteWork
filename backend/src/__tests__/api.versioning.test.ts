import request from "supertest";
import express from "express";
import { createApp } from "../app";
import {
  apiVersionMiddleware,
  API_VERSION,
  API_VERSION_HEADER,
  DEPRECATION_HEADER,
  LEGACY_PATH_PREFIX,
  SUNSET_HEADER,
  apiVersionFrom,
  PUBLIC_API_BASE_PATHS,
} from "../middleware/apiVersion.middleware";

/**
 * Contract/parity tests locking in the v1 API versioning promise.
 *
 * Guarantees:
 *  1. Parity — the versioned lane `/api/v1/*` and the legacy aliases (`/auth`,
 *     `/trades`, ...) serve IDENTICAL behaviour for the same request, because
 *     they share one router in app.ts.
 *  2. Deprecation signalling — only legacy public responses carry
 *     `Deprecation`/`Sunset`; v1 responses carry `X-Api-Version` and no
 *     deprecation headers.
 *  3. Non-versioned routes (health, admin) receive no version headers.
 */
describe("API Versioning contract", () => {
  let app: express.Application;

  beforeAll(() => {
    app = createApp();
  });

  // Hermetic, definitely-registered public endpoints. All return before any DB
  // or external-network dependency (auth-gated 401 or body validation), so
  // parity is comparable without side effects. Avoids /stellar/fees (live
  // Horizon call) and /treasury (no GET collection route).
  const PUBLIC_CASES: Array<{ method: string; path: string }> = [
    { method: "get", path: "/wallet/balance" },
    { method: "get", path: "/goals" },
    { method: "get", path: "/users/me" },
    { method: "post", path: "/auth/challenge" },
  ];

  it("serves identical behaviour on /api/v1 and legacy aliases (parity)", async () => {
    for (const c of PUBLIC_CASES) {
      const legacy = await (request(app) as any)[c.method](c.path);
      const v1 = await (request(app) as any)[c.method](
        `/api/${API_VERSION}${c.path}`,
      );

      expect(v1.status).toBe(legacy.status);
      expect(v1.status).not.toBe(404); // path must resolve, not 404
      const { timestamp: _v1Timestamp, ...v1Body } = v1.body as Record<string, unknown>;
      const { timestamp: _legacyTimestamp, ...legacyBody } = legacy.body as Record<string, unknown>;
      expect(v1Body).toEqual(legacyBody);
    }
  });

  it("marks legacy public responses with Deprecation + Sunset + X-Api-Version", async () => {
    const res = await request(app).get("/wallet/balance");
    expect(res.headers[API_VERSION_HEADER.toLowerCase()]).toBe(API_VERSION);
    expect(res.headers[DEPRECATION_HEADER.toLowerCase()]).toBe("true");
    expect(res.headers[SUNSET_HEADER.toLowerCase()]).toMatch(
      /\d{1,2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT/,
    );
  });

  it("serves /api/v1 responses with X-Api-Version and NO deprecation headers", async () => {
    const res = await request(app).get(`/api/${API_VERSION}/wallet/balance`);
    expect(res.status).not.toBe(404);
    expect(res.headers[API_VERSION_HEADER.toLowerCase()]).toBe(API_VERSION);
    expect(res.headers[DEPRECATION_HEADER.toLowerCase()]).toBeUndefined();
    expect(res.headers[SUNSET_HEADER.toLowerCase()]).toBeUndefined();
  });

  it("does not signal a version or deprecation on health (infra)", async () => {
    const res = await request(app).get("/health/live");
    expect(res.status).toBe(200);
    expect(res.headers[API_VERSION_HEADER.toLowerCase()]).toBeUndefined();
    expect(res.headers[DEPRECATION_HEADER.toLowerCase()]).toBeUndefined();
  });

  it("does not signal a version or deprecation on admin routes (internal)", async () => {
    const res = await request(app).get("/api/admin/auth/claims").set(
      "Authorization",
      "Bearer invalid-token",
    );
    expect(res.headers[API_VERSION_HEADER.toLowerCase()]).toBeUndefined();
    expect(res.headers[DEPRECATION_HEADER.toLowerCase()]).toBeUndefined();
  });

  it("never marks admin/health paths as deprecated (monitoring split stays clean)", () => {
    expect(PUBLIC_API_BASE_PATHS).toContain("/auth");
    expect(PUBLIC_API_BASE_PATHS).toContain("/trades");
    expect(PUBLIC_API_BASE_PATHS).toContain("/webhooks");
    expect(PUBLIC_API_BASE_PATHS).not.toContain("/admin");
    expect(PUBLIC_API_BASE_PATHS).not.toContain("/api");
    expect(PUBLIC_API_BASE_PATHS).not.toContain("/health");
  });
});

/**
 * Unit tests for the version/deprecation middleware and the marker it leaves
 * for request logging and traffic-share monitoring.
 */
describe("apiVersionMiddleware", () => {
  function run(path: string) {
    const headers: Record<string, string> = {};
    const req = { path, headers: {} } as unknown as express.Request;
    const res = {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
    } as unknown as express.Response;
    let nextCalled = false;
    apiVersionMiddleware(req, res, () => {
      nextCalled = true;
    });
    return { headers, req, nextCalled };
  }

  it("tags a versioned /api/v1 request without deprecation headers", () => {
    const { headers, req } = run(`/api/${API_VERSION}/trades`);
    expect(apiVersionFrom(req)).toBe(API_VERSION);
    expect(headers[API_VERSION_HEADER]).toBe(API_VERSION);
    expect(headers[DEPRECATION_HEADER]).toBeUndefined();
    expect(headers[SUNSET_HEADER]).toBeUndefined();
  });

  it("tags a legacy public request as deprecated with a Sunset date", () => {
    const { headers, req, nextCalled } = run("/trades/123/evidence");
    expect(apiVersionFrom(req)).toBe(LEGACY_PATH_PREFIX);
    expect(headers[API_VERSION_HEADER]).toBe(API_VERSION);
    expect(headers[DEPRECATION_HEADER]).toBe("true");
    expect(headers[SUNSET_HEADER]).toMatch(
      /\d{1,2} \w{3} \d{4} \d{2}:\d{2}:\d{2} GMT/,
    );
    expect(nextCalled).toBe(true);
  });

  it("leaves admin and health requests unversioned with no headers", () => {
    for (const p of ["/admin/audit", "/api/admin/dlq/pending", "/health"]) {
      const { headers, req } = run(p);
      expect(apiVersionFrom(req)).toBe("unversioned");
      expect(headers[API_VERSION_HEADER]).toBeUndefined();
      expect(headers[DEPRECATION_HEADER]).toBeUndefined();
    }
  });

  it("does not tag arbitrary non-public paths", () => {
    const { headers, req } = run("/something-else");
    expect(apiVersionFrom(req)).toBe("unversioned");
    expect(Object.keys(headers)).toHaveLength(0);
  });
});
