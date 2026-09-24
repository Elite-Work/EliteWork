/**
 * Typed mock factories for test fixtures.
 * Replaces `as any` casts with properly typed mock builders.
 */

import { Request, Response } from "express";
import { EventEmitter } from "events";

/**
 * Creates a typed mock for Prisma client with partial implementations.
 */
export function createMockPrisma<T extends Record<string, unknown>>(
  overrides: Partial<T> = {}
): jest.Mocked<T> {
  return new Proxy(jest.fn() as unknown as jest.Mocked<T>, {
    get: (target, prop) => {
      if (prop in overrides) {
        return overrides[prop as keyof T];
      }
      return target[prop as keyof T];
    },
  });
}

/**
 * Creates a typed mock for Express Request with default values.
 */
export function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    method: "POST",
    path: "/test",
    headers: {},
    body: {},
    query: {},
    params: {},
    ...overrides,
  } as Request;
}

/**
 * Creates a typed mock for Express Response with EventEmitter support.
 */
export function createMockResponse(): Response & EventEmitter & { body?: unknown } {
  const events = new EventEmitter();
  const headers: Record<string, string> = {};

  return {
    once: events.once.bind(events),
    emit: events.emit.bind(events),
    setHeader: jest.fn((key: string, value: unknown) => {
      headers[key] = String(value);
    }),
    getHeaders: jest.fn(() => ({ ...headers })),
    statusCode: 200,
    status: jest.fn(function (this: { statusCode: number }, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function (this: { body: unknown; emit: (event: string) => void }, body: unknown) {
      this.body = body;
      this.emit("finish");
      return this;
    }),
    send: jest.fn(function (this: { body: unknown; emit: (event: string) => void }, body: unknown) {
      this.body = body;
      this.emit("finish");
      return this;
    }),
  } as Response & EventEmitter & { body?: unknown };
}

/**
 * Creates a typed mock for Redis client operations.
 */
export function createMockRedis(
  getResult: unknown = null,
  setResult: string = "OK",
  delResult: number = 1
) {
  return {
    get: jest.fn().mockResolvedValue(getResult),
    set: jest.fn().mockResolvedValue(setResult),
    del: jest.fn().mockResolvedValue(delResult),
  };
}

/**
 * Creates a typed mock for express-rate-limit options.
 */
export function createRateLimitOptions(overrides: Record<string, unknown> = {}) {
  return {
    windowMs: 900000,
    max: 10,
    message: "Too many requests",
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req: Request) => req.ip ?? "unknown",
    handler: (req: Request, res: Response, next: () => void) => next(),
    ...overrides,
  };
}

/**
 * Helper to create a partial fixture with type safety.
 */
export function fixture<T>(overrides: Partial<T>): T {
  return overrides as T;
}