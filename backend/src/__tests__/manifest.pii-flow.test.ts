/**
 * PII flow for POST /trades/:id/manifest (docs/pii-encryption.md §1b).
 *
 * Drives the real route and the real ManifestService against a mocked Prisma
 * client, and asserts that every PII field the route accepts reaches the
 * database only as an EncryptionService envelope — never as plaintext — and
 * that fields the route does not declare (e.g. a driver phone number) are
 * dropped before they reach the service.
 */
import express from "express";
import request from "supertest";
import { TradeStatus } from "@prisma/client";
import { createManifestRouter } from "../routes/manifest.routes";
import { ManifestService } from "../services/manifest.service";
import { EncryptionService } from "../services/encryption.service";

const SELLER = "GCSELLER000000000000000000000000000000000000000000000000";
const TRADE_ID = "trade-pii-001";

jest.mock("../middleware/auth.middleware", () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { walletAddress: "GCSELLER000000000000000000000000000000000000000000000000" };
        next();
    },
}));

const CIPHERTEXT_ENVELOPE = /^v\d+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;

const body = {
    driverName: "Chinedu Okafor",
    driverIdNumber: "NIN-99887766",
    vehicleRegistration: "LAG-123-XY",
    routeDescription: "12 Marina Road, Lagos to Kano depot",
    expectedDeliveryAt: new Date(Date.now() + 86_400_000).toISOString(),
    // Not part of the manifest schema — must never be persisted.
    driverPhoneNumber: "+2348012345678",
};

function setup() {
    const prisma = {
        trade: {
            findUnique: jest.fn().mockResolvedValue({
                tradeId: TRADE_ID,
                sellerAddress: SELLER,
                buyerAddress: "GCBUYER",
                status: TradeStatus.FUNDED,
            }),
        },
        deliveryManifest: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 7 }),
        },
    };
    const contractService = {
        buildSubmitManifestTx: jest.fn().mockResolvedValue({ unsignedXdr: "AAAA" }),
    };
    const manifestService = new ManifestService(prisma as any);
    const submitSpy = jest.spyOn(manifestService, "submitManifest");

    const app = express();
    app.use(express.json());
    app.use("/trades/:id/manifest", createManifestRouter(manifestService, contractService as any));

    return { app, prisma, contractService, submitSpy };
}

describe("manifest route PII flow", () => {
    it("encrypts every accepted PII field before it is persisted", async () => {
        const { app, prisma } = setup();

        await request(app).post(`/trades/${TRADE_ID}/manifest`).send(body).expect(201);

        const { data } = prisma.deliveryManifest.create.mock.calls[0][0];
        const encryption = new EncryptionService();
        for (const field of ["driverName", "driverIdNumber", "vehicleRegistration", "routeDescription"] as const) {
            expect(data[field]).toMatch(CIPHERTEXT_ENVELOPE);
            expect(encryption.decrypt(data[field], TRADE_ID)).toBe(body[field]);
        }
    });

    it("never writes plaintext PII anywhere in the persisted row", async () => {
        const { app, prisma } = setup();

        await request(app).post(`/trades/${TRADE_ID}/manifest`).send(body).expect(201);

        const persisted = JSON.stringify(prisma.deliveryManifest.create.mock.calls[0][0]);
        for (const value of [body.driverName, body.driverIdNumber, body.vehicleRegistration, body.routeDescription, body.driverPhoneNumber]) {
            expect(persisted).not.toContain(value);
        }
    });

    it("drops undeclared fields such as a driver phone number before the service layer", async () => {
        const { app, prisma, submitSpy } = setup();

        await request(app).post(`/trades/${TRADE_ID}/manifest`).send(body).expect(201);

        expect(submitSpy.mock.calls[0][0]).not.toHaveProperty("driverPhoneNumber");
        expect(prisma.deliveryManifest.create.mock.calls[0][0].data).not.toHaveProperty("driverPhoneNumber");
    });

    it("sends only blind-index hashes, not PII, to the contract layer", async () => {
        const { app, contractService } = setup();

        await request(app).post(`/trades/${TRADE_ID}/manifest`).send(body).expect(201);

        const args = contractService.buildSubmitManifestTx.mock.calls[0][0];
        expect(args.driverNameHash).toMatch(/^[a-f0-9]{64}$/);
        expect(args.driverIdHash).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(args)).not.toContain(body.driverName);
        expect(JSON.stringify(args)).not.toContain(body.driverIdNumber);
    });
});
