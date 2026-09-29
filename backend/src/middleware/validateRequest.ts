import { Request, Response, NextFunction } from "express";
import { AppError, ErrorCode } from "../errors/errorCodes";

type ParseAsyncSchema = {
  parseAsync: (input: unknown) => Promise<unknown>;
};

type ZodLikeIssue = {
  path: Array<string | number>;
  message: string;
};

function getZodLikeIssues(error: unknown): ZodLikeIssue[] | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const err = error as Record<string, unknown>;
  if (Array.isArray(err.issues)) {
    return err.issues as ZodLikeIssue[];
  }
  if (Array.isArray(err.errors)) {
    return err.errors as ZodLikeIssue[];
  }

  return null;
}

function sanitizeString(value: string): string {
  return value
    .trim()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return sanitizeString(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }
  if (value !== null && typeof value === "object") {
    return sanitizeObject(value as Record<string, unknown>);
  }
  return value;
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    sanitized[key] = sanitizeValue(obj[key]);
  }
  return sanitized;
}

export const validateRequest = (schema: {
  body?: ParseAsyncSchema;
  query?: ParseAsyncSchema;
  params?: ParseAsyncSchema;
}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schema.body) {
        const parsed = await schema.body.parseAsync(req.body);
        req.body = sanitizeValue(parsed);
      }
      if (schema.query) {
        const parsed = await schema.query.parseAsync(req.query);
        Object.defineProperty(req, 'query', {
          value: sanitizeValue(parsed),
          writable: true,
          configurable: true,
        });
      }
      if (schema.params) {
        const parsed = await schema.params.parseAsync(req.params);
        req.params = sanitizeValue(parsed) as unknown as Request["params"];
      }
      next();
    } catch (error) {
      const issues = getZodLikeIssues(error);
      if (issues?.length) {
        const firstError = issues[0];
        const fieldName = firstError.path.join(".");
        const message = fieldName ? `${fieldName}: ${firstError.message}` : firstError.message;
        next(
          new AppError(ErrorCode.VALIDATION_ERROR, message, 400, {
            errors: issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          }),
        );
        return;
      }
      next(error);
    }
  };
};
