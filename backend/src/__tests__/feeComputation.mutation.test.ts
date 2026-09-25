/**
 * Mutation-killing tests for feeComputation.ts
 *
 * These tests are specifically designed to kill surviving StrykerJS mutants
 * that the main feeComputation.test.ts suite might miss. Each test is
 * annotated with the mutation class it targets.
 *
 * Mutation classes covered:
 *   - ArithmeticOperator: +→-, *→/, /→*, bigint ops
 *   - BoundaryValue: ±1 off-by-one on BPS_DIVISOR (10_000)
 *   - ConditionalExpression: branches in computeFee switch
 *   - LogicalOperator: fee conservation throw condition
 *   - ObjectLiteral: wrong field returned (outcome, feeBps, calculatedAt)
 */

import {
  computeReleaseFee,
  computeRefundFee,
  computeSplitFee,
  computeFullSellerFee,
  computeFullBuyerFee,
  computeFee,
  assertFeeConservation,
  type FeeBreakdown,
} from "../lib/feeComputation";

// ─── ArithmeticOperator mutations ──────────────────────────────────────────

describe("feeComputation — arithmetic precision (mutation killers)", () => {
  /**
   * Targets: fee = amount * feeBps / 10_000
   * Mutants to kill:
   *   fee = amount + feeBps / 10_000
   *   fee = amount - feeBps / 10_000
   *   fee = amount * feeBps * 10_000   (divisor flipped)
   *   fee = amount / feeBps / 10_000
   */
  it("release: fee is proportional — 1% of 10_000 is exactly 100", () => {
    const r = computeReleaseFee(10_000n, 100); // 1%
    expect(BigInt(r.fee)).toBe(100n);
    expect(BigInt(r.sellerNet)).toBe(9_900n);
  });

  it("release: fee is proportional — 0.5% of 20_000 is exactly 100", () => {
    const r = computeReleaseFee(20_000n, 50); // 0.5%
    expect(BigInt(r.fee)).toBe(100n);
    expect(BigInt(r.sellerNet)).toBe(19_900n);
  });

  it("release: fee floor rounds down for non-integer results", () => {
    // 1 stroop × 100 bps = 0.01 → floors to 0
    const r = computeReleaseFee(1n, 100);
    expect(BigInt(r.fee)).toBe(0n);
    expect(BigInt(r.sellerNet)).toBe(1n);
  });

  it("release: sellerNet = amount − fee (not amount + fee)", () => {
    const amount = 50_000n;
    const r = computeReleaseFee(amount, 200); // 2%
    expect(BigInt(r.sellerNet)).toBe(amount - BigInt(r.fee));
    expect(BigInt(r.sellerNet)).toBe(49_000n);
  });

  /**
   * Targets: split arithmetic chain
   *   lossBps = BPS_DIVISOR − sellerGetsBps
   *   sellerLoss = amount * lossBps * sellerLossBps / (BPS_DIVISOR * BPS_DIVISOR)
   */
  it("split: lossBps is complement of sellerGetsBps (10_000 − sellerGetsBps)", () => {
    // seller_gets = 7_000 → lossBps should be 3_000 (not 10_000 + 7_000)
    // If + were used instead of −, lossBps = 17_000 → sellerLoss > amount → negative sellerRaw
    const r = computeSplitFee(10_000n, 7_000n, 10_000n, 0);
    // lossBps=3_000, sellerLoss = 10_000 * 3_000 * 10_000 / (10_000^2) = 3_000
    // sellerRaw = 7_000, buyerRefund = 3_000
    expect(BigInt(r.buyerRefund)).toBe(3_000n);
    expect(BigInt(r.sellerNet)).toBe(7_000n);
  });

  it("split: sellerLoss uses multiplication, not addition, of both bps terms", () => {
    // total=10_000, sellerGetsBps=9_000 (→lossBps=1_000), sellerLossBps=5_000
    // sellerLoss = 10_000 * 1_000 * 5_000 / (10_000*10_000) = 500
    // If lossBps*sellerLossBps were replaced by addition: 1_000+5_000=6_000
    // then sellerLoss = 10_000 * 6_000 / 10_000^2 = 0.06 stroops ≠ 500
    const r = computeSplitFee(10_000n, 9_000n, 5_000n, 0);
    expect(BigInt(r.buyerRefund)).toBe(500n);
    expect(BigInt(r.sellerNet)).toBe(9_500n);
  });

  it("split: division uses BPS_DIVISOR^2, not BPS_DIVISOR once", () => {
    // total=10_000, seller_gets=5_000 (lossBps=5_000), sellerLoss_bps=5_000
    // correct: 10_000 * 5_000 * 5_000 / (10_000^2) = 2_500
    // wrong (divide once): 10_000 * 5_000 * 5_000 / 10_000 = 25_000_000 → overflow
    const r = computeSplitFee(10_000n, 5_000n, 5_000n, 0);
    expect(BigInt(r.buyerRefund)).toBe(2_500n);
  });

  it("split: buyerRefund = amount − sellerRaw (not sellerLoss)", () => {
    // total=10_000, sellerGetsBps=8_000, sellerLossBps=2_000
    // lossBps=2_000, sellerLoss=10_000*2_000*2_000/100_000_000=400
    // sellerRaw=9_600, buyerRefund=10_000−9_600=400
    const r = computeSplitFee(10_000n, 8_000n, 2_000n, 0);
    expect(BigInt(r.buyerRefund)).toBe(400n);
    expect(BigInt(r.sellerNet)).toBe(9_600n);
  });
});

