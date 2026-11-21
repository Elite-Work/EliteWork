import { isIP } from "node:net";
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

const BLOCKED_GATEWAY_HOSTNAMES = new Set([
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
]);
const BLOCKED_GATEWAY_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain"];

function stripIpBracketsAndZone(rawHost: string): string {
    const trimmed = rawHost.trim().toLowerCase();
    const unbracketed =
        trimmed.startsWith("[") && trimmed.endsWith("]") ? trimmed.slice(1, -1) : trimmed;
    const zoneIndex = unbracketed.indexOf("%");
    return zoneIndex === -1 ? unbracketed : unbracketed.slice(0, zoneIndex);
}

function isPrivateOrInternalIpv4Octets(octets: number[]): boolean {
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
        return true;
    }
    const [a, b, c] = octets;
    return (
        a === 0 || // "this" network (0.0.0.0/8)
        a === 10 || // RFC 1918 private (10.0.0.0/8)
        (a === 100 && b >= 64 && b <= 127) || // RFC 6598 CGNAT (100.64.0.0/10)
        a === 127 || // loopback (127.0.0.0/8)
        (a === 169 && b === 254) || // link-local & cloud metadata (169.254.0.0/16)
        (a === 172 && b >= 16 && b <= 31) || // RFC 1918 private (172.16.0.0/12)
        (a === 192 && b === 0 && c === 0) || // IETF protocol assignments (192.0.0.0/24)
        (a === 192 && b === 168) || // RFC 1918 private (192.168.0.0/16)
        (a === 198 && (b === 18 || b === 19)) || // benchmarking (198.18.0.0/15)
        a >= 224 // multicast (224.0.0.0/4) & reserved/broadcast (240.0.0.0/4)
    );
}

function parseIpv6Hextets(ip: string): number[] | null {
    const halves = ip.split("::");
    if (halves.length > 2) return null;

    const parseSide = (side: string): number[] | null => {
        if (!side) return [];
        const out: number[] = [];
        for (const part of side.split(":")) {
            if (part.includes(".")) {
                const octets = part.split(".").map(Number);
                if (
                    octets.length !== 4 ||
                    octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)
                ) {
                    return null;
                }
                out.push(octets[0] * 256 + octets[1], octets[2] * 256 + octets[3]);
                continue;
            }
            if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
            out.push(parseInt(part, 16));
        }
        return out;
    };

    const left = parseSide(halves[0]);
    if (!left) return null;
    if (halves.length === 1) {
        return left.length === 8 ? left : null;
    }
    const right = parseSide(halves[1]);
    if (!right) return null;
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    return [...left, ...Array<number>(missing).fill(0), ...right];
}

function extractIpv4OctetsFromHextets(hi: number, lo: number): number[] {
    return [Math.floor(hi / 256), hi % 256, Math.floor(lo / 256), lo % 256];
}

/**
 * Return true if an IP literal (IPv4 or IPv6, optionally bracketed) belongs to
 * loopback, private, link-local, metadata, CGNAT, multicast, or reserved ranges.
 */
