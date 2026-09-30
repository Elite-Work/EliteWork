import { NextFunction, Request, Response } from "express";
import { appLogger } from "./logger";
import { TracedRequest } from "./correlationId.middleware";
import { apiVersionFrom } from "./apiVersion.middleware";

interface RequestWithOptionalUser extends Request {
  user?: { id?: string };
  userId?: string;
}

/**
 * Structured request logging middleware.
 *
 * Logs every request with consistent fields:
 *   method, path, status, durationMs, correlationId, userId, userAgent, ip
 *
 * Log level:
 *   info  → 2xx / 3xx
 *   warn  → 4xx
 *   error → 5xx
 *
 * Also attaches X-Request-Id to the response for client-side tracing.
 */
export function requestLoggerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();
  const traced = req as TracedRequest & RequestWithOptionalUser;

  // Propagate the server-generated request ID to the client.
  if (traced.requestId) {
    res.setHeader("X-Request-Id", traced.requestId);
  }

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const status = res.statusCode;

    const logFields = {
      method: req.method,
      path: req.path,
      status,
      durationMs,
      correlationId: traced.correlationId,
      userId: traced.user?.id ?? traced.userId ?? undefined,
      userAgent: req.get("user-agent"),
      ip: req.ip,
      // Which API lane served this request: "v1", "/api/legacy", or
      // "unversioned". Lets monitoring split traffic share as the sunset
      // window progresses. Read at finish time so the version middleware has
      // definitely run.
      apiVersion: apiVersionFrom(req),
    };

    if (status >= 500) {
      appLogger.error(logFields, "request completed");
    } else if (status >= 400) {
      appLogger.warn(logFields, "request completed");
    } else {
      appLogger.info(logFields, "request completed");
    }
  });

  next();
}
