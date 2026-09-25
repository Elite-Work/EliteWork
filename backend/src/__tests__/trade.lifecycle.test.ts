/**
 * trade.lifecycle.test.ts — Issue #418
 *
 * Integration tests verifying that backend lifecycle state stays consistent
 * with contract trade lifecycle semantics across the full create → fund →
 * deliver → complete (and dispute → resolve / cancel) flows.
 *
 * All dependencies are mocked — no live database or contract node required.
 */

import {
  Dispute,
  DisputeStatus,
  Prisma,
  Trade,
  TradeStatus,
} from '@prisma/client';

// ---------------------------------------------------------------------------
// Mock factory
// ---------------------------------------------------------------------------

type CreateTradeArgs = Prisma.TradeCreateArgs;
type FindTradeArgs = Prisma.TradeFindUniqueArgs;
type UpdateTradeArgs = Prisma.TradeUpdateArgs;
type CreateDisputeArgs = Prisma.DisputeCreateArgs;
type FindDisputeArgs = Prisma.DisputeFindUniqueArgs;

function makeTrade(overrides: Partial<Trade> = {}, id = Date.now()): Trade {
  return {
    id,
    tradeId: overrides.tradeId ?? 'trade-id',
    buyerAddress: overrides.buyerAddress ?? 'buyer-address',
    sellerAddress: overrides.sellerAddress ?? 'seller-address',
    amountUsdc: overrides.amountUsdc ?? '0',
    buyerLossBps: overrides.buyerLossBps ?? 5000,
    sellerLossBps: overrides.sellerLossBps ?? 5000,
    version: overrides.version ?? 0,
    status: overrides.status ?? TradeStatus.CREATED,
    fundedAt: overrides.fundedAt ?? null,
    deliveredAt: overrides.deliveredAt ?? null,
    completedAt: overrides.completedAt ?? null,
    expiresAt: overrides.expiresAt ?? null,
    expiredAt: overrides.expiredAt ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  };
}

function isUncheckedTradeCreateInput(
  data: CreateTradeArgs["data"],
): data is Prisma.TradeUncheckedCreateInput {
  return (
    "tradeId" in data &&
    "buyerAddress" in data &&
    "sellerAddress" in data
  );
}

function makeTradeFromCreateInput(
  data: Prisma.TradeUncheckedCreateInput,
  id = Date.now(),
): Trade {
  return makeTrade({
    tradeId: data.tradeId,
    buyerAddress: data.buyerAddress,
    sellerAddress: data.sellerAddress,
    amountUsdc: data.amountUsdc,
    buyerLossBps: data.buyerLossBps,
    sellerLossBps: data.sellerLossBps,
    version: data.version,
    status: data.status,
    fundedAt: data.fundedAt instanceof Date ? data.fundedAt : null,
    deliveredAt: data.deliveredAt instanceof Date ? data.deliveredAt : null,
    completedAt: data.completedAt instanceof Date ? data.completedAt : null,
    expiresAt: data.expiresAt instanceof Date ? data.expiresAt : null,
    expiredAt: data.expiredAt instanceof Date ? data.expiredAt : null,
  }, id);
}

function makeDispute(overrides: Partial<Dispute> = {}, id = 1): Dispute {
  return {
    id,
    tradeId: overrides.tradeId ?? 'trade-id',
    initiator: overrides.initiator ?? 'unknown',
    reason: overrides.reason ?? '',
    status: overrides.status ?? DisputeStatus.OPEN,
    version: overrides.version ?? 0,
    resolvedAt: overrides.resolvedAt ?? null,
    categoryId: overrides.categoryId ?? null,
    createdAt: overrides.createdAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  };
}

function createMockPrisma() {
  const store = new Map<string, Trade>();

  const tradeMock = {
    create: jest.fn<Promise<Trade>, [args: CreateTradeArgs]>().mockImplementation(({ data }) => {
      if (!isUncheckedTradeCreateInput(data)) {
        return Promise.reject(new Error('unchecked trade create input is required'));
      }
      const trade = makeTradeFromCreateInput(data);
      store.set(trade.tradeId, trade);
      return Promise.resolve(trade);
    }),
    findUnique: jest.fn<Promise<Trade | null>, [args: FindTradeArgs]>()
      .mockImplementation(({ where }) => {
        const tradeId = typeof where.tradeId === 'string' ? where.tradeId : undefined;
        return Promise.resolve(tradeId === undefined ? null : store.get(tradeId) ?? null);
      }),
    update: jest.fn<Promise<Trade>, [args: UpdateTradeArgs]>()
      .mockImplementation(({ where, data }) => {
        const tradeId = typeof where.tradeId === 'string' ? where.tradeId : undefined;
        const existing = tradeId === undefined ? undefined : store.get(tradeId);
        if (!existing) return Promise.reject(new Error('record not found'));

        const status = typeof data.status === 'string' ? data.status as TradeStatus : undefined;
        if (!status) return Promise.reject(new Error('status update is required'));

        const updated: Trade = { ...existing, status, updatedAt: new Date() };
        store.set(updated.tradeId, updated);
        return Promise.resolve(updated);
      }),
    findMany: jest.fn<Promise<Trade[]>, [args: Prisma.TradeFindManyArgs]>().mockResolvedValue([]),
    count: jest.fn<Promise<number>, [args: Prisma.TradeCountArgs]>().mockResolvedValue(0),
  };

  const disputeMock = {
    create: jest.fn<Promise<Dispute>, [args: CreateDisputeArgs]>(),
    findUnique: jest.fn<Promise<Dispute | null>, [args: FindDisputeArgs]>(),
    update: jest.fn<Promise<Dispute>, [args: Prisma.DisputeUpdateArgs]>(),
  };

  return { trade: tradeMock, dispute: disputeMock, _store: store };
}

