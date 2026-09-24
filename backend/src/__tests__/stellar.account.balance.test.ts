import request from "supertest";
import express from "express";

const mockLoadAccount = jest.fn();

jest.mock("../config/stellar", () => ({
  horizonServer: {
    loadAccount: mockLoadAccount,
  },
  sorobanRpcClient: {},
  networkPassphrase: "Test SDF Network ; September 2015",
}));

const { createApp } = require("../app") as typeof import("../app");

const VALID_ADDRESS = "GDDD3FRCH55BSYNKISYY242HQNIBOH35CQP42NSJABR62XK2JOV5MED6";
const MALFORMED_ADDRESS = "not-a-valid-stellar-address";

const FUNDED_ACCOUNT_BALANCES = [
  {
    asset_type: "native",
    balance: "100.0000000",
  },
  {
    asset_type: "credit_alphanum4",
    asset_code: "USDC",
    asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
    balance: "50.0000000",
    limit: "922337203685.4775807",
  },
];

describe("GET /stellar/account/:address/balance", () => {
  let app: express.Application;

  beforeEach(() => {
    mockLoadAccount.mockReset();
    app = createApp();
  });

  it("returns balances for a funded account", async () => {
    mockLoadAccount.mockResolvedValue({ balances: FUNDED_ACCOUNT_BALANCES });

    const res = await request(app).get(`/stellar/account/${VALID_ADDRESS}/balance`);

    expect(res.status).toBe(200);
    expect(res.body.address).toBe(VALID_ADDRESS);
    expect(res.body.balances).toHaveLength(2);

    const xlm = res.body.balances.find((b: any) => b.assetCode === "XLM");
    expect(xlm).toBeDefined();
    expect(xlm.assetType).toBe("native");
    expect(xlm.issuer).toBeNull();
    expect(xlm.balance).toBe("100.0000000");

    const usdc = res.body.balances.find((b: any) => b.assetCode === "USDC");
    expect(usdc).toBeDefined();
    expect(usdc.issuer).toBeTruthy();
    expect(usdc.limit).toBeTruthy();
  });

  it("returns 200 with empty balances for an unfunded account", async () => {
    mockLoadAccount.mockRejectedValue({ response: { status: 404 } });

    const res = await request(app).get(`/stellar/account/${VALID_ADDRESS}/balance`);

    expect(res.status).toBe(200);
    expect(res.body.address).toBe(VALID_ADDRESS);
    expect(res.body.balances).toHaveLength(0);
  });

  it("returns 400 for a malformed address", async () => {
    const res = await request(app).get(`/stellar/account/${MALFORMED_ADDRESS}/balance`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty("error");
  });

  it("returns 502 when Horizon fails with a non-404 error", async () => {
    mockLoadAccount.mockRejectedValue(new Error("Network timeout"));

    const res = await request(app).get(`/stellar/account/${VALID_ADDRESS}/balance`);

    expect(res.status).toBe(502);
    expect(res.body).toHaveProperty("error");
  });
});
