/**
 * Pilot metric recorders (issue #46).
 *
 * Uses the injectable PilotMetricsRecorder pattern so tests never need a
 * live Prometheus/OTel endpoint.
 */
import {
  __resetPilotMetricsForTests,
  __setPilotRecorderForTests,
  recordBulkImport,
  recordCooperativeGmv,
  recordCooperativeTradeEvent,
  PilotMetricsRecorder,
} from "../lib/metrics";

function makePilotRecorder(): PilotMetricsRecorder & {
  tradeEvents: Array<{ cooperative: string; region: string; event: string }>;
  gmvRecords: Array<{ cooperative: string; region: string; amountUsdc: string }>;
  bulkRecords: Array<{ outcome: string; count: number }>;
} {
  const tradeEvents: Array<{ cooperative: string; region: string; event: string }> = [];
  const gmvRecords: Array<{ cooperative: string; region: string; amountUsdc: string }> = [];
  const bulkRecords: Array<{ outcome: string; count: number }> = [];

  return {
    tradeEvents,
    gmvRecords,
    bulkRecords,
    recordCooperativeTradeEvent(cooperative, region, event) {
      tradeEvents.push({ cooperative, region, event });
    },
    recordCooperativeGmv(cooperative, region, amountUsdc) {
      gmvRecords.push({ cooperative, region, amountUsdc });
    },
    recordBulkImport(outcome, count) {
      bulkRecords.push({ outcome, count });
    },
  };
}

describe("Pilot metrics (#46)", () => {
  let recorder: ReturnType<typeof makePilotRecorder>;

  beforeEach(() => {
    recorder = makePilotRecorder();
    __setPilotRecorderForTests(recorder);
  });

  afterEach(() => {
    __resetPilotMetricsForTests();
  });

  it("records per-cooperative funnel events without throwing", () => {
    expect(() =>
      recordCooperativeTradeEvent("kebbi-coop", "kebbi", "created"),
    ).not.toThrow();
    expect(recorder.tradeEvents).toEqual([
      { cooperative: "kebbi-coop", region: "kebbi", event: "created" },
    ]);
  });

  it("records per-region GMV without throwing", () => {
    expect(() =>
      recordCooperativeGmv("kebbi-coop", "kebbi", "125.50"),
    ).not.toThrow();
    expect(recorder.gmvRecords).toEqual([
      { cooperative: "kebbi-coop", region: "kebbi", amountUsdc: "125.50" },
    ]);
  });

  it("records bulk-import outcomes without throwing", () => {
    expect(() => {
      recordBulkImport("succeeded", 3);
      recordBulkImport("failed", 1);
    }).not.toThrow();
    expect(recorder.bulkRecords).toEqual([
      { outcome: "succeeded", count: 3 },
      { outcome: "failed", count: 1 },
    ]);
  });

  it("skips zero-count bulk records", () => {
    recordBulkImport("succeeded", 0);
    expect(recorder.bulkRecords).toEqual([]);
  });
});
