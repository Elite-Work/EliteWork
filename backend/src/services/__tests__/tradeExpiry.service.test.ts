import { TradeExpiryService } from '../tradeExpiry.service';
import { TradeStatus } from '@prisma/client';

jest.mock('../../jobs/queue', () => ({
  notificationQueue: { add: jest.fn().mockResolvedValue({}) },
}));

function makePrisma(overrides: Partial<{
  findMany: ReturnType<typeof jest.fn>;
  updateMany: ReturnType<typeof jest.fn>;
}> = {}) {
  return {
    trade: {
      findMany: overrides.findMany ?? jest.fn().mockResolvedValue([]),
      updateMany: overrides.updateMany ?? jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe('TradeExpiryService.sweepExpiredTrades', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns zero counts when no stale trades exist', async () => {
    const db = makePrisma();
    const service = new TradeExpiryService(db as never);
    const result = await service.sweepExpiredTrades();
    expect(result).toEqual({ scanned: 0, expired: 0, errors: 0 });
  });

  it('marks each stale trade as EXPIRED and increments version', async () => {
    const fakeTrade = {
      id: 1,
      tradeId: 'trade-abc',
      buyerAddress: 'GBUYER',
      sellerAddress: 'GSELLER',
      amountUsdc: '100',
      status: TradeStatus.FUNDED,
      version: 3,
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const db = makePrisma({ findMany: jest.fn().mockResolvedValue([fakeTrade]), updateMany });
    const service = new TradeExpiryService(db as never);

    const result = await service.sweepExpiredTrades();

    expect(result.scanned).toBe(1);
    expect(result.expired).toBe(1);
    expect(result.errors).toBe(0);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 1, version: 3 }),
        data: expect.objectContaining({ status: TradeStatus.EXPIRED }),
      }),
    );
  });

  it('counts errors when updateMany throws', async () => {
    const fakeTrade = {
      id: 2,
      tradeId: 'trade-fail',
      buyerAddress: 'GBUYER',
      sellerAddress: 'GSELLER',
      amountUsdc: '50',
      status: TradeStatus.CREATED,
      version: 0,
    };
    const updateMany = jest.fn().mockRejectedValue(new Error('db error'));
    const db = makePrisma({ findMany: jest.fn().mockResolvedValue([fakeTrade]), updateMany });
    const service = new TradeExpiryService(db as never);

    const result = await service.sweepExpiredTrades();

    expect(result.errors).toBe(1);
    expect(result.expired).toBe(0);
  });

  it('respects batchSize limit passed to findMany', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const db = makePrisma({ findMany });
    const service = new TradeExpiryService(db as never);

    await service.sweepExpiredTrades(25);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 25 }),
    );
  });
});

describe('TradeExpiryService.getPendingRefunds', () => {
  it('queries EXPIRED trades ordered by expiredAt asc', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const db = makePrisma({ findMany });
    const service = new TradeExpiryService(db as never);

    await service.getPendingRefunds(10);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: TradeStatus.EXPIRED },
        take: 10,
        orderBy: { expiredAt: 'asc' },
      }),
    );
  });
});
