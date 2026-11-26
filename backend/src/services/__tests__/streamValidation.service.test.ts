/**
 * Unit tests for StreamValidationService: every validation rule (existence,
 * lifecycle state, maintenance lock), the order they run in, and the exact
 * error code / HTTP status / message / details each one produces.
 */

import { Stream, StreamStatus } from "@prisma/client";
import { AppError, ErrorCode } from "../../errors/errorCodes";
import {
  LIVE_STATUSES,
  RESUMABLE_STATUSES,
  SUSPENDABLE_STATUSES,
  StreamValidationService,
} from "../streamValidation.service";

const STREAM_ID = "stream-42";
const LOCKED_AT = new Date("2026-03-01T12:00:00.000Z");

function makeStream(overrides: Partial<Stream> = {}): Stream {
  return {
    streamId: STREAM_ID,
    status: StreamStatus.ACTIVE,
    lockedAt: null,
    lockedBy: null,
    lockReason: null,
    ...overrides,
  } as Stream;
}

function makePrisma(stream: Stream | null = makeStream()) {
  return { stream: { findUnique: jest.fn().mockResolvedValue(stream) } };
}

/** Runs fn and returns the AppError it throws, failing the test otherwise. */
async function catchAppError(fn: () => unknown): Promise<AppError> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error("expected an AppError to be thrown");
}

