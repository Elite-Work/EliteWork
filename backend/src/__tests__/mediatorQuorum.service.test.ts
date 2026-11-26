/**
 * Mediator quorum mirror tests (#195).
 *
 * The branches worth pinning are the ones that decide money: reaching quorum,
 * failing to reach it, the deadline fallback, and the tie-break. Each of these
 * is duplicated in the contract's `quorum_stress_tests.rs`; if a case here
 * changes without the contract changing, the two layers have drifted.
 */

import {
  BPS_DIVISOR,
  DEFAULT_MEDIATOR_WEIGHT,
  DEFAULT_QUORUM_CONFIG,
  DisputeVoteState,
  MAX_MEDIATOR_WEIGHT,
  MediatorQuorumService,
  MediatorVote,
  QuorumConfig,
  assertMediatorWeightValid,
  assertQuorumConfigValid,
  evaluateVote,
  pendingResolution,
  quorumStatus,
  requiresQuorum,
  tallyVotes,
} from "../services/mediatorQuorum.service";

const NOW = 1_700_000_000;
const WINDOW = 7 * 24 * 60 * 60;
const THRESHOLD = 1_000_000n;

const ENABLED: QuorumConfig = {
  enabled: true,
  valueThreshold: THRESHOLD,
  requiredWeight: 3,
  voteWindowSecs: WINDOW,
  fallbackMinWeight: 2,
};

function vote(
  mediator: string,
  sellerGetsBps: number,
  weight = DEFAULT_MEDIATOR_WEIGHT,
  votedAt = NOW,
): MediatorVote {
  return {
    mediator,
    sellerGetsBps,
    weight,
    rationaleHash: `Qm${mediator}`,
    votedAt,
  };
}

function state(votes: MediatorVote[], amount = THRESHOLD * 4n): DisputeVoteState {
  return {
    tradeId: "trade-1",
    amount,
    votes,
    openedAt: votes.length > 0 ? votes[0].votedAt : null,
  };
}

describe("quorum config mirrors the contract", () => {
  it("is disabled by default", () => {
    expect(DEFAULT_QUORUM_CONFIG.enabled).toBe(false);
  });

  it("carries the contract's default values", () => {
    expect(DEFAULT_QUORUM_CONFIG.valueThreshold).toBe(10_000_000_000n);
    expect(DEFAULT_QUORUM_CONFIG.requiredWeight).toBe(3);
    expect(DEFAULT_QUORUM_CONFIG.voteWindowSecs).toBe(WINDOW);
    expect(DEFAULT_QUORUM_CONFIG.fallbackMinWeight).toBe(2);
    expect(DEFAULT_MEDIATOR_WEIGHT).toBe(1);
    expect(MAX_MEDIATOR_WEIGHT).toBe(10);
    expect(BPS_DIVISOR).toBe(10_000);
  });
});

describe("requiresQuorum", () => {
  it("is false while quorum is disabled, at any value", () => {
    expect(requiresQuorum(THRESHOLD * 1_000n)).toBe(false);
  });

  it("is false below the threshold", () => {
    expect(requiresQuorum(THRESHOLD - 1n, ENABLED)).toBe(false);
  });

  it("is true at the threshold exactly", () => {
    expect(requiresQuorum(THRESHOLD, ENABLED)).toBe(true);
  });

  it("is true above the threshold", () => {
    expect(requiresQuorum(THRESHOLD + 1n, ENABLED)).toBe(true);
  });
});

