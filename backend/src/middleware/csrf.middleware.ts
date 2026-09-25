import crypto from "crypto";
import { NextFunction, Request, Response } from "express";

const CSRF_COOKIE = "csrf_token";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function cookies(req: Request): Record<string, string> {
  return Object.fromEntries((req.headers.cookie ?? "").split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 0) return [];
    return [[part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())]];
  }));
}

export function csrfToken(_req: Request, res: Response): void {
  const token = crypto.randomBytes(32).toString("hex");
  res.setHeader("Set-Cookie", `${CSRF_COOKIE}=${encodeURIComponent(token)}; Path=/; SameSite=Strict${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  res.json({ csrfToken: token });
}

function isAdminPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/") ||
    path === "/api/admin" || path.startsWith("/api/admin/");
}

/** Bearer authentication is not ambient and does not need CSRF protection. */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (!isAdminPath(req.path) || SAFE_METHODS.has(req.method) || req.headers.authorization?.startsWith("Bearer ")) {
    next();
    return;
  }

  const csrfCookie = cookies(req)[CSRF_COOKIE];
  const csrfHeader = req.headers["x-csrf-token"];
  if (!csrfCookie || typeof csrfHeader !== "string" || csrfHeader.length !== csrfCookie.length || !crypto.timingSafeEqual(Buffer.from(csrfCookie), Buffer.from(csrfHeader))) {
    res.status(403).json({ error: "CSRF token required" });
    return;
  }
  next();
}