/**
 * Job Heartbeat Wrapper
 * 
 * Decorates job processors to automatically ping heartbeats
 * before/after execution and handle failures gracefully
 */

import { Job } from "bullmq";
import { jobHeartbeatService, JobType, HeartbeatPingData } from "../services/jobHeartbeat.service";
import { appLogger } from "../middleware/logger";

export type JobProcessor<T = any> = (job: Job<T>) => Promise<any>;

/**
 * Wraps a job processor to add automatic heartbeat pinging
 * 
 * Usage:
 * const processor = withHeartbeat(
 *   JobType.RECONCILIATION,
 *   async (job) => {
 *     // Your job logic here
 *   }
 * );
 */
export function withHeartbeat(
  jobType: JobType,
  processor: JobProcessor,
): JobProcessor {
  return async (job: Job) => {
    const startTime = Date.now();
    let result: any;
    let error: Error | null = null;

    try {
      // Ping job start
      await jobHeartbeatService.ping(jobType, {
        status: "started",
      });

      // Execute job processor
      result = await processor(job);

      // Ping job completion
      const duration = Date.now() - startTime;
      await jobHeartbeatService.ping(jobType, {
        status: "completed",
        result,
        duration,
      });

      appLogger.info(
        { jobType, jobId: job.id, durationMs: duration },
        "[JobHeartbeat] Job completed successfully",
      );

      return result;
    } catch (err) {
      error = err as Error;
      const duration = Date.now() - startTime;

      // Ping job failure
      await jobHeartbeatService.ping(jobType, {
        status: "failed",
        error: error.message,
        duration,
      });

      appLogger.error(
        {
          jobType,
          jobId: job.id,
          durationMs: duration,
          error: error.message,
        },
        "[JobHeartbeat] Job failed",
      );

      throw error;
    }
  };
}

/**
 * Class decorator for job handlers
 * Usage:
 * @JobHeartbeatDecorator(JobType.RECONCILIATION)
 * class ReconciliationWorker {
 *   async process(job: Job) { ... }
 * }
 */
type JobHandlerConstructor = {
  prototype: {
    process: (job: Job) => Promise<Record<string, unknown>>;
  };
};

export function JobHeartbeatDecorator(jobType: JobType) {
  return function (constructor: JobHandlerConstructor) {
    const originalProcess = constructor.prototype.process;

    constructor.prototype.process = async function (job: Job) {
      const startTime = Date.now();
      try {
        await jobHeartbeatService.ping(jobType, {
          status: "started",
        });

        const result = await originalProcess.call(this, job);

        const duration = Date.now() - startTime;
        await jobHeartbeatService.ping(jobType, {
          status: "completed",
          result,
          duration,
        });

        return result;
      } catch (error) {
        const duration = Date.now() - startTime;
        await jobHeartbeatService.ping(jobType, {
          status: "failed",
          error: String(error),
          duration,
        });
        throw error;
      }
    };

    return constructor;
  };
}