describe("StreamValidationService", () => {
  describe("status sets", () => {
    it("LIVE_STATUSES is ACTIVE and SUSPENDED", () => {
      expect([...LIVE_STATUSES]).toEqual([StreamStatus.ACTIVE, StreamStatus.SUSPENDED]);
    });

    it("SUSPENDABLE_STATUSES is ACTIVE only", () => {
      expect([...SUSPENDABLE_STATUSES]).toEqual([StreamStatus.ACTIVE]);
    });

    it("RESUMABLE_STATUSES is SUSPENDED only", () => {
      expect([...RESUMABLE_STATUSES]).toEqual([StreamStatus.SUSPENDED]);
    });
  });

  describe("getStreamOrThrow", () => {
    it("returns the stream when it exists", async () => {
      const stream = makeStream();
      const prisma = makePrisma(stream);
      const service = new StreamValidationService(prisma as any);

      await expect(service.getStreamOrThrow(STREAM_ID)).resolves.toBe(stream);
      expect(prisma.stream.findUnique).toHaveBeenCalledWith({ where: { streamId: STREAM_ID } });
    });

    it("throws 404 NOT_FOUND for an unknown stream", async () => {
      const service = new StreamValidationService(makePrisma(null) as any);

      const error = await catchAppError(() => service.getStreamOrThrow("missing"));

      expect(error.code).toBe(ErrorCode.NOT_FOUND);
      expect(error.statusCode).toBe(404);
      expect(error.message).toBe("Stream missing not found");
      expect(error.details).toEqual({ streamId: "missing" });
    });

    it("propagates database errors unchanged", async () => {
      const boom = new Error("db down");
      const prisma = { stream: { findUnique: jest.fn().mockRejectedValue(boom) } };
      const service = new StreamValidationService(prisma as any);

      await expect(service.getStreamOrThrow(STREAM_ID)).rejects.toBe(boom);
    });
  });

  describe("assertStatusAllowed", () => {
    const service = new StreamValidationService(makePrisma() as any);

    it.each([
      [StreamStatus.ACTIVE, LIVE_STATUSES],
      [StreamStatus.SUSPENDED, LIVE_STATUSES],
      [StreamStatus.ACTIVE, SUSPENDABLE_STATUSES],
      [StreamStatus.SUSPENDED, RESUMABLE_STATUSES],
    ])("allows %s within the permitted set", (status, allowed) => {
      expect(() =>
        service.assertStatusAllowed(makeStream({ status }), allowed, "acted on"),
      ).not.toThrow();
    });

    it.each([
      [StreamStatus.TERMINATED, LIVE_STATUSES, "terminated"],
      [StreamStatus.COMPLETED, LIVE_STATUSES, "clawed back"],
      [StreamStatus.SUSPENDED, SUSPENDABLE_STATUSES, "suspended"],
      [StreamStatus.TERMINATED, SUSPENDABLE_STATUSES, "suspended"],
      [StreamStatus.ACTIVE, RESUMABLE_STATUSES, "resumed"],
      [StreamStatus.COMPLETED, RESUMABLE_STATUSES, "resumed"],
    ])("rejects %s with 409 DOMAIN_ERROR", async (status, allowed, action) => {
      const error = await catchAppError(() =>
        service.assertStatusAllowed(makeStream({ status }), allowed, action),
      );

      expect(error.code).toBe(ErrorCode.DOMAIN_ERROR);
      expect(error.statusCode).toBe(409);
      expect(error.message).toBe(`Stream ${STREAM_ID} cannot be ${action} from status ${status}`);
      expect(error.details).toEqual({
        streamId: STREAM_ID,
        status,
        allowedStatuses: [...allowed],
      });
    });

    it("returns a copy of allowedStatuses in details, not the shared constant", async () => {
      const error = await catchAppError(() =>
        service.assertStatusAllowed(
          makeStream({ status: StreamStatus.COMPLETED }),
          LIVE_STATUSES,
          "terminated",
        ),
      );
      expect(error.details.allowedStatuses).not.toBe(LIVE_STATUSES);
    });

    it("rejects every status when the allowed set is empty", () => {
      expect(() => service.assertStatusAllowed(makeStream(), [], "touched")).toThrow(AppError);
    });
  });

  describe("assertNotLocked", () => {
    const service = new StreamValidationService(makePrisma() as any);

    it("passes when lockedAt is null", () => {
      expect(() => service.assertNotLocked(makeStream())).not.toThrow();
    });

    it("passes when only lockedBy/lockReason are set (lockedAt is the source of truth)", () => {
      expect(() =>
        service.assertNotLocked(makeStream({ lockedBy: "GADMIN", lockReason: "stale" })),
      ).not.toThrow();
    });

    it("throws 409 DOMAIN_ERROR with lock details when locked", async () => {
      const error = await catchAppError(() =>
        service.assertNotLocked(
          makeStream({ lockedAt: LOCKED_AT, lockedBy: "GADMIN", lockReason: "migration" }),
        ),
      );

      expect(error.code).toBe(ErrorCode.DOMAIN_ERROR);
      expect(error.statusCode).toBe(409);
      expect(error.message).toBe(`Stream ${STREAM_ID} is locked for maintenance`);
      expect(error.details).toEqual({
        streamId: STREAM_ID,
        lockedBy: "GADMIN",
        lockedAt: "2026-03-01T12:00:00.000Z",
        lockReason: "migration",
      });
    });

    it("reports null lockedBy/lockReason when the lock has no metadata", async () => {
      const error = await catchAppError(() =>
        service.assertNotLocked(makeStream({ lockedAt: LOCKED_AT })),
      );
      expect(error.details).toMatchObject({ lockedBy: null, lockReason: null });
    });
  });

  describe("requireActionableStream", () => {
    it("returns the loaded stream when every rule passes", async () => {
      const stream = makeStream({ status: StreamStatus.SUSPENDED });
      const prisma = makePrisma(stream);
      const service = new StreamValidationService(prisma as any);

      await expect(
        service.requireActionableStream(STREAM_ID, RESUMABLE_STATUSES, "resumed"),
      ).resolves.toBe(stream);
      expect(prisma.stream.findUnique).toHaveBeenCalledTimes(1);
    });

    it("fails with 404 before checking status or lock", async () => {
      const service = new StreamValidationService(makePrisma(null) as any);
      const statusSpy = jest.spyOn(service, "assertStatusAllowed");
      const lockSpy = jest.spyOn(service, "assertNotLocked");

      const error = await catchAppError(() =>
        service.requireActionableStream(STREAM_ID, LIVE_STATUSES, "terminated"),
      );

      expect(error.statusCode).toBe(404);
      expect(statusSpy).not.toHaveBeenCalled();
      expect(lockSpy).not.toHaveBeenCalled();
    });

    it("reports the status error before the lock error when both apply", async () => {
      const stream = makeStream({ status: StreamStatus.TERMINATED, lockedAt: LOCKED_AT });
      const service = new StreamValidationService(makePrisma(stream) as any);

      const error = await catchAppError(() =>
        service.requireActionableStream(STREAM_ID, LIVE_STATUSES, "terminated"),
      );

      expect(error.message).toBe(`Stream ${STREAM_ID} cannot be terminated from status TERMINATED`);
    });

    it("fails with the lock error when the status is valid but the stream is locked", async () => {
      const stream = makeStream({ lockedAt: LOCKED_AT, lockedBy: "GADMIN" });
      const service = new StreamValidationService(makePrisma(stream) as any);

      const error = await catchAppError(() =>
        service.requireActionableStream(STREAM_ID, LIVE_STATUSES, "clawed back"),
      );

      expect(error.statusCode).toBe(409);
      expect(error.message).toBe(`Stream ${STREAM_ID} is locked for maintenance`);
    });
  });
});
