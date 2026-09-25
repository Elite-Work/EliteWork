/**
 * Money conversion boundary tests — Issue #178.
 *
 * The point of the module is that amounts above 2^53 stroops survive intact, so
 * the fixtures here deliberately straddle that boundary and the i128 limit.
 */

import {
  I128_MAX,
  I128_MIN,
  MAX_SAFE_STROOPS,
  MONEY_DECIMALS,
  MoneyConversionError,
  assertI128Range,
  formatStroopsToDecimal,
  isSafeAsNumber,
  normalizeDecimalString,
  parseDecimalToStroops,
  sumDecimalStrings,
} from "../money";

/**
 * 2^53 + 1 stroops — MAX_SAFE_STROOPS (2^53 - 1) plus 2. Doubles can still
 * represent 2^53 exactly, so the first value a JS number is actually forced
 * to round is 2^53 + 1 (odd, rounds to the nearest even representable value).
 */
const UNSAFE_STROOPS = MAX_SAFE_STROOPS + 2n;
const UNSAFE_DECIMAL = formatStroopsToDecimal(UNSAFE_STROOPS);

describe("parseDecimalToStroops", () => {
  it("converts whole and fractional amounts exactly", () => {
    expect(parseDecimalToStroops("1")).toBe(10_000_000n);
    expect(parseDecimalToStroops("1.0000000")).toBe(10_000_000n);
    expect(parseDecimalToStroops("0.0000001")).toBe(1n);
    expect(parseDecimalToStroops("125.5")).toBe(1_255_000_000n);
    expect(parseDecimalToStroops("0")).toBe(0n);
  });

  it("handles negative amounts", () => {
    expect(parseDecimalToStroops("-1.5")).toBe(-15_000_000n);
    expect(parseDecimalToStroops("-0.0000001")).toBe(-1n);
  });

  it("treats a bigint as whole units", () => {
    expect(parseDecimalToStroops(5n)).toBe(50_000_000n);
  });

  it("converts an amount above 2^53 stroops without losing a single stroop", () => {
    const parsed = parseDecimalToStroops(UNSAFE_DECIMAL);
    expect(parsed).toBe(UNSAFE_STROOPS);
    // The float path this module replaces would have rounded here.
    expect(BigInt(Math.round(Number(UNSAFE_DECIMAL) * 10 ** MONEY_DECIMALS))).not.toBe(
      UNSAFE_STROOPS,
    );
  });

  it("round-trips a very large amount", () => {
    const huge = "9007199254740993.9999999";
    expect(formatStroopsToDecimal(parseDecimalToStroops(huge))).toBe(huge);
  });

  it("rejects more decimal places than are representable", () => {
    expect(() => parseDecimalToStroops("1.00000001")).toThrow(MoneyConversionError);
    expect(() => parseDecimalToStroops("1.00000001")).toThrow(/at most 7/);
  });

  it("rejects exponent notation, which only appears after a float", () => {
    expect(() => parseDecimalToStroops("1e21")).toThrow(MoneyConversionError);
    expect(() => parseDecimalToStroops("1E7")).toThrow(MoneyConversionError);
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "  ", "abc", "1.", ".5", "1.2.3", "+1", "1,000"]) {
      expect(() => parseDecimalToStroops(bad)).toThrow(MoneyConversionError);
    }
  });

  it("rejects a non-string, non-bigint value outright", () => {
    expect(() => parseDecimalToStroops(1.5 as unknown as string)).toThrow(
      /must be decimal strings/,
    );
  });

  it("rejects an amount beyond i128", () => {
    // One whole unit past the largest representable amount.
    const overflow = (I128_MAX / 10n ** BigInt(MONEY_DECIMALS) + 1n).toString();
    expect(() => parseDecimalToStroops(overflow)).toThrow(/outside the i128 range/);
  });
});

describe("formatStroopsToDecimal", () => {
  it("always emits the full fractional width", () => {
    expect(formatStroopsToDecimal(10_000_000n)).toBe("1.0000000");
    expect(formatStroopsToDecimal(1n)).toBe("0.0000001");
    expect(formatStroopsToDecimal(0n)).toBe("0.0000000");
  });

  it("keeps the sign on negative amounts and drops it on zero", () => {
    expect(formatStroopsToDecimal(-15_000_000n)).toBe("-1.5000000");
    expect(formatStroopsToDecimal(-0n)).toBe("0.0000000");
  });

  it("renders the i128 boundaries", () => {
    expect(formatStroopsToDecimal(I128_MAX)).toBe("17014118346046923173168730371588.4105727");
    expect(formatStroopsToDecimal(I128_MIN)).toBe("-17014118346046923173168730371588.4105728");
  });
});

describe("assertI128Range", () => {
  it("accepts the exact boundaries", () => {
    expect(assertI128Range(I128_MAX)).toBe(I128_MAX);
    expect(assertI128Range(I128_MIN)).toBe(I128_MIN);
  });

  it("rejects one stroop past either boundary", () => {
    expect(() => assertI128Range(I128_MAX + 1n)).toThrow(/outside the i128 range/);
    expect(() => assertI128Range(I128_MIN - 1n)).toThrow(/outside the i128 range/);
  });
});

describe("isSafeAsNumber", () => {
  it("marks the 2^53 boundary", () => {
    expect(isSafeAsNumber(MAX_SAFE_STROOPS)).toBe(true);
    expect(isSafeAsNumber(UNSAFE_STROOPS)).toBe(false);
    expect(isSafeAsNumber(-UNSAFE_STROOPS)).toBe(false);
  });
});

describe("sumDecimalStrings", () => {
  it("sums without float drift", () => {
    // 0.1 + 0.2 !== 0.3 in IEEE-754; in stroops it is exact.
    expect(sumDecimalStrings(["0.1", "0.2"])).toBe("0.3000000");
  });

  it("sums amounts that individually exceed 2^53 stroops", () => {
    const total = sumDecimalStrings([UNSAFE_DECIMAL, UNSAFE_DECIMAL]);
    expect(parseDecimalToStroops(total)).toBe(UNSAFE_STROOPS * 2n);
  });

  it("returns zero for an empty list", () => {
    expect(sumDecimalStrings([])).toBe("0.0000000");
  });

  it("propagates a bad value rather than skipping it", () => {
    expect(() => sumDecimalStrings(["1.0", "oops"])).toThrow(MoneyConversionError);
  });
});

describe("normalizeDecimalString", () => {
  it("canonicalises equivalent spellings to one string", () => {
    expect(normalizeDecimalString("1")).toBe("1.0000000");
    expect(normalizeDecimalString("1.0")).toBe("1.0000000");
    expect(normalizeDecimalString("1.0000000")).toBe("1.0000000");
  });

  it("preserves an amount above 2^53 stroops unchanged", () => {
    expect(normalizeDecimalString(UNSAFE_DECIMAL)).toBe(UNSAFE_DECIMAL);
  });
});
