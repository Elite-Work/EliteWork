import { PrismaClient } from "@prisma/client";
import { AdminAuditService } from "../services/adminAudit.service";
import { encodeCursor } from "../lib/cursorPagination";

describe("AdminAuditService.list", () => {
  let mockPrisma: {
    adminActionAudit: { findMany: jest.Mock; count: jest.Mock };
  };
  let adminAuditService: AdminAuditService;

  beforeEach(() => {
    mockPrisma = {
      adminActionAudit: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    adminAuditService = new AdminAuditService(mockPrisma as unknown as Pick<PrismaClient, "adminActionAudit">);
  });

  it("defaults to cursor pagination ordered newest-first", async () => {
    const records = [
      {
        id: 2,
        action: "TREASURY_WITHDRAW",
        actorAddress: "GADMIN",
        targetReference: "GDEST",
        note: "OPS-42",
        createdAt: new Date("2026-07-02T00:00:00Z"),
      },
    ];
    mockPrisma.adminActionAudit.findMany.mockResolvedValue(records);

    const result = await adminAuditService.list();

    expect(mockPrisma.adminActionAudit.findMany).toHaveBeenCalledWith({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 21,
    });
    expect(result.items).toEqual(records);
    expect(result.pageInfo).toEqual({ nextCursor: null, hasNextPage: false, limit: 20 });
    expect(result.pagination).toBeUndefined();
  });

  it("walks to the next page using the returned cursor", async () => {
    const page1 = [{ id: 5, action: "A", actorAddress: "G1", targetReference: null, note: null, createdAt: new Date() }];
    mockPrisma.adminActionAudit.findMany.mockResolvedValueOnce(page1);

    const result = await adminAuditService.list({ limit: 1 });
    expect(result.pageInfo.hasNextPage).toBe(false);

    mockPrisma.adminActionAudit.findMany.mockResolvedValueOnce([]);
    const cursor = encodeCursor({ id: 5 });
    await adminAuditService.list({ cursor, limit: 1 });

    expect(mockPrisma.adminActionAudit.findMany).toHaveBeenLastCalledWith({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
      cursor: { id: 5 },
      skip: 1,
    });
  });

  it("honors legacy page/limit params for backward compatibility", async () => {
    mockPrisma.adminActionAudit.count.mockResolvedValue(45);

    const result = await adminAuditService.list({ page: 2, limit: 10 });

    expect(mockPrisma.adminActionAudit.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      skip: 10,
      take: 10,
    });
    expect(result.pagination).toEqual({ page: 2, limit: 10, total: 45, totalPages: 5 });
  });

  it("caps the limit at 100 even if a larger value is requested", async () => {
    await adminAuditService.list({ limit: 500 });

    expect(mockPrisma.adminActionAudit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 101 }),
    );
  });

  it("falls back to defaults for invalid legacy page/limit values", async () => {
    await adminAuditService.list({ page: -1, limit: 0 });

    expect(mockPrisma.adminActionAudit.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 20,
    });
  });
});
