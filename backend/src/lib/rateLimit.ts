import rateLimit, { type Options } from 'express-rate-limit';
import { NextFunction, Request, Response } from 'express';
import { RateLimitPreset } from '../config/rateLimit';
import { ErrorCode } from '../errors/errorCodes';
import { AuthRequest } from '../services/auth.service';

/**
 * Rate limiting resilience policy: FAIL-OPEN (documented choice).
 *
 * - Current implementation uses in-memory MemoryStore (express-rate-limit default).
 * - On Redis unavailability, we remain fail-open (allow request) but per-pod counters may be lenient.
 * - Rationale: Do not block legitimate trade/admin traffic during Redis brownout.
 *   DDoS degradation is acceptable; payout safety is enforced via DB locks + idempotency DB constraints.
 * - If Redis-backed store is added later, keep fail-open with alert; do NOT block traffic.
 * See docs/redis-resilience.md#rate-limiting
 */

type KeyGenerator = (req: Request) => string;

function resolveClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function resolveWalletAddress(req: Request): string | undefined {
  const walletAddress = (req as AuthRequest).user?.walletAddress?.trim();
  return walletAddress || undefined;
}

export function createIpRateLimiter(preset: RateLimitPreset) {
  return createRateLimiter(preset, resolveClientIp);
}

export function createWalletRateLimiter(preset: RateLimitPreset) {
  return createRateLimiter(preset, (req: Request) => {
    const walletAddress = resolveWalletAddress(req);
    if (!walletAddress) {
      return resolveClientIp(req);
    }
    return `wallet:${walletAddress}`;
  });
}

function createRateLimiter(preset: RateLimitPreset, keyGenerator: KeyGenerator) {
  return rateLimit({
    windowMs: preset.windowMs,
    max: preset.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: preset.message,
    keyGenerator,
    handler: (
      req: Request,
      res: Response,
      _next: NextFunction,
      options: Options,
    ) => {
      const retryAfterSeconds = Math.ceil((options.windowMs ?? preset.windowMs) / 1000);
      const limit = typeof options.max === 'number' ? options.max : preset.max;

      res.status(429).json({
        code: ErrorCode.RATE_LIMIT_EXCEEDED,
        message: typeof options.message === 'string' ? options.message : preset.message,
        details: {
          retryAfterSeconds,
          limit,
          windowMs: options.windowMs ?? preset.windowMs,
        },
        timestamp: new Date().toISOString(),
        path: req.path,
      });
    },
    // Graceful degradation: on MemoryStore errors, fail open but log
    // If a RedisStore is ever injected, keep same fail-open contract.
    validate: false,
  });
}

/**
 * Export for testing: documents chosen fail-open behavior on Redis loss.
 */
export const RATE_LIMIT_RESILIENCE_POLICY = {
  onRedisDown: "fail-open-graceful" as const,
  behavior: "allow request (lenient per-pod counters), alert via redis_connection_failure, no blocking",
  alternativeRejected: "fail-closed (deny all) rejected — would cause global deadlock during routine Redis upgrade",
};
