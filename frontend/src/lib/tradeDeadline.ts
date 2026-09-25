/**
 * Trade delivery-deadline helpers (Issue #123).
 *
 * Trades carry a delivery deadline. Depending on where the data comes from the
 * deadline is exposed as:
 *
 *   - `expiresAt` — the persisted escrow deadline (after which the expiry
 *     sweeper may refund the trade),
 *   - `eta` — the expected-delivery timestamp rendered on the trade detail page,
 *   - `deliveryDays` — the delivery window (in days) captured when the trade was
 *     created; used as a fallback relative to `createdAt`.
 *
 * `resolveDeadline` normalizes those into a single `Date | null` so the assets
 * page can offer a consistent "approaching deadline" filter and a soonest-first
 * sort without caring which field the backend populated.
 */

export const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A deadline within this window (days) counts as "approaching". */
export const DEADLINE_SOON_WINDOW_DAYS = 7;

/** Statuses for which a deadline is no longer actionable. */
const TERMINAL_STATUSES = new Set([
  "completed",
  "settled",
  "cancelled",
  "canceled",
  "expired",
  "refunded",
  "failed",
]);

export type TradeDeadlineSource = "expiresAt" | "eta" | "deliveryDays" | null;

export type DeadlineState =
  | "overdue"
  | "due-today"
  | "due-soon"
  | "on-track"
  | "unknown";

export interface TradeDeadlineLike {
  status?: string;
  createdAt?: string;
  /** ISO timestamp or null. */
  eta?: string | null;
  /** ISO timestamp or null. */
  expiresAt?: string | null;
  /** Delivery window in days, captured at creation time. */
  deliveryDays?: number | null;
}

export interface DeadlineInfo {
  /** The effective deadline, or null when the trade has no usable deadline. */
  deadline: Date | null;
  source: TradeDeadlineSource;
  /** Whole days until the deadline; negative when overdue. null if unknown. */
  daysRemaining: number | null;
  state: DeadlineState;
}

function parseDate(value: string | null | undefined): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** True for statuses where a deadline is no longer actionable. */
export function isTerminalStatus(status: string | undefined | null): boolean {
  return typeof status === "string" && TERMINAL_STATUSES.has(status.toLowerCase());
}

/**
 * Resolve the effective delivery deadline for a trade, preferring the explicit
 * persisted deadline, then the ETA, then `createdAt + deliveryDays`.
 */
export function resolveDeadline(
  trade: TradeDeadlineLike | null | undefined,
): { deadline: Date | null; source: TradeDeadlineSource } {
  if (!trade) return { deadline: null, source: null };

  const expiresAt = parseDate(trade.expiresAt);
  if (expiresAt) return { deadline: expiresAt, source: "expiresAt" };

  const eta = parseDate(trade.eta);
  if (eta) return { deadline: eta, source: "eta" };

  const created = parseDate(trade.createdAt);
  const windowDays = trade.deliveryDays;
  if (
    created &&
    typeof windowDays === "number" &&
    Number.isFinite(windowDays) &&
    windowDays > 0
  ) {
    return {
      deadline: new Date(created.getTime() + windowDays * MS_PER_DAY),
      source: "deliveryDays",
    };
  }

  return { deadline: null, source: null };
}

/**
 * Classify a trade's deadline relative to `now`.
 *
 * `daysRemaining` is ceilinged so a deadline under 24h away reports `0`
 * ("due today") rather than `-0`/`1`.
 */
export function getDeadlineInfo(
  trade: TradeDeadlineLike | null | undefined,
  now: number = Date.now(),
  windowDays: number = DEADLINE_SOON_WINDOW_DAYS,
): DeadlineInfo {
  const { deadline, source } = resolveDeadline(trade);
  if (!deadline) {
    return { deadline: null, source: null, daysRemaining: null, state: "unknown" };
  }

  const diffMs = deadline.getTime() - now;
  // Whole days, rounded toward the future so "3.5 days remaining" reads as 4.
  const daysRemaining = Math.ceil(diffMs / MS_PER_DAY);

  let state: DeadlineState;
  if (diffMs < 0) state = "overdue";
  else if (diffMs < MS_PER_DAY) state = "due-today";
  else if (diffMs <= windowDays * MS_PER_DAY) state = "due-soon";
  else state = "on-track";

  return { deadline, source, daysRemaining, state };
}

/**
 * True when a trade should surface in the "Near deadline" quick filter: it has
 * a deadline inside the window (or already missed) and is still actionable.
 */
export function isNearDeadline(
  trade: TradeDeadlineLike | null | undefined,
  now: number = Date.now(),
  windowDays: number = DEADLINE_SOON_WINDOW_DAYS,
): boolean {
  if (isTerminalStatus(trade?.status)) return false;
  const { state } = getDeadlineInfo(trade, now, windowDays);
  return state === "overdue" || state === "due-today" || state === "due-soon";
}

/**
 * Comparator for a soonest-deadline-first sort. Trades without a usable
 * deadline always sort last so they never displace an actionable one.
 */
export function compareByDeadline(
  a: TradeDeadlineLike,
  b: TradeDeadlineLike,
): number {
  const aDeadline = resolveDeadline(a).deadline;
  const bDeadline = resolveDeadline(b).deadline;
  if (aDeadline && bDeadline) return aDeadline.getTime() - bDeadline.getTime();
  if (aDeadline) return -1;
  if (bDeadline) return 1;
  return 0;
}

/** Short human label for a deadline, or null when the deadline is unknown. */
export function formatDeadlineLabel(info: DeadlineInfo): string | null {
  if (info.state === "unknown") return null;
  switch (info.state) {
    case "overdue":
      return "Overdue";
    case "due-today":
      return "Due today";
    case "due-soon":
      return `Due in ${info.daysRemaining}d`;
    case "on-track":
    default:
      return `Due ${info.deadline!.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })}`;
  }
}
