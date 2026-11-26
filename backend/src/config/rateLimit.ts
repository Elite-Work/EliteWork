import { env } from "./env";

export interface RateLimitPreset {
  windowMs: number;
  max: number;
  message: string;
}

export const RATE_LIMIT_CONFIG = {
  auth: {
    windowMs: env.RATE_LIMIT_AUTH_WINDOW_MS,
    max: env.RATE_LIMIT_AUTH_MAX,
    message: "Too many challenges/verify attempts, try again later.",
  },
  authRefresh: {
    windowMs: env.RATE_LIMIT_AUTH_REFRESH_WINDOW_MS,
    max: env.RATE_LIMIT_AUTH_REFRESH_MAX,
    message: "Too many token refresh attempts, try again later.",
  },
  user: {
    windowMs: env.RATE_LIMIT_USER_WINDOW_MS,
    max: env.RATE_LIMIT_USER_MAX,
    message: "Too many user profile requests, try again later.",
  },
  dispute: {
    windowMs: env.RATE_LIMIT_DISPUTE_WINDOW_MS,
    max: env.RATE_LIMIT_DISPUTE_MAX,
    message: "Too many dispute initiation attempts, try again later.",
  },
  admin: {
    windowMs: 60000, // 1 minute
    max: 100,
    message: "Too many admin requests, try again later.",
  },
  evidenceUpload: {
    windowMs: env.RATE_LIMIT_EVIDENCE_UPLOAD_WINDOW_MS,
    max: env.RATE_LIMIT_EVIDENCE_UPLOAD_MAX,
    message: "Evidence upload quota exceeded, try again later.",
  },
  tradeExport: {
    windowMs: 60 * 60 * 1000,
    max: 30,
    message: "Trade export quota exceeded, try again later.",
  },
  batchQuery: {
    windowMs: 60 * 60 * 1000,
    max: 60,
    message: "Batch query quota exceeded, try again later.",
  },
} as const satisfies Record<string, RateLimitPreset>;
