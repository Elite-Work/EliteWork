import { Response, NextFunction } from "express";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { isMediatorAddress } from "../lib/accessControl";
import { AuthRequest, AuthService } from "../services/auth.service";
import { AppError, ErrorCode } from "../errors/errorCodes";
import { runtimeEnvValue } from "../config/env";
import { deviceContextFromRequest } from "../lib/deviceContext";
import { adminSessionService } from "../services/adminSession.service";

function annotateDenied(reason: string, address: string): void {
  try {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan && typeof activeSpan.setAttributes === "function") {
      activeSpan.setAttributes({
        "admin.attempted": true,
        "admin.verdict": "denied",
        "admin.denied_reason": reason,
        "admin.address": address,
      });
      activeSpan.setStatus({ code: SpanStatusCode.ERROR, message: reason });
    }
  } catch {
    // Ignore telemetry failure in mock/test
  }
}

/**
 * Admin authentication middleware (adminAuth health guard).
 *
 * Enforces token freshness, session revocation checks, and mediator allowlist authorization.
 */
export const adminMiddleware = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const walletAddress = req.user?.walletAddress?.trim();
  if (!req.user || !walletAddress || !isMediatorAddress(walletAddress)) {
    try {
      const activeSpan = trace.getActiveSpan();
      if (activeSpan && typeof activeSpan.setAttributes === "function") {
        activeSpan.setAttributes({
          "admin.attempted": true,
          "admin.verdict": "denied",
          "admin.address": walletAddress ?? "unknown",
        });
        activeSpan.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden: admin access required" });
      }
    } catch {
      // Ignore telemetry failure in mock/test
    }
    res.status(403).json({
      code: "AUTH_ERROR",
      message: "Forbidden: admin access required",
      error: "Forbidden: admin access required",
      details: {},
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // Token freshness check: reject expired or stale tokens
  const nowInSeconds = Math.floor(Date.now() / 1000);
  if (typeof req.user.exp === "number" && nowInSeconds >= req.user.exp) {
    res.status(401).json({ error: "Unauthorized: token expired or stale" });
    return;
  }

  // Revocation check: verify if token's jti has been invalidated
  if (req.user.jti) {
    try {
      const isRevoked = await AuthService.isTokenRevoked(req.user.jti);
      if (isRevoked) {
        res.status(401).json({ error: "Unauthorized: session has been revoked" });
        return;
      }
    } catch (err) {
      res.status(401).json({ error: "Unauthorized: session revocation check failed" });
      return;
    }
  }

  // Device-context binding (issue #198). Off unless ADMIN_SESSION_BINDING_ENABLED.
  if (runtimeEnvValue("ADMIN_SESSION_BINDING_ENABLED")) {
    const claims = req.user;
    const isBound = claims.tier === "admin" && typeof claims.deviceHash === "string";

    if (!isBound) {
      if (runtimeEnvValue("ADMIN_SESSION_BINDING_ENFORCE")) {
        annotateDenied("admin session not device-bound", walletAddress);
        res.status(401).json({
          code: "ADMIN_BINDING_REQUIRED",
          error: "Unauthorized: admin session is not device-bound",
          requiresStepUp: true,
        });
        return;
      }
      // Transition window: allow legacy unbound admin bearers through.
    } else {
      const current = deviceContextFromRequest(req);
      const deviceMismatch = current.deviceHash !== claims.deviceHash;
      const ipMismatch = !!claims.ipClass && current.ipClass !== claims.ipClass;
      if (deviceMismatch || ipMismatch) {
        annotateDenied(
          deviceMismatch ? "admin device fingerprint mismatch" : "admin ip class mismatch",
          walletAddress,
        );
        res.status(401).json({
          code: "ADMIN_CONTEXT_MISMATCH",
          error: "Unauthorized: admin session context mismatch — step-up required",
          requiresStepUp: true,
        });
        return;
      }

      if (claims.jti) {
        try {
          const session = await adminSessionService.get(claims.jti);
          if (!session) {
            annotateDenied("admin session not in registry", walletAddress);
            res.status(401).json({
              code: "ADMIN_SESSION_REVOKED",
              error: "Unauthorized: admin session revoked or expired",
              requiresStepUp: true,
            });
            return;
          }
          void adminSessionService.touch(claims.jti);
        } catch {
          res.status(401).json({
            code: "ADMIN_SESSION_CHECK_FAILED",
            error: "Unauthorized: admin session check failed",
          });
          return;
        }
      }
    }
  }

  // Attach admin identity to the request context
  req.user.isAdmin = true;

  // Annotate active OpenTelemetry span
  try {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan && typeof activeSpan.setAttributes === "function") {
      activeSpan.setAttributes({
        "admin.action": "privileged",
        "admin.address": walletAddress,
        "admin.verdict": "granted",
        "is_admin": true,
      });
    }
  } catch {
    // Ignore telemetry failure in mock/test
  }

  next();
};