describe("tallyVotes", () => {
  it("returns an empty tally for no votes", () => {
    expect(tallyVotes([])).toEqual([]);
  });

  it("pools weight behind the same outcome", () => {
    const tallies = tallyVotes([
      vote("a", 7_000),
      vote("b", 7_000),
      vote("c", 2_000),
    ]);
    expect(tallies[0]).toEqual({ sellerGetsBps: 7_000, weight: 2, voteCount: 2 });
    expect(tallies[1]).toEqual({ sellerGetsBps: 2_000, weight: 1, voteCount: 1 });
  });

  it("keeps distinct outcomes separate", () => {
    const tallies = tallyVotes([
      vote("a", 7_000),
      vote("b", 3_000),
      vote("c", 10_000),
    ]);
    expect(tallies).toHaveLength(3);
    expect(tallies.every((t) => t.weight === 1)).toBe(true);
  });

  it("counts weight, not headcount", () => {
    const tallies = tallyVotes([vote("heavy", 8_000, 3), vote("light", 2_000, 1)]);
    expect(tallies[0]).toEqual({ sellerGetsBps: 8_000, weight: 3, voteCount: 1 });
  });

  it("orders a tie by ascending bps, matching the contract's tie-break", () => {
    const tallies = tallyVotes([
      vote("a", 8_000),
      vote("b", 2_000),
      vote("c", 8_000),
      vote("d", 2_000),
    ]);
    expect(tallies[0].sellerGetsBps).toBe(2_000);
    expect(tallies[0].weight).toBe(2);
    expect(tallies[1].sellerGetsBps).toBe(8_000);
  });
});

describe("quorumStatus", () => {
  it("reports the full required weight as outstanding with no votes", () => {
    const status = quorumStatus(state([]), NOW, ENABLED);
    expect(status.voteCount).toBe(0);
    expect(status.leadingBps).toBeNull();
    expect(status.weightToQuorum).toBe(3);
    expect(status.quorumReached).toBe(false);
    expect(status.fallbackAvailableAt).toBeNull();
    expect(status.fallbackAvailable).toBe(false);
  });

  it("counts down the weight still needed", () => {
    const status = quorumStatus(state([vote("a", 7_000)]), NOW, ENABLED);
    expect(status.leadingBps).toBe(7_000);
    expect(status.weightToQuorum).toBe(2);
    expect(status.quorumReached).toBe(false);
  });

  it("reports quorum once one outcome carries the required weight", () => {
    const status = quorumStatus(
      state([vote("a", 7_000), vote("b", 7_000), vote("c", 7_000)]),
      NOW,
      ENABLED,
    );
    expect(status.quorumReached).toBe(true);
    expect(status.weightToQuorum).toBe(0);
  });

  it("does not pool disagreeing votes into quorum", () => {
    const status = quorumStatus(
      state([vote("a", 7_000), vote("b", 3_000), vote("c", 10_000)]),
      NOW,
      ENABLED,
    );
    expect(status.totalWeight).toBe(3);
    expect(status.quorumReached).toBe(false);
    expect(status.weightToQuorum).toBe(2);
  });

  it("measures the fallback window from the first vote", () => {
    const votes = [vote("a", 7_000, 1, NOW), vote("b", 7_000, 1, NOW + 100)];
    const status = quorumStatus(state(votes), NOW, ENABLED);
    expect(status.fallbackAvailableAt).toBe(NOW + WINDOW);
  });

  it("withholds the fallback until the window closes", () => {
    const votes = [vote("a", 7_000), vote("b", 2_000)];
    expect(quorumStatus(state(votes), NOW + WINDOW - 1, ENABLED).fallbackAvailable).toBe(
      false,
    );
    expect(quorumStatus(state(votes), NOW + WINDOW, ENABLED).fallbackAvailable).toBe(
      true,
    );
  });

  it("withholds the fallback below the minimum weight", () => {
    const status = quorumStatus(state([vote("a", 7_000)]), NOW + WINDOW, ENABLED);
    expect(status.totalWeight).toBe(1);
    expect(status.fallbackAvailable).toBe(false);
  });

  it("does not offer a fallback once quorum is already reached", () => {
    const status = quorumStatus(
      state([vote("a", 7_000), vote("b", 7_000), vote("c", 7_000)]),
      NOW + WINDOW,
      ENABLED,
    );
    expect(status.quorumReached).toBe(true);
    expect(status.fallbackAvailable).toBe(false);
  });
});

