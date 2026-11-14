import express from "express";
import request from "supertest";
import type { PrismaClient } from "@prisma/client";
import { createEvidenceRouter } from "../routes/evidence.routes";
import { EvidenceService } from "../services/evidence.service";
import { IPFSService, ServiceUnavailableError } from "../services/ipfs.service";
import { __setPinataClientForTests, __resetPinataClient } from "../config/ipfs";
import { appLogger } from "../middleware/logger";

jest.mock("../middleware/auth.middleware", () => ({
    authMiddleware: (req: express.Request & { user?: { walletAddress: string } }, _res: express.Response, next: express.NextFunction) => {
        req.user = { walletAddress: "GCBUYER0000000000000000000000000000000000000000000000000" };
        next();
    },
}));

describe("Evidence routes streaming fallback", () => {
    it("returns 502 when IPFS streaming is unavailable", async () => {
        const evidenceService = {
            streamFromIPFS: jest.fn().mockRejectedValue(new ServiceUnavailableError()),
        } as unknown as EvidenceService;

        const app = express();
        app.use(createEvidenceRouter(evidenceService));

        const res = await request(app).get("/evidence/bafydeadbeef/stream").expect(502);

        expect(res.body).toEqual({ error: "Failed to stream from IPFS gateway" });
        expect(evidenceService.streamFromIPFS).toHaveBeenCalledWith("bafydeadbeef", undefined);
    });
});

describe("POST /evidence/video filename XSS sanitization (#486)", () => {
    afterEach(() => {
        __resetPinataClient();
        jest.restoreAllMocks();
    });

    it("sanitizes malicious filename from multipart upload before logging and persisting metadata", async () => {
        const tradeId = "550e8400-e29b-41d4-a716-446655440000";
        const buyer = "GCBUYER0000000000000000000000000000000000000000000000000";
        const createMock = jest.fn().mockResolvedValue({ id: 101 });
        const mockPrisma = {
            trade: {
                findUnique: jest.fn().mockResolvedValue({
                    tradeId,
                    buyerAddress: buyer,
                    sellerAddress: "GCSELLER000000000000000000000000000000000000000000000000",
                }),
            },
            tradeEvidence: {
                findMany: jest.fn(),
                create: createMock,
            },
        } as unknown as PrismaClient;

        const pinFileToIPFS = jest.fn().mockResolvedValue({ IpfsHash: "bafyroutesafe" });
        __setPinataClientForTests({ pinFileToIPFS } as unknown as Parameters<typeof __setPinataClientForTests>[0]);
        const infoSpy = jest.spyOn(appLogger, "info").mockImplementation(() => appLogger);

        const service = new EvidenceService(mockPrisma, new IPFSService());
        const app = express();
        app.use(createEvidenceRouter(service));

        const mp4Header = Buffer.from([
            0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
        ]);

        const res = await request(app)
            .post("/evidence/video")
            .field("tradeId", tradeId)
            .attach("file", mp4Header, {
                filename: "<script>alert(1)</script>.mp4",
                contentType: "video/mp4",
            })
            .expect(201);

        expect(res.body.cid).toBe("bafyroutesafe");

        const savedFilename = createMock.mock.calls[0][0].data.filename as string;
        expect(savedFilename).not.toMatch(/[<>"'&;\r\n\0/\\]|\.\./);
        expect(savedFilename).not.toContain("<script>");

        expect(infoSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                cid: "bafyroutesafe",
                filename: savedFilename,
            }),
            "[IPFSService] File uploaded successfully",
        );
    });
});
