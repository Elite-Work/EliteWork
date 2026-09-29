import "./config/loadEnv";
import express from "express";
import fs from "fs";
import path from "path";
import swaggerUi from "swagger-ui-express";
import YAML from "yamljs";
import { prisma } from "./lib/db";
import { EventListenerService } from "./services/eventListener.service";
import { createApp } from "./app";
import { env } from "./config/env";
import { appLogger } from "./middleware/logger";
import { initializeTracing } from "./config/tracing";
import { HealthService } from "./services/health.service";
import { createReconciliationWorker } from "./jobs/workers/reconciliation.worker";
import { createPiiLogScannerWorker } from "./jobs/workers/piiLogScanner.worker";
import { reconciliationQueue, piiScanQueue, closeAllQueueConnections } from "./jobs/queue";
import { redis } from "./lib/redis";
import { ShutdownOrchestrator, Shutdownable } from "./lib/shutdown";
import { formatConfigFingerprint } from "./config/env";

void env;

// Initialize distributed tracing before any other imports
initializeTracing();

const shutDownOrchestrator = new ShutdownOrchestrator({
  drainTimeoutMs: Number(process.env.SHUTDOWN_DRAIN_TIMEOUT_MS ?? 20_000),
  forceExitTimeoutMs: Number(process.env.SHUTDOWN_FORCE_EXIT_TIMEOUT_MS ?? 30_000),
});

const app = createApp(() => shutDownOrchestrator.isShuttingDown());
const port = env.PORT;

const docsDir = path.join(__dirname, "docs");
const openapiYamlPath = path.join(docsDir, "openapi.yaml");
const openapiJsonPath = path.join(docsDir, "openapi.json");

let openapiSpec: Record<string, unknown> | null = null;
try {
  openapiSpec = YAML.load(openapiYamlPath) as Record<string, unknown>;
} catch (error) {
  appLogger.warn({ error }, "OpenAPI spec could not be loaded");
}

if (env.NODE_ENV !== "production" && openapiSpec) {
  // Override server URL from env so Try It Out links work in deployed environments
  if (env.API_PUBLIC_URL && Array.isArray(openapiSpec.servers)) {
    openapiSpec.servers = [{ url: env.API_PUBLIC_URL }];
  }

  // Auto-generate stable operationId for every operation so generated docs
  // have consistent anchor links and code-gen-friendly function names
  if (typeof openapiSpec.paths === "object" && openapiSpec.paths) {
    for (const [path, methods] of Object.entries(
      openapiSpec.paths as Record<string, unknown>,
    )) {
      for (const [method, operation] of Object.entries(
        methods as Record<string, unknown>,
      )) {
        if (typeof operation === "object" && operation !== null && !(operation as Record<string, unknown>).operationId) {
          const safePath = path
            .replace(/[{}]/g, "")
            .replace(/[^a-zA-Z0-9_/]/g, "_")
            .replace(/\/+/g, ".")
            .replace(/^\.|\.$/g, "")
            .replace(/\.+/g, ".");
          (operation as Record<string, unknown>).operationId = `${method}${safePath ? `.${safePath}` : ""}`;
        }
      }
    }
  }

  try {
    fs.writeFileSync(openapiJsonPath, JSON.stringify(openapiSpec, null, 2));
  } catch (error) {
    appLogger.warn({ error }, "OpenAPI spec could not be exported");
  }

  app.get("/api/docs/openapi.json", (_req, res) => {
    res.json(openapiSpec);
  });

  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec));
}

const eventListenerService = new EventListenerService(prisma);
const healthService = new HealthService();

let reconciliationWorker: ReturnType<typeof createReconciliationWorker> | undefined;
let piiLogScannerWorker: ReturnType<typeof createPiiLogScannerWorker> | undefined;

