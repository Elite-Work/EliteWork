/**
 * Outbox consistency check endpoints
 * 
 * Exposes consistency scan results and gap reports
 * Admin-only endpoints for monitoring and debugging
 */

import { Router, Request, Response, NextFunction } from "express";
import { appLogger } from "../middleware/logger";
import {
  scanOutboxCompleteness,
  generateOutboxGapReport,
  exportOutboxGaps,
} from "../lib/outbox/outboxScanner";
import { adminMiddleware } from "../middleware/admin.middleware";
import { prisma } from "../lib/db";

const isAdmin = adminMiddleware;

export function createOutboxRoutes(): Router {
  const router = Router();

  /**
   * GET /admin/outbox/health
   * Run a quick consistency check on recent events
   */
  router.get(
    "/admin/outbox/health",
    isAdmin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const timeWindow = parseInt(req.query.timeWindow as string) || 60; // Default 1 hour

        appLogger.info(
          { timeWindow },
          "[OutboxRoute] Running consistency check",
        );

        const report = await scanOutboxCompleteness(timeWindow);

        res.status(report.summary.criticalGaps > 0 ? 500 : 200).json({
          status:
            report.summary.criticalGaps > 0
              ? "degraded"
              : "healthy",
          scanTime: new Date().toISOString(),
          summary: report.summary,
          gapCount: report.gapsDetected.length,
          criticalGapsPresent: report.summary.criticalGaps > 0,
        });
      } catch (error) {
        appLogger.error(
          { error },
          "[OutboxRoute] Consistency check failed",
        );
        res.status(500).json({
          error: "Consistency check failed",
          message: String(error),
        });
      }
    },
  );

  /**
   * GET /admin/outbox/gaps
   * Retrieve detailed gap report for a time range
   */
  router.get(
    "/admin/outbox/gaps",
    isAdmin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const startTime = req.query.start
          ? new Date(req.query.start as string)
          : new Date(Date.now() - 24 * 60 * 60 * 1000); // Default 24h ago

        const endTime = req.query.end
          ? new Date(req.query.end as string)
          : new Date();

        const format = (req.query.format as string) || "json"; // json, csv, markdown

        appLogger.info(
          { startTime, endTime, format },
          "[OutboxRoute] Generating gap report",
        );

        const report = await generateOutboxGapReport(startTime, endTime);

        if (format === "json") {
          res.status(200).json(report);
        } else {
          const exported = await exportOutboxGaps(report.gaps, format as any);
          res.status(200).type(format === "csv" ? "text/csv" : "text/markdown");
          res.send(exported);
        }
      } catch (error) {
        appLogger.error({ error }, "[OutboxRoute] Gap report generation failed");
        res.status(500).json({
          error: "Gap report generation failed",
          message: String(error),
        });
      }
    },
  );

  /**
   * GET /admin/outbox/stats
   * Get outbox statistics and queue status
   */
  router.get(
    "/admin/outbox/stats",
    isAdmin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Fetch outbox stats
        const totalEvents = await prisma.chainEventOutbox.count();
        const pendingEvents = await prisma.chainEventOutbox.count({
          where: { status: "PENDING" },
        });
        const processedEvents = await prisma.chainEventOutbox.count({
          where: { status: "PROCESSED" },
        });
        const deadLetteredEvents = await prisma.chainEventOutbox.count({
          where: { status: "DEAD_LETTER" },
        });
        const retryingEvents = await prisma.chainEventOutbox.count({
          where: { status: "RETRYING" },
        });

        // Fetch oldest pending event
        const oldestPending = await prisma.chainEventOutbox.findFirst({
          where: { status: "PENDING" },
          orderBy: { createdAt: "asc" },
        });

        res.status(200).json({
          outboxStats: {
            totalEvents,
            pendingEvents,
            processedEvents,
            deadLetteredEvents,
            retryingEvents,
            oldestPendingAge: oldestPending
              ? Math.floor(
                  (Date.now() - oldestPending.createdAt.getTime()) / 1000,
                )
              : null,
            oldestPendingId: oldestPending?.id,
          },
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        appLogger.error({ error }, "[OutboxRoute] Stats retrieval failed");
        res.status(500).json({
          error: "Stats retrieval failed",
          message: String(error),
        });
      }
    },
  );

  /**
   * POST /admin/outbox/replay
   * Manually replay a dead-lettered event or failed event
   */
  router.post(
    "/admin/outbox/replay",
    isAdmin,
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const { eventId, tradeId } = req.body;

        if (!eventId && !tradeId) {
          return res.status(400).json({
            error: "Missing required field: eventId or tradeId",
          });
        }

        const event = await prisma.chainEventOutbox.findFirst({
          where: eventId ? { id: parseInt(eventId) } : { tradeId },
          orderBy: { createdAt: "desc" },
        });

        if (!event) {
          return res.status(404).json({ error: "Event not found" });
        }

        // Reset event to PENDING for reprocessing
        await prisma.chainEventOutbox.update({
          where: { id: event.id },
          data: {
            status: "PENDING",
            attempts: 0,
            nextAttemptAt: new Date(),
            lastError: null,
          },
        });

        appLogger.info(
          { eventId: event.id, tradeId: event.tradeId },
          "[OutboxRoute] Event manually replayed",
        );

        res.status(200).json({
          message: "Event queued for replay",
          eventId: event.id,
          tradeId: event.tradeId,
        });
      } catch (error) {
        appLogger.error({ error }, "[OutboxRoute] Event replay failed");
        res.status(500).json({
          error: "Event replay failed",
          message: String(error),
        });
      }
    },
  );

  return router;
}

export default createOutboxRoutes;
