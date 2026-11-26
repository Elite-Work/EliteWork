import axios from "axios";
import express from "express";
import request from "supertest";
import { Readable } from "stream";
import { createEvidenceRouter } from "../routes/evidence.routes";
import { EvidenceService } from "../services/evidence.service";
import { ServiceUnavailableError } from "../services/ipfs.service";
import { createMockAxiosResponse, createMockPrisma } from "./factories/mockFactories";
import type { MockedPrisma } from "./factories/mockFactories";

jest.mock("../middleware/auth.middleware", () => ({
    authMiddleware: (req: any, _res: any, next: any) => {
        req.user = { walletAddress: "GCBUYER0000000000000000000000000000000000000000000000000" };
        next();
    },
}));

describe("IPFS proxy SSRF prevention (#487)", () => {
    let prisma: MockedPrisma;
    let service: EvidenceService;
    const originalEnv = process.env;

    beforeEach(() => {
        prisma = createMockPrisma();
        service = new EvidenceService(prisma);
        jest.restoreAllMocks();
        process.env = { ...originalEnv };
        delete process.env.IPFS_GATEWAY_URLS;
        delete process.env.IPFS_GATEWAY_URL;
        delete process.env.IPFS_GATEWAY_ALLOWLIST;
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    it.each([
        ["loopback IPv4", "http://127.0.0.1:8080/ipfs"],
        ["localhost hostname", "http://localhost:8080/ipfs"],
        ["sub-localhost hostname", "http://ipfs.localhost/ipfs"],
        ["AWS/cloud metadata link-local IP", "http://169.254.169.254/latest/meta-data"],
        ["RFC1918 10.0.0.0/8", "http://10.0.0.1/ipfs"],
        ["RFC1918 172.16.0.0/12", "http://172.16.0.1/ipfs"],
        ["RFC1918 192.168.0.0/16", "http://192.168.1.1/ipfs"],
        ["CGNAT 100.64.0.0/10", "http://100.64.0.1/ipfs"],
        ["unspecified 0.0.0.0", "http://0.0.0.0:8080/ipfs"],
        ["IPv6 loopback", "http://[::1]:8080/ipfs"],
        ["IPv4-mapped IPv6 loopback", "http://[::ffff:127.0.0.1]/ipfs"],
        ["IPv4-mapped IPv6 metadata", "http://[::ffff:169.254.169.254]/latest/meta-data"],
        ["IPv6 link-local", "http://[fe80::1]/ipfs"],
        ["IPv6 unique local", "http://[fd00::1]/ipfs"],
        ["decimal encoded loopback IP", "http://2130706433/ipfs"],
        ["hex encoded loopback IP", "http://0x7f000001/ipfs"],
        ["internal DNS suffix", "http://metadata.google.internal/computeMetadata/v1"],
        ["mDNS .local suffix", "http://internal-gateway.local/ipfs"],
        ["non-HTTP scheme", "file:///etc/passwd"],
    ])("blocks %s (%s) in IPFS_GATEWAY_URLS even without an explicit allowlist", async (_label, blockedUrl) => {
        process.env.IPFS_GATEWAY_URLS = blockedUrl;
        const getSpy = jest.spyOn(axios, "get");

        await expect(service.streamFromIPFS("bafydeadbeef")).rejects.toBeInstanceOf(
            ServiceUnavailableError,
        );
        expect(getSpy).not.toHaveBeenCalled();
    });

    it("blocks private/internal fallback IPFS_GATEWAY_URL", async () => {
        process.env.IPFS_GATEWAY_URL = "http://169.254.169.254/latest/meta-data";
        const getSpy = jest.spyOn(axios, "get");

        await expect(service.streamFromIPFS("bafydeadbeef")).rejects.toBeInstanceOf(
            ServiceUnavailableError,
        );
        expect(getSpy).not.toHaveBeenCalled();
    });

    it("skips blocked private gateways and uses a valid public gateway in IPFS_GATEWAY_URLS", async () => {
        process.env.IPFS_GATEWAY_URLS =
            "http://127.0.0.1:8080/ipfs,http://169.254.169.254/latest,https://gateway.pinata.cloud/ipfs";

        const getSpy = jest.spyOn(axios, "get").mockResolvedValue(
            createMockAxiosResponse(Readable.from(Buffer.from("video-bytes")), {
                status: 200,
                headers: { "content-type": "video/mp4" },
            }),
        );

        const res = await service.streamFromIPFS("bafyvalidcid");

        expect(res.status).toBe(200);
        expect(getSpy).toHaveBeenCalledTimes(1);
        expect(getSpy).toHaveBeenCalledWith(
            "https://gateway.pinata.cloud/ipfs/bafyvalidcid",
            expect.any(Object),
        );
    });

    it.each([
        "../admin",
        "bafy@127.0.0.1",
        "bafy?redirect=http://127.0.0.1",
        "bafy#fragment",
    ])("rejects unsafe CID payload (%s) before constructing gateway URL", async (maliciousCid) => {
        process.env.IPFS_GATEWAY_URLS = "https://gateway.pinata.cloud/ipfs";
        const getSpy = jest.spyOn(axios, "get");

        await expect(service.streamFromIPFS(maliciousCid)).rejects.toBeInstanceOf(
            ServiceUnavailableError,
        );
        expect(getSpy).not.toHaveBeenCalled();
    });

    it("returns 502 from GET /evidence/:cid/stream without issuing an internal request", async () => {
        process.env.IPFS_GATEWAY_URLS = "http://127.0.0.1:8080/ipfs";
        const getSpy = jest.spyOn(axios, "get");

        const app = express();
        app.use(createEvidenceRouter(service));

        const res = await request(app).get("/evidence/bafydeadbeef/stream").expect(502);

        expect(res.body).toEqual({ error: "Failed to stream from IPFS gateway" });
        expect(getSpy).not.toHaveBeenCalled();
    });
});
