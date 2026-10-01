import request from "supertest";
import express from "express";

const mockTransactions = jest.fn();

jest.mock("../config/stellar", () => ({
  horizonServer: {
    transactions: mockTransactions,
  },
  sorobanRpcClient: {},
  networkPassphrase: "Test SDF Network ; September 2015",
}));

const { createApp } = require("../app") as typeof import("../app");

describe("GET /stellar/tx/:hash/status", () => {
  let app: express.Application;

  beforeEach(() => {
    mockTransactions.mockReset();
    app = createApp();
  });

  it("returns success status for a confirmed transaction", async () => {
    const mockCall = jest.fn().mockResolvedValue({
      id: "abc123",
      successful: true,
      ledger: 12345,
      created_at: "2024-01-01T00:00:00Z",
      result_xdr: "AAAA",
    });
    mockTransactions.mockReturnValue({
      transaction: () => ({ call: mockCall }),
    });

    const response = await request(app).get(
      "/stellar/tx/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/status"
    );

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("success");
    expect(response.body.ledger).toBe(12345);
    expect(response.body.hash).toBe("abc123");
    expect(response.body).toHaveProperty("resultCodes");
  });

  it("returns failed status for a failed transaction", async () => {
    const mockCall = jest.fn().mockResolvedValue({
      id: "def456",
      successful: false,
      ledger: 12346,
      created_at: "2024-01-01T00:00:00Z",
      result_xdr: "AAAA",
    });
    mockTransactions.mockReturnValue({
      transaction: () => ({ call: mockCall }),
    });

    const response = await request(app).get(
      "/stellar/tx/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/status"
    );

    expect(response.status).toBe(200);
    expect(response.body.status).toBe("failed");
  });

  it("returns 404 for unknown transaction hash", async () => {
    const mockCall = jest.fn().mockRejectedValue({
      response: { status: 404 },
    });
    mockTransactions.mockReturnValue({
      transaction: () => ({ call: mockCall }),
    });

    const response = await request(app).get(
      "/stellar/tx/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc/status"
    );

    expect(response.status).toBe(404);
    expect(response.body.status).toBe("pending");
  });

  it("returns 400 for invalid hash", async () => {
    const response = await request(app).get("/stellar/tx/short/status");

    expect(response.status).toBe(400);
    expect(response.body).toHaveProperty("error");
  });

  it("returns 502 on network error", async () => {
    const mockCall = jest.fn().mockRejectedValue(new Error("Network failure"));
    mockTransactions.mockReturnValue({
      transaction: () => ({ call: mockCall }),
    });

    const response = await request(app).get(
      "/stellar/tx/dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd/status"
    );

    expect(response.status).toBe(502);
    expect(response.body).toHaveProperty("error");
  });
});
