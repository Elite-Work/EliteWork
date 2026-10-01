import { Request, Response, NextFunction } from "express";
import { runtimeEnvValue } from "../config/env";
import { AppError, ErrorCode } from "../errors/errorCodes";

function isAdminPath(path: string): boolean {
  return path === "/admin" || path.startsWith("/admin/") ||
    path === "/api/admin" || path.startsWith("/api/admin/");
}

export function adminFeatureGate(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!isAdminPath(req.path)) {
    next();
    return;
  }

  if (!runtimeEnvValue("ADMIN_ROUTES_ENABLED")) {
    next(
      new AppError(
        ErrorCode.NOT_FOUND,
        "Admin routes are not enabled in this environment",
        404,
      ),
    );
    return;
  }
  next();
}
