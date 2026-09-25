import Redis from "ioredis";
import { EventEmitter } from "events";
import { env } from "../config/env";
import { appLogger } from "../middleware/logger";
import { alertService } from "../services/alert.service";

const REDIS_URL = process.env.REDIS_URL ?? env.REDIS_URL;
const isTestEnv = (process.env.NODE_ENV ?? env.NODE_ENV) === "test";

export const redis: InstanceType<typeof Redis> = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: isTestEnv,
});

function dispatchRedisAlert(message: string, details: Record<string, unknown> = {}): void {
  void alertService.dispatch("redis_connection_failure", message, details);
}

if (typeof (redis as any).on === "function") {
  (redis as unknown as EventEmitter).on("error", (err: Error) => {
    appLogger.error({ error: err }, "Redis error");
    dispatchRedisAlert("Redis client error", { error: err.message });
  });

  (redis as unknown as EventEmitter).on("close", () => {
    appLogger.warn("Redis connection closed");
    dispatchRedisAlert("Redis connection closed");
  });
}
