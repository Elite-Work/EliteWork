import { OrphanDepositService, DepositEvent } from '../orphanDeposit.service';

type AsyncMock = jest.Mock<Promise<unknown>, unknown[]>;

function asyncMock(): AsyncMock {
    return jest.fn<Promise<unknown>, unknown[]>();
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    orphanDeposit: {
      findUnique: asyncMock().mockResolvedValue(null),
      create: asyncMock().mockResolvedValue({ id: 1 }),
      findMany: asyncMock().mockResolvedValue([]),
      count: asyncMock().mockResolvedValue(0),
      update: asyncMock().mockResolvedValue({}),
    },
    trade: {
      findUnique: asyncMock().mockResolvedValue(null),
    },
    adminActionAudit: {
      create: asyncMock().mockResolvedValue({}),
    },
    $transaction: asyncMock().mockImplementation((...ops: unknown[]) => Promise.resolve(ops)),
    ...overrides,
  };
}

const baseEvent: DepositEvent = {
  ledgerSeq: 1000,
  txHash: 'abc123',
  depositorAddress: 'GDEPOSITOR',
  amountRaw: '500000000',
  assetId: 'cNGN-contract',
  contractTradeId: 'trade-99',
};

describe('OrphanDepositService.ingestDepositEvents', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates orphan record when no matching trade exists', async () => {
    const db = makePrisma();
    const service = new OrphanDepositService(db as never);

    const result = await service.ingestDepositEvents([baseEvent]);

    expect(result.orphansDetected).toBe(1);
    expect(result.alreadyKnown).toBe(0);
    expect(db.orphanDeposit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ txHash: 'abc123' }),
      }),
    );
  });

  it('skips event when txHash already recorded', async () => {
    const db = makePrisma();
    (db.orphanDeposit.findUnique as AsyncMock).mockResolvedValue({ id: 5 });
    const service = new OrphanDepositService(db as never);

    const result = await service.ingestDepositEvents([baseEvent]);

    expect(result.alreadyKnown).toBe(1);
    expect(result.orphansDetected).toBe(0);
    expect(db.orphanDeposit.create).not.toHaveBeenCalled();
  });

  it('skips event when matching trade exists in DB', async () => {
    const db = makePrisma();
    (db.trade.findUnique as AsyncMock).mockResolvedValue({ id: 10, tradeId: 'trade-99' });
    const service = new OrphanDepositService(db as never);

    const result = await service.ingestDepositEvents([baseEvent]);

    expect(result.orphansDetected).toBe(0);
    expect(db.orphanDeposit.create).not.toHaveBeenCalled();
  });

  it('handles event with no contractTradeId as orphan', async () => {
    const db = makePrisma();
    const noIdEvent: DepositEvent = { ...baseEvent, contractTradeId: undefined };
    const service = new OrphanDepositService(db as never);

    const result = await service.ingestDepositEvents([noIdEvent]);

    expect(result.orphansDetected).toBe(1);
  });
});

describe('OrphanDepositService.attachOrphanToTrade', () => {
  it('throws when trade does not exist', async () => {
    const db = makePrisma();
    const service = new OrphanDepositService(db as never);

    await expect(service.attachOrphanToTrade(1, 'missing-trade', 'GADMIN')).rejects.toThrow(
      'Trade missing-trade not found',
    );
  });

  it('calls $transaction with update + audit on success', async () => {
    const db = makePrisma();
    (db.trade.findUnique as AsyncMock).mockResolvedValue({ id: 1, tradeId: 'trade-1' });
    const service = new OrphanDepositService(db as never);

    await service.attachOrphanToTrade(3, 'trade-1', 'GADMIN');

    expect(db.$transaction).toHaveBeenCalled();
  });
});