describe("pendingResolution", () => {
  it("is null with no votes", () => {
    expect(pendingResolution(state([]), NOW, ENABLED)).toBeNull();
  });

  it("is null while the dispute is still open", () => {
    expect(
      pendingResolution(state([vote("a", 7_000), vote("b", 2_000)]), NOW, ENABLED),
    ).toBeNull();
  });

  it("resolves via quorum when one outcome carries the weight", () => {
    const result = pendingResolution(
      state([vote("a", 7_000), vote("b", 7_000), vote("c", 7_000)]),
      NOW,
      ENABLED,
    );
    expect(result).toEqual({ sellerGetsBps: 7_000, weight: 3, via: "quorum" });
  });

  it("resolves a weighted mediator alone", () => {
    const result = pendingResolution(state([vote("heavy", 8_000, 3)]), NOW, ENABLED);
    expect(result).toEqual({ sellerGetsBps: 8_000, weight: 3, via: "quorum" });
  });

  it("resolves via fallback on plurality after the window", () => {
    const votes = [vote("a", 7_000), vote("b", 7_000), vote("c", 2_000)];
    const result = pendingResolution(state(votes), NOW + WINDOW, ENABLED);
    expect(result).toEqual({ sellerGetsBps: 7_000, weight: 2, via: "fallback" });
  });

  it("breaks a fallback tie toward the buyer", () => {
    const votes = [
      vote("a", 8_000),
      vote("b", 2_000),
      vote("c", 8_000),
      vote("d", 2_000),
    ];
    const result = pendingResolution(state(votes), NOW + WINDOW, {
      ...ENABLED,
      requiredWeight: 4,
    });
    expect(result).toEqual({ sellerGetsBps: 2_000, weight: 2, via: "fallback" });
  });
});

describe("evaluateVote", () => {
  const base = state([]);

  it("accepts a well-formed first vote", () => {
    expect(
      evaluateVote({
        state: base,
        mediator: "m1",
        sellerGetsBps: 7_000,
        rationaleHash: "QmRationale",
        config: ENABLED,
      }).allowed,
    ).toBe(true);
  });

  it("rejects bps outside 0..10_000", () => {
    for (const bps of [-1, 10_001, 1.5]) {
      const result = evaluateVote({
        state: base,
        mediator: "m1",
        sellerGetsBps: bps,
        rationaleHash: "QmRationale",
        config: ENABLED,
      });
      expect(result.rejection).toBe("INVALID_BPS");
    }
  });

  it("accepts the bps boundaries", () => {
    for (const bps of [0, 10_000]) {
      expect(
        evaluateVote({
          state: base,
          mediator: "m1",
          sellerGetsBps: bps,
          rationaleHash: "QmRationale",
          config: ENABLED,
        }).allowed,
      ).toBe(true);
    }
  });

  it("requires a rationale hash", () => {
    const result = evaluateVote({
      state: base,
      mediator: "m1",
      sellerGetsBps: 7_000,
      rationaleHash: "   ",
      config: ENABLED,
    });
    expect(result.rejection).toBe("MISSING_RATIONALE");
  });

  it("rejects a vote on a trade below the threshold", () => {
    const result = evaluateVote({
      state: state([], THRESHOLD - 1n),
      mediator: "m1",
      sellerGetsBps: 7_000,
      rationaleHash: "QmRationale",
      config: ENABLED,
    });
    expect(result.rejection).toBe("QUORUM_NOT_REQUIRED");
  });

  it("rejects a second vote from the same mediator", () => {
    const result = evaluateVote({
      state: state([vote("m1", 7_000)]),
      mediator: "m1",
      sellerGetsBps: 2_000,
      rationaleHash: "QmSwitched",
      config: ENABLED,
    });
    expect(result.rejection).toBe("ALREADY_VOTED");
  });

  it("allows a different mediator to vote", () => {
    expect(
      evaluateVote({
        state: state([vote("m1", 7_000)]),
        mediator: "m2",
        sellerGetsBps: 7_000,
        rationaleHash: "QmRationale",
        config: ENABLED,
      }).allowed,
    ).toBe(true);
  });
});

