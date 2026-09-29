import type { Server } from "http";
import { appLogger } from "../middleware/logger";

export interface Shutdownable {
  name: string;
  stop(): Promise<void> | void;
}

export interface ShutdownOptions {
  drainTimeoutMs?: number;
  forceExitTimeoutMs?: number;
}

const DEFAULT_DRAIN_TIMEOUT_MS = 20_000;
const DEFAULT_FORCE_EXIT_TIMEOUT_MS = 30_000;

async function withTimeout<T>(
  label: string,
  ms: number,
  fn: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Shutdown step "${label}" timed out after ${ms}ms`));
    }, ms);

    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Orchestrates graceful shutdown of all application subsystems in a
 * deterministic, bounded order:
 *
 *  1. Set `shuttingDown` flag → readiness probes return 503
 *  2. Close HTTP server (stop accepting new connections, drain in-flight)
 *  3. Stop Soroban event listener (wait for in-flight poll to finish)
 *  4. Close BullMQ workers (drain active jobs, pause new pickup)
 *  5. Close queue producer connections
 *  6. Disconnect Redis
 *  7. Disconnect Prisma/Postgres
 *
 * Each step is bounded by `drainTimeoutMs`. A hard `forceExitTimeoutMs`
 * timer guarantees the process exits even if a step hangs.
 */
export class ShutdownOrchestrator {
  private shuttingDown = false;
  private drainTimeoutMs: number;
  private forceExitTimeoutMs: number;
  private forceExitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ShutdownOptions = {}) {
    this.drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS;
    this.forceExitTimeoutMs =
      options.forceExitTimeoutMs ?? DEFAULT_FORCE_EXIT_TIMEOUT_MS;
  }

  /** Whether a shutdown is currently in progress. */
  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  /**
   * Execute the full shutdown sequence.
   * @param server     The HTTP server returned by `app.listen()`
   * @param services   Ordered list of services to shut down after the server
   */
  async shutdown(
    signal: string,
    server: Server,
    services: Shutdownable[],
  ): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;

    const startMs = Date.now();
    appLogger.info({ signal }, "Shutdown sequence initiated");

    // Guarantee we exit even if a step hangs
    this.forceExitTimer = setTimeout(() => {
      appLogger.fatal(
        { forceExitTimeoutMs: this.forceExitTimeoutMs },
        "Force exit — shutdown exceeded deadline",
      );
      clearTimeout(this.forceExitTimer as ReturnType<typeof setTimeout>);
      process.exit(1);
    }, this.forceExitTimeoutMs);
    this.forceExitTimer.unref();

    try {
      // 1. Close HTTP server — stop accepting, drain in-flight requests
      await withTimeout("http-server", this.drainTimeoutMs, () =>
        this.closeServer(server),
      );
      appLogger.info("HTTP server drained");

      // 2-7. Shut down services in order
      for (const svc of services) {
        await withTimeout(svc.name, this.drainTimeoutMs, () =>
          Promise.resolve(svc.stop()),
        );
        appLogger.info({ service: svc.name }, "Service stopped");
      }

      const elapsed = Date.now() - startMs;
      appLogger.info(
        { elapsedMs: elapsed },
        "Shutdown complete — exiting",
      );
      if (this.forceExitTimer) {
        clearTimeout(this.forceExitTimer);
        this.forceExitTimer = null;
      }
      process.exit(0);
    } catch (err) {
      const elapsed = Date.now() - startMs;
      appLogger.error(
        { err, elapsedMs: elapsed },
        "Error during shutdown — forcing exit",
      );
      if (this.forceExitTimer) {
        clearTimeout(this.forceExitTimer);
        this.forceExitTimer = null;
      }
      process.exit(1);
    }
  }

  private closeServer(server: Server): Promise<void> {
    return new Promise<void>((resolve) => {
      server.close((err) => {
        if (err) {
          appLogger.warn({ err }, "HTTP server close returned error");
        }
        resolve();
      });
    });
  }
}