// ─── BoundaryValue mutations ────────────────────────────────────────────────

describe("feeComputation — BPS boundary values (mutation killers)", () => {
  it("split with sellerGetsBps=0 — buyer gets everything", () => {
    // lossBps = 10_000, sellerLoss = total (all loss to seller if sellerLossBps=10_000)
    const r = computeSplitFee(10_000n, 0n, 10_000n, 0);
    expect(BigInt(r.sellerNet)).toBe(0n);
    expect(BigInt(r.buyerRefund)).toBe(10_000n);
    expect(BigInt(r.fee)).toBe(0n);
  });

  it("split with sellerGetsBps=10_000 — mirrors full_seller", () => {
    // lossBps=0 → sellerLoss=0, sellerRaw=total, fee=total*feeBps/10_000
    const r = computeSplitFee(10_000n, 10_000n, 5_000n, 100);
    expect(BigInt(r.buyerRefund)).toBe(0n);
    expect(BigInt(r.fee)).toBe(100n);
    expect(BigInt(r.sellerNet)).toBe(9_900n);
  });

  it("release with feeBps=9_999 — near-full fee", () => {
    // fee = 10_000 * 9_999 / 10_000 = 9_999
    const r = computeReleaseFee(10_000n, 9_999);
    expect(BigInt(r.fee)).toBe(9_999n);
    expect(BigInt(r.sellerNet)).toBe(1n);
  });

  it("release with feeBps=10_000 — seller gets 0", () => {
    const r = computeReleaseFee(10_000n, 10_000);
    expect(BigInt(r.fee)).toBe(10_000n);
    expect(BigInt(r.sellerNet)).toBe(0n);
  });

  it("BPS_DIVISOR is exactly 10_000 — not 9_999 or 10_001", () => {
    // If BPS_DIVISOR were 9_999: fee of 1% on 10_000 = 10_000*100/9_999 ≈ 100.01 → 100n ← same
    // Use a value where rounding diverges: 1% on 9_999
    // Correct: 9_999 * 100 / 10_000 = 9 (floor of 9.999)
    // Wrong (9_999 divisor): 9_999 * 100 / 9_999 = 100 (exact) → different!
    const r = computeReleaseFee(9_999n, 100);
    expect(BigInt(r.fee)).toBe(99n); // floor of 99.99
    expect(BigInt(r.sellerNet)).toBe(9_900n);
  });
});

// ─── ObjectLiteral / field mutations ──────────────────────────────────────

describe("feeComputation — output fields (mutation killers)", () => {
  it("release: outcome field is 'release'", () => {
    expect(computeReleaseFee(1_000n, 100).outcome).toBe("release");
  });

  it("refund: outcome field is 'refund'", () => {
    expect(computeRefundFee(1_000n, 100).outcome).toBe("refund");
  });

  it("split: outcome field is 'split'", () => {
    expect(computeSplitFee(1_000n, 5_000n, 5_000n, 100).outcome).toBe("split");
  });

  it("full_seller: outcome field is 'full_seller'", () => {
    expect(computeFullSellerFee(1_000n, 100).outcome).toBe("full_seller");
  });

  it("full_buyer: outcome field is 'full_buyer'", () => {
    expect(computeFullBuyerFee(1_000n, 100).outcome).toBe("full_buyer");
  });

  it("all functions set total correctly", () => {
    const amount = 77_777n;
    expect(computeReleaseFee(amount, 100).total).toBe(amount.toString());
    expect(computeRefundFee(amount, 100).total).toBe(amount.toString());
    expect(computeSplitFee(amount, 5_000n, 5_000n, 100).total).toBe(amount.toString());
    expect(computeFullSellerFee(amount, 100).total).toBe(amount.toString());
    expect(computeFullBuyerFee(amount, 100).total).toBe(amount.toString());
  });

  it("feeBps is echoed correctly on the breakdown", () => {
    expect(computeReleaseFee(10_000n, 250).feeBps).toBe(250);
    expect(computeSplitFee(10_000n, 5_000n, 5_000n, 333).feeBps).toBe(333);
  });

  it("refund: fee is '0' (not amount)", () => {
    const r = computeRefundFee(99_999n, 500);
    expect(r.fee).toBe("0");
    expect(r.sellerNet).toBe("0");
  });

  it("full_buyer: fee is '0' and sellerNet is '0'", () => {
    const r = computeFullBuyerFee(99_999n, 500);
    expect(r.fee).toBe("0");
    expect(r.sellerNet).toBe("0");
    expect(r.buyerRefund).toBe("99999");
  });

  it("calculatedAt is a valid ISO-8601 timestamp", () => {
    const r = computeReleaseFee(1_000n, 100);
    expect(() => new Date(r.calculatedAt)).not.toThrow();
    expect(new Date(r.calculatedAt).getFullYear()).toBeGreaterThanOrEqual(2024);
  });
});

