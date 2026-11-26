/**
 * Exhaustive transition-table tests for the dispute status state machine.
 *
 * Every (from, to) pair over DisputeStatus is enumerated so that adding a new
 * status or edge without updating EXPECTED fails loudly here.
 */
import { DisputeStatus } from "@prisma/client";
import { AppError, ErrorCode } from "../../errors/errorCodes";
import {
  COMPLETED_DISPUTE_STATUSES,
  VALID_TRANSITIONS,
  assertTransitionApplied,
  assertValidTransition,
  getAllowedTransitions,
  isTerminalDisputeStatus,
  isValidTransition,
  resolvedAtForStatus,
} from "../disputeTransitions";

const { OPEN, UNDER_REVIEW, RESOLVED, CLOSED } = DisputeStatus;

const ALL_STATUSES = Object.values(DisputeStatus) as DisputeStatus[];

/** The single source of truth this suite pins the implementation against. */
const EXPECTED: Record<DisputeStatus, DisputeStatus[]> = {
  [OPEN]: [UNDER_REVIEW, CLOSED],
  [UNDER_REVIEW]: [RESOLVED, CLOSED],
  [RESOLVED]: [],
  [CLOSED]: [],
};

const ALL_PAIRS: Array<[DisputeStatus, DisputeStatus, boolean]> = ALL_STATUSES.flatMap(
  (from) => ALL_STATUSES.map((to): [DisputeStatus, DisputeStatus, boolean] => [
    from,
    to,
    EXPECTED[from].includes(to),
  ]),
);

const VALID_PAIRS = ALL_PAIRS.filter(([, , valid]) => valid);
const INVALID_PAIRS = ALL_PAIRS.filter(([, , valid]) => !valid);

function captureError(fn: () => void): AppError {
  try {
    fn();
  } catch (err) {
    return err as AppError;
  }
  throw new Error("expected function to throw");
}

describe("dispute transition table", () => {
  it("defines an entry for every DisputeStatus", () => {
    expect(Object.keys(VALID_TRANSITIONS).sort()).toEqual([...ALL_STATUSES].sort());
  });

  it("matches the expected table exactly", () => {
    for (const status of ALL_STATUSES) {
      expect([...VALID_TRANSITIONS[status]].sort()).toEqual([...EXPECTED[status]].sort());
    }
  });

  it("enumerates every pair (|S|^2)", () => {
    expect(ALL_PAIRS).toHaveLength(ALL_STATUSES.length ** 2);
    expect(VALID_PAIRS).toHaveLength(4);
  });

  it.each(ALL_PAIRS)("isValidTransition(%s -> %s) === %s", (from, to, expected) => {
    expect(isValidTransition(from, to)).toBe(expected);
  });

  it.each(ALL_STATUSES)("getAllowedTransitions(%s) mirrors the table", (status) => {
    expect(getAllowedTransitions(status)).toEqual(EXPECTED[status]);
  });

  it("returns an empty list for an unknown status rather than throwing", () => {
    expect(getAllowedTransitions("BOGUS" as DisputeStatus)).toEqual([]);
    expect(isValidTransition("BOGUS" as DisputeStatus, OPEN)).toBe(false);
  });
});

describe("structural invariants", () => {
  it.each(ALL_STATUSES)("%s has no self-transition", (status) => {
    expect(isValidTransition(status, status)).toBe(false);
  });

  it("never transitions back to OPEN", () => {
    for (const from of ALL_STATUSES) {
      expect(isValidTransition(from, OPEN)).toBe(false);
    }
  });

  it("terminal statuses have no outgoing edges", () => {
    for (const status of COMPLETED_DISPUTE_STATUSES) {
      expect(getAllowedTransitions(status)).toEqual([]);
    }
  });

  it("every terminal status is reachable from OPEN", () => {
    const reachable = new Set<DisputeStatus>([OPEN]);
    const queue: DisputeStatus[] = [OPEN];
    while (queue.length > 0) {
      const current = queue.shift() as DisputeStatus;
      for (const next of getAllowedTransitions(current)) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }
    expect([...reachable].sort()).toEqual([...ALL_STATUSES].sort());
  });

  it.each([
    [OPEN, false],
    [UNDER_REVIEW, false],
    [RESOLVED, true],
    [CLOSED, true],
  ] as const)("isTerminalDisputeStatus(%s) === %s", (status, expected) => {
    expect(isTerminalDisputeStatus(status)).toBe(expected);
  });

  it.each([
    [OPEN, false],
    [UNDER_REVIEW, false],
    [RESOLVED, true],
    [CLOSED, true],
  ] as const)("resolvedAtForStatus(%s) stamps a date: %s", (status, stamps) => {
    const value = resolvedAtForStatus(status);
    if (stamps) {
      expect(value).toBeInstanceOf(Date);
    } else {
      expect(value).toBeUndefined();
    }
  });
});

describe("assertValidTransition", () => {
  it.each(VALID_PAIRS)("accepts %s -> %s", (from, to) => {
    expect(() => assertValidTransition(from, to)).not.toThrow();
  });

  it.each(INVALID_PAIRS)("rejects %s -> %s with a 422 AppError", (from, to) => {
    const error = captureError(() => assertValidTransition(from, to));

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(ErrorCode.DISPUTE_STATUS_TRANSITION_INVALID);
    expect(error.statusCode).toBe(422);
    expect(error.message).toBe(`Cannot transition dispute from ${from} to ${to}`);
    expect(error.details).toEqual({
      currentStatus: from,
      requestedStatus: to,
      allowedTransitions: EXPECTED[from],
    });
  });
});

describe("assertTransitionApplied", () => {
  it("does nothing when the CAS update applied", () => {
    expect(() => assertTransitionApplied(true, "T-1")).not.toThrow();
  });

  it("throws a 409 conflict carrying the tradeId when it did not", () => {
    const error = captureError(() => assertTransitionApplied(false, "T-1"));

    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(ErrorCode.DISPUTE_STATUS_CONFLICT);
    expect(error.statusCode).toBe(409);
    expect(error.details).toEqual({ tradeId: "T-1" });
  });
});
