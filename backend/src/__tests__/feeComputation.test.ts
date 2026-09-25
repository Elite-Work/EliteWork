/**
 * Unified fee computation parity tests.
 *
 * Validates that the backend fee computation matches the on-chain contract
 * logic for every trade outcome defined in the fee matrix:
 *   - release, refund, split, full_seller, full_buyer
 *
 * Also tests the conservation invariant (seller_net + buyer_refund + fee == total)
 * for all outcomes.
 */

import {
  computeFee,
  computeReleaseFee,
  computeRefundFee,
  computeSplitFee,
  computeFullSellerFee,
  computeFullBuyerFee,
  assertFeeConservation,
} from "../lib/feeComputation";

const BPS_DIVISOR = 10_000n;

describe("Fee computation — backend mirrors contract arithmetic", () => {
  describe("RELEASE outcome", () => {
    it("deducts fee from full amount", () => {
      const result = computeReleaseFee(10_000n, 100);
      expect(result.fee).toBe("100");
      expect(result.sellerNet).toBe("9900");
      expect(result.buyerRefund).toBe("0");
      assertFeeConservation(result);
    });

    it("zero fee when feeBps=0", () => {
      const result = computeReleaseFee(10_000n, 0);
      expect(result.fee).toBe("0");
      expect(result.sellerNet).toBe("10000");
      assertFeeConservation(result);
    });

    it("handles large amounts without overflow", () => {
      const result = computeReleaseFee(999_999_999n, 100);
      assertFeeConservation(result);
    });
  });

  describe("REFUND outcome", () => {
    it("charges no fee on full refund", () => {
      const result = computeRefundFee(10_000n, 100);
      expect(result.fee).toBe("0");
      expect(result.sellerNet).toBe("0");
      expect(result.buyerRefund).toBe("10000");
      assertFeeConservation(result);
    });

    it("buyer receives full amount regardless of feeBps", () => {
      const result = computeRefundFee(50_000n, 500);
      expect(result.buyerRefund).toBe("50000");
      expect(result.fee).toBe("0");
      assertFeeConservation(result);
    });
  });

  describe("SPLIT outcome (dispute resolution)", () => {
    // Documented contract example from ADR-002:
    //   total=10_000, seller_gets_bps=7_000, seller_loss_bps=4_000, fee_bps=100
    //   → seller_raw=8_800, fee=88, seller_net=8_712, buyer_refund=1_200
    it("matches the documented contract example exactly", () => {
      const result = computeSplitFee(10_000n, 7_000n, 4_000n, 100);
      expect(result.sellerNet).toBe("8712");
      expect(result.buyerRefund).toBe("1200");
      expect(result.fee).toBe("88");
      assertFeeConservation(result);
    });

    it("50/50 split with symmetric loss sharing", () => {
      const result = computeSplitFee(10_000n, 5_000n, 5_000n, 0);
      expect(result.sellerNet).toBe("7500");
      expect(result.buyerRefund).toBe("2500");
      expect(result.fee).toBe("0");
      assertFeeConservation(result);
    });

    it("conservation holds for odd amounts", () => {
      const result = computeSplitFee(9_999n, 6_543n, 3_210n, 75);
      assertFeeConservation(result);
    });

    it("conservation holds for large amounts", () => {
      const result = computeSplitFee(999_999_999n, 8_500n, 2_000n, 50);
      assertFeeConservation(result);
    });
  });

  describe("FULL_SELLER outcome", () => {
    it("buyer receives nothing, all funds to seller minus fee", () => {
      const result = computeFullSellerFee(10_000n, 100);
      expect(result.buyerRefund).toBe("0");
      expect(result.sellerNet).toBe("9900");
      expect(result.fee).toBe("100");
      assertFeeConservation(result);
    });
  });

  describe("FULL_BUYER outcome", () => {
    it("seller receives nothing, buyer gets full refund, no fee", () => {
      const result = computeFullBuyerFee(10_000n, 100);
      expect(result.sellerNet).toBe("0");
      expect(result.fee).toBe("0");
      expect(result.buyerRefund).toBe("10000");
      assertFeeConservation(result);
    });
  });

  describe("computeFee dispatcher", () => {
    it("dispatches to release", () => {
      const result = computeFee("release", 10_000n, 100);
      expect(result.outcome).toBe("release");
      assertFeeConservation(result);
    });

    it("dispatches to refund", () => {
      const result = computeFee("refund", 10_000n, 100);
      expect(result.outcome).toBe("refund");
      assertFeeConservation(result);
    });

    it("dispatches to split", () => {
      const result = computeFee("split", 10_000n, 100, 7_000n, 4_000n);
      expect(result.outcome).toBe("split");
      assertFeeConservation(result);
    });

    it("dispatches to full_seller", () => {
      const result = computeFee("full_seller", 10_000n, 100);
      expect(result.outcome).toBe("full_seller");
      assertFeeConservation(result);
    });

    it("dispatches to full_buyer", () => {
      const result = computeFee("full_buyer", 10_000n, 100);
      expect(result.outcome).toBe("full_buyer");
      assertFeeConservation(result);
    });
  });

  describe("conservation invariant sweep", () => {
    it("holds across a range of feeBps values for all outcomes", () => {
      const outcomes = [
        "release",
        "refund",
        "full_seller",
        "full_buyer",
      ] as const;
      const feeBpsValues = [0, 1, 100, 250, 500];
      const amounts = [1n, 100n, 10_000n, 1_000_000n, 999_999_999n];

      for (const outcome of outcomes) {
        for (const feeBps of feeBpsValues) {
          for (const amount of amounts) {
            const result = computeFee(outcome, amount, feeBps);
            assertFeeConservation(result);
          }
        }
      }
    });

    it("holds for split across many BPS combinations", () => {
      const cases = [
        { sellerGetsBps: 0n, sellerLossBps: 10_000n },
        { sellerGetsBps: 3_333n, sellerLossBps: 6_666n },
        { sellerGetsBps: 5_000n, sellerLossBps: 5_000n },
        { sellerGetsBps: 7_000n, sellerLossBps: 4_000n },
        { sellerGetsBps: 10_000n, sellerLossBps: 0n },
      ];

      for (const { sellerGetsBps, sellerLossBps } of cases) {
        for (const feeBps of [0, 100, 500]) {
          for (const amount of [10_000n, 99_999n, 1_000_000n]) {
            const result = computeFee(
              "split",
              amount,
              feeBps,
              sellerGetsBps,
              sellerLossBps,
            );
            assertFeeConservation(result);
          }
        }
      }
    });
  });
});
