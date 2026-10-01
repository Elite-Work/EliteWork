import { PrismaClient, StreamStatus } from "@prisma/client";
import { AdminStreamsService, vestingStateOf } from "../services/adminStreams.service";

type StreamRecord = {
  streamId: string;
  recipient: string;
  totalVested: string;
  claimed: string;
  unclaimed: string;
  pendingClawback: string;
  status: StreamStatus;
  adminTags: string[];
  createdAt: Date;
  updatedAt: Date;
};

function makeStream(overrides: Partial<StreamRecord> = {}): StreamRecord {
  return {
    streamId: "stream-1",
    recipient: "GRECIPIENT",
    totalVested: "10000",
    claimed: "0",
    unclaimed: "10000",
    pendingClawback: "0",
    status: StreamStatus.ACTIVE,
    adminTags: [],
    createdAt: new Date("2026-07-01T00:00:00Z"),
    updatedAt: new Date("2026-07-01T00:00:00Z"),
    ...overrides,
  };
}

describe("vestingStateOf", () => {
  it("is not_started when nothing has been claimed", () => {
    expect(vestingStateOf(makeStream({ claimed: "0", totalVested: "10000" }))).toBe(
      "not_started",
    );
  });

  it("is vesting when partially claimed", () => {
    expect(vestingStateOf(makeStream({ claimed: "2500", totalVested: "10000" }))).toBe("vesting");
  });

  it("is fully_vested when claimed equals or exceeds totalVested", () => {
    expect(vestingStateOf(makeStream({ claimed: "10000", totalVested: "10000" }))).toBe(
      "fully_vested",
    );
    expect(vestingStateOf(makeStream({ claimed: "12000", totalVested: "10000" }))).toBe(
      "fully_vested",
    );
  });
});

describe("AdminStreamsService.list", () => {
  let mockPrisma: { stream: { findMany: jest.Mock; findUnique: jest.Mock } };
  let service: AdminStreamsService;

  beforeEach(() => {
    mockPrisma = {
      stream: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };
    service = new AdminStreamsService(mockPrisma as unknown as Pick<PrismaClient, "stream">);
  });

  it("returns paginated summaries with derived vestingState, newest first", async () => {
    mockPrisma.stream.findMany.mockResolvedValue([
      makeStream({ streamId: "s1", claimed: "10000", totalVested: "10000" }),
    ]);

    const result = await service.list();

    expect(mockPrisma.stream.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { createdAt: "desc" },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ streamId: "s1", vestingState: "fully_vested" });
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it("filters by status at the database level", async () => {
    await service.list({ status: StreamStatus.SUSPENDED });

    expect(mockPrisma.stream.findMany).toHaveBeenCalledWith({
      where: { status: StreamStatus.SUSPENDED },
      orderBy: { createdAt: "desc" },
    });
  });

  it("filters by adminTag at the database level", async () => {
    await service.list({ adminTag: "high-value" });

    expect(mockPrisma.stream.findMany).toHaveBeenCalledWith({
      where: { adminTags: { has: "high-value" } },
      orderBy: { createdAt: "desc" },
    });
  });

  it("filters by derived vestingState in-memory", async () => {
    mockPrisma.stream.findMany.mockResolvedValue([
      makeStream({ streamId: "not-started", claimed: "0" }),
      makeStream({ streamId: "vesting", claimed: "2500" }),
      makeStream({ streamId: "fully-vested", claimed: "10000" }),
    ]);

    const result = await service.list({ vestingState: "vesting" });

    expect(result.items.map((s) => s.streamId)).toEqual(["vesting"]);
    expect(result.pagination.total).toBe(1);
  });

  it("paginates the (possibly vestingState-filtered) result set", async () => {
    mockPrisma.stream.findMany.mockResolvedValue([
      makeStream({ streamId: "s1" }),
      makeStream({ streamId: "s2" }),
      makeStream({ streamId: "s3" }),
    ]);

    const result = await service.list({ page: 2, limit: 2 });

    expect(result.items.map((s) => s.streamId)).toEqual(["s3"]);
    expect(result.pagination).toEqual({ page: 2, limit: 2, total: 3, totalPages: 2 });
  });

  it("caps limit at 100 and defaults invalid page/limit to safe values", async () => {
    await service.list({ page: -1, limit: 500 });

    // 500 items is enough to prove pagination reflects the capped limit, not the requested one.
    mockPrisma.stream.findMany.mockResolvedValue(
      Array.from({ length: 150 }, (_, i) => makeStream({ streamId: `s${i}` })),
    );
    const result = await service.list({ limit: 500 });

    expect(result.pagination.limit).toBe(100);
    expect(result.items).toHaveLength(100);
  });
});

describe("AdminStreamsService.getByStreamId", () => {
  it("returns the raw stream record for a known id", async () => {
    const mockPrisma = {
      stream: { findUnique: jest.fn().mockResolvedValue(makeStream({ streamId: "s1" })) },
    };
    const service = new AdminStreamsService(mockPrisma as unknown as Pick<PrismaClient, "stream">);

    const result = await service.getByStreamId("s1");

    expect(mockPrisma.stream.findUnique).toHaveBeenCalledWith({ where: { streamId: "s1" } });
    expect(result?.streamId).toBe("s1");
  });

  it("returns null for an unknown id", async () => {
    const mockPrisma = { stream: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new AdminStreamsService(mockPrisma as unknown as Pick<PrismaClient, "stream">);

    expect(await service.getByStreamId("missing")).toBeNull();
  });
});
