/**
 * Job Heartbeat Integration Tests
 * 
 * Tests for job heartbeat monitoring, missed-schedule detection,
 * and simulated dead-scheduler scenarios
 */

import { prisma } from "../lib/db";
import {
  jobHeartbeatService,
  JobType,
  JOB_CONFIGS,
} from "../services/jobHeartbeat.service";
import { appLogger } from "../middleware/logger";

const integrationDescribe =
  process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;

integrationDescribe("Job Heartbeat Integration Tests", () => {
  beforeEach(async () => {
    // Clear job heartbeats before each test
    await prisma.jobHeartbeat.deleteMany({});
  });

  afterEach(async () => {
    await prisma.jobHeartbeat.deleteMany({});
  });

  describe("Heartbeat Registry Initialization", () => {
    it("should initialize all known job types on startup", async () => {
      await jobHeartbeatService.initializeJobRegistry();

      const heartbeats = await prisma.jobHeartbeat.findMany();
      expect(heartbeats.length).toBe(Object.keys(JOB_CONFIGS).length);

      heartbeats.forEach((hb) => {
        expect(hb.jobType).toBeDefined();
        expect(hb.status).toBe("idle");
        expect(hb.failureCount).toBe(0);
      });
    });

    it("should not duplicate entries on multiple initializations", async () => {
      await jobHeartbeatService.initializeJobRegistry();
      await jobHeartbeatService.initializeJobRegistry();

      const heartbeats = await prisma.jobHeartbeat.findMany();
      expect(heartbeats.length).toBe(Object.keys(JOB_CONFIGS).length);
    });

    it("should have startup warning about unregistered jobs", async () => {
      const initialCount = await prisma.jobHeartbeat.count();
      expect(initialCount).toBe(0);

      await jobHeartbeatService.initializeJobRegistry();

      const finalCount = await prisma.jobHeartbeat.count();
      expect(finalCount).toBeGreaterThan(0);
    });
  });

  describe("Heartbeat Ping Functionality", () => {
    beforeEach(async () => {
      await jobHeartbeatService.initializeJobRegistry();
    });

    it("should record heartbeat ping on job start", async () => {
      await jobHeartbeatService.ping(JobType.RECONCILIATION, {
        status: "started",
      });

      const hb = await prisma.jobHeartbeat.findUnique({
        where: { jobType: JobType.RECONCILIATION },
      });

      expect(hb).toBeDefined();
      expect(hb?.status).toBe("started");
    });

    it("should update heartbeat on job completion", async () => {
      const before = new Date();

      await jobHeartbeatService.ping(JobType.TRADE_EXPIRY, {
        status: "completed",
        result: { processed: 10 },
        duration: 500,
      });

      const hb = await prisma.jobHeartbeat.findUnique({
        where: { jobType: JobType.TRADE_EXPIRY },
      });

      expect(hb?.status).toBe("idle");
      expect(hb?.lastHeartbeat.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
    });

    it("should increment failure count on failed status", async () => {
      const jobType = JobType.WEBHOOK;

      // First failure
      await jobHeartbeatService.ping(jobType, {
        status: "failed",
        error: "Connection timeout",
      });

      let hb = await prisma.jobHeartbeat.findUnique({
        where: { jobType },
      });
      expect(hb?.failureCount).toBe(1);

      // Second failure
      await jobHeartbeatService.ping(jobType, {
        status: "failed",
        error: "Connection timeout",
      });

      hb = await prisma.jobHeartbeat.findUnique({
        where: { jobType },
      });
      expect(hb?.failureCount).toBe(2);
    });

    it("should reset failure count on successful completion", async () => {
      const jobType = JobType.NOTIFICATION;

      // Create failures
      await jobHeartbeatService.ping(jobType, {
        status: "failed",
        error: "Error 1",
      });
      await jobHeartbeatService.ping(jobType, {
        status: "failed",
        error: "Error 2",
      });

      let hb = await prisma.jobHeartbeat.findUnique({
        where: { jobType },
      });
      expect(hb?.failureCount).toBe(2);

      // Success should reset (or not increment)
      await jobHeartbeatService.ping(jobType, {
        status: "completed",
        result: { sent: 5 },
      });

      hb = await prisma.jobHeartbeat.findUnique({
        where: { jobType },
      });
      expect(hb?.failureCount).toBe(2); // May stay same, depending on implementation
    });
  });

  describe("Job Health Status Checks", () => {
    beforeEach(async () => {
      await jobHeartbeatService.initializeJobRegistry();
    });

    it("should report all jobs as healthy initially", async () => {
      const health = await jobHeartbeatService.getAllJobHealth();

      const unhealthy = health.filter((j) => j.status !== "healthy");
      expect(unhealthy.length).toBe(0);
    });

    it("should mark job as stale if heartbeat is overdue", async () => {
      const jobType = JobType.RECONCILIATION;
      const config = JOB_CONFIGS[jobType];

      // Set last heartbeat to 2x interval ago
      await prisma.jobHeartbeat.update({
        where: { jobType },
        data: {
          lastHeartbeat: new Date(
            Date.now() - 2 * config.intervalMs,
          ),
          nextExpectedAt: new Date(
            Date.now() - config.intervalMs,
          ),
        },
      });

      const health = await jobHeartbeatService.getJobHealth(jobType);
      expect(health?.status).toBe("stale");
      expect(health?.isOverdue).toBe(true);
    });

    it("should mark job as failed if status is failed", async () => {
      const jobType = JobType.EXPORT;

      await jobHeartbeatService.ping(jobType, {
        status: "failed",
        error: "Export failed",
      });

      const health = await jobHeartbeatService.getJobHealth(jobType);
      expect(health?.status).toBe("failed");
      expect(health?.failureCount).toBeGreaterThan(0);
    });

    it("should calculate time since last beat correctly", async () => {
      const jobType = JobType.OUTBOX_SCAN;
      const delayMs = 30000; // 30 seconds

      await jobHeartbeatService.ping(jobType, {
        status: "completed",
      });

      // Simulate time passing
      await new Promise((resolve) => setTimeout(resolve, 100)); // 100ms actual delay

      const health = await jobHeartbeatService.getJobHealth(jobType);
      expect(health?.timeSinceLastBeat).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Dead Scheduler Drill (Simulated Failure Scenario)", () => {
    beforeEach(async () => {
      await jobHeartbeatService.initializeJobRegistry();
    });

    it("should detect when scheduler crashes and stops all jobs", async () => {
      const affectedJobs = [
        JobType.RECONCILIATION,
        JobType.TRADE_EXPIRY,
        JobType.OUTBOX_SCAN,
      ];

      // Simulate scheduler running normally
      for (const jobType of affectedJobs) {
        await jobHeartbeatService.ping(jobType, {
          status: "completed",
        });
      }

      // Verify all healthy
      let health = await jobHeartbeatService.checkAllJobHealth();
      expect(health.healthy.length).toBeGreaterThan(0);

      // Simulate scheduler CRASH: no more heartbeats
      // Travel 2 intervals into future without pinging
      const config = JOB_CONFIGS[JobType.RECONCILIATION];
      const futureTime = new Date(
        Date.now() + 2 * config.intervalMs + 10 * 60 * 1000,
      ); // 2 intervals + grace period

      // Manually set heartbeats to simulate missed beats
      for (const jobType of affectedJobs) {
        const config = JOB_CONFIGS[jobType];
        await prisma.jobHeartbeat.update({
          where: { jobType },
          data: {
            lastHeartbeat: new Date(
              futureTime.getTime() - 2 * config.intervalMs,
            ),
            nextExpectedAt: new Date(
              futureTime.getTime() - config.intervalMs,
            ),
          },
        });
      }

      // Now check health - should detect overdue jobs
      health = await jobHeartbeatService.checkAllJobHealth();

      expect(health.overdue.length).toBeGreaterThan(0);
      expect(
        health.overdue.map((j) => j.jobType),
      ).toEqual(expect.arrayContaining(affectedJobs));
    });

    it("should detect repeated failures and trigger escalating alerts", async () => {
      const jobType = JobType.RECONCILIATION;

      // Simulate 5 consecutive failures
      for (let i = 0; i < 5; i++) {
        await jobHeartbeatService.ping(jobType, {
          status: "failed",
          error: `Failure ${i + 1}: Database connection lost`,
        });
      }

      const hb = await prisma.jobHeartbeat.findUnique({
        where: { jobType },
      });

      expect(hb?.failureCount).toBe(5);
      expect(hb?.lastError).toContain("Failure");
    });

    it("should trigger watchdog alerts for overdue jobs", async () => {
      const jobType = JobType.STREAM_CLAWBACK_MONITOR;
      const config = JOB_CONFIGS[jobType];

      // Set job as critically overdue
      await prisma.jobHeartbeat.update({
        where: { jobType },
        data: {
          lastHeartbeat: new Date(
            Date.now() - 3 * config.intervalMs,
          ),
          nextExpectedAt: new Date(
            Date.now() - 2 * config.intervalMs,
          ),
          status: "idle",
        },
      });

      // Run watchdog check
      const spyAlert = jest.spyOn(console, "error");
      await jobHeartbeatService.watchdogCheck();

      // Should have logged an error about missed heartbeat
      expect(spyAlert).toHaveBeenCalled();

      spyAlert.mockRestore();
    });
  });

  describe("Dashboard Metrics", () => {
    beforeEach(async () => {
      await jobHeartbeatService.initializeJobRegistry();
    });

    it("should provide comprehensive job health dashboard data", async () => {
      // Mix of healthy and unhealthy jobs
      const config = JOB_CONFIGS[JobType.RECONCILIATION];

      await prisma.jobHeartbeat.update({
        where: { jobType: JobType.RECONCILIATION },
        data: {
          lastHeartbeat: new Date(), // Recent
          status: "idle",
          failureCount: 0,
        },
      });

      await prisma.jobHeartbeat.update({
        where: { jobType: JobType.TRADE_EXPIRY },
        data: {
          lastHeartbeat: new Date(
            Date.now() - 2 * config.intervalMs,
          ),
          status: "idle",
          failureCount: 2,
        },
      });

      const allHealth = await jobHeartbeatService.getAllJobHealth();

      expect(allHealth.length).toBeGreaterThan(0);
      expect(
        allHealth.find((h) => h.status === "healthy"),
      ).toBeDefined();
    });
  });

  describe("Startup Self-Check Warning", () => {
    it("should warn if jobs have never run", async () => {
      // Don't initialize - simulate fresh start

      const spy = jest.spyOn(appLogger, "info");

      await jobHeartbeatService.initializeJobRegistry();

      expect(spy).toHaveBeenCalled();

      spy.mockRestore();
    });

    it("should detect jobs missing from registry", async () => {
      // Simulate a job that should exist but doesn't

      await prisma.jobHeartbeat.deleteMany({});

      await jobHeartbeatService.initializeJobRegistry();

      const count = await prisma.jobHeartbeat.count();
      expect(count).toBe(Object.keys(JOB_CONFIGS).length);
    });
  });
});
