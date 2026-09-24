import request from "supertest";
import { createApp } from "../app";
import { TOKEN_CONFIG } from "../config/token";
import { ErrorCode } from "../errors/errorCodes";

// ── Typed mock factories ─────────────────────────────────────────────────────

type RedisMock = {
  get: jest.Mock<Promise<string | undefined>, [string]>;
  set: jest.Mock<Promise<void>, [string, unknown]>;
};

function createMockRedis(): RedisMock {
  const store = new Map<string, unknown>();
  return {
    get: jest.fn().mockImplementation(async (key: string) => store.get(key) as string | undefined),
    set: jest.fn().mockImplementation(async (key: string, value: unknown) => { store.set(key, value); }),
  };
}

function createMockAuthMiddleware(): jest.Mock<void, [ { user: { walletAddress: string } }, unknown, () => void ]> {
  return jest.fn((req: { user: { walletAddress: string } }, _res: unknown, next: () => void) => {
    req.user = { walletAddress: "GBU...123" };
    next();
  });
}

// Mock redis
const mockRedis = createMockRedis();
jest.mock("../lib/redis", () => ({
  redis: {
    get: mockRedis.get,
    set: mockRedis.set,
  },
}));

// Mock auth middleware to skip auth
const mockAuthMiddleware = createMockAuthMiddleware();
jest.mock("../middleware/auth.middleware", () => ({
  authMiddleware: mockAuthMiddleware,
}));

describe("Backend Reliability Layer", () => {
  const app = createApp();

  describe("Token Config", () => {
    it("should use cNGN as the default symbol", () => {
      expect(TOKEN_CONFIG.symbol).toBe("cNGN");
      expect(TOKEN_CONFIG.decimals).toBe(7);
    });
  });

  describe("Schema Validation", () => {
    it("should return VALIDATION_ERROR for invalid trade creation", async () => {
      const res = await request(app)
        .post("/trades")
        .send({
          amountUsdc: "invalid", // Invalid amount format
        });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(res.body.details).toBeDefined();
    });

    it("should return VALIDATION_ERROR for invalid UUID in params", async () => {
      const res = await request(app).get("/trades/not-a-uuid");

      expect(res.status).toBe(400);
      expect(res.body.code).toBe(ErrorCode.VALIDATION_ERROR);
    });
  });

  describe("Idempotency", () => {
    it("should return the same response for repeated requests with same Idempotency-Key", async () => {
      const key = "test-idempotency-key";
      
      // First request (will fail validation but should be cached)
      const res1 = await request(app)
        .post("/trades")
        .set("Idempotency-Key", key)
        .send({ buyerAddress: "addr1" }); // Missing fields

      expect(res1.headers["x-idempotency-cache"]).toBeUndefined();

      // Second request
      const res2 = await request(app)
        .post("/trades")
        .set("Idempotency-Key", key)
        .send({ buyerAddress: "addr1" });

      expect(res2.status).toBe(res1.status);
      expect(res2.body).toEqual(res1.body);
      expect(res2.headers["x-idempotency-cache"]).toBe("HIT");
    });
  });

  describe("Error Format", () => {
    it("should return a consistent error format for 404s", async () => {
      const res = await request(app).get("/non-existent-route");

      expect(res.body).toHaveProperty("code");
      expect(res.body).toHaveProperty("message");
      expect(res.body).toHaveProperty("details");
    });
  });

  describe("Request ID", () => {
    it("should include X-Request-ID in response headers", async () => {
      const res = await request(app).get("/health");
      expect(res.headers["x-request-id"]).toBeDefined();
    });
  });
});