async function startReconciliationCron() {
  if (!env.RECONCILIATION_CRON_ENABLED) {
    appLogger.info("Reconciliation cron is disabled");
    return;
  }

  try {
    reconciliationWorker = createReconciliationWorker();
    appLogger.info("Reconciliation worker started");

    // Schedule daily sweep at 02:00 UTC
    await reconciliationQueue.add(
      "daily-sweep",
      {},
      {
        repeat: {
          pattern: "0 2 * * *",
        },
      },
    );
    appLogger.info("Reconciliation daily sweep scheduled (02:00 UTC)");
  } catch (error) {
    appLogger.error({ error }, "Failed to start reconciliation cron");
  }
}

async function startPiiScanCron() {
  if (!env.PII_SCANNER_CRON_ENABLED) {
    appLogger.info("PII log scanner cron is disabled");
    return;
  }

  try {
    piiLogScannerWorker = createPiiLogScannerWorker();
    appLogger.info("PII log scanner worker started");

    // Weekly sweep, Sunday 03:00 UTC — offset from the reconciliation sweep
    // to avoid contending for the same Redis connection/CPU window.
    await piiScanQueue.add(
      "weekly-scan",
      {},
      {
        repeat: {
          pattern: "0 3 * * 0",
        },
      },
    );
    appLogger.info("PII log scan scheduled (Sundays 03:00 UTC)");
  } catch (error) {
    appLogger.error({ error }, "Failed to start PII log scanner cron");
  }
}

async function bootstrap() {
  const isTest = (process.env.NODE_ENV ?? env.NODE_ENV) === "test";

  // Sanitized effective-config fingerprint. Secret values are redacted to a
  // stable marker so the boot log confirms which secrets are present without
  // ever exposing them.
  appLogger.info(
    { effectiveConfig: formatConfigFingerprint({ ...process.env }) },
    "Effective configuration fingerprint",
  );

  if (!isTest) {
    appLogger.info("Performing startup readiness check...");
    try {
      const startupCheck = await healthService.performStartupCheck();
      if (startupCheck.status !== "ready") {
        appLogger.fatal({ checks: startupCheck.checks }, "Critical startup dependencies are not ready. Exiting.");
        process.exit(1);
      }
      appLogger.info("Startup readiness check passed.");
    } catch (error) {
      appLogger.fatal({ error }, "Failed to perform startup check. Exiting.");
      process.exit(1);
    }
  }

  const server = app.listen(port, async () => {
    appLogger.info({ port }, "Amana backend listening");

    try {
      await eventListenerService.start();
      appLogger.info("EventListenerService started successfully");
    } catch (error) {
      appLogger.error({ error }, "Failed to start EventListenerService");
    }

    await startReconciliationCron();
    await startPiiScanCron();
  });

  // Ordered, bounded, logged graceful shutdown.
  // 1. Readiness probes return 503 (createApp wired to orchestrator state)
  // 2. HTTP server drains in-flight requests
  // 3. Event listener drains in-flight poll and logs the last cursor
  // 4. BullMQ workers drain active jobs (pause new pickup via worker.close)
  // 5. Queue producer connections close
  // 6. Redis singleton disconnects
  // 7. Prisma/Postgres disconnects
  const shutdown = async (signal: string) => {
    const services: Shutdownable[] = [
      {
        name: "event-listener",
        stop: async () => {
          await eventListenerService.drain();
        },
      },
      {
        name: "reconciliation-worker",
        stop: async () => {
          if (reconciliationWorker) await reconciliationWorker.close();
          else appLogger.info("Reconciliation worker not running — skipping");
        },
      },
      {
        name: "pii-worker",
        stop: async () => {
          if (piiLogScannerWorker) await piiLogScannerWorker.close();
          else appLogger.info("PII worker not running — skipping");
        },
      },
      {
        name: "queue-connections",
        stop: async () => {
          await reconciliationQueue.close();
          await piiScanQueue.close();
          await closeAllQueueConnections();
        },
      },
      {
        name: "redis",
        stop: async () => {
          await redis.quit();
        },
      },
      { name: "database", stop: () => prisma.$disconnect() },
    ];
    await shutDownOrchestrator.shutdown(signal, server, services);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

bootstrap().catch((error) => {
  appLogger.fatal({ error }, "Fatal bootstrap error");
  process.exit(1);
});
