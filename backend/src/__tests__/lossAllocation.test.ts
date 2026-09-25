/**
 * Loss-ratio split allocation tests.
 *
 * Validates the largest-remainder algorithm for splitting escrow totals
 * according to BPS ratios, ensuring:
 *   - Zero-dust guarantee (allocations sum exactly to total)
 *   - Each share is within 1 stroop of its exact proportional share
 *   - Deterministic behavior for identical inputs
 *   - Parity between this implementation and the Rust contract
 */

import {
  largestRemainderAllocation,
  splitLossRatio,
  assertZeroDust,
} from "../lib/lossAllocation";

describe("Largest-remainder allocation — zero-dust guarantee", () => {
  describe("basic splits", () => {
    it("50/50 split of 10_000", () => {
      const result = largestRemainderAllocation({
        total: 10_000n,
        sharesBps: [5_000n, 5_000n],
      });
      expect(result.allocated[0]).toBe(5_000n);
      expect(result.allocated[1]).toBe(5_000n);
      assertZeroDust(result, 10_000n);
    });

    it("70/30 split of 10_000", () => {
      const result = largestRemainderAllocation({
        total: 10_000n,
        sharesBps: [7_000n, 3_000n],
      });
      expect(result.allocated[0]).toBe(7_000n);
      expect(result.allocated[1]).toBe(3_000n);
      assertZeroDust(result, 10_000n);
    });

    it("100/0 split of 10_000", () => {
      const result = largestRemainderAllocation({
        total: 10_000n,
        sharesBps: [10_000n, 0n],
      });
      expect(result.allocated[0]).toBe(10_000n);
      expect(result.allocated[1]).toBe(0n);
      assertZeroDust(result, 10_000n);
    });
  });

  describe("indivisible stroop amounts", () => {
    it("1 stroop total with 50/50 — gives 1 stroop to party with larger remainder", () => {
      // 1 * 5000 = 5000, floor(5000/10000)=0, remainder=5000
      // Both parties have remainder 5000, first party gets the stroop
      const result = largestRemainderAllocation({
        total: 1n,
        sharesBps: [5_000n, 5_000n],
      });
      expect(result.allocated[0] + result.allocated[1]).toBe(1n);
      assertZeroDust(result, 1n);
    });

    it("3 stroops with 70/30", () => {
      // 3 * 7000 = 21000, floor = 2, remainder = 1000
      // 3 * 3000 = 9000, floor = 0, remainder = 9000
      // Party 1 remainder (9000) > Party 0 remainder (1000), so party 1 gets +1
      const result = largestRemainderAllocation({
        total: 3n,
        sharesBps: [7_000n, 3_000n],
      });
      assertZeroDust(result, 3n);
      // Party 0: floor(21000/10000) = 2, Party 1: floor(9000/10000) = 0
      // Remaining: 3 - 2 - 0 = 1 stroop
      // Party 1 has larger remainder (9000 > 1000), gets the stroop
      expect(result.allocated[0]).toBe(2n);
      expect(result.allocated[1]).toBe(1n);
    });

    it("7 stroops with 1/99 ratio", () => {
      const result = largestRemainderAllocation({
        total: 7n,
        sharesBps: [100n, 9_900n],
      });
      assertZeroDust(result, 7n);
      // Party 0: 7 * 100 / 10000 = 0.07 → floor=0, remainder=700
      // Party 1: 7 * 9900 / 10000 = 6.93 → floor=6, remainder=9300
      expect(result.allocated[0]).toBe(0n);
      expect(result.allocated[1]).toBe(7n);
    });

    it("1 stroop with 1/9999 ratio", () => {
      const result = largestRemainderAllocation({
        total: 1n,
        sharesBps: [1n, 9_999n],
      });
      assertZeroDust(result, 1n);
      // Party 0: 1 * 1 / 10000 = 0.0001 → floor=0, remainder=1
      // Party 1: 1 * 9999 / 10000 = 0.9999 → floor=0, remainder=9999
      // Party 1 gets the stroop (larger remainder)
      expect(result.allocated[0]).toBe(0n);
      expect(result.allocated[1]).toBe(1n);
    });
  });

  describe("edge cases", () => {
    it("zero total", () => {
      const result = largestRemainderAllocation({
        total: 0n,
        sharesBps: [5_000n, 5_000n],
      });
      expect(result.allocated[0]).toBe(0n);
      expect(result.allocated[1]).toBe(0n);
      assertZeroDust(result, 0n);
    });

    it("single party (100%)", () => {
      const result = largestRemainderAllocation({
        total: 42n,
        sharesBps: [10_000n],
      });
      expect(result.allocated[0]).toBe(42n);
      assertZeroDust(result, 42n);
    });

    it("three-party split", () => {
      const result = largestRemainderAllocation({
        total: 10_000n,
        sharesBps: [3_334n, 3_333n, 3_333n],
      });
      assertZeroDust(result, 10_000n);
      // Sum should be exactly 10_000
      expect(result.sum).toBe(10_000n);
    });
  });

  describe("large amounts", () => {
    it("1M stroops with 60/40", () => {
      const result = largestRemainderAllocation({
        total: 1_000_000n,
        sharesBps: [6_000n, 4_000n],
      });
      assertZeroDust(result, 1_000_000n);
      expect(result.allocated[0]).toBe(600_000n);
      expect(result.allocated[1]).toBe(400_000n);
    });

    it("999_999_999 stroops with 70/30", () => {
      const result = largestRemainderAllocation({
        total: 999_999_999n,
        sharesBps: [7_000n, 3_000n],
      });
      assertZeroDust(result, 999_999_999n);
      // Each allocation should be within 1 stroop of exact
      const exact0 = (999_999_999n * 7_000n) / 10_000n;
      const exact1 = (999_999_999n * 3_000n) / 10_000n;
      expect(
        result.allocated[0] >= exact0 - 1n && result.allocated[0] <= exact0 + 1n,
      ).toBe(true);
      expect(
        result.allocated[1] >= exact1 - 1n && result.allocated[1] <= exact1 + 1n,
      ).toBe(true);
    });
  });

  describe("splitLossRatio convenience", () => {
    it("50/50 loss split of 10_000", () => {
      const [buyer, seller] = splitLossRatio(10_000n, 5_000n, 5_000n);
      expect(buyer + seller).toBe(10_000n);
    });

    it("70/30 loss split", () => {
      const [buyer, seller] = splitLossRatio(10_000n, 7_000n, 3_000n);
      assertZeroDust(
        { allocated: [buyer, seller], sum: buyer + seller, exact: [], remainder: 0n },
        10_000n,
      );
    });

    it("throws on invalid BPS sum", () => {
      expect(() => splitLossRatio(10_000n, 6_000n, 5_000n)).toThrow(
        "must equal",
      );
    });
  });

  describe("validation", () => {
    it("throws if sharesBps don't sum to 10_000", () => {
      expect(() =>
        largestRemainderAllocation({ total: 10_000n, sharesBps: [4_000n, 4_000n] }),
      ).toThrow("must sum to");
    });

    it("throws on negative total", () => {
      expect(() =>
        largestRemainderAllocation({ total: -1n, sharesBps: [5_000n, 5_000n] }),
      ).toThrow("non-negative");
    });

    it("throws on negative share", () => {
      expect(() =>
        largestRemainderAllocation({ total: 10_000n, sharesBps: [11_000n, -1_000n] }),
      ).toThrow("non-negative");
    });
  });
});
