/**
 * Scenario tests for the mediator quorum rule (#195): quorum met, quorum not
 * met, and tie-break. Complements mediatorQuorum.service.test.ts, which pins
 * the individual helpers; these walk whole vote sets end to end through the
 * service and pendingResolution.
 */
import {
  DisputeVoteState,
  MediatorQuorumService,
  MediatorVote,
  QuorumConfig,
  pendingResolution,
  quorumStatus,
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

function vote(mediator: string, sellerGetsBps: number, weight = 1, votedAt = NOW): MediatorVote {
  return { mediator, sellerGetsBps, weight, rationaleHash: `Qm${mediator}`, votedAt };
}

function state(votes: MediatorVote[], amount = THRESHOLD * 2n): DisputeVoteState {
  return {
    tradeId: "trade-scenario",
    amount,
    votes,
    openedAt: votes.length > 0 ? votes[0].votedAt : null,
  };
}

const service = new MediatorQuorumService(ENABLED);

describe("quorum met", () => {
  it("settles when mixed weights pool to exactly the required weight", () => {
    const s = state([vote("a", 6_000, 2), vote("b", 6_000, 1)]);

    expect(service.getStatus(s, NOW)).toMatchObject({
      quorumReached: true,
      weightToQuorum: 0,
      leadingBps: 6_000,
      totalWeight: 3,
    });
    expect(service.getPendingResolution(s, NOW)).toEqual({
      sellerGetsBps: 6_000,
      weight: 3,
      via: "quorum",
    });
  });

  it("settles despite a dissenting minority", () => {
    const s = state([vote("a", 7_000, 2), vote("b", 2_000, 2), vote("c", 7_000, 1)]);

    expect(service.getPendingResolution(s, NOW)).toEqual({
      sellerGetsBps: 7_000,
      weight: 3,
      via: "quorum",
    });
  });

  it("never reports negative weight-to-quorum when overshooting", () => {
    const status = service.getStatus(state([vote("a", 5_000, 5)]), NOW);
    expect(status.weightToQuorum).toBe(0);
    expect(status.quorumReached).toBe(true);
  });

  it("reports via quorum, not fallback, even after the window closes", () => {
    const s = state([vote("a", 4_000), vote("b", 4_000), vote("c", 4_000)]);
    const status = service.getStatus(s, NOW + WINDOW * 2);

    expect(status.quorumReached).toBe(true);
    expect(status.fallbackAvailable).toBe(false);
    expect(service.getPendingResolution(s, NOW + WINDOW * 2)?.via).toBe("quorum");
  });

  it("honours a stricter custom required weight", () => {
    const strict: QuorumConfig = { ...ENABLED, requiredWeight: 5 };
    const fourVotes = [vote("a", 9_000), vote("b", 9_000), vote("c", 9_000), vote("d", 9_000)];

    expect(quorumStatus(state(fourVotes), NOW, strict).quorumReached).toBe(false);
    expect(
      quorumStatus(state([...fourVotes, vote("e", 9_000)]), NOW, strict).quorumReached,
    ).toBe(true);
  });

  it("supports both extremes of the bps range as outcomes", () => {
    for (const bps of [0, 10_000]) {
      const s = state([vote("a", bps, 3)]);
      expect(service.getPendingResolution(s, NOW)).toEqual({
        sellerGetsBps: bps,
        weight: 3,
        via: "quorum",
      });
    }
  });
});

describe("quorum not met", () => {
  it("stays open while the leader is one weight short", () => {
    const s = state([vote("a", 7_000), vote("b", 7_000)]);
    const status = service.getStatus(s, NOW);

    expect(status.quorumReached).toBe(false);
    expect(status.weightToQuorum).toBe(1);
    expect(service.getPendingResolution(s, NOW)).toBeNull();
  });

  it("does not pool split votes even when total weight exceeds the requirement", () => {
    const s = state([vote("a", 7_000, 2), vote("b", 3_000, 1), vote("c", 1_000, 2)]);
    const status = service.getStatus(s, NOW);

    expect(status.totalWeight).toBe(5);
    expect(status.quorumReached).toBe(false);
    expect(service.getPendingResolution(s, NOW)).toBeNull();
  });

  it("stays open one second before the fallback window closes", () => {
    const s = state([vote("a", 7_000), vote("b", 2_000)]);
    expect(service.getPendingResolution(s, NOW + WINDOW - 1)).toBeNull();
  });

  it("stays open after the window when too little weight has voted", () => {
    const s = state([vote("a", 7_000)]);
    const status = service.getStatus(s, NOW + WINDOW);

    expect(status.fallbackAvailableAt).toBe(NOW + WINDOW);
    expect(status.fallbackAvailable).toBe(false);
    expect(service.getPendingResolution(s, NOW + WINDOW)).toBeNull();
  });

  it("falls back to plurality once the window closes with enough weight", () => {
    const s = state([vote("a", 7_000), vote("b", 2_000)]);
    expect(service.getPendingResolution(s, NOW + WINDOW)).toEqual({
      sellerGetsBps: 2_000,
      weight: 1,
      via: "fallback",
    });
  });

  it("reports quorum as not required while the feature is disabled", () => {
    const disabled = new MediatorQuorumService({ ...ENABLED, enabled: false });
    const s = state([]);

    expect(disabled.getStatus(s, NOW).requiresQuorum).toBe(false);
    expect(() => disabled.assertVoteAllowed(s, "m1", 5_000, "QmR")).toThrow(
      /does not require a mediator quorum/,
    );
  });

  it("rejects votes on a trade below the value threshold", () => {
    expect(() =>
      service.assertVoteAllowed(state([], THRESHOLD - 1n), "m1", 5_000, "QmR"),
    ).toThrow(/does not require a mediator quorum/);
  });
});

describe("tie-break", () => {
  it("picks the lower (buyer-protective) bps on a two-way tie", () => {
    const status = service.getStatus(state([vote("a", 8_000), vote("b", 3_000)]), NOW);

    expect(status.leadingBps).toBe(3_000);
    expect(status.tallies.map((t) => t.sellerGetsBps)).toEqual([3_000, 8_000]);
  });

  it("picks the lowest bps on a three-way tie", () => {
    const s = state([vote("a", 9_000), vote("b", 500), vote("c", 4_000)]);
    expect(service.getStatus(s, NOW).leadingBps).toBe(500);
  });

  it("is independent of vote order", () => {
    const votes = [vote("a", 8_000), vote("b", 2_000), vote("c", 8_000), vote("d", 2_000)];
    const orders = [votes, [...votes].reverse(), [votes[1], votes[0], votes[3], votes[2]]];

    for (const order of orders) {
      expect(service.getStatus(state(order), NOW).leadingBps).toBe(2_000);
    }
  });

  it("applies the tie-break when both tied outcomes reach quorum", () => {
    const s = state([
      vote("a", 8_000, 3),
      vote("b", 2_000, 1),
      vote("c", 2_000, 1),
      vote("d", 2_000, 1),
    ]);

    expect(service.getPendingResolution(s, NOW)).toEqual({
      sellerGetsBps: 2_000,
      weight: 3,
      via: "quorum",
    });
  });

  it("breaks ties on weight, not headcount", () => {
    const s = state([vote("a", 2_000), vote("b", 2_000), vote("heavy", 8_000, 3)]);
    const status = service.getStatus(s, NOW);

    expect(status.leadingBps).toBe(8_000);
    expect(status.tallies[0]).toEqual({ sellerGetsBps: 8_000, weight: 3, voteCount: 1 });
  });

  it("treats 0 bps (full refund to buyer) as the winning side of a tie", () => {
    const s = state([vote("a", 10_000), vote("b", 0)]);
    expect(pendingResolution(s, NOW + WINDOW, ENABLED)).toEqual({
      sellerGetsBps: 0,
      weight: 1,
      via: "fallback",
    });
  });
});
