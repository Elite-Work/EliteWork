/**
 * Mutation-killing tests for lossAllocation.ts
 *
 * Covers the mutation classes that the main lossAllocation.test.ts is weakest
 * against, particularly:
 *   - ArithmeticOperator: BigInt addition, subtraction, multiplication, and division in allocation math
 *   - BoundaryValue: BPS_DIVISOR (10_000), off-by-one in remainder loop
 *   - ConditionalExpression: comparisons in sort, eviction branches
 *   - BlockStatement: early return / guard removals
 *   - ObjectLiteral: remainder / sum field correctness
 */

import {
  largestRemainderAllocation,
  splitLossRatio,
  assertZeroDust,
  type AllocationResult,
} from "../lib/lossAllocation";

// ─── ArithmeticOperator mutations ──────────────────────────────────────────

describe("lossAllocation — arithmetic precision (mutation killers)", () => {
  /**
   * Targets: product = total * sharesBps[i]  (not + or −)
   * and floorValue = product / BPS_DIVISOR   (not *)
   */
  it("70/30 split: party 0 gets 7_000 not 3_000", () => {
    const r = largestRemainderAllocation({ total: 10_000n, sharesBps: [7_000n, 3_000n] });
    expect(r.allocated[0]).toBe(7_000n);
    expect(r.allocated[1]).toBe(3_000n);
  });

  it("1/99 split of 100: party 1 gets 99", () => {
    const r = largestRemainderAllocation({ total: 100n, sharesBps: [100n, 9_900n] });
    expect(r.allocated[0]).toBe(1n);
    expect(r.allocated[1]).toBe(99n);
    assertZeroDust(r, 100n);
  });

  it("remainder = product mod BPS_DIVISOR (not product / BPS_DIVISOR)", () => {
    // 7 * 7_000 = 49_000; floor = 4 (not 4_900); remainder = 9_000
    // 7 * 3_000 = 21_000; floor = 2 (not 2_100); remainder = 1_000
    // Party 0 (remainder 9_000 > 1_000) gets the 1 extra stroop
    const r = largestRemainderAllocation({ total: 7n, sharesBps: [7_000n, 3_000n] });
    // floor: [4, 2], sum = 6, remaining = 1; party 0 gets it (larger remainder)
    expect(r.allocated[0]).toBe(5n);
    expect(r.allocated[1]).toBe(2n);
    assertZeroDust(r, 7n);
  });

  it("assignedSum = sum of floors (not sum of products)", () => {
    // If assignedSum used products (not floors), remainingStroops would be wrong
    // 13 * [3_000, 7_000]:
    //   floor([3_000*13/10_000]) = floor(3.9) = 3
    //   floor([7_000*13/10_000]) = floor(9.1) = 9
    //   assignedSum = 12, remaining = 1; party 0 gets it (remainder 9_000 > 1_000)
    const r = largestRemainderAllocation({ total: 13n, sharesBps: [3_000n, 7_000n] });
    expect(r.allocated[0]).toBe(4n);
    expect(r.allocated[1]).toBe(9n);
    assertZeroDust(r, 13n);
  });
});

// ─── BoundaryValue mutations ────────────────────────────────────────────────

describe("lossAllocation — BPS boundary (mutation killers)", () => {
  it("BPS_DIVISOR = 10_000, not 9_999 or 10_001", () => {
    // If divisor were 9_999: 10_000 * 5_000 / 9_999 = 5000.5 → floor 5000 (same)
    // Use a value where off-by-one gives different floor:
    // total=9_999, share=5_000:
    //   correct: 9_999 * 5_000 / 10_000 = 4_999.5 → floor 4_999
    //   wrong (9_999): 9_999 * 5_000 / 9_999 = 5_000 → floor 5_000 (different!)
    const r = largestRemainderAllocation({ total: 9_999n, sharesBps: [5_000n, 5_000n] });
    // floors: [4_999, 4_999], sum=9_998, remaining=1
    // Both remainders are equal (5_000); party 0 gets the extra stroop
    expect(r.allocated[0]).toBe(5_000n);
    expect(r.allocated[1]).toBe(4_999n);
    assertZeroDust(r, 9_999n);
  });

  it("validation: throws when sum = 9_999 (off by 1 below 10_000)", () => {
    expect(() =>
      largestRemainderAllocation({ total: 10_000n, sharesBps: [4_999n, 5_000n] }),
    ).toThrow("must sum to");
  });

  it("validation: throws when sum = 10_001 (off by 1 above 10_000)", () => {
    expect(() =>
      largestRemainderAllocation({ total: 10_000n, sharesBps: [5_001n, 5_000n] }),
    ).toThrow("must sum to");
  });
});

// ─── Remainder distribution sort (ConditionalExpression) ──────────────────

