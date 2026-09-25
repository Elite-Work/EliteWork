import { DisputeCategory, Prisma } from "@prisma/client";
import {
  DisputeCategoryNameConflictError,
  DisputeCategoryNotFoundError,
  DisputeCategoryService,
} from "../services/disputeCategory.service";

type CategoryPrismaMock = {
  disputeCategory: {
    create: jest.MockedFunction<
      (args: Prisma.DisputeCategoryCreateArgs) => Promise<DisputeCategory>
    >;
    findMany: jest.MockedFunction<
      (args: Prisma.DisputeCategoryFindManyArgs) => Promise<DisputeCategory[]>
    >;
    findUnique: jest.MockedFunction<
      (args: Prisma.DisputeCategoryFindUniqueArgs) => Promise<DisputeCategory | null>
    >;
    update: jest.MockedFunction<
      (args: Prisma.DisputeCategoryUpdateArgs) => Promise<DisputeCategory>
    >;
  };
};

function createMockPrisma(): CategoryPrismaMock {
  return {
    disputeCategory: {
      create: jest.fn<
        Promise<DisputeCategory>,
        [args: Prisma.DisputeCategoryCreateArgs]
      >(),
      findMany: jest.fn<
        Promise<DisputeCategory[]>,
        [args: Prisma.DisputeCategoryFindManyArgs]
      >(),
      findUnique: jest.fn<
        Promise<DisputeCategory | null>,
        [args: Prisma.DisputeCategoryFindUniqueArgs]
      >(),
      update: jest.fn<
        Promise<DisputeCategory>,
        [args: Prisma.DisputeCategoryUpdateArgs]
      >(),
    },
  };
}

type CategoryDatabase = ConstructorParameters<typeof DisputeCategoryService>[0];

function asPrismaClient(mock: CategoryPrismaMock): CategoryDatabase {
  return mock as unknown as CategoryDatabase;
}

const mockDate = new Date("2026-05-27T00:00:00.000Z");

function makeCategory(overrides: Partial<DisputeCategory> = {}): DisputeCategory {
  return {
    id: 1,
    name: "DAMAGE",
    description: "Goods damaged",
    isActive: true,
    createdAt: mockDate,
    updatedAt: mockDate,
    ...overrides,
  };
}

describe("DisputeCategoryService", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: DisputeCategoryService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new DisputeCategoryService(asPrismaClient(prisma));
  });

  it("creates an active dispute category with a trimmed unique name", async () => {
    prisma.disputeCategory.findUnique.mockResolvedValue(null);
    prisma.disputeCategory.create.mockResolvedValue(
      makeCategory({ description: "Goods damaged" }),
    );

    const category = await service.createCategory({
      name: " DAMAGE ",
      description: "Goods damaged",
    });

    expect(prisma.disputeCategory.findUnique).toHaveBeenCalledWith({
      where: { name: "DAMAGE" },
    });
    expect(prisma.disputeCategory.create).toHaveBeenCalledWith({
      data: {
        name: "DAMAGE",
        description: "Goods damaged",
        isActive: true,
      },
    });
    expect(category).toMatchObject({
      id: 1,
      name: "DAMAGE",
      isActive: true,
      createdAt: "2026-05-27T00:00:00.000Z",
    });
  });

  it("rejects duplicate category names", async () => {
    prisma.disputeCategory.findUnique.mockResolvedValue(makeCategory());

    await expect(service.createCategory({ name: "DAMAGE" })).rejects.toBeInstanceOf(
      DisputeCategoryNameConflictError,
    );
  });

  it("lists only active categories by default", async () => {
    prisma.disputeCategory.findMany.mockResolvedValue([]);

    await service.listCategories();

    expect(prisma.disputeCategory.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });
  });

  it("deactivates a category instead of deleting it", async () => {
    prisma.disputeCategory.findUnique.mockResolvedValue(makeCategory());
    prisma.disputeCategory.update.mockResolvedValue(
      makeCategory({ isActive: false }),
    );

    await service.deleteCategory(1);

    expect(prisma.disputeCategory.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { isActive: false },
    });
  });

  it("throws when deactivating an unknown category", async () => {
    prisma.disputeCategory.findUnique.mockResolvedValue(null);

    await expect(service.deleteCategory(404)).rejects.toBeInstanceOf(DisputeCategoryNotFoundError);
  });
});