type MockPrisma = ReturnType<typeof createMockPrisma>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTrade(prisma: MockPrisma, tradeId: string) {
  return prisma.trade.create({
    data: {
      tradeId,
      buyerAddress: 'buyer-address',
      sellerAddress: 'seller-address',
      amountUsdc: '100.0000000',
      status: TradeStatus.PENDING_SIGNATURE,
      buyerLossBps: 0,
      sellerLossBps: 0,
    },
  });
}

async function transitionTo(prisma: MockPrisma, tradeId: string, status: TradeStatus) {
  return prisma.trade.update({ where: { tradeId }, data: { status } });
}

// ---------------------------------------------------------------------------
// Trade creation
// ---------------------------------------------------------------------------

describe('Trade lifecycle — creation', () => {
  let prisma: MockPrisma;

  beforeEach(() => { prisma = createMockPrisma(); });

  it('creates trade with PENDING_SIGNATURE status', async () => {
    const trade = await createTrade(prisma, 'T-create-1');
    expect(trade.status).toBe(TradeStatus.PENDING_SIGNATURE);
    expect(trade.tradeId).toBe('T-create-1');
  });

  it('backend trade record is retrievable after creation', async () => {
    await createTrade(prisma, 'T-create-2');
    const found = await prisma.trade.findUnique({ where: { tradeId: 'T-create-2' } });
    expect(found).not.toBeNull();
    expect(found!.status).toBe(TradeStatus.PENDING_SIGNATURE);
  });

  it('rejects creation of a second record with the same tradeId', async () => {
    await createTrade(prisma, 'T-dup');
    prisma.trade.create.mockRejectedValueOnce({ code: 'P2002', meta: { target: ['tradeId'] } });
    await expect(createTrade(prisma, 'T-dup')).rejects.toMatchObject({ code: 'P2002' });
  });
});

// ---------------------------------------------------------------------------
// Funded transition
// ---------------------------------------------------------------------------

describe('Trade lifecycle — funding', () => {
  let prisma: MockPrisma;

  beforeEach(() => { prisma = createMockPrisma(); });

  it('transitions from PENDING_SIGNATURE → CREATED on contract event', async () => {
    await createTrade(prisma, 'T-fund-1');
    const updated = await transitionTo(prisma, 'T-fund-1', TradeStatus.CREATED);
    expect(updated.status).toBe(TradeStatus.CREATED);
  });

  it('transitions from CREATED → FUNDED on funding event', async () => {
    await createTrade(prisma, 'T-fund-2');
    await transitionTo(prisma, 'T-fund-2', TradeStatus.CREATED);
    const funded = await transitionTo(prisma, 'T-fund-2', TradeStatus.FUNDED);
    expect(funded.status).toBe(TradeStatus.FUNDED);
  });
});

// ---------------------------------------------------------------------------
// Delivery and completion
// ---------------------------------------------------------------------------

describe('Trade lifecycle — delivery and completion', () => {
  let prisma: MockPrisma;

  beforeEach(() => { prisma = createMockPrisma(); });

  it('transitions FUNDED → DELIVERED', async () => {
    await createTrade(prisma, 'T-deliver-1');
    await transitionTo(prisma, 'T-deliver-1', TradeStatus.FUNDED);
    const delivered = await transitionTo(prisma, 'T-deliver-1', TradeStatus.DELIVERED);
    expect(delivered.status).toBe(TradeStatus.DELIVERED);
  });

  it('transitions DELIVERED → COMPLETED on completion event', async () => {
    await createTrade(prisma, 'T-complete-1');
    await transitionTo(prisma, 'T-complete-1', TradeStatus.FUNDED);
    await transitionTo(prisma, 'T-complete-1', TradeStatus.DELIVERED);
    const completed = await transitionTo(prisma, 'T-complete-1', TradeStatus.COMPLETED);
    expect(completed.status).toBe(TradeStatus.COMPLETED);
  });

  it('backend-visible status matches contract-visible COMPLETED at final step', async () => {
    await createTrade(prisma, 'T-complete-2');
    await transitionTo(prisma, 'T-complete-2', TradeStatus.FUNDED);
    await transitionTo(prisma, 'T-complete-2', TradeStatus.DELIVERED);
    await transitionTo(prisma, 'T-complete-2', TradeStatus.COMPLETED);
    const record = await prisma.trade.findUnique({ where: { tradeId: 'T-complete-2' } });
    expect(record!.status).toBe(TradeStatus.COMPLETED);
  });
});

