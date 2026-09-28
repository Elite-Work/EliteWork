import {
  DEADLINE_SOON_WINDOW_DAYS,
  MS_PER_DAY,
  compareByDeadline,
  formatDeadlineLabel,
  getDeadlineInfo,
  isNearDeadline,
  isTerminalStatus,
  resolveDeadline,
  type TradeDeadlineLike,
} from "../tradeDeadline";

const NOW = new Date("2026-06-15T12:00:00.000Z").getTime();

function iso(daysFromNow: number): string {
  return new Date(NOW + daysFromNow * MS_PER_DAY).toISOString();
}

describe("resolveDeadline", () => {
  it("prefers the persisted expiresAt over eta and deliveryDays", () => {
    const trade: TradeDeadlineLike = {
      createdAt: iso(-10),
      deliveryDays: 2,
      eta: iso(5),
      expiresAt: iso(3),
    };

    const { deadline, source } = resolveDeadline(trade);
    expect(source).toBe("expiresAt");
    expect(deadline?.toISOString()).toBe(iso(3));
  });

  it("falls back to eta when expiresAt is missing", () => {
    const { source, deadline } = resolveDeadline({ eta: iso(4) });
    expect(source).toBe("eta");
    expect(deadline?.toISOString()).toBe(iso(4));
  });

  it("derives the deadline from createdAt + deliveryDays as a last resort", () => {
    const { source, deadline } = resolveDeadline({ createdAt: iso(-3), deliveryDays: 5 });
    expect(source).toBe("deliveryDays");
    expect(deadline?.toISOString()).toBe(iso(2));
  });

  it("ignores invalid dates and non-positive delivery windows", () => {
    expect(resolveDeadline({ expiresAt: "not-a-date", eta: "", deliveryDays: 0 }).deadline).toBeNull();
    expect(resolveDeadline({ createdAt: iso(-1), deliveryDays: -5 }).deadline).toBeNull();
    expect(resolveDeadline(null).deadline).toBeNull();
  });
});

describe("getDeadlineInfo", () => {
  it.each([
    ["overdue", -2],
    ["due-today", 0],
    ["due-soon", 3],
    ["on-track", 30],
  ] as const)("classifies a deadline %s days out as %s", (expectedState, offsetDays) => {
    const info = getDeadlineInfo({ expiresAt: iso(offsetDays) }, NOW);
    expect(info.state).toBe(expectedState);
  });

  it("reports unknown state when there is no usable deadline", () => {
    const info = getDeadlineInfo({ status: "FUNDED" }, NOW);
    expect(info.state).toBe("unknown");
    expect(info.daysRemaining).toBeNull();
  });

  it("treats a deadline under 24h away as due-today but an hourly-overdue one as overdue", () => {
    const laterToday = getDeadlineInfo({ expiresAt: iso(0.4) }, NOW);
    expect(laterToday.state).toBe("due-today");
    expect(laterToday.daysRemaining).toBe(1); // ceil(0.4) === 1, used only for display

    const slightlyOverdue = getDeadlineInfo({ expiresAt: iso(-0.4) }, NOW);
    expect(slightlyOverdue.state).toBe("overdue");
  });
});

describe("isNearDeadline", () => {
  it("includes overdue, due-today, and within-window trades", () => {
    expect(isNearDeadline({ expiresAt: iso(-1), status: "FUNDED" }, NOW)).toBe(true);
    expect(isNearDeadline({ expiresAt: iso(0), status: "FUNDED" }, NOW)).toBe(true);
    expect(isNearDeadline({ expiresAt: iso(DEADLINE_SOON_WINDOW_DAYS), status: "FUNDED" }, NOW)).toBe(true);
  });

  it("excludes trades comfortably inside their window", () => {
    expect(isNearDeadline({ expiresAt: iso(DEADLINE_SOON_WINDOW_DAYS + 1) }, NOW)).toBe(false);
    expect(isNearDeadline({}, NOW)).toBe(false);
  });

  it("excludes terminal trades even when their deadline has passed", () => {
    for (const status of ["COMPLETED", "settled", "CANCELLED", "EXPIRED", "REFUNDED"]) {
      expect(isNearDeadline({ expiresAt: iso(-5), status }, NOW)).toBe(false);
    }
  });

  it("honours a custom window", () => {
    expect(isNearDeadline({ expiresAt: iso(10) }, NOW, 14)).toBe(true);
    expect(isNearDeadline({ expiresAt: iso(10) }, NOW, 3)).toBe(false);
  });
});

describe("compareByDeadline", () => {
  it("orders soonest deadline first", () => {
    const trades: TradeDeadlineLike[] = [
      { expiresAt: iso(10) },
      { expiresAt: iso(-1) },
      { expiresAt: iso(3) },
    ];
    const sorted = [...trades].sort(compareByDeadline);
    expect(sorted.map((t) => t.expiresAt)).toEqual([iso(-1), iso(3), iso(10)]);
  });

  it("sorts trades without a deadline last", () => {
    const trades: TradeDeadlineLike[] = [
      { status: "FUNDED" },
      { expiresAt: iso(2) },
      { eta: iso(1) },
    ];
    const sorted = [...trades].sort(compareByDeadline);
    expect(sorted[0].eta).toBe(iso(1));
    expect(sorted[1].expiresAt).toBe(iso(2));
    expect(sorted[2].expiresAt).toBeUndefined();
  });
});

describe("formatDeadlineLabel", () => {
  it("labels overdue, due-today, and due-soon deadlines", () => {
    expect(formatDeadlineLabel(getDeadlineInfo({ expiresAt: iso(-3) }, NOW))).toBe("Overdue");
    expect(formatDeadlineLabel(getDeadlineInfo({ expiresAt: iso(0) }, NOW))).toBe("Due today");
    expect(formatDeadlineLabel(getDeadlineInfo({ expiresAt: iso(2) }, NOW))).toBe("Due in 2d");
  });

  it("returns null when the deadline is unknown", () => {
    expect(formatDeadlineLabel(getDeadlineInfo({}, NOW))).toBeNull();
  });
});

describe("isTerminalStatus", () => {
  it("recognises terminal statuses case-insensitively", () => {
    expect(isTerminalStatus("COMPLETED")).toBe(true);
    expect(isTerminalStatus("cancelled")).toBe(true);
    expect(isTerminalStatus("FUNDED")).toBe(false);
    expect(isTerminalStatus(undefined)).toBe(false);
  });
});
