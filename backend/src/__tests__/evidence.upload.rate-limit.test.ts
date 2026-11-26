import express from "express";
import request from "supertest";
import { createEvidenceRouter } from "../routes/evidence.routes";
import { RATE_LIMIT_CONFIG } from "../config/rateLimit";
import { ErrorCode } from "../errors/errorCodes";

// The wallet is taken from a header so one test can act as several users.
jest.mock("../middleware/auth.middleware", () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { walletAddress: req.headers["x-test-wallet"] ?? "GWALLETA" };
        next();
    },
}));

// Redis-backed idempotency is out of scope here.
jest.mock("../middleware/idempotency", () => ({
    idempotencyMiddleware: (_req: any, _res: any, next: any) => next(),
}));

const TRADE_ID = "6f1c2c1e-1d3a-4c8e-9b6a-2f3e4d5c6b7a";
const BURST = { windowMs: 60_000, max: 2, message: "Evidence upload quota exceeded, try again later." };

function buildApp(preset = BURST) {
    const evidenceService = {
        uploadVideoEvidence: jest.fn().mockResolvedValue({ cid: "bafytest" }),
    } as any;
    const app = express();
    app.use(createEvidenceRouter(evidenceService, preset));
    return { app, evidenceService };
}

function upload(app: express.Express, wallet = "GWALLETA") {
    return request(app)
        .post("/evidence/video")
        .set("x-test-wallet", wallet)
        .field("tradeId", TRADE_ID)
        .attach("file", Buffer.from("fake-mp4"), { filename: "clip.mp4", contentType: "video/mp4" });
}

describe("POST /evidence/video per-user rate limit", () => {
    it("allows uploads up to the burst limit, then returns 429", async () => {
        const { app, evidenceService } = buildApp();

        await upload(app).expect(201);
        await upload(app).expect(201);
        const res = await upload(app).expect(429);

        expect(res.body).toMatchObject({
            code: ErrorCode.RATE_LIMIT_EXCEEDED,
            message: BURST.message,
            details: { limit: 2, windowMs: 60_000, retryAfterSeconds: 60 },
        });
        expect(evidenceService.uploadVideoEvidence).toHaveBeenCalledTimes(2);
    });

    it("rejects before the multipart body is processed", async () => {
        const { app, evidenceService } = buildApp({ ...BURST, max: 1 });

        await upload(app).expect(201);
        await upload(app).expect(429);
        // Even an otherwise-invalid request is limited, not validated.
        await request(app).post("/evidence/video").set("x-test-wallet", "GWALLETA").expect(429);

        expect(evidenceService.uploadVideoEvidence).toHaveBeenCalledTimes(1);
    });

    it("counts each wallet separately", async () => {
        const { app } = buildApp({ ...BURST, max: 1 });

        await upload(app, "GWALLETA").expect(201);
        await upload(app, "GWALLETA").expect(429);
        await upload(app, "GWALLETB").expect(201);
    });

    it("sends standard RateLimit headers", async () => {
        const { app } = buildApp();
        const res = await upload(app).expect(201);
        expect(res.headers["ratelimit-limit"]).toBe("2");
    });

    it("does not rate-limit read endpoints", async () => {
        const evidenceService = {
            getEvidenceByTradeId: jest.fn().mockResolvedValue([]),
        } as any;
        const app = express();
        app.use(createEvidenceRouter(evidenceService, { ...BURST, max: 1 }));

        for (let i = 0; i < 3; i++) {
            await request(app).get(`/trades/${TRADE_ID}/evidence`).expect(200);
        }
    });

    it("uses the env-configured evidenceUpload preset by default", () => {
        expect(RATE_LIMIT_CONFIG.evidenceUpload).toEqual({
            windowMs: 60 * 60 * 1000,
            max: 20,
            message: "Evidence upload quota exceeded, try again later.",
        });
    });
});
