import { Response, NextFunction } from "express";
import { AuthRequest } from "../services/auth.service";
import { isCooperativeAdmin, getCooperativeMembers } from "../lib/cooperativeAccess";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { getAdminAllowlistLowercase } from "../lib/accessControl";

/**
 * Express middleware to restrict an endpoint to cooperative admins.
 * Requires the `authMiddleware` to have run first to populate `req.user`.
 * Expects the `id` param to contain the cooperative ID.
 */
export const requireCooperativeAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const caller = req.user?.walletAddress?.trim();
  if (!caller) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const cooperativeId = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const lowerCaller = caller.toLowerCase();

  const isAdmin = isCooperativeAdmin(cooperativeId, lowerCaller) || getAdminAllowlistLowercase().has(lowerCaller);

  if (!isAdmin) {
    try {
      const activeSpan = trace.getActiveSpan();
      if (activeSpan && typeof activeSpan.setAttributes === "function") {
        activeSpan.setAttributes({
          "coop.attempted": true,
          "coop.verdict": "denied",
          "coop.address": lowerCaller,
          "coop.id": cooperativeId,
        });
        activeSpan.setStatus({ code: SpanStatusCode.ERROR, message: "Forbidden: cooperative admin access required" });
      }
    } catch {
      // Ignore telemetry failure
    }
    res.status(403).json({ error: "Forbidden: cooperative admin access required" });
    return;
  }

  try {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan && typeof activeSpan.setAttributes === "function") {
      activeSpan.setAttributes({
        "coop.action": "privileged",
        "coop.address": lowerCaller,
        "coop.verdict": "granted",
        "coop.id": cooperativeId,
      });
    }
  } catch {
    // Ignore telemetry failure
  }

  next();
};

/**
 * Express middleware to restrict an endpoint to cooperative members.
 * Requires the `authMiddleware` to have run first to populate `req.user`.
 * Expects the `id` param to contain the cooperative ID.
 */
export const requireCooperativeMember = (req: AuthRequest, res: Response, next: NextFunction): void => {
  const caller = req.user?.walletAddress?.trim();
  if (!caller) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const cooperativeId = String(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  const lowerCaller = caller.toLowerCase();

  const members = getCooperativeMembers(cooperativeId);
  const isMember = members.includes(lowerCaller) || isCooperativeAdmin(cooperativeId, lowerCaller) || getAdminAllowlistLowercase().has(lowerCaller);

  if (!isMember) {
    res.status(403).json({ error: "Forbidden: cooperative member access required" });
    return;
  }

  next();
};
