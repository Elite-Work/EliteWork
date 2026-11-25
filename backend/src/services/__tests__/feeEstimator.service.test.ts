import {
  computeBufferedFee,
  isCongested,
  bumpFee,
  sizeResourceFee,
  isTimeoutLikeFailure,
  withFeeBumpRetry,
  type FeeBufferOptions,
  type FeeStatsLike,
} from "../feeEstimator.service";

const OPTS: FeeBufferOptions = {
  percentile: "p90",
  safetyMultiplier: 1.5,
  congestionBoost: 2,
  congestionCapacity: 0.75,
  congestionFeeRatio: 4,
  minStroops: 100,
  maxStroops: 1_000_000,
};

function feeStats(overrides: Partial<FeeStatsLike> = {}): FeeStatsLike {
  return {
    last_ledger: "51234567",
    last_ledger_base_fee: "100",
    ledger_capacity_usage: "0.1",
    fee_charged: { min: "100", max: "200", mode: "100", p50: "100", p90: "120", p99: "180" },
    max_fee: { min: "100", max: "10000", p90: "5000" },
    ...overrides,
  };
}

describe("computeBufferedFee", () => {
  it("applies the safety multiplier to the chosen percentile when calm", () => {
    const e = computeBufferedFee(feeStats(), OPTS);
    expect(e.congested).toBe(false);
    expect(e.percentileFee).toBe(120);
    expect(e.multiplier).toBe(1.5);
    expect(e.bufferedFee).toBe(180); // ceil(120 * 1.5)
    expect(e.cappedAtMax).toBe(false);
  });

  it("rounds a fractional buffered fee up to the next stroop", () => {
    const e = computeBufferedFee(
      feeStats({ fee_charged: { p90: "101" } }),
      OPTS,
    );
    expect(e.bufferedFee).toBe(152); // ceil(101 * 1.5)
  });

  it("boosts the multiplier when ledger capacity usage is high", () => {
    const e = computeBufferedFee(feeStats({ ledger_capacity_usage: "0.9" }), OPTS);
    expect(e.congested).toBe(true);
    expect(e.multiplier).toBe(3); // 1.5 * congestionBoost(2)
    expect(e.bufferedFee).toBe(360); // ceil(120 * 3)
  });

  it("treats a percentile fee far above base fee as congestion", () => {
    const e = computeBufferedFee(
      feeStats({
        ledger_capacity_usage: "0.2",
        fee_charged: { max: "600", p90: "500" },
      }),
      OPTS,
    );
    expect(e.congested).toBe(true); // 500 >= 100 * 4
    expect(e.bufferedFee).toBe(1500); // ceil(500 * 3)
  });

  it("clamps to maxStroops and reports cappedAtMax", () => {
    const e = computeBufferedFee(
      feeStats({ fee_charged: { max: "900000", p90: "900000" } }),
      { ...OPTS, maxStroops: 1000 },
    );
    expect(e.bufferedFee).toBe(1000);
    expect(e.cappedAtMax).toBe(true);
  });

  it("clamps up to minStroops", () => {
    const e = computeBufferedFee(feeStats({ fee_charged: { p90: "10" }, last_ledger_base_fee: "10" }), {
      ...OPTS,
      minStroops: 500,
    });
    expect(e.bufferedFee).toBe(500);
  });

  it("falls back to base fee when the percentile is missing", () => {
    const e = computeBufferedFee(
      feeStats({ fee_charged: {}, last_ledger_base_fee: "100" }),
      OPTS,
    );
    expect(e.percentileFee).toBe(100);
    expect(e.bufferedFee).toBe(150);
  });

  it("defaults base fee to 100 when absent", () => {
    const e = computeBufferedFee(
      { fee_charged: {}, ledger_capacity_usage: "0" } as FeeStatsLike,
      OPTS,
    );
    expect(e.baseFee).toBe(100);
  });
});

