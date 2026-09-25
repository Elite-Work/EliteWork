import express from "express";
import request from "supertest";
import { createHealthDetailRouter } from "../routes/health.detail.routes";
import { HealthService } from "../services/health.service";

jest.mock("../services/health.service");
jest.mock("../middleware/logger", () => ({ appLogger: { info: jest.fn(), error: jest.fn() } }));

type HealthResponse = Awaited<ReturnType<HealthService["performHealthCheck"]>>;
type HealthChecks = HealthResponse["checks"];
type HealthResultOverrides = Omit<Partial<HealthResponse>, "checks"> & {
    checks?: Partial<HealthChecks>;
};

const upCheck = (latency = 5) => ({ status: "up" as const, message: "ok", responseTime: latency });
const downCheck = (msg = "timeout") => ({ status: "down" as const, message: msg, responseTime: 5000 });

function makeHealthResult(overrides: HealthResultOverrides = {}): HealthResponse {
    const { checks: checkOverrides, ...rest } = overrides;
    return {
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: 100,
        checks: {
            database: upCheck(),
            indexer: upCheck(),
            stellar: upCheck(),
            sorobanRpc: upCheck(),
            ipfs: upCheck(),
            redis: upCheck(),
            config: upCheck(),
            ...checkOverrides,
        },
        details: {
            databaseLatency: 5,
            redisLatency: 5,
            indexerLagSeconds: 0,
            lastProcessedLedger: null,
            stellarNetwork: "testnet",
            ipfsGateway: "https://gateway.pinata.cloud/ipfs",
            missingEnvVars: [],
            circuitBreakers: [],
        },
        ...rest,
    };
}

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use("/health", createHealthDetailRouter());
    return app;
}

describe("GET /health/detail (#729)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns 200 with per-service status and latency when all healthy", async () => {
        jest.mocked(HealthService.prototype.performHealthCheck).mockResolvedValue(makeHealthResult());

        const res = await request(buildApp()).get("/health/detail");

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("healthy");
        expect(res.body.checks.database).toMatchObject({ status: "up", latency: expect.any(Number) });
        expect(res.body.checks.redis).toMatchObject({ status: "up", latency: expect.any(Number) });
    });

    it("returns 200 with degraded status when one service is down", async () => {
        jest.mocked(HealthService.prototype.performHealthCheck).mockResolvedValue(
            makeHealthResult({
                status: "degraded",
                checks: {
                    database: upCheck(),
                    indexer: downCheck("connection refused"),
                    stellar: upCheck(),
                    ipfs: upCheck(),
                    redis: upCheck(),
                    config: upCheck(),
                },
            })
        );

        const res = await request(buildApp()).get("/health/detail");

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("degraded");
        expect(res.body.checks.indexer.status).toBe("down");
        expect(res.body.checks.indexer.error).toBe("connection refused");
    });

    it("returns 503 when all services are down (unhealthy)", async () => {
        jest.mocked(HealthService.prototype.performHealthCheck).mockResolvedValue(
            makeHealthResult({
                status: "unhealthy",
                checks: {
                    database: downCheck("DB unreachable"),
                    indexer: downCheck(),
                    stellar: downCheck(),
                    ipfs: downCheck(),
                    redis: downCheck(),
                    config: downCheck(),
                },
            })
        );

        const res = await request(buildApp()).get("/health/detail");

        expect(res.status).toBe(503);
        expect(res.body.status).toBe("unhealthy");
    });

    it("does not include error field for healthy services", async () => {
        jest.mocked(HealthService.prototype.performHealthCheck).mockResolvedValue(makeHealthResult());

        const res = await request(buildApp()).get("/health/detail");

        expect(res.body.checks.database.error).toBeUndefined();
    });

    it("returns 503 with error field when performHealthCheck throws", async () => {
        jest.mocked(HealthService.prototype.performHealthCheck).mockRejectedValue(new Error("unexpected"));

        const res = await request(buildApp()).get("/health/detail");

        expect(res.status).toBe(503);
        expect(res.body.status).toBe("down");
        expect(res.body.error).toBeDefined();
    });
});
