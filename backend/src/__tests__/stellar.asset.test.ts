import request from "supertest";
import express from "express";

const mockAssets = jest.fn();

jest.mock("../config/stellar", () => ({
  horizonServer: {
    assets: mockAssets,
  },
  sorobanRpcClient: {},
  networkPassphrase: "Test SDF Network ; September 2015",
}));

jest.mock("../lib/cache", () => ({
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue(undefined),
}));

const { createApp } = require("../app") as typeof import("../app");

const KNOWN_ISSUER = "GDDD3FRCH55BSYNKISYY242HQNIBOH35CQP42NSJABR62XK2JOV5MED6";

const makeAssetRecord = (code: string, issuer: string) => ({
  asset_code: code,
  asset_issuer: issuer,
  amount: "1000000",
  flags: { auth_required: false, auth_revocable: false, auth_clawback_enabled: false },
  accounts: { authorized: 42 },
});

function buildMockChain(records: any[]) {
  const call = jest.fn().mockResolvedValue({ records });
  const forIssuer = jest.fn().mockReturnValue({ limit: () => ({ call }) });
  const forCode = jest.fn().mockReturnValue({ forIssuer, limit: () => ({ call }) });
  const limit = jest.fn().mockReturnValue({ call });
  return { call, forIssuer, forCode, limit };
}

describe("GET /stellar/assets", () => {
  let app: express.Application;

  beforeEach(() => {
    mockAssets.mockReset();
    app = createApp();
  });

  it("returns a list of assets", async () => {
    const record = makeAssetRecord("USDC", KNOWN_ISSUER);
    const chain = buildMockChain([record]);
    mockAssets.mockReturnValue(chain);

    const res = await request(app).get("/stellar/assets");

    expect(res.status).toBe(200);
    expect(res.body.assets).toHaveLength(1);
    expect(res.body.assets[0].code).toBe("USDC");
    expect(res.body.assets[0].issuer).toBe(KNOWN_ISSUER);
    expect(res.body.assets[0].supply).toBe("1000000");
    expect(res.body.assets[0]).toHaveProperty("authRequired");
    expect(res.body.assets[0]).toHaveProperty("numAccounts");
  });

  it("filters by issuer when ?issuer= is provided", async () => {
    const record = makeAssetRecord("USDC", KNOWN_ISSUER);
    const call = jest.fn().mockResolvedValue({ records: [record] });
    const forIssuerChain = { limit: () => ({ call }) };
    const forIssuer = jest.fn().mockReturnValue(forIssuerChain);
    mockAssets.mockReturnValue({ forIssuer, limit: () => ({ call }) });

    const res = await request(app).get(`/stellar/assets?issuer=${KNOWN_ISSUER}`);

    expect(res.status).toBe(200);
    expect(forIssuer).toHaveBeenCalledWith(KNOWN_ISSUER);
    expect(res.body.assets[0].issuer).toBe(KNOWN_ISSUER);
  });

  it("returns 502 when Horizon fails", async () => {
    mockAssets.mockReturnValue({
      limit: () => ({ call: jest.fn().mockRejectedValue(new Error("Horizon error")) }),
    });

    const res = await request(app).get("/stellar/assets");

    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty("error");
  });
});

describe("GET /stellar/assets/:code", () => {
  let app: express.Application;

  beforeEach(() => {
    mockAssets.mockReset();
    app = createApp();
  });

  it("returns assets matching a known code", async () => {
    const record = makeAssetRecord("USDC", KNOWN_ISSUER);
    const call = jest.fn().mockResolvedValue({ records: [record] });
    const forIssuer = jest.fn().mockReturnValue({ limit: () => ({ call }) });
    const forCode = jest.fn().mockReturnValue({ forIssuer, limit: () => ({ call }) });
    mockAssets.mockReturnValue({ forCode });

    const res = await request(app).get("/stellar/assets/USDC");

    expect(res.status).toBe(200);
    expect(forCode).toHaveBeenCalledWith("USDC");
    expect(res.body.assets[0].code).toBe("USDC");
  });

  it("returns 404 when no asset matches the code", async () => {
    const call = jest.fn().mockResolvedValue({ records: [] });
    const forCode = jest.fn().mockReturnValue({ limit: () => ({ call }) });
    mockAssets.mockReturnValue({ forCode });

    const res = await request(app).get("/stellar/assets/UNKNOWN");

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("filters by issuer when ?issuer= is provided with code", async () => {
    const record = makeAssetRecord("USDC", KNOWN_ISSUER);
    const call = jest.fn().mockResolvedValue({ records: [record] });
    const forIssuer = jest.fn().mockReturnValue({ limit: () => ({ call }) });
    const forCode = jest.fn().mockReturnValue({ forIssuer, limit: () => ({ call }) });
    mockAssets.mockReturnValue({ forCode });

    const res = await request(app).get(`/stellar/assets/USDC?issuer=${KNOWN_ISSUER}`);

    expect(res.status).toBe(200);
    expect(forIssuer).toHaveBeenCalledWith(KNOWN_ISSUER);
  });

  it("returns 502 when Horizon fails on code lookup", async () => {
    const forCode = jest.fn().mockReturnValue({
      limit: () => ({ call: jest.fn().mockRejectedValue(new Error("Horizon error")) }),
    });
    mockAssets.mockReturnValue({ forCode });

    const res = await request(app).get("/stellar/assets/USDC");

    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty("error");
  });
});
