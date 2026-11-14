import { Readable } from "node:stream";
import axios from "axios";
import express, { NextFunction, Response } from "express";
import request from "supertest";
import { AuthRequest } from "../middleware/auth.middleware";
import { createEvidenceRouter } from "../routes/evidence.routes";
import {
    EvidenceService,
    isPrivateOrInternalIp,
    isSafeIpfsGatewayUrl,
} from "../services/evidence.service";
import { ServiceUnavailableError } from "../services/ipfs.service";

jest.mock("../middleware/auth.middleware", () => ({
    authMiddleware: (req: AuthRequest, _res: Response, next: NextFunction) => {
        req.user = {
            sub: "GCBUYER0000000000000000000000000000000000000000000000000",
            walletAddress: "GCBUYER0000000000000000000000000000000000000000000000000",
            jti: "test-jti-1",
            tv: 0,
        };
        next();
    },
}));

type EvidenceCtorPrisma = ConstructorParameters<typeof EvidenceService>[0];

function buildEvidenceService(): EvidenceService {
    const prisma = {
        trade: { findUnique: jest.fn() },
        tradeEvidence: { findMany: jest.fn(), create: jest.fn() },
    } as unknown as EvidenceCtorPrisma;
    return new EvidenceService(prisma);
}

function mockAxiosStreamSuccess(status = 200) {
    return jest.spyOn(axios, "get").mockImplementation((async () => ({
        status,
        statusText: status === 200 ? "OK" : "Redirect",
        headers: { "content-type": "video/mp4" },
        config: {} as never,
        data: Readable.from(Buffer.from("ok")),
    })) as unknown as typeof axios.get);
}