describe("isCongested", () => {
  it("is false for a calm network", () => {
    expect(isCongested(feeStats(), OPTS)).toBe(false);
  });
  it("is true past the capacity threshold", () => {
    expect(isCongested(feeStats({ ledger_capacity_usage: "0.8" }), OPTS)).toBe(true);
  });
  it("is true at the exact capacity threshold boundary", () => {
    expect(isCongested(feeStats({ ledger_capacity_usage: "0.75" }), OPTS)).toBe(true);
    expect(isCongested(feeStats({ ledger_capacity_usage: "0.749" }), OPTS)).toBe(false);
  });
  it("is true at the exact fee ratio threshold boundary", () => {
    expect(
      isCongested(
        feeStats({
          ledger_capacity_usage: "0.1",
          fee_charged: { p90: "400" },
          last_ledger_base_fee: "100",
        }),
        OPTS,
      ),
    ).toBe(true);
    expect(
      isCongested(
        feeStats({
          ledger_capacity_usage: "0.1",
          fee_charged: { p90: "399" },
          last_ledger_base_fee: "100",
        }),
        OPTS,
      ),
    ).toBe(false);
  });
});

describe("bumpFee", () => {
  it("raises the fee by the bump factor and rounds up", () => {
    expect(bumpFee(101, { bumpFactor: 1.5, maxStroops: 1_000_000 })).toBe(152);
  });
  it("never exceeds maxStroops", () => {
    expect(bumpFee(900_000, { bumpFactor: 2, maxStroops: 1_000_000 })).toBe(1_000_000);
  });
});

describe("sizeResourceFee", () => {
  it("adds the simulated resource fee to the inclusion fee", () => {
    expect(sizeResourceFee("2500", 180)).toBe(2680);
    expect(sizeResourceFee(2500, 180)).toBe(2680);
  });
  it("tolerates a missing resource fee", () => {
    expect(sizeResourceFee(undefined, 180)).toBe(180);
  });
});

describe("isTimeoutLikeFailure", () => {
  it.each([
    "Transaction submission timed out",
    "tx_too_late",
    "txTooLate",
    "HTTP 504 Gateway Timeout",
    "deadline exceeded",
  ])("matches %s", (msg) => {
    expect(isTimeoutLikeFailure(new Error(msg))).toBe(true);
  });

  it("does not match non-timeout failures", () => {
    expect(isTimeoutLikeFailure(new Error("tx_insufficient_balance"))).toBe(false);
    expect(isTimeoutLikeFailure(null)).toBe(false);
  });
});

describe("withFeeBumpRetry", () => {
  it("returns immediately on success without bumping", async () => {
    const submit = jest.fn().mockResolvedValue("ok");
    const result = await withFeeBumpRetry(submit, 200, { maxRetries: 3 });
    expect(result).toBe("ok");
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith(200);
  });

  it("bumps the fee and retries on a timeout-style failure", async () => {
    const submit = jest
      .fn()
      .mockRejectedValueOnce(new Error("tx submission timed out"))
      .mockResolvedValueOnce("ok");
    const onRetry = jest.fn();

    const result = await withFeeBumpRetry(submit, 200, {
      maxRetries: 3,
      bumpFactor: 1.5,
      maxStroops: 1_000_000,
      onRetry,
    });

    expect(result).toBe("ok");
    expect(submit).toHaveBeenNthCalledWith(1, 200);
    expect(submit).toHaveBeenNthCalledWith(2, 300);
    expect(onRetry).toHaveBeenCalledWith(1, 300, expect.any(Error));
  });

  it("rethrows a non-timeout error without retrying", async () => {
    const submit = jest.fn().mockRejectedValue(new Error("tx_bad_seq"));
    await expect(withFeeBumpRetry(submit, 200, { maxRetries: 3 })).rejects.toThrow("tx_bad_seq");
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxRetries and throws the last error", async () => {
    const submit = jest.fn().mockRejectedValue(new Error("timed out"));
    await expect(
      withFeeBumpRetry(submit, 200, { maxRetries: 2, bumpFactor: 1.5, maxStroops: 1_000_000 }),
    ).rejects.toThrow("timed out");
    expect(submit).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});
