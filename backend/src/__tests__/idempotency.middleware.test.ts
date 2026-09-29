import { EventEmitter } from "events";
import { Request, Response } from "express";

jest.mock("../lib/redis", () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    eval: jest.fn(),
  },
}));

jest.mock("../services/alert.service", () => ({
  alertService: {
    dispatch: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock("../middleware/logger", () => ({
  appLogger: {
    info: jest.fn(),
    error: jest.fn(),
  },
}));

import { redis } from "../lib/redis";
import { alertService } from "../services/alert.service";
import {
  idempotencyMiddleware,
  IDEMPOTENCY_ACQUIRE_SCRIPT,
  IDEMPOTENCY_COMMIT_SCRIPT,
} from "../middleware/idempotency";

const CACHE_KEY = "idempotency:POST:/trades:idem-1";
const LOCK_KEY = "idempotency:lock:POST:/trades:idem-1";

/**
 * Minimal in-memory Redis that implements the two idempotency scripts with the
 * same semantics as the Lua source, and records every command sent (one entry
 * per network round trip).
 */
function installFakeRedis(redisMock: jest.Mocked<typeof redis>) {
  const store = new Map<string, string>();
  const roundTrips: string[] = [];

  (redisMock.get as jest.Mock).mockImplementation(async (key: string) => {
    roundTrips.push("GET");
    return store.get(key) ?? null;
  });
  (redisMock.del as jest.Mock).mockImplementation(async (key: string) => {
    roundTrips.push("DEL");
    return store.delete(key) ? 1 : 0;
  });
  (redisMock.eval as jest.Mock).mockImplementation(
    async (script: string, _numKeys: number, k1: string, k2: string, ...args: unknown[]) => {
      if (script === IDEMPOTENCY_ACQUIRE_SCRIPT) {
        roundTrips.push("EVAL acquire");
        const cached = store.get(k1);
        if (cached) return cached;
        if (store.has(k2)) return 0;
        store.set(k2, "1");
        return 1;
      }
      if (script === IDEMPOTENCY_COMMIT_SCRIPT) {
        roundTrips.push("EVAL commit");
        store.set(k1, String(args[0]));
        store.delete(k2);
        return 1;
      }
      throw new Error("unexpected script");
    },
  );

  return { store, roundTrips };
}

function createReq(
  overrides: Partial<Request> = {},
): Request {
  return {
    method: "POST",
    path: "/trades",
    headers: { "idempotency-key": "idem-1" },
    ...overrides,
  } as Request;
}

function createRes() {
  const events = new EventEmitter();
  const headers: Record<string, any> = {};

  const res = {
    once: events.once.bind(events),
    emit: events.emit.bind(events),
    setHeader: jest.fn((key: string, value: unknown) => {
      headers[key] = value;
    }),
    getHeaders: jest.fn(() => ({ ...headers })),
    statusCode: 200,
    status: jest.fn(function status(this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(this: any, body: unknown) {
      this.body = body;
      this.emit("finish");
      return this;
    }),
    send: jest.fn(function send(this: any, body: unknown) {
      this.body = body;
      this.emit("finish");
      return this;
    }),
  } as unknown as Response & EventEmitter & { body?: unknown };

  return { res, headers };
}

describe("idempotencyMiddleware", () => {
  const redisMock = redis as jest.Mocked<typeof redis>;
  const alertMock = alertService as jest.Mocked<typeof alertService>;

  let fake: ReturnType<typeof installFakeRedis>;

  beforeEach(() => {
    jest.clearAllMocks();
    fake = installFakeRedis(redisMock);
    alertMock.dispatch.mockResolvedValue(undefined);
  });

  it("bypasses when idempotency key is missing", async () => {
    const req = createReq({ headers: {} as any });
    const { res } = createRes();
    const next = jest.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(fake.roundTrips).toEqual([]);
  });

  it("bypasses for non-mutation methods", async () => {
    const req = createReq({ method: "GET" });
    const { res } = createRes();
    const next = jest.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(fake.roundTrips).toEqual([]);
  });

  it("replays cached response for duplicate/stale keys", async () => {
    fake.store.set(
      CACHE_KEY,
      JSON.stringify({
        status: 201,
        body: { tradeId: "t-1" },
        headers: { "content-type": "application/json" },
      }),
    );

    const req = createReq();
    const { res, headers } = createRes();
    const next = jest.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect((res as any).body).toEqual({ tradeId: "t-1" });
    expect(headers["X-Idempotency-Cache"]).toBe("HIT");
  });

  it("caches first successful response and releases lock", async () => {
    const req = createReq();
    const { res } = createRes();

    await idempotencyMiddleware(req, res, () => {
      res.status(201).json({ ok: true });
    });

    await Promise.resolve();

    expect(redisMock.eval).toHaveBeenCalledWith(
      IDEMPOTENCY_COMMIT_SCRIPT,
      2,
      CACHE_KEY,
      LOCK_KEY,
      expect.any(String),
      86400,
    );
    expect(fake.store.has(CACHE_KEY)).toBe(true);
    expect(fake.store.has(LOCK_KEY)).toBe(false);
  });

  it("caches successful responses sent via res.send", async () => {
    const req = createReq();
    const { res, headers } = createRes();

    await idempotencyMiddleware(req, res, () => {
      res.status(201).send({ ok: true });
    });

    await Promise.resolve();

    expect(fake.store.get(CACHE_KEY)).toContain('"body":{"ok":true}');
    expect(headers["X-Idempotency-Cache"]).not.toBe("HIT");
    expect(fake.store.has(LOCK_KEY)).toBe(false);
  });

  it("caches the original body when res.json delegates to res.send", async () => {
    const req = createReq();
    const { res } = createRes();
    // Mirror Express: res.json serializes and calls this.send(string).
    res.json = jest.fn(function json(this: Response, body: unknown) {
      return this.send(JSON.stringify(body));
    });

    await idempotencyMiddleware(req, res, () => {
      res.status(201).json({ ok: true });
    });
    await Promise.resolve();

    const commits = fake.roundTrips.filter((c) => c === "EVAL commit");
    expect(commits).toHaveLength(1);
    expect(JSON.parse(fake.store.get(CACHE_KEY)!).body).toEqual({ ok: true });
  });

  describe("Redis round-trip budget", () => {
    it("uses 2 round trips for a first successful request (was 5)", async () => {
      const req = createReq();
      const { res } = createRes();
      // Mirror Express so the json -> send delegation is exercised.
      res.json = jest.fn(function json(this: Response, body: unknown) {
        return this.send(JSON.stringify(body));
      });

      await idempotencyMiddleware(req, res, () => {
        res.status(201).json({ ok: true });
      });
      await Promise.resolve();

      expect(fake.roundTrips).toEqual(["EVAL acquire", "EVAL commit"]);
    });

    it("uses 2 round trips for a first non-2xx request (was 3)", async () => {
      const req = createReq();
      const { res } = createRes();

      await idempotencyMiddleware(req, res, () => {
        res.status(422).json({ error: "invalid" });
      });
      await Promise.resolve();

      expect(fake.roundTrips).toEqual(["EVAL acquire", "DEL"]);
      expect(fake.store.has(LOCK_KEY)).toBe(false);
      expect(fake.store.has(CACHE_KEY)).toBe(false);
    });

    it("uses 1 round trip for a cached replay", async () => {
      fake.store.set(
        CACHE_KEY,
        JSON.stringify({ status: 201, body: { tradeId: "t-1" }, headers: {} }),
      );
      const req = createReq();
      const { res } = createRes();

      await idempotencyMiddleware(req, res, jest.fn());

      expect(fake.roundTrips).toEqual(["EVAL acquire"]);
    });
  });

  it("serves in-flight duplicate request from replay cache without duplicate side effects", async () => {
    let sideEffects = 0;
    const req1 = createReq();
    const req2 = createReq();
    const { res: res1 } = createRes();
    const { res: res2, headers: headers2 } = createRes();

    const next1 = jest.fn(() => {
      sideEffects += 1;
      setTimeout(() => {
        res1.status(201).json({ tradeId: "created-once" });
      }, 10);
    });

    const next2 = jest.fn(() => {
      sideEffects += 1;
    });

    await Promise.all([
      idempotencyMiddleware(req1, res1, next1),
      idempotencyMiddleware(req2, res2, next2),
    ]);

    expect(sideEffects).toBe(1);
    expect(next1).toHaveBeenCalledTimes(1);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.status).toHaveBeenCalledWith(201);
    expect((res2 as any).body).toEqual({ tradeId: "created-once" });
    expect(headers2["X-Idempotency-Cache"]).toBe("HIT");
  });

  it("waits for a long-running in-flight request before returning a replay", async () => {
    let sideEffects = 0;
    const req1 = createReq();
    const req2 = createReq();
    const { res: res1 } = createRes();
    const { res: res2, headers: headers2 } = createRes();

    const next1 = jest.fn(() => {
      sideEffects += 1;
      setTimeout(() => {
        res1.status(201).json({ tradeId: "created-once" });
      }, 1200);
    });

    const next2 = jest.fn(() => {
      sideEffects += 1;
    });

    await Promise.all([
      idempotencyMiddleware(req1, res1, next1),
      idempotencyMiddleware(req2, res2, next2),
    ]);

    expect(sideEffects).toBe(1);
    expect(next1).toHaveBeenCalledTimes(1);
    expect(next2).not.toHaveBeenCalled();
    expect(res2.status).toHaveBeenCalledWith(201);
    expect((res2 as any).body).toEqual({ tradeId: "created-once" });
    expect(headers2["X-Idempotency-Cache"]).toBe("HIT");
  });

  it("returns 409 when same key is reused with a different request body", async () => {
    const crypto = await import("crypto");
    const originalBodyHash = crypto
      .createHash("sha256")
      .update(JSON.stringify({ amount: 100 }))
      .digest("hex");

    fake.store.set(
      CACHE_KEY,
      JSON.stringify({
        status: 201,
        body: { tradeId: "t-original" },
        headers: {},
        requestBodyHash: originalBodyHash,
      }),
    );

    // Request with a different body but the same idempotency key
    const req = createReq({ body: { amount: 999 } } as any);
    const { res } = createRes();
    const next = jest.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect((res as any).body).toMatchObject({
      error: expect.stringContaining("different request body"),
    });
  });

  it("continues request flow when Redis storage fails", async () => {
    (redisMock.eval as jest.Mock).mockRejectedValueOnce(new Error("redis down"));

    const req = createReq();
    const { res } = createRes();
    const next = jest.fn();

    await idempotencyMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(alertMock.dispatch).toHaveBeenCalledWith(
      "cache_unavailable",
      expect.stringContaining("Idempotency cache unavailable"),
      expect.objectContaining({
        path: "/trades",
        method: "POST",
        error: "redis down",
      }),
    );
  });
});
