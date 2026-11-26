/**
 * DeadlineExtensionService — request validation, state guards, and the
 * gate in front of the on-chain `extend_deadline()` call.
 *
 * Boundary cases for the caps live in src/__tests__/deadlineExtension.service.test.ts;
 * this file covers the service surface a request handler uses before it
 * builds and dispatches the contract transaction.
 */

import { AppError, ErrorCode } from "../../errors/errorCodes";
import {
  DEFAULT_EXTENSION_POLICY,
  DeadlineExtensionService,
  ExtensionPolicy,
  TradeExtensionState,
  assertPolicyWithinCeilings,
  deadlineExtensionService,
  evaluateExtension,
} from "../deadlineExtension.service";

const DAY = 24 * 60 * 60;
const NOW = 1_800_000_000;
const DEADLINE = NOW + 3 * DAY;

function state(overrides: Partial<TradeExtensionState> = {}): TradeExtensionState {
  return {
    tradeId: "trade-42",
    extensionsUsed: 0,
    originalDeadline: null,
    currentDeadline: DEADLINE,
    ...overrides,
  };
}

function catchAppError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    return err as AppError;
  }
  throw new Error("expected AppError to be thrown");
}

describe("request validation (evaluateExtension)", () => {
  it("reports NOT_IN_FUTURE before NOT_LATER_THAN_CURRENT when both apply", () => {
    const result = evaluateExtension({ state: state(), newDeadline: NOW, now: NOW });
    expect(result.rejection).toBe("NOT_IN_FUTURE");
  });

  it("rejects a new deadline equal to now", () => {
    const result = evaluateExtension({
      state: state({ currentDeadline: NOW + 10 }),
      newDeadline: NOW,
      now: NOW,
    });
    expect(result).toMatchObject({ allowed: false, rejection: "NOT_IN_FUTURE" });
  });

  it("rejects a new deadline earlier than the current one but still in the future", () => {
    const result = evaluateExtension({ state: state(), newDeadline: DEADLINE - 1, now: NOW });
    expect(result).toMatchObject({ allowed: false, rejection: "NOT_LATER_THAN_CURRENT" });
  });

  it("allows a one-second extension", () => {
    const result = evaluateExtension({ state: state(), newDeadline: DEADLINE + 1, now: NOW });
    expect(result.allowed).toBe(true);
    expect(result.rejection).toBeUndefined();
    expect(result.reason).toBeUndefined();
  });

  it("always returns the budget, even on rejection", () => {
    const result = evaluateExtension({
      state: state({ extensionsUsed: 2 }),
      newDeadline: NOW - 1,
      now: NOW,
    });
    expect(result.allowed).toBe(false);
    expect(result.budget).toMatchObject({
      tradeId: "trade-42",
      extensionsUsed: 2,
      extensionsRemaining: 1,
      isFinalExtension: true,
    });
  });

  it("includes the overshoot and cap in the lifetime rejection reason", () => {
    const result = evaluateExtension({
      state: state(),
      newDeadline: DEADLINE + 31 * DAY,
      now: NOW,
    });
    expect(result.rejection).toBe("LIFETIME_CAP_EXCEEDED");
    expect(result.reason).toContain(`${31 * DAY}s`);
    expect(result.reason).toContain(`${30 * DAY}s lifetime cap`);
  });
});

describe("state guards", () => {
  it("refuses when the deadline is exactly now (boundary of expiry)", () => {
    const result = evaluateExtension({
      state: state({ currentDeadline: NOW }),
      newDeadline: NOW + DAY,
      now: NOW,
    });
    expect(result.rejection).toBe("ALREADY_EXPIRED");
  });

  it("allows one second before expiry", () => {
    const result = evaluateExtension({
      state: state({ currentDeadline: NOW + 1 }),
      newDeadline: NOW + DAY,
      now: NOW,
    });
    expect(result.allowed).toBe(true);
  });

  it("checks NO_DEADLINE before any other guard", () => {
    const result = evaluateExtension({
      state: state({ currentDeadline: null, extensionsUsed: 99 }),
      newDeadline: NOW - 1,
      now: NOW,
    });
    expect(result.rejection).toBe("NO_DEADLINE");
  });

  it("checks count exhaustion before the lifetime cap", () => {
    const result = evaluateExtension({
      state: state({ extensionsUsed: 3 }),
      newDeadline: DEADLINE + 365 * DAY,
      now: NOW,
    });
    expect(result.rejection).toBe("COUNT_EXHAUSTED");
  });
});