describe("IPFS Proxy SSRF Protection (#487)", () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        jest.restoreAllMocks();
        process.env = { ...originalEnv };
        delete process.env.IPFS_GATEWAY_URLS;
        delete process.env.IPFS_GATEWAY_ALLOWLIST;
        delete process.env.IPFS_GATEWAY_URL;
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    describe("isPrivateOrInternalIp", () => {
        it.each([
            ["loopback IPv4", "127.0.0.1"],
            ["RFC1918 10/8", "10.0.0.1"],
            ["RFC1918 172.16/12 lower", "172.16.0.1"],
            ["RFC1918 172.16/12 upper", "172.31.255.254"],
            ["RFC1918 192.168/16", "192.168.1.1"],
            ["cloud metadata link-local", "169.254.169.254"],
            ["CGNAT 100.64/10", "100.64.0.1"],
            ["this-network 0/8", "0.0.0.0"],
            ["multicast 224/4", "224.0.0.1"],
            ["limited broadcast", "255.255.255.255"],
            ["IPv6 loopback", "::1"],
            ["bracketed IPv6 loopback", "[::1]"],
            ["IPv6 unspecified", "::"],
            ["IPv4-mapped loopback dotted", "::ffff:127.0.0.1"],
            ["IPv4-mapped metadata dotted", "::ffff:169.254.169.254"],
            ["IPv4-mapped loopback hex", "::ffff:7f00:1"],
            ["AWS IPv6 ULA metadata", "fd00:ec2::254"],
            ["IPv6 ULA fc00::/7", "fc00::1"],
            ["IPv6 link-local", "fe80::1"],
            ["IPv6 link-local with zone", "fe80::1%eth0"],
        ])("flags %s (%s) as private/internal", (_label, ip) => {
            expect(isPrivateOrInternalIp(ip)).toBe(true);
        });

        it.each([
            ["Cloudflare DNS IPv4", "1.1.1.1"],
            ["Google DNS IPv4", "8.8.8.8"],
            ["adjacent below 172.16/12", "172.15.255.254"],
            ["adjacent above 172.16/12", "172.32.0.1"],
            ["Cloudflare DNS IPv6", "2606:4700:4700::1111"],
            ["Google DNS IPv6", "2001:4860:4860::8888"],
        ])("allows public IP %s (%s)", (_label, ip) => {
            expect(isPrivateOrInternalIp(ip)).toBe(false);
        });
    });

    describe("isSafeIpfsGatewayUrl", () => {
        it.each([
            ["localhost", "http://localhost/ipfs"],
            ["subdomain localhost", "https://sub.localhost/ipfs"],
            ["GCP metadata internal", "http://metadata.google.internal/computeMetadata"],
            ["mDNS .local", "http://ipfs.local/ipfs"],
            ["single-label internal hostname", "http://redis:6379/"],
            ["file scheme", "file:///etc/passwd"],
            ["ftp scheme", "ftp://ipfs.io/ipfs"],
            ["embedded credentials", "https://user:pass@gateway.pinata.cloud/ipfs"],
            ["decimal loopback", "http://2130706433/ipfs"],
            ["hex loopback", "http://0x7f000001/ipfs"],
            ["IPv6 loopback", "http://[::1]:8080/ipfs"],
            ["IPv4-mapped loopback", "http://[::ffff:127.0.0.1]/ipfs"],
            ["IPv6 metadata ULA", "http://[fd00:ec2::254]/latest"],
            ["trailing dot internal", "http://metadata.google.internal./latest"],
        ])("rejects unsafe gateway URL (%s: %s)", (_label, url) => {
            expect(isSafeIpfsGatewayUrl(url)).toBe(false);
        });

        it.each([
            ["Pinata HTTPS", "https://gateway.pinata.cloud/ipfs"],
            ["ipfs.io HTTPS", "https://ipfs.io/ipfs"],
            ["public IPv4 HTTPS", "https://1.1.1.1/ipfs"],
            ["public IPv6 HTTPS", "https://[2606:4700:4700::1111]/ipfs"],
        ])("accepts safe public gateway URL (%s: %s)", (_label, url) => {
            expect(isSafeIpfsGatewayUrl(url)).toBe(true);
        });
    });

    describe("EvidenceService.streamFromIPFS", () => {
        it.each([
            ["decimal loopback", "http://2130706433/ipfs", "2130706433,127.0.0.1"],
            ["hex loopback", "http://0x7f000001/ipfs", "0x7f000001,127.0.0.1"],
            ["AWS metadata", "http://169.254.169.254/latest/meta-data", "169.254.169.254"],
            ["IPv6 loopback", "http://[::1]:8080/ipfs", "::1"],
            ["IPv4-mapped IPv6 loopback", "http://[::ffff:127.0.0.1]/ipfs", "::ffff:7f00:1,::ffff:127.0.0.1"],
            ["AWS IPv6 metadata", "http://[fd00:ec2::254]/latest", "fd00:ec2::254"],
            ["localhost", "http://localhost:8080/ipfs", "localhost"],
            ["GCP metadata hostname", "http://metadata.google.internal/computeMetadata", "metadata.google.internal"],
        ])(
            "blocks %s (%s) with empty or explicit allowlist and fails closed without pinata fallback",
            async (_label, maliciousUrl, allowlistEntry) => {
                const axiosSpy = mockAxiosStreamSuccess(200);
                const service = buildEvidenceService();

                process.env.IPFS_GATEWAY_URLS = maliciousUrl;
                process.env.IPFS_GATEWAY_ALLOWLIST = "";
                await expect(service.streamFromIPFS("bafydeadbeef")).rejects.toBeInstanceOf(
                    ServiceUnavailableError,
                );

                process.env.IPFS_GATEWAY_ALLOWLIST = allowlistEntry;
                await expect(service.streamFromIPFS("bafydeadbeef")).rejects.toBeInstanceOf(
                    ServiceUnavailableError,
                );

                expect(axiosSpy).not.toHaveBeenCalled();
            },
        );

        it("skips blocked internal gateway entries and falls back to subsequent public gateway", async () => {
            const axiosSpy = mockAxiosStreamSuccess(200);
            process.env.IPFS_GATEWAY_URLS = "http://127.0.0.1:8080/ipfs,https://ipfs.io/ipfs";

            const service = buildEvidenceService();
            const res = await service.streamFromIPFS("bafyvalidcid123");

            expect(res.status).toBe(200);
            expect(axiosSpy).toHaveBeenCalledTimes(1);
            expect(axiosSpy).toHaveBeenCalledWith(
                "https://ipfs.io/ipfs/bafyvalidcid123",
                expect.objectContaining({
                    maxRedirects: 0,
                    responseType: "stream",
                }),
            );
        });

        it("blocks unsafe single fallback IPFS_GATEWAY_URL when IPFS_GATEWAY_URLS is unset", async () => {
            const axiosSpy = mockAxiosStreamSuccess(200);
            process.env.IPFS_GATEWAY_URL = "http://169.254.169.254/latest";

            const service = buildEvidenceService();
            await expect(service.streamFromIPFS("bafyvalidcid123")).rejects.toBeInstanceOf(
                ServiceUnavailableError,
            );
            expect(axiosSpy).not.toHaveBeenCalled();
        });

        it.each([
            "../latest/meta-data",
            "bafy/../../admin",
            "bafy?target=http://127.0.0.1",
            "bafy#fragment",
            "bafy@127.0.0.1",
            "%2e%2e%2fsecret",
            "bafy cid",
        ])("rejects unsafe CID %j before calling any gateway", async (unsafeCid) => {
            const axiosSpy = mockAxiosStreamSuccess(200);
            process.env.IPFS_GATEWAY_URLS = "https://ipfs.io/ipfs";

            const service = buildEvidenceService();
            await expect(service.streamFromIPFS(unsafeCid)).rejects.toBeInstanceOf(
                ServiceUnavailableError,
            );
            expect(axiosSpy).not.toHaveBeenCalled();
        });

        it("disables HTTP redirects via maxRedirects: 0 and rejects upstream 302 responses", async () => {
            const axiosSpy = mockAxiosStreamSuccess(302);
            process.env.IPFS_GATEWAY_URLS = "https://ipfs.io/ipfs";

            const service = buildEvidenceService();
            await expect(service.streamFromIPFS("bafyvalidcid123")).rejects.toBeInstanceOf(
                ServiceUnavailableError,
            );
            expect(axiosSpy).toHaveBeenCalledWith(
                "https://ipfs.io/ipfs/bafyvalidcid123",
                expect.objectContaining({ maxRedirects: 0 }),
            );
        });
    });

    describe("GET /evidence/:cid/stream route", () => {
        it("returns 502 and makes zero upstream requests when gateway targets cloud metadata", async () => {
            const axiosSpy = mockAxiosStreamSuccess(200);
            process.env.IPFS_GATEWAY_URLS = "http://169.254.169.254/latest";

            const service = buildEvidenceService();
            const app = express();
            app.use(createEvidenceRouter(service));

            const res = await request(app).get("/evidence/bafydeadbeef/stream");

            expect(res.status).toBe(502);
            expect(res.body).toEqual({ error: "Failed to stream from IPFS gateway" });
            expect(axiosSpy).not.toHaveBeenCalled();
        });
    });
});
