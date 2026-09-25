import request from "supertest";
import { TOKEN_CONFIG } from "../config/token";
import { ErrorCode } from "../errors/errorCodes";

// Mock redis
jest.mock("../lib/redis", () => {
  const store = new Map<string, string>();
  return {
    redis: {
      status: "ready",
      get: jest.fn(async (key: string) => store.get(key) ?? null),
      set: jest.fn(async (key: string, value: string, ...args: unknown[]) => {
        if (args.includes("NX") && store.has(key)) return null;
        store.set(key, value);
        return "OK";
      }),
      del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
      exists: jest.fn(async (key: string) => (store.has(key) ? 1 : 0)),
      on: jest.fn(),
    },
  };
});

// Mock auth middleware to skip auth
jest.mock("../middleware/auth.middleware", () => ({
  authMiddleware: (req: any, res: any, next: any) => {
    req.user = { walletAddress: "GBU...123" };
    next();
  },
}));

const { createApp } = require("../app") as typeof import("../app");

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
      const res = await request(app).post("/trades").send({});

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
      expect(res2.body).toMatchObject({
        code: res1.body.code,
        message: res1.body.message,
        details: res1.body.details,
      });
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
      const res = await request(app).get("/health/live");
      expect(res.headers["x-request-id"]).toBeDefined();
    });
  });
});
