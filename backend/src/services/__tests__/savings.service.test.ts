import { SavingsService } from "../savings.service";

describe("SavingsService deposit progress and calculations", () => {
  it("calculates goal progress using integer percentage arithmetic", async () => {
    const now = new Date();
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: 1,
          walletAddress: "guser",
          vaults: [],
        }),
      },
      goal: {
        findMany: jest.fn().mockResolvedValue([
          {
            goalId: "goal-1",
            targetAmountUsdc: "300",
            currentAmountUsdc: "100",
            deadline: new Date(now.getTime() + 24 * 60 * 60 * 1000),
            status: "ACTIVE",
            createdAt: now,
            vault: { balanceUsdc: "100" },
          },
        ]),
      },
      vault: {},
    };
    const service = new SavingsService(prisma as never);

    const result = await service.getGoalsAnalytics("GUSER");

    expect(result.goals[0].percentageComplete).toBe(33);
    expect(result.overallProgressPercentage).toBe(33);
    expect(result.totalTargetAmount).toBe("300");
    expect(result.totalCurrentAmount).toBe("100");
  });

  it("records a deposit-triggered goal progress update", async () => {
    const goalUpdate = jest.fn().mockResolvedValue({
      goalId: "goal-1",
      currentAmountUsdc: "1250000",
    });
    const service = new SavingsService({
      goal: { update: goalUpdate },
      user: {},
      vault: {},
    } as never);

    await expect(service.updateGoalProgress("goal-1", "1250000")).resolves.toEqual({
      goalId: "goal-1",
      currentAmountUsdc: "1250000",
    });
    expect(goalUpdate).toHaveBeenCalledWith({
      where: { goalId: "goal-1" },
      data: { currentAmountUsdc: "1250000" },
    });
  });
});
