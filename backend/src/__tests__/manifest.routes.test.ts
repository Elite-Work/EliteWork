import express from "express";
import jwt from "jsonwebtoken";
import request from "supertest";
import { createManifestRouter } from "../routes/manifest.routes";
import { ManifestConflictError } from "../services/manifest.service";
import { AuthService } from "../services/auth.service";
import { Keypair } from "@stellar/stellar-sdk";

describe("Manifest Routes", () => {
  const walletAddress = Keypair.random().publicKey();
  const buyerAddress = Keypair.random().publicKey();
  const mediatorAddress = Keypair.random().publicKey();
  let token: string;
  let buyerToken: string;
  let mediatorToken: string;

  beforeAll(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-at-least-32-characters-long";
    process.env.JWT_ISSUER = process.env.JWT_ISSUER || "amana";
    process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE || "amana-api";
    const now = Math.floor(Date.now() / 1000);
    token = jwt.sign(
      {
        walletAddress,
        jti: "manifest-seller-jti",
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        nbf: now - 1,
      },
      process.env.JWT_SECRET as string,
      { algorithm: "HS256" },
    );
    buyerToken = jwt.sign(
      {
        walletAddress: buyerAddress,
        jti: "manifest-buyer-jti",
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        nbf: now - 1,
      },
      process.env.JWT_SECRET as string,
      { algorithm: "HS256" },
    );
    mediatorToken = jwt.sign(
      {
        walletAddress: mediatorAddress,
        jti: "manifest-mediator-jti",
        iss: process.env.JWT_ISSUER,
        aud: process.env.JWT_AUDIENCE,
        nbf: now - 1,
      },
      process.env.JWT_SECRET as string,
      { algorithm: "HS256" },
    );
    process.env.ADMIN_STELLAR_PUBKEYS = mediatorAddress;
    jest.spyOn(AuthService, "isTokenRevoked").mockResolvedValue(false);
    jest.spyOn(AuthService, "getTokenVersion").mockResolvedValue(0);
  });

  it("reads :id from parent route params when posting manifest", async () => {
    const submitManifest = jest.fn().mockResolvedValue({
      manifestId: 123,
      driverNameHash: "hash-name",
      driverIdHash: "hash-id",
    });
    const buildSubmitManifestTx = jest.fn().mockResolvedValue({
      unsignedXdr: "AAAA-test-xdr",
    });

    const app = express();
    app.use(express.json());
    app.use(
      "/trades/:id/manifest",
      createManifestRouter(
        { submitManifest } as any,
        { buildSubmitManifestTx } as any,
      ),
    );

    const response = await request(app)
      .post("/trades/test-id/manifest")
      .set("Authorization", `Bearer ${token}`)
      .send({
        driverName: "Driver Name",
        driverIdNumber: "DRV-12345",
        vehicleRegistration: "ABC-123XY",
        routeDescription: "Farm to depot",
        expectedDeliveryAt: "2026-03-28T12:00:00.000Z",
      });

    expect(response.status).toBe(201);
    expect(submitManifest).toHaveBeenCalledWith(
      expect.objectContaining({
        tradeId: "test-id",
      }),
    );
  });

  it("returns masked manifest view for buyer", async () => {
    const getManifestByTradeId = jest.fn().mockResolvedValue({
      tradeId: "test-id",
      roleView: "buyer",
      driverName: "D****",
      driverIdNumber: "ID-****",
      vehicleRegistration: "ABC-123XY",
      routeDescription: "Farm to depot",
    });

    const app = express();
    app.use(express.json());
    app.use(
      "/trades/:id/manifest",
      createManifestRouter(
        { getManifestByTradeId } as any,
        {} as any,
      ),
    );

    const response = await request(app)
      .get("/trades/test-id/manifest")
      .set("Authorization", `Bearer ${buyerToken}`);

    expect(response.status).toBe(200);
    expect(response.body.driverName).toBe("D****");
    expect(response.body.driverIdNumber).toBe("ID-****");
    expect(response.body.driverNameHash).toBeUndefined();
    expect(response.body.driverIdHash).toBeUndefined();
  });

  it("returns hash view for mediator", async () => {
    const getManifestByTradeId = jest.fn().mockResolvedValue({
      tradeId: "test-id",
      roleView: "mediator",
      driverNameHash: "a".repeat(64),
      driverIdHash: "b".repeat(64),
      vehicleRegistration: "ABC-123XY",
      routeDescription: "Farm to depot",
    });

    const app = express();
    app.use(express.json());
    app.use(
      "/trades/:id/manifest",
      createManifestRouter(
        { getManifestByTradeId } as any,
        {} as any,
      ),
    );

    const response = await request(app)
      .get("/trades/test-id/manifest")
      .set("Authorization", `Bearer ${mediatorToken}`);

    expect(response.status).toBe(200);
    expect(response.body.driverNameHash).toHaveLength(64);
    expect(response.body.driverIdHash).toHaveLength(64);
    expect(response.body.driverName).toBeUndefined();
    expect(response.body.driverIdNumber).toBeUndefined();
  });

  it("returns 409 when manifest is submitted twice", async () => {
    const submitManifest = jest
      .fn()
      .mockResolvedValueOnce({
        manifestId: 123,
        driverNameHash: "hash-name",
        driverIdHash: "hash-id",
      })
      .mockRejectedValueOnce(new ManifestConflictError());
    const buildSubmitManifestTx = jest.fn().mockResolvedValue({
      unsignedXdr: "AAAA-test-xdr",
    });

    const app = express();
    app.use(express.json());
    app.use(
      "/trades/:id/manifest",
      createManifestRouter(
        { submitManifest } as any,
        { buildSubmitManifestTx } as any,
      ),
    );

    const payload = {
      driverName: "Driver Name",
      driverIdNumber: "DRV-12345",
      vehicleRegistration: "ABC-123XY",
      routeDescription: "Farm to depot",
      expectedDeliveryAt: "2026-03-28T12:00:00.000Z",
    };

    const first = await request(app)
      .post("/trades/test-id/manifest")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/trades/test-id/manifest")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);
    expect(second.status).toBe(409);
  });
});