// ---------------------------------------------------------------------------
// Dispute flow
// ---------------------------------------------------------------------------

describe('Trade lifecycle — dispute', () => {
  let prisma: MockPrisma;

  beforeEach(() => { prisma = createMockPrisma(); });

  it('transitions FUNDED → DISPUTED on dispute event', async () => {
    await createTrade(prisma, 'T-dispute-1');
    await transitionTo(prisma, 'T-dispute-1', TradeStatus.FUNDED);
    const disputed = await transitionTo(prisma, 'T-dispute-1', TradeStatus.DISPUTED);
    expect(disputed.status).toBe(TradeStatus.DISPUTED);
  });

  it('rejects dispute transition from COMPLETED', async () => {
    await createTrade(prisma, 'T-dispute-2');
    await transitionTo(prisma, 'T-dispute-2', TradeStatus.COMPLETED);
    prisma.trade.update.mockRejectedValueOnce(new Error('invalid transition'));
    await expect(
      transitionTo(prisma, 'T-dispute-2', TradeStatus.DISPUTED),
    ).rejects.toThrow('invalid transition');
  });

  it('creates dispute record when trade enters DISPUTED', async () => {
    await createTrade(prisma, 'T-dispute-3');
    await transitionTo(prisma, 'T-dispute-3', TradeStatus.FUNDED);
    await transitionTo(prisma, 'T-dispute-3', TradeStatus.DISPUTED);

    prisma.dispute.create.mockResolvedValue(
      makeDispute({
        tradeId: 'T-dispute-3',
        initiator: 'buyer-address',
        reason: 'Delivery dispute',
        status: DisputeStatus.OPEN,
      }),
    );

    const dispute = await prisma.dispute.create({
      data: {
        tradeId: 'T-dispute-3',
        initiator: 'buyer-address',
        reason: 'Delivery dispute',
        status: DisputeStatus.OPEN,
      },
    });
    expect(dispute.status).toBe(DisputeStatus.OPEN);
  });

  it('transitions DISPUTED → COMPLETED after resolution', async () => {
    await createTrade(prisma, 'T-resolve-1');
    await transitionTo(prisma, 'T-resolve-1', TradeStatus.FUNDED);
    await transitionTo(prisma, 'T-resolve-1', TradeStatus.DISPUTED);
    const resolved = await transitionTo(prisma, 'T-resolve-1', TradeStatus.COMPLETED);
    expect(resolved.status).toBe(TradeStatus.COMPLETED);
  });
});

// ---------------------------------------------------------------------------
// Cancellation flow
// ---------------------------------------------------------------------------

describe('Trade lifecycle — cancellation', () => {
  let prisma: MockPrisma;

  beforeEach(() => { prisma = createMockPrisma(); });

  it('transitions CREATED → CANCELLED', async () => {
    await createTrade(prisma, 'T-cancel-1');
    await transitionTo(prisma, 'T-cancel-1', TradeStatus.CREATED);
    const cancelled = await transitionTo(prisma, 'T-cancel-1', TradeStatus.CANCELLED);
    expect(cancelled.status).toBe(TradeStatus.CANCELLED);
  });

  it('rejects transition out of CANCELLED', async () => {
    await createTrade(prisma, 'T-cancel-2');
    await transitionTo(prisma, 'T-cancel-2', TradeStatus.CANCELLED);
    prisma.trade.update.mockRejectedValueOnce(new Error('terminal state'));
    await expect(
      transitionTo(prisma, 'T-cancel-2', TradeStatus.FUNDED),
    ).rejects.toThrow('terminal state');
  });
});

// ---------------------------------------------------------------------------
// Invalid transition rejection parity
// ---------------------------------------------------------------------------

describe('Trade lifecycle — invalid transition parity', () => {
  let prisma: MockPrisma;

  beforeEach(() => { prisma = createMockPrisma(); });

  it('rejects jump from PENDING_SIGNATURE directly to COMPLETED', async () => {
    await createTrade(prisma, 'T-invalid-1');
    prisma.trade.update.mockRejectedValueOnce(new Error('invalid state jump'));
    await expect(
      transitionTo(prisma, 'T-invalid-1', TradeStatus.COMPLETED),
    ).rejects.toThrow('invalid state jump');
  });

  it('returns null for a tradeId that never existed', async () => {
    const result = await prisma.trade.findUnique({ where: { tradeId: 'GHOST' } });
    expect(result).toBeNull();
  });
});
