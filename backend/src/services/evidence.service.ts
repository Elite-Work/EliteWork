import axios from "axios";
import { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { IPFSService, ServiceUnavailableError } from "./ipfs.service";
import { getAdminAllowlistLowercase } from "../lib/accessControl";
import { env, runtimeEnvValue } from "../config/env";

export class EvidenceAccessDeniedError extends Error {
    status = 403;
    constructor() {
        super("Access denied: you are not a party to this trade");
        this.name = "EvidenceAccessDeniedError";
    }
}

export class EvidenceTradeNotFoundError extends Error {
    status = 404;
    constructor() {
        super("Trade not found");
        this.name = "EvidenceTradeNotFoundError";
    }
}

export class EvidenceValidationError extends Error {
    status = 400;
    constructor(message = "Invalid evidence file") {
        super(message);
        this.name = "EvidenceValidationError";
    }
}

export class EvidenceScanError extends Error {
    status = 503;
    constructor(message = "Evidence scan service unavailable") {
        super(message);
        this.name = "EvidenceScanError";
    }
}

export interface EvidenceScanResult {
    clean: boolean;
    reason?: string;
}

export interface EvidenceScanner {
    scan(file: Express.Multer.File): Promise<EvidenceScanResult>;
}

class NoopEvidenceScanner implements EvidenceScanner {
    async scan(): Promise<EvidenceScanResult> {
        return { clean: true };
    }
}

function getEvidenceMetadataRetentionDays(): number {
    return runtimeEnvValue("EVIDENCE_METADATA_RETENTION_DAYS");
}

function isEvidenceMetadataExpired(createdAt: Date): boolean {
    const retentionMs = getEvidenceMetadataRetentionDays() * 24 * 60 * 60 * 1000;
    return Date.now() - createdAt.getTime() > retentionMs;
}

type EvidenceDatabase = {
    trade: Pick<PrismaClient["trade"], "findUnique">;
    tradeEvidence: Pick<PrismaClient["tradeEvidence"], "findMany" | "create">;
};

export class EvidenceService {
    private ipfs: IPFSService;
    private scanner: EvidenceScanner;
    /** In-process cache: CID → resolved gateway URL */
    private readonly urlCache = new Map<string, string>();
    /** In-process gateway circuit state. */
    private readonly gatewayCircuit = new Map<string, { failures: number; openUntil: number }>();

    constructor(
        private readonly prisma: EvidenceDatabase = defaultPrisma as unknown as EvidenceDatabase,
        ipfs?: IPFSService,
        scanner?: EvidenceScanner,
    ) {
        this.ipfs = ipfs ?? new IPFSService();
        this.scanner = scanner ?? new NoopEvidenceScanner();
    }

    /** Return all evidence records for a trade. Caller must be buyer or seller. */
    async getEvidenceByTradeId(tradeId: string, callerAddress: string) {
        const trade = await this.prisma.trade.findUnique({
            where: { tradeId },
        });

        if (!trade) throw new EvidenceTradeNotFoundError();

        const caller = callerAddress.toLowerCase();
        const isAdmin = getAdminAllowlistLowercase().has(caller);
        if (
            trade.buyerAddress.toLowerCase() !== caller &&
            trade.sellerAddress.toLowerCase() !== caller &&
            !isAdmin
        ) {
            throw new EvidenceAccessDeniedError();
        }

        const records = await this.prisma.tradeEvidence.findMany({
            where: { tradeId },
            orderBy: { createdAt: "asc" },
        });

        return records.map((r) => {
            const retentionExpired = isEvidenceMetadataExpired(r.createdAt);
            return {
                id: r.id,
                cid: retentionExpired ? "redacted" : r.cid,
                filename: retentionExpired ? "redacted" : r.filename,
                mimeType: r.mimeType,
                uploadedBy: retentionExpired && !isAdmin ? "redacted" : r.uploadedBy,
                url: retentionExpired ? null : this.resolveGatewayUrl(r.cid),
                createdAt: r.createdAt,
                retentionExpired,
            };
        });
    }

    /**
     * Upload a video file to IPFS and persist the evidence record.
     * Caller must be buyer or seller of the referenced trade.
     */
    async uploadVideoEvidence(
        tradeId: string,
        callerAddress: string,
        file: Express.Multer.File,
    ) {
        const trade = await this.prisma.trade.findUnique({ where: { tradeId } });
        if (!trade) throw new EvidenceTradeNotFoundError();

        const caller = callerAddress.toLowerCase();
        if (
            trade.buyerAddress.toLowerCase() !== caller &&
            trade.sellerAddress.toLowerCase() !== caller
        ) {
            throw new EvidenceAccessDeniedError();
        }

        // Validate declared mime type
        const allowed = ["video/mp4", "video/webm"];
        if (!allowed.includes(file.mimetype)) {
            throw new EvidenceValidationError("Unsupported file type");
        }

        // Validate mime by magic bytes to prevent spoofed content-type uploads.
        const sniffed = this.sniffMimeType(file.buffer);
        if (!sniffed || sniffed !== file.mimetype) {
            throw new EvidenceValidationError("File content does not match declared MIME type");
        }

        // Enforce configurable size limit (default 50MB)
        const size = file.size ?? file.buffer.length;
        const MAX = env.EVIDENCE_MAX_BYTES;
        if (size > MAX) {
            throw new EvidenceValidationError("File too large");
        }

        const scan = await this.runEvidenceScan(file);
        if (!scan.clean) {
            throw new EvidenceValidationError(scan.reason || "Evidence blocked by malware scanner");
        }

        const cid = await this.ipfs.uploadFile(file.buffer, file.originalname);

        const record = await this.prisma.tradeEvidence.create({
            data: {
                tradeId,
                cid,
                filename: file.originalname,
                mimeType: file.mimetype,
                uploadedBy: caller,
            },
        });

        return {
            evidenceId: record.id,
            cid,
            ipfsUrl: this.resolveGatewayUrl(cid),
        };
    }

    /**
     * Proxy-stream a file from the IPFS gateway with optional Range support.
     * Returns an axios response stream so the route can pipe it.
     */
    async streamFromIPFS(cid: string, range?: string) {
        // Build list of gateway base URLs to try. Prefer explicit env var list.
        const urls = this.resolveGatewayUrls(cid);

        const headers: Record<string, string> = {};
        if (range) headers["Range"] = range;

        const timeoutMs = env.IPFS_STREAM_TIMEOUT_MS;

        let lastError: unknown = null;
        for (const url of urls) {
            if (this.isGatewayCircuitOpen(url)) {
                continue;
            }

            try {
                const response = await axios.get(url, {
                    responseType: "stream",
                    headers,
                    timeout: timeoutMs,
                    validateStatus: (s) => s < 500,
                });
                this.onGatewaySuccess(url);
                return response;
            } catch (err) {
                lastError = err;
                this.onGatewayFailure(url);
            }
        }

        if (lastError) {
            throw new ServiceUnavailableError();
        }
        throw new ServiceUnavailableError();
    }

    /** Resolve and cache the public gateway URL for a CID. */
    private resolveGatewayUrl(cid: string): string {
        if (this.urlCache.has(cid)) {
            return this.urlCache.get(cid)!;
        }
        const url = this.ipfs.getFileUrl(cid);
        this.urlCache.set(cid, url);
        return url;
    }

    private sniffMimeType(buffer: Buffer): "video/mp4" | "video/webm" | null {
        // MP4: bytes 4-7 should contain 'ftyp' marker in ISO BMFF containers.
        if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
            return "video/mp4";
        }

        // WebM: EBML header starts with 0x1A45DFA3.
        if (
            buffer.length >= 4 &&
            buffer[0] === 0x1a &&
            buffer[1] === 0x45 &&
            buffer[2] === 0xdf &&
            buffer[3] === 0xa3
        ) {
            return "video/webm";
        }

        return null;
    }

    private async runEvidenceScan(file: Express.Multer.File): Promise<EvidenceScanResult> {
        const required =
            process.env.EVIDENCE_SCAN_REQUIRED !== undefined
                ? process.env.EVIDENCE_SCAN_REQUIRED.toLowerCase() === "true"
                : env.EVIDENCE_SCAN_REQUIRED;
        try {
            return await this.scanner.scan(file);
        } catch (error) {
            if (!required) {
                return { clean: true };
            }
            throw new EvidenceScanError(
                error instanceof Error ? error.message : "Evidence scan service unavailable",
            );
        }
    }

    private resolveGatewayUrls(cid: string): string[] {
        if (!/^[a-zA-Z0-9._-]+$/.test(cid) || cid.includes("..")) {
            throw new ServiceUnavailableError("Invalid IPFS CID");
        }

        const gatewayUrls = process.env.IPFS_GATEWAY_URLS ?? env.IPFS_GATEWAY_URLS;
        const allowlist = this.parseGatewayAllowlist();
        const configured: string[] = [];

        if (gatewayUrls) {
            for (const value of gatewayUrls.split(",")) {
                const gateway = value.trim();
                if (!gateway) continue;
                const normalized = gateway.replace(/\/$/, "");
                if (!this.isGatewayAllowed(normalized, allowlist)) {
                    continue;
                }
                configured.push(`${normalized}/${cid}`);
            }
        }

        if (configured.length > 0) {
            return configured;
        }

        // If IPFS_GATEWAY_URLS was explicitly set (non-empty) and every entry was
        // rejected (e.g., private/internal IP or not allowlisted), fail closed
        // instead of silently falling back to IPFS_GATEWAY_URL.
        if (gatewayUrls && gatewayUrls.trim().length > 0) {
            throw new ServiceUnavailableError("No allowed IPFS gateway configured");
        }

        const fallback = this.resolveGatewayUrl(cid);
        const fallbackBase = fallback.replace(/\/+[^/]+$/, "");
        if (!this.isGatewayAllowed(fallbackBase, allowlist)) {
            throw new ServiceUnavailableError("No allowed IPFS gateway configured");
        }
        return [fallback];
    }

    private parseGatewayAllowlist(): Set<string> {
        const raw = process.env.IPFS_GATEWAY_ALLOWLIST ?? env.IPFS_GATEWAY_ALLOWLIST ?? "";
        return new Set(
            raw
                .split(",")
                .map((v: string) => v.trim().toLowerCase())
                .filter(Boolean),
        );
    }

    private isGatewayAllowed(gatewayBase: string, allowlist: Set<string>): boolean {
        try {
            const parsed = new URL(gatewayBase);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
                return false;
            }
            if (parsed.username || parsed.password) {
                return false;
            }
            const host = parsed.hostname.toLowerCase();
            if (!host || this.isPrivateOrInternalHost(host)) {
                return false;
            }
            if (allowlist.size === 0) return true;
            return allowlist.has(host);
        } catch {
            return false;
        }
    }

    private isPrivateOrInternalHost(hostname: string): boolean {
        const bare = hostname.startsWith("[") && hostname.endsWith("]")
            ? hostname.slice(1, -1)
            : hostname;
        const lower = bare.toLowerCase();

        if (
            lower === "localhost" ||
            lower.endsWith(".localhost") ||
            lower.endsWith(".local") ||
            lower.endsWith(".internal")
        ) {
            return true;
        }

        // Handle IPv4-mapped IPv6 addresses (dotted or WHATWG-normalized hex, e.g. ::ffff:7f00:1)
        if (lower.startsWith("::ffff:")) {
            const mapped = lower.slice("::ffff:".length);
            if (this.isPrivateOrInternalIpv4(mapped)) {
                return true;
            }
            const hexMatch = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(mapped);
            if (hexMatch) {
                const hi = parseInt(hexMatch[1], 16);
                const lo = parseInt(hexMatch[2], 16);
                const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
                if (this.isPrivateOrInternalIpv4(ipv4)) {
                    return true;
                }
            }
        }

        // Loopback, unspecified, link-local (fe80::/10), unique local (fc00::/7)
        if (
            lower === "::1" ||
            lower === "::" ||
            lower === "0:0:0:0:0:0:0:1" ||
            lower === "0:0:0:0:0:0:0:0" ||
            /^fe[89ab][0-9a-f]:/i.test(lower) ||
            /^f[cd][0-9a-f]{2}:/i.test(lower)
        ) {
            return true;
        }

        return this.isPrivateOrInternalIpv4(lower);
    }

    private isPrivateOrInternalIpv4(host: string): boolean {
        const parts = host.split(".");
        if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) {
            return false;
        }
        const octets = parts.map((p) => Number(p));
        if (octets.some((o) => o < 0 || o > 255)) {
            return false;
        }
        const [o1, o2] = octets;
        if (o1 === 0) return true; // 0.0.0.0/8 ("this" network)
        if (o1 === 10) return true; // 10.0.0.0/8 (RFC1918)
        if (o1 === 100 && o2 >= 64 && o2 <= 127) return true; // 100.64.0.0/10 (CGNAT)
        if (o1 === 127) return true; // 127.0.0.0/8 (loopback)
        if (o1 === 169 && o2 === 254) return true; // 169.254.0.0/16 (link-local / cloud metadata)
        if (o1 === 172 && o2 >= 16 && o2 <= 31) return true; // 172.16.0.0/12 (RFC1918)
        if (o1 === 192 && o2 === 168) return true; // 192.168.0.0/16 (RFC1918)
        if (o1 >= 224) return true; // multicast / reserved / broadcast
        return false;
    }

    private isGatewayCircuitOpen(url: string): boolean {
        const state = this.gatewayCircuit.get(url);
        if (!state) return false;
        return state.openUntil > Date.now();
    }

    private onGatewaySuccess(url: string): void {
        this.gatewayCircuit.delete(url);
    }

    private onGatewayFailure(url: string): void {
        const threshold = runtimeEnvValue("IPFS_GATEWAY_CIRCUIT_FAILURE_THRESHOLD");
        const cooldownMs = runtimeEnvValue("IPFS_GATEWAY_CIRCUIT_COOLDOWN_MS");
        const current = this.gatewayCircuit.get(url) ?? { failures: 0, openUntil: 0 };
        const failures = current.failures + 1;

        if (failures >= threshold) {
            this.gatewayCircuit.set(url, {
                failures,
                openUntil: Date.now() + cooldownMs,
            });
            return;
        }

        this.gatewayCircuit.set(url, {
            failures,
            openUntil: 0,
        });
    }
}