export function isPrivateOrInternalIp(rawIp: string): boolean {
    const ip = stripIpBracketsAndZone(rawIp);
    const version = isIP(ip);
    if (version === 4) {
        return isPrivateOrInternalIpv4Octets(ip.split(".").map(Number));
    }
    if (version !== 6) {
        return false;
    }

    const h = parseIpv6Hextets(ip);
    if (!h) return true;

    const isAllZeroPrefix6 = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0;
    // Unspecified (::), loopback (::1), or deprecated IPv4-compatible (::/96)
    if (isAllZeroPrefix6) {
        if (h[6] === 0 && (h[7] === 0 || h[7] === 1)) return true;
        return isPrivateOrInternalIpv4Octets(extractIpv4OctetsFromHextets(h[6], h[7]));
    }
    // IPv4-mapped (::ffff:0:0/96) — Node's URL parser normalizes ::ffff:127.0.0.1 to ::ffff:7f00:1
    if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0xffff) {
        return isPrivateOrInternalIpv4Octets(extractIpv4OctetsFromHextets(h[6], h[7]));
    }
    // IPv4-translated (::ffff:0:0:0/96)
    if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0xffff && h[5] === 0) {
        return isPrivateOrInternalIpv4Octets(extractIpv4OctetsFromHextets(h[6], h[7]));
    }
    // NAT64 well-known / local-use prefixes (64:ff9b::/96, 64:ff9b:1::/48)
    if (h[0] === 0x0064 && h[1] === 0xff9b && (h[2] === 1 || (h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0))) {
        return true;
    }
    // Discard-only prefix (0100::/64)
    if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) {
        return true;
    }
    // 6to4 tunneling (2002::/16) embeds IPv4 in hextets 1..2
    if (h[0] === 0x2002) {
        return isPrivateOrInternalIpv4Octets(extractIpv4OctetsFromHextets(h[1], h[2]));
    }
    // Teredo tunneling (2001::/32)
    if (h[0] === 0x2001 && h[1] === 0x0000) {
        return true;
    }
    // Unique Local Addresses (fc00::/7 — includes AWS IPv6 IMDS fd00:ec2::254)
    if (h[0] >= 0xfc00 && h[0] <= 0xfdff) {
        return true;
    }
    // Link-local unicast (fe80::/10)
    if (h[0] >= 0xfe80 && h[0] <= 0xfebf) {
        return true;
    }
    // Multicast (ff00::/8)
    if (h[0] >= 0xff00) {
        return true;
    }

    return false;
}

/**
 * Validate that an IPFS gateway base URL uses http/https and targets a non-private,
 * non-internal host (blocking localhost, cloud metadata, RFC1918/ULA/link-local IPs).
 */
export function isSafeIpfsGatewayUrl(gatewayBase: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(gatewayBase);
    } catch {
        return false;
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
    }
    if (parsed.username !== "" || parsed.password !== "") {
        return false;
    }

    const host = stripIpBracketsAndZone(parsed.hostname).replace(/\.+$/, "");
    if (!host) {
        return false;
    }
    if (isIP(host) !== 0) {
        return !isPrivateOrInternalIp(host);
    }
    if (BLOCKED_GATEWAY_HOSTNAMES.has(host)) {
        return false;
    }
    if (BLOCKED_GATEWAY_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
        return false;
    }
    // Require a FQDN (at least one dot) so single-label internal service names like "redis" or "metadata" fail closed.
    if (!host.includes(".")) {
        return false;
    }

    return true;
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
                    maxRedirects: 0,
                    validateStatus: (s) => s < 500,
                });
                if ([301, 302, 303, 307, 308].includes(response.status)) {
                    throw new Error(`IPFS gateway redirect blocked (status ${response.status})`);
                }
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

    private static isSafeCid(cid: string): boolean {
        if (!cid || cid.includes("..") || /[/?#@\\%]/.test(cid)) {
            return false;
        }
        return ![...cid].some((ch) => {
            const code = ch.charCodeAt(0);
            return code <= 0x20 || code === 0x7f;
        });
    }

    private resolveGatewayUrls(cid: string): string[] {
        if (!EvidenceService.isSafeCid(cid)) {
            throw new ServiceUnavailableError("Invalid IPFS CID");
        }

        const gatewayUrls = process.env.IPFS_GATEWAY_URLS ?? env.IPFS_GATEWAY_URLS;
        const allowlist = this.parseGatewayAllowlist();
        const configuredEntries = gatewayUrls
            ? gatewayUrls
                  .split(",")
                  .map((value) => value.trim())
                  .filter(Boolean)
            : [];
        const configured: string[] = [];

        for (const gateway of configuredEntries) {
            const normalized = gateway.replace(/\/$/, "");
            if (!this.isGatewayAllowed(normalized, allowlist)) {
                continue;
            }
            configured.push(`${normalized}/${cid}`);
        }

        if (configured.length > 0) {
            return configured;
        }

        if (configuredEntries.length > 0) {
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
        if (!isSafeIpfsGatewayUrl(gatewayBase)) {
            return false;
        }
        if (allowlist.size === 0) {
            return true;
        }
        try {
            const host = stripIpBracketsAndZone(new URL(gatewayBase).hostname).replace(/\.+$/, "");
            return allowlist.has(host);
        } catch {
            return false;
        }
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
