import { createHash } from "crypto";
import { Request, Response, NextFunction } from "express";
import { redis } from "../lib/redis";
import { appLogger } from "./logger";
import { alertService } from "../services/alert.service";

function bodyHash(body: unknown): string {
  const normalized = JSON.stringify(body ?? null);
  return createHash("sha256").update(normalized).digest("hex");
}

const IDEMPOTENCY_TTL = 60 * 60 * 24; // 24 hours
const IDEMPOTENCY_LOCK_TTL = 30; // 30 seconds
const IN_PROGRESS_POLL_MS = 25;
const IDEMPOTENCY_IN_PROGRESS_MAX_WAIT_MS = IDEMPOTENCY_LOCK_TTL * 1000;

/**
 * Round-trip budget (see docs/idempotency-redis-roundtrips.md):
 *   first request, 2xx  -> 2 (ACQUIRE + COMMIT)   previously 5 (GET, SET NX, SET x2, DEL)
 *   first request, !2xx -> 2 (ACQUIRE + DEL)      previously 3 (GET, SET NX, DEL)
 *   cached replay       -> 1 (ACQUIRE)            previously 1 (GET)
 *
 * Both scripts touch two keys, so on Redis Cluster the cache and lock keys would
 * need a shared hash tag. The backend currently talks to a single Redis node.
 */

// Returns the cached response if present; otherwise tries to take the lock and
// returns 1 when acquired, 0 when another request already holds it.
export const IDEMPOTENCY_ACQUIRE_SCRIPT = `
local cached = redis.call("GET", KEYS[1])
if cached then
  return cached
end
if redis.call("SET", KEYS[2], "1", "NX", "EX", ARGV[1]) then
  return 1
end
return 0
`;

// Stores the response and releases the lock in a single round trip.
export const IDEMPOTENCY_COMMIT_SCRIPT = `
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("DEL", KEYS[2])
return 1
`;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCachedResponse(cacheKey: string): Promise<string | null> {
  const deadline = Date.now() + IDEMPOTENCY_IN_PROGRESS_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    await sleep(IN_PROGRESS_POLL_MS);
    const cached = await redis.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  return null;
}

export const idempotencyMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const key = req.headers["idempotency-key"] as string;

  if (!key) {
    return next();
  }

  // Only apply to mutations (POST, PUT, PATCH, DELETE)
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next();
  }

  const cacheKey = `idempotency:${req.method}:${req.path}:${key}`;
  const lockKey = `idempotency:lock:${req.method}:${req.path}:${key}`;

  try {
    const acquired = (await redis.eval(
      IDEMPOTENCY_ACQUIRE_SCRIPT,
      2,
      cacheKey,
      lockKey,
      IDEMPOTENCY_LOCK_TTL,
    )) as string | number;

    if (typeof acquired === "string") {
      const cachedResponse = acquired;
      appLogger.info({ key, path: req.path }, "Idempotency cache hit");
      const { status, body, headers, requestBodyHash } = JSON.parse(cachedResponse);

      // 409 if same key but different request body
      if (requestBodyHash !== undefined && requestBodyHash !== bodyHash(req.body)) {
        return res.status(409).json({
          error: "Idempotency key already used with a different request body",
        });
      }

      // Set cached headers
      Object.entries(headers).forEach(([k, v]) => {
        res.setHeader(k, v as string);
      });
      res.setHeader("X-Idempotency-Cache", "HIT");

      return res.status(status).json(deserializeCachedBody(body));
    }

    if (acquired !== 1) {
      const replayResponse = await waitForCachedResponse(cacheKey);
      if (replayResponse) {
        appLogger.info({ key, path: req.path }, "Idempotency replay after in-flight request");
        const { status, body, headers } = JSON.parse(replayResponse);

        Object.entries(headers).forEach(([k, v]) => {
          res.setHeader(k, v as string);
        });
        res.setHeader("X-Idempotency-Cache", "HIT");

        return res.status(status).json(deserializeCachedBody(body));
      }

      res.setHeader("X-Idempotency-Cache", "IN_PROGRESS");
      return res.status(409).json({
        error: "Request with this idempotency key is already in progress",
      });
    }

    let lockReleased = false;
    const releaseLock = () => {
      if (lockReleased) {
        return;
      }
      lockReleased = true;
      redis.del(lockKey).catch((err: unknown) =>
        appLogger.error({ err, key }, "Failed to release idempotency lock"),
      );
    };

    res.once("finish", releaseLock);
    res.once("close", releaseLock);

    // Intercept res.json and res.send to cache successful responses regardless of Express helper used.
    const originalJson = res.json.bind(res);
    const originalSend = res.send?.bind(res);

    // Express' res.json() delegates to res.send() with the serialized string, so both
    // overrides fire for one response. Only the first (un-serialized) body is cached.
    let responseCached = false;
    const cacheResponse = (body: unknown) => {
      if (responseCached) {
        return;
      }
      responseCached = true;
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const responseData = {
          status: res.statusCode,
          body,
          headers: res.getHeaders(),
          requestBodyHash: bodyHash(req.body),
        };
        // The commit script deletes the lock, so finish/close must not DEL it again.
        lockReleased = true;
        redis
          .eval(
            IDEMPOTENCY_COMMIT_SCRIPT,
            2,
            cacheKey,
            lockKey,
            JSON.stringify(responseData),
            IDEMPOTENCY_TTL,
          )
          .catch((err: unknown) => {
            appLogger.error({ err }, "Failed to cache idempotent response");
            redis.del(lockKey).catch((delErr: unknown) =>
              appLogger.error({ err: delErr, key }, "Failed to release idempotency lock"),
            );
          });
      }
    };

    res.json = (body?: unknown) => {
      cacheResponse(body);
      return originalJson(body);
    };

    if (typeof originalSend === "function") {
      res.send = (body?: unknown) => {
        cacheResponse(body);
        return originalSend(body);
      };
    }

    next();
  } catch (error) {
    appLogger.error({ error, key }, "Idempotency middleware error");
    void alertService.dispatch(
      "cache_unavailable",
      "Idempotency cache unavailable; proceeding without idempotency protection",
      {
        path: req.path,
        method: req.method,
        error: error instanceof Error ? error.message : "Unknown error",
      },
    );
    next(); // Proceed without idempotency if Redis fails
  }
};
