-- Base tables for vested token streams and their clawback audit events.
-- Later migrations add lifecycle, maintenance-lock, and admin-tag fields.
CREATE TABLE "Stream" (
    "id" SERIAL NOT NULL,
    "streamId" VARCHAR(255) NOT NULL,
    "recipient" VARCHAR(255) NOT NULL,
    "totalVested" VARCHAR(100) NOT NULL,
    "claimed" VARCHAR(100) NOT NULL DEFAULT '0',
    "unclaimed" VARCHAR(100) NOT NULL DEFAULT '0',
    "pendingClawback" VARCHAR(100) NOT NULL DEFAULT '0',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stream_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StreamClawbackEvent" (
    "id" SERIAL NOT NULL,
    "streamId" VARCHAR(255) NOT NULL,
    "admin" VARCHAR(255) NOT NULL,
    "amount" VARCHAR(100) NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "txHash" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StreamClawbackEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Stream_streamId_key" ON "Stream"("streamId");
CREATE INDEX "Stream_streamId_idx" ON "Stream"("streamId");
CREATE INDEX "Stream_recipient_idx" ON "Stream"("recipient");
CREATE UNIQUE INDEX "StreamClawbackEvent_streamId_txHash_key" ON "StreamClawbackEvent"("streamId", "txHash");
CREATE INDEX "StreamClawbackEvent_streamId_idx" ON "StreamClawbackEvent"("streamId");
CREATE INDEX "StreamClawbackEvent_admin_idx" ON "StreamClawbackEvent"("admin");

ALTER TABLE "StreamClawbackEvent"
    ADD CONSTRAINT "StreamClawbackEvent_streamId_fkey"
    FOREIGN KEY ("streamId") REFERENCES "Stream"("streamId") ON DELETE CASCADE ON UPDATE CASCADE;