// ─── ConditionalExpression / switch mutations ──────────────────────────────

describe("computeFee dispatcher — branch isolation (mutation killers)", () => {
  it("release uses amount (not 0)", () => {
    const r = computeFee("release", 5_000n, 200);
    expect(BigInt(r.sellerNet)).toBeGreaterThan(0n);
  });

  it("refund buyerRefund equals total (not 0)", () => {
    const r = computeFee("refund", 5_000n, 200);
    expect(r.buyerRefund).toBe("5000");
  });

  it("full_seller produces fee > 0 when feeBps > 0", () => {
    const r = computeFee("full_seller", 10_000n, 100);
    expect(BigInt(r.fee)).toBeGreaterThan(0n);
    expect(r.buyerRefund).toBe("0");
  });

  it("full_buyer produces fee = 0 regardless of feeBps", () => {
    const r = computeFee("full_buyer", 10_000n, 9_000);
    expect(r.fee).toBe("0");
  });

  it("split default args give sellerGetsBps=10_000 (full seller)", () => {
    // Default sellerGetsBps=10_000, sellerLossBps=5_000
    // lossBps=0 → sellerLoss=0, sellerRaw=amount, fee=amount*feeBps/10_000
    const r = computeFee("split", 10_000n, 100);
    expect(BigInt(r.buyerRefund)).toBe(0n);
    expect(BigInt(r.fee)).toBe(100n);
  });
});

// ─── assertFeeConservation branch ──────────────────────────────────────────

describe("assertFeeConservation (mutation killers)", () => {
  it("does not throw when conservation holds exactly", () => {
    const valid: FeeBreakdown = {
      outcome: "release",
      total: "10000",
      fee: "100",
      sellerNet: "9900",
      buyerRefund: "0",
      feeBps: 100,
      feeDust: "0",
      calculatedAt: new Date().toISOString(),
    };
    expect(() => assertFeeConservation(valid)).not.toThrow();
  });

  it("throws when sellerNet is wrong (sum > total)", () => {
    const broken: FeeBreakdown = {
      outcome: "release",
      total: "10000",
      fee: "100",
      sellerNet: "9901", // off by 1
      buyerRefund: "0",
      feeBps: 100,
      feeDust: "0",
      calculatedAt: new Date().toISOString(),
    };
    expect(() => assertFeeConservation(broken)).toThrow("conservation violated");
  });

  it("throws when fee is wrong (sum < total)", () => {
    const broken: FeeBreakdown = {
      outcome: "release",
      total: "10000",
      fee: "99", // should be 100
      sellerNet: "9900",
      buyerRefund: "0",
      feeBps: 100,
      feeDust: "0",
      calculatedAt: new Date().toISOString(),
    };
    expect(() => assertFeeConservation(broken)).toThrow("conservation violated");
  });

  it("throws when buyerRefund is wrong (sum ≠ total)", () => {
    const broken: FeeBreakdown = {
      outcome: "refund",
      total: "10000",
      fee: "0",
      sellerNet: "0",
      buyerRefund: "9999", // should be 10000
      feeBps: 0,
      feeDust: "0",
      calculatedAt: new Date().toISOString(),
    };
    expect(() => assertFeeConservation(broken)).toThrow("conservation violated");
  });

  it("error message names the outcome", () => {
    const broken: FeeBreakdown = {
      outcome: "split",
      total: "1000",
      fee: "0",
      sellerNet: "0",
      buyerRefund: "0", // 0+0+0 ≠ 1000
      feeBps: 0,
      feeDust: "0",
      calculatedAt: new Date().toISOString(),
    };
    expect(() => assertFeeConservation(broken)).toThrow(/\[split\]/);
  });
});