describe("DeadlineExtensionService (gate before on-chain dispatch)", () => {
  const strict: ExtensionPolicy = { maxExtensions: 1, maxTotalExtensionSecs: 2 * DAY };

  afterEach(() => {
    jest.useRealTimers();
  });

  it("applies its own policy rather than the default", () => {
    const service = new DeadlineExtensionService(strict);

    expect(service.getBudget(state())).toMatchObject({
      extensionsRemaining: 1,
      extensionSecsRemaining: 2 * DAY,
      isFinalExtension: true,
    });

    const err = catchAppError(() =>
      service.assertExtensionAllowed(state(), DEADLINE + 3 * DAY, NOW),
    );
    expect(err.details.rejection).toBe("LIFETIME_CAP_EXCEEDED");
  });

  it("returns the pre-extension budget when the extension is allowed", () => {
    const service = new DeadlineExtensionService(strict);
    const budget = service.assertExtensionAllowed(state(), DEADLINE + DAY, NOW);
    expect(budget).toEqual(service.getBudget(state()));
  });

  it.each([
    ["NO_DEADLINE", state({ currentDeadline: null }), NOW + DAY],
    ["ALREADY_EXPIRED", state({ currentDeadline: NOW - 1 }), NOW + DAY],
    ["NOT_IN_FUTURE", state(), NOW - 1],
    ["NOT_LATER_THAN_CURRENT", state(), DEADLINE],
    ["COUNT_EXHAUSTED", state({ extensionsUsed: 3 }), DEADLINE + DAY],
    ["LIFETIME_CAP_EXCEEDED", state(), DEADLINE + 31 * DAY],
  ] as const)(
    "throws a 409 DOMAIN_ERROR for %s so no transaction is built",
    (rejection, tradeState, newDeadline) => {
      const err = catchAppError(() =>
        deadlineExtensionService.assertExtensionAllowed(tradeState, newDeadline, NOW),
      );
      expect(err.code).toBe(ErrorCode.DOMAIN_ERROR);
      expect(err.statusCode).toBe(409);
      expect(err.details).toMatchObject({ tradeId: "trade-42", rejection });
      expect(err.details.budget).toBeDefined();
      expect(err.message).not.toBe("");
    },
  );

  it("defaults `now` to the current wall clock in Unix seconds", () => {
    jest.useFakeTimers().setSystemTime((DEADLINE + 1) * 1000);
    const err = catchAppError(() =>
      deadlineExtensionService.assertExtensionAllowed(state(), DEADLINE + DAY),
    );
    expect(err.details.rejection).toBe("ALREADY_EXPIRED");

    jest.setSystemTime((DEADLINE - 1) * 1000);
    expect(() =>
      deadlineExtensionService.assertExtensionAllowed(state(), DEADLINE + DAY),
    ).not.toThrow();
  });

  it("singleton uses the default policy", () => {
    expect(deadlineExtensionService.getPolicy()).toEqual(DEFAULT_EXTENSION_POLICY);
  });
});

describe("assertPolicyWithinCeilings error shape", () => {
  it.each([
    [{ maxExtensions: -1, maxTotalExtensionSecs: 0 }, "maxExtensions"],
    [{ maxExtensions: Number.NaN, maxTotalExtensionSecs: 0 }, "maxExtensions"],
    [{ maxExtensions: 1, maxTotalExtensionSecs: 1.5 }, "maxTotalExtensionSecs"],
    [{ maxExtensions: 13, maxTotalExtensionSecs: 0 }, "maxExtensions"],
    [{ maxExtensions: 1, maxTotalExtensionSecs: 366 * DAY }, "maxTotalExtensionSecs"],
  ])("rejects %j as a 400 VALIDATION_ERROR naming %s", (policy, field) => {
    const err = catchAppError(() => assertPolicyWithinCeilings(policy));
    expect(err.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(err.statusCode).toBe(400);
    expect(err.details).toHaveProperty(field);
  });

  it("accepts a zero policy (extensions disabled)", () => {
    expect(() =>
      assertPolicyWithinCeilings({ maxExtensions: 0, maxTotalExtensionSecs: 0 }),
    ).not.toThrow();
  });
});
