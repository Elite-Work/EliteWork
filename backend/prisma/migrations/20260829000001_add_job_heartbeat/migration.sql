-- AddJobHeartbeat migration
-- Adds JobHeartbeat model for tracking scheduled job execution health

-- CreateTable JobHeartbeat
CREATE TABLE "JobHeartbeat" (
    "id" SERIAL NOT NULL,
    "jobType" VARCHAR(100) NOT NULL UNIQUE,
    "lastHeartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(50) NOT NULL DEFAULT 'idle',
    "intervalMs" INTEGER NOT NULL DEFAULT 86400000,
    "nextExpectedAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobHeartbeat_jobType_idx" ON "JobHeartbeat"("jobType");

-- CreateIndex
CREATE INDEX "JobHeartbeat_status_nextExpectedAt_idx" ON "JobHeartbeat"("status", "nextExpectedAt");

-- CreateIndex
CREATE INDEX "JobHeartbeat_lastCheckedAt_idx" ON "JobHeartbeat"("lastCheckedAt");