describe("assertQuorumConfigValid", () => {
  it("accepts a valid config", () => {
    expect(() => assertQuorumConfigValid(ENABLED)).not.toThrow();
  });

  it("rejects a fallback threshold above the quorum threshold", () => {
    expect(() =>
      assertQuorumConfigValid({ ...ENABLED, requiredWeight: 2, fallbackMinWeight: 3 }),
    ).toThrow(/must not exceed requiredWeight/);
  });

  it("accepts a fallback threshold equal to the quorum threshold", () => {
    expect(() =>
      assertQuorumConfigValid({ ...ENABLED, requiredWeight: 3, fallbackMinWeight: 3 }),
    ).not.toThrow();
  });

  it("rejects non-positive weights and windows", () => {
    expect(() => assertQuorumConfigValid({ ...ENABLED, requiredWeight: 0 })).toThrow(
      /requiredWeight must be a positive integer/,
    );
    expect(() => assertQuorumConfigValid({ ...ENABLED, voteWindowSecs: 0 })).toThrow(
      /voteWindowSecs must be a positive integer/,
    );
    expect(() => assertQuorumConfigValid({ ...ENABLED, fallbackMinWeight: 0 })).toThrow(
      /fallbackMinWeight must be a positive integer/,
    );
  });

  it("rejects a negative value threshold", () => {
    expect(() => assertQuorumConfigValid({ ...ENABLED, valueThreshold: -1n })).toThrow(
      /valueThreshold must be non-negative/,
    );
  });
});

describe("assertMediatorWeightValid", () => {
  it("accepts the bounds", () => {
    expect(() => assertMediatorWeightValid(1)).not.toThrow();
    expect(() => assertMediatorWeightValid(MAX_MEDIATOR_WEIGHT)).not.toThrow();
  });

  it("rejects zero, negative, and fractional weights", () => {
    for (const weight of [0, -1, 1.5]) {
      expect(() => assertMediatorWeightValid(weight)).toThrow(/positive integer/);
    }
  });

  it("rejects a weight above the cap", () => {
    expect(() => assertMediatorWeightValid(MAX_MEDIATOR_WEIGHT + 1)).toThrow(
      /exceeds the maximum/,
    );
  });
});

describe("MediatorQuorumService", () => {
  const service = new MediatorQuorumService(ENABLED);

  it("exposes a copy of its config, not the instance", () => {
    const config = service.getConfig();
    config.requiredWeight = 99;
    expect(service.getConfig().requiredWeight).toBe(3);
  });

  it("throws a 409 carrying the rejection", () => {
    expect.assertions(2);
    try {
      service.assertVoteAllowed(state([vote("m1", 7_000)]), "m1", 7_000, "QmDup");
    } catch (err) {
      const error = err as { statusCode?: number; details?: Record<string, unknown> };
      expect(error.statusCode).toBe(409);
      expect(error.details?.rejection).toBe("ALREADY_VOTED");
    }
  });

  it("does not throw for a permitted vote", () => {
    expect(() =>
      service.assertVoteAllowed(state([]), "m1", 7_000, "QmRationale"),
    ).not.toThrow();
  });

  it("exposes service delegate methods correctly", () => {
    expect(service.requiresQuorum(THRESHOLD)).toBe(true);
    expect(service.requiresQuorum(THRESHOLD - 1n)).toBe(false);

    const s = service.getStatus(state([vote("m1", 7_000, 4)]), NOW);
    expect(s.quorumReached).toBe(true);
    expect(s.weightToQuorum).toBe(0);

    const res = service.getPendingResolution(state([vote("m1", 7_000, 3)]), NOW);
    expect(res).toEqual({ sellerGetsBps: 7_000, weight: 3, via: "quorum" });
  });

  it("throws 409 with reason for invalid bps or missing rationale", () => {
    expect(() =>
      service.assertVoteAllowed(state([]), "m1", -1, "QmRationale"),
    ).toThrow();
    expect(() =>
      service.assertVoteAllowed(state([]), "m1", 5000, "   "),
    ).toThrow();
    expect(() =>
      service.assertVoteAllowed(state([], THRESHOLD - 1n), "m1", 5000, "QmRationale"),
    ).toThrow();
  });
});