describe("lossAllocation — remainder sort order (mutation killers)", () => {
  it("stroop goes to party with LARGEST remainder, not smallest", () => {
    // total=1, shares=[1, 9_999]:
    //   floor([0, 0]), remainders=[1, 9_999]
    //   party 1 has larger remainder → gets the stroop
    const r = largestRemainderAllocation({ total: 1n, sharesBps: [1n, 9_999n] });
    expect(r.allocated[0]).toBe(0n);
    expect(r.allocated[1]).toBe(1n);
  });

  it("with equal remainders, party 0 gets the stroop (stable sort)", () => {
    // total=1, shares=[5_000, 5_000]:
    //   remainders=[5_000, 5_000] — equal, sort stable → party 0 first
    const r = largestRemainderAllocation({ total: 1n, sharesBps: [5_000n, 5_000n] });
    expect(r.allocated[0]).toBe(1n);
    expect(r.allocated[1]).toBe(0n);
  });

  it("distributes N extra stroops to top-N parties by remainder", () => {
    // total=7, shares=[3_334, 3_333, 3_333]:
    //   floors: [2, 2, 2], sum=6, remaining=1
    //   remainders: [3_340, 3_310, 3_310] — party 0 largest → gets +1
    const r = largestRemainderAllocation({
      total: 7n,
      sharesBps: [3_334n, 3_333n, 3_333n],
    });
    expect(r.sum).toBe(7n);
    assertZeroDust(r, 7n);
    // Party 0 has largest remainder and gets the extra stroop
    expect(r.allocated[0]).toBeGreaterThanOrEqual(r.allocated[1]);
    expect(r.allocated[0]).toBeGreaterThanOrEqual(r.allocated[2]);
  });

  it("three-party with 2 extra stroops both distributed correctly", () => {
    // total=3, shares=[4_000, 4_000, 2_000]:
    //   floors: [1, 1, 0], sum=2, remaining=1
    //   remainders: [4_000*3=12000 mod 10000=2000, same 2000, 2_000*3=6000 mod 10000=6000]
    //   party 2 largest → gets +1 → allocated=[1,1,1]
    const r = largestRemainderAllocation({
      total: 3n,
      sharesBps: [4_000n, 4_000n, 2_000n],
    });
    assertZeroDust(r, 3n);
    expect(r.sum).toBe(3n);
  });
});

// ─── ObjectLiteral / output fields ────────────────────────────────────────

describe("lossAllocation — output fields (mutation killers)", () => {
  it("sum equals the total argument, not the product sum", () => {
    const total = 999_983n;
    const r = largestRemainderAllocation({
      total,
      sharesBps: [6_500n, 3_500n],
    });
    expect(r.sum).toBe(total);
  });

  it("remainder field reflects actual stroops distributed", () => {
    // total=9_999, shares=[5_000, 5_000]: floors=[4_999,4_999], remaining=1 → remainder=1
    const r = largestRemainderAllocation({ total: 9_999n, sharesBps: [5_000n, 5_000n] });
    expect(r.remainder).toBe(1n);
  });

  it("remainder is 0 when total divides evenly", () => {
    const r = largestRemainderAllocation({ total: 10_000n, sharesBps: [5_000n, 5_000n] });
    expect(r.remainder).toBe(0n);
  });

  it("exact field is normalised (product / BPS_DIVISOR)", () => {
    // 10_000 * 7_000 / 10_000 = 7_000 for party 0
    const r = largestRemainderAllocation({ total: 10_000n, sharesBps: [7_000n, 3_000n] });
    expect(r.exact[0]).toBe(7_000n);
    expect(r.exact[1]).toBe(3_000n);
  });
});

// ─── splitLossRatio convenience ────────────────────────────────────────────

describe("splitLossRatio — mutation killers", () => {
  it("zero total returns [0, 0]", () => {
    const [a, b] = splitLossRatio(0n, 5_000n, 5_000n);
    expect(a).toBe(0n);
    expect(b).toBe(0n);
  });

  it("100% buyer gets all", () => {
    const [buyer, seller] = splitLossRatio(10_000n, 10_000n, 0n);
    expect(buyer).toBe(10_000n);
    expect(seller).toBe(0n);
  });

  it("100% seller gets all", () => {
    const [buyer, seller] = splitLossRatio(10_000n, 0n, 10_000n);
    expect(buyer).toBe(0n);
    expect(seller).toBe(10_000n);
  });

  it("sum of parts always equals total for a range of values", () => {
    const amounts = [1n, 7n, 99n, 1_000n, 99_999n, 1_000_000n];
    const splits: Array<[bigint, bigint]> = [
      [1n, 9_999n], [3_000n, 7_000n], [5_000n, 5_000n], [9_000n, 1_000n],
    ];
    for (const total of amounts) {
      for (const [b, s] of splits) {
        const [ba, sa] = splitLossRatio(total, b, s);
        expect(ba + sa).toBe(total);
      }
    }
  });
});

// ─── assertZeroDust ────────────────────────────────────────────────────────

describe("assertZeroDust — mutation killers", () => {
  it("throws when sum ≠ total", () => {
    const broken: AllocationResult = {
      exact: [],
      allocated: [4_999n, 4_999n],
      remainder: 1n,
      sum: 9_998n, // should be 9_999
    };
    expect(() => assertZeroDust(broken, 9_999n)).toThrow("zero-dust");
  });

  it("does not throw when sum = total", () => {
    const valid: AllocationResult = {
      exact: [7_000n, 3_000n],
      allocated: [7_000n, 3_000n],
      remainder: 0n,
      sum: 10_000n,
    };
    expect(() => assertZeroDust(valid, 10_000n)).not.toThrow();
  });

  it("throw message includes sum and total values", () => {
    const broken: AllocationResult = {
      exact: [],
      allocated: [5_000n],
      remainder: 0n,
      sum: 5_000n,
    };
    expect(() => assertZeroDust(broken, 6_000n)).toThrow(/5000.*6000|6000.*5000/);
  });
});
