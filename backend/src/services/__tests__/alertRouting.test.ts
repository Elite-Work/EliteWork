/**
 * Severity classification and channel routing for AlertService, per
 * docs/alert-routing-policy.md:
 *   - page   — production impact or fund risk (P0/P1), wakes on-call
 *   - ticket — degraded but workable (P2/P3), next-business-day triage
 *
 * These tests pin the classification of every alert type so a reroute
 * (e.g. demoting a page to a ticket) is a deliberate, reviewed change,
 * and verify the dispatched payload carries the registry's routing.
 */

import { AlertService, type AlertType } from "../alert.service";
import { ALERT_REGISTRY, getAlertRegistryEntry } from "../../config/alertRegistry";

jest.mock("../../middleware/logger", () => ({
  appLogger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const PAGE_ALERTS: AlertType[] = [
  "db_connection_failure",
  "redis_connection_failure",
  "reconciliation_drift_critical",
  "reconciliation_job_failure",
  "admin_soroban_tx_failure",
  "job_repeated_failures",
  "job_failure_rate_high",
  "outbox_critical_gaps",
  "synthetic_probe_failure",
];

const TICKET_ALERTS: AlertType[] = [
  "cache_unavailable",
  "reconciliation_drift_warning",
  "stellar_fee_congestion",
  "job_missed_heartbeat",
  "outbox_scan_failed",
  "pii_log_leak_detected",
];

const WEBHOOK = "https://alerts.example.com/hook";

function lastPayload(fetchMock: jest.Mock) {
  const [, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return JSON.parse((init as RequestInit).body as string);
}

describe("alert severity classification", () => {
  it("classifies every registered alert type as exactly one of page or ticket", () => {
    const classified = [...PAGE_ALERTS, ...TICKET_ALERTS].sort();
    expect(classified).toEqual(Object.keys(ALERT_REGISTRY).sort());
    expect(new Set(classified).size).toBe(classified.length);
  });

  it.each(PAGE_ALERTS)("routes %s to page", (type) => {
    expect(getAlertRegistryEntry(type).routing).toBe("page");
  });

  it.each(TICKET_ALERTS)("routes %s to ticket", (type) => {
    expect(getAlertRegistryEntry(type).routing).toBe("ticket");
  });

  it("splits reconciliation drift by severity: warning tickets, critical pages", () => {
    expect(ALERT_REGISTRY.reconciliation_drift_warning.routing).toBe("ticket");
    expect(ALERT_REGISTRY.reconciliation_drift_critical.routing).toBe("page");
  });

  it("pages on a hard Redis outage but only tickets a degraded cache", () => {
    expect(ALERT_REGISTRY.redis_connection_failure.routing).toBe("page");
    expect(ALERT_REGISTRY.cache_unavailable.routing).toBe("ticket");
  });

  it("gives every alert a runbook link", () => {
    for (const entry of Object.values(ALERT_REGISTRY)) {
      expect(entry.runbookUrl).toMatch(/^docs\/.+\.md(#.+)?$/);
    }
  });
});

describe("alert channel routing on dispatch", () => {
  const fetchMock = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  it.each(Object.keys(ALERT_REGISTRY) as AlertType[])(
    "stamps %s with its registry routing and runbook",
    async (type) => {
      const service = new AlertService(WEBHOOK, undefined, 60_000);
      await service.dispatch(type, "msg");

      expect(fetchMock).toHaveBeenCalledWith(WEBHOOK, expect.objectContaining({ method: "POST" }));
      const payload = lastPayload(fetchMock);
      expect(payload.type).toBe(type);
      expect(payload.routing).toBe(ALERT_REGISTRY[type].routing);
      expect(payload.runbookUrl).toBe(ALERT_REGISTRY[type].runbookUrl);
      expect(payload.severity).toBe("critical");
    },
  );

  it("routes page and ticket alerts to the same webhook, distinguished only by payload", async () => {
    const service = new AlertService(WEBHOOK, undefined, 60_000);
    await service.dispatch("db_connection_failure", "db down");
    await service.dispatch("cache_unavailable", "cache degraded");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([WEBHOOK, WEBHOOK]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).routing).toBe("page");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).routing).toBe("ticket");
  });

  it("does not dispatch any class when the webhook is unconfigured", async () => {
    const service = new AlertService(undefined, undefined, 60_000);
    await service.dispatch("db_connection_failure", "db down");
    await service.dispatch("cache_unavailable", "cache degraded");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dedupes a page alert independently of a ticket alert", async () => {
    const service = new AlertService(WEBHOOK, undefined, 60_000);
    await service.dispatch("db_connection_failure", "1");
    await service.dispatch("db_connection_failure", "2");
    await service.dispatch("cache_unavailable", "3");

    const routings = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).routing);
    expect(routings).toEqual(["page", "ticket"]);
  });

  it("uses the registry's per-type dedupe window over the global cooldown", async () => {
    jest.useFakeTimers().setSystemTime(0);
    // stellar_fee_congestion has a 15-minute window; global cooldown is 1s.
    const service = new AlertService(WEBHOOK, undefined, 1_000);

    await service.dispatch("stellar_fee_congestion", "1");
    jest.setSystemTime(5 * 60_000);
    await service.dispatch("stellar_fee_congestion", "2");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    jest.setSystemTime(15 * 60_000);
    await service.dispatch("stellar_fee_congestion", "3");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to the global cooldown for types without a dedupe window", async () => {
    jest.useFakeTimers().setSystemTime(0);
    const service = new AlertService(WEBHOOK, undefined, 1_000);

    await service.dispatch("db_connection_failure", "1");
    jest.setSystemTime(999);
    await service.dispatch("db_connection_failure", "2");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    jest.setSystemTime(1_000);
    await service.dispatch("db_connection_failure", "3");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
