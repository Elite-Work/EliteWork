import { Counter, Histogram, metrics } from "@opentelemetry/api";

const METER_NAME = "amana-backend";

export type StellarTransactionOutcome =
  | "success"
  | "rpc_error"
  | "contract_panic"
  | "xdr_invalid"
  | "network_error";

export type StellarRpcMethod =
  | "sendTransaction"
  | "simulateTransaction"
  | "prepareTransaction"
  | "getAccount";

export type StellarRpcOutcome = "success" | "error";

export type SorobanRpcHealthStatus = "up" | "down";

/**
 * Outcome of an inbound webhook signature check. `verified` is the only
 * accepting outcome; every other value is a distinct rejection reason, so an
 * alert can distinguish a misconfigured provider from a forgery attempt.
 */
export type WebhookVerificationOutcome =
  | "verified"
  | "unknown_provider"
  | "missing_secret"
  | "missing_signature"
  | "missing_timestamp"
  | "malformed_timestamp"
  | "stale_timestamp"
  | "missing_raw_body"
  | "invalid_signature";

/**
 * What happened to a payout intent. `duplicate` is the one that matters
 * operationally: a non-zero rate means retries are reaching the payout path,
 * and a zero rate after a known incident means the guard was bypassed.
 */
export type PayoutIntentOutcome =
  | "claimed"
  | "duplicate"
  | "submitted"
  | "confirmed"
  | "failed";

export interface StellarMetricsRecorder {
  recordTransactionSubmission(
    operation: string,
    outcome: StellarTransactionOutcome,
    durationMs: number,
  ): void;
  recordRpcCall(
    rpcMethod: StellarRpcMethod,
    outcome: StellarRpcOutcome,
    durationMs: number,
  ): void;
  recordSorobanRpcHealth(
    status: SorobanRpcHealthStatus,
    responseTimeMs: number,
  ): void;
}

let submissionCounter: Counter | undefined;
let submissionDuration: Histogram | undefined;
let rpcDuration: Histogram | undefined;
let sorobanRpcHealthGauge: Counter | undefined;
let sorobanRpcHealthLatency: Histogram | undefined;
let webhookVerificationCounter: Counter | undefined;
let payoutIntentCounter: Counter | undefined;
let customRecorder: StellarMetricsRecorder | null = null;

function getMeter() {
  return metrics.getMeter(METER_NAME);
}

function getSubmissionCounter(): Counter {
  if (!submissionCounter) {
    submissionCounter = getMeter().createCounter(
      "stellar_transaction_submissions_total",
      {
        description: "Total Stellar transaction submission attempts",
      },
    );
  }
  return submissionCounter;
}

function getSubmissionDuration(): Histogram {
  if (!submissionDuration) {
    submissionDuration = getMeter().createHistogram(
      "stellar_transaction_duration_ms",
      {
        description: "Stellar transaction submission latency in milliseconds",
        unit: "ms",
      },
    );
  }
  return submissionDuration;
}

function getRpcDuration(): Histogram {
  if (!rpcDuration) {
    rpcDuration = getMeter().createHistogram("stellar_rpc_duration_ms", {
      description: "Stellar Soroban RPC call latency in milliseconds",
      unit: "ms",
    });
  }
  return rpcDuration;
}

function getSorobanRpcHealthGauge(): Counter {
  if (!sorobanRpcHealthGauge) {
    sorobanRpcHealthGauge = getMeter().createCounter(
      "soroban_rpc_health_checks_total",
      {
        description: "Total Soroban RPC health check results",
      },
    );
  }
  return sorobanRpcHealthGauge;
}

function getSorobanRpcHealthLatency(): Histogram {
  if (!sorobanRpcHealthLatency) {
    sorobanRpcHealthLatency = getMeter().createHistogram(
      "soroban_rpc_health_check_duration_ms",
      {
        description: "Soroban RPC health check latency in milliseconds",
        unit: "ms",
      },
    );
  }
  return sorobanRpcHealthLatency;
}

function getWebhookVerificationCounter(): Counter {
  if (!webhookVerificationCounter) {
    webhookVerificationCounter = getMeter().createCounter(
      "webhook_signature_verifications_total",
      {
        description:
          "Inbound webhook signature verification results, labelled by provider and outcome",
      },
    );
  }
  return webhookVerificationCounter;
}

/**
 * Records one inbound webhook signature check.
 *
 * Alert on a spike in the non-`verified` outcomes: a burst of
 * `invalid_signature` is an attacker probing the endpoint, while a burst of
 * `missing_secret` means a provider was deployed without its secret.
 */
export function recordWebhookSignatureVerification(
  provider: string,
  outcome: WebhookVerificationOutcome,
): void {
  getWebhookVerificationCounter().add(1, { provider, outcome });
}

function getPayoutIntentCounter(): Counter {
  if (!payoutIntentCounter) {
    payoutIntentCounter = getMeter().createCounter("payout_intents_total", {
      description:
        "Payout intent lifecycle transitions, labelled by payout kind and outcome",
    });
  }
  return payoutIntentCounter;
}

/**
 * Records one payout intent transition.
 *
 * Alert on `outcome="duplicate"`: every count is a retry that would have been a
 * second payout without the idempotency guard.
 */
export function recordPayoutIntentOutcome(
  kind: string,
  outcome: PayoutIntentOutcome,
): void {
  getPayoutIntentCounter().add(1, { kind, outcome });
}

export function recordTransactionSubmission(
  operation: string,
  outcome: StellarTransactionOutcome,
  durationMs: number,
): void {
  if (customRecorder) {
    customRecorder.recordTransactionSubmission(operation, outcome, durationMs);
    return;
  }

  const labels = { operation, outcome };
  getSubmissionCounter().add(1, labels);
  getSubmissionDuration().record(durationMs, labels);
}

export function recordRpcCall(
  rpcMethod: StellarRpcMethod,
  outcome: StellarRpcOutcome,
  durationMs: number,
): void {
  if (customRecorder) {
    customRecorder.recordRpcCall(rpcMethod, outcome, durationMs);
    return;
  }

  getRpcDuration().record(durationMs, { rpc_method: rpcMethod, outcome });
}

export function classifySubmissionError(error: unknown): StellarTransactionOutcome {
  if (!(error instanceof Error)) {
    return "network_error";
  }

  const message = error.message;
  if (/invalid transaction xdr|xdr/i.test(message)) {
    return "xdr_invalid";
  }
  if (/contract panic/i.test(message)) {
    return "contract_panic";
  }
  if (/rpc error/i.test(message)) {
    return "rpc_error";
  }
  return "network_error";
}

export async function withRpcMetrics<T>(
  rpcMethod: StellarRpcMethod,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    recordRpcCall(rpcMethod, "success", performance.now() - start);
    return result;
  } catch (error) {
    recordRpcCall(rpcMethod, "error", performance.now() - start);
    throw error;
  }
}

export function recordSorobanRpcHealth(
  status: SorobanRpcHealthStatus,
  responseTimeMs: number,
): void {
  if (customRecorder && typeof customRecorder.recordSorobanRpcHealth === "function") {
    customRecorder.recordSorobanRpcHealth(status, responseTimeMs);
    return;
  }

  const labels = { status };
  getSorobanRpcHealthGauge().add(1, labels);
  getSorobanRpcHealthLatency().record(responseTimeMs, labels);
}

/** Vitest/Jest-only hook to assert metric emissions without a live Prometheus endpoint. */
export function __setMetricsRecorderForTests(
  recorder: StellarMetricsRecorder | null,
): void {
  customRecorder = recorder;
}

export function __resetMetricsForTests(): void {
  customRecorder = null;
  submissionCounter = undefined;
  submissionDuration = undefined;
  rpcDuration = undefined;
  sorobanRpcHealthGauge = undefined;
  sorobanRpcHealthLatency = undefined;
  webhookVerificationCounter = undefined;
  payoutIntentCounter = undefined;
}

// ---------------------------------------------------------------------------
// Quote deviation metrics
// ---------------------------------------------------------------------------

let quoteDeviationHistogram: Histogram | undefined;

function getQuoteDeviationHistogram(): Histogram {
  if (!quoteDeviationHistogram) {
    quoteDeviationHistogram = getMeter().createHistogram(
      "path_payment_quote_deviation_bps",
      {
        description: "Deviation of cached quote vs fresh quote in basis points",
        unit: "bps",
      },
    );
  }
  return quoteDeviationHistogram;
}

export function recordQuoteDeviation(
  sourceAssetCode: string,
  deviationBps: number,
): void {
  getQuoteDeviationHistogram().record(deviationBps, { source_asset: sourceAssetCode });
}

// ---------------------------------------------------------------------------
// Reconciliation drift metrics
// ---------------------------------------------------------------------------

let reconciliationDriftCounter: Counter | undefined;
let reconciliationSweepCounter: Counter | undefined;

function getReconciliationDriftCounter(): Counter {
  if (!reconciliationDriftCounter) {
    reconciliationDriftCounter = getMeter().createCounter(
      "reconciliation_drift_total",
      {
        description: "Total number of reconciliation drift detections by severity",
      },
    );
  }
  return reconciliationDriftCounter;
}

function getReconciliationSweepCounter(): Counter {
  if (!reconciliationSweepCounter) {
    reconciliationSweepCounter = getMeter().createCounter(
      "reconciliation_sweeps_total",
      {
        description: "Total reconciliation sweeps completed",
      },
    );
  }
  return reconciliationSweepCounter;
}

export function recordReconciliationDrift(
  severity: "warning" | "critical",
): void {
  getReconciliationDriftCounter().add(1, { severity });
}

export function recordReconciliationSweep(
  outcome: "success" | "failure",
): void {
  getReconciliationSweepCounter().add(1, { outcome });
}

// ---------------------------------------------------------------------------
// Business KPI / product-funnel metrics  (#232)
//
// Tracks the escrow trade lifecycle funnel end-to-end:
//   created → funded → delivered/released → refunded/disputed
//
// Naming convention:
//   amana_trades_<event>_total  — monotonic counters (cardinality-safe labels)
//   amana_trade_time_to_<phase>_ms — histograms for time-between-state durations
//   amana_trade_gmv_usdc        — histogram approximating GMV per trade
//   amana_dispute_rate_window   — gauge fed by a sliding-window dispute-rate alert helper
// ---------------------------------------------------------------------------

export type TradeFunnelEvent =
  | "created"
  | "funded"
  | "delivered"
  | "released"
  | "refunded"
  | "disputed"
  | "expired"
  | "cancelled";

export type DisputeRateAlertOutcome = "ok" | "anomaly_detected";

// ---------------------------------------------------------------------------
// Test helpers for KPI metrics — declared early so the record functions below
// can reference customKpiRecorder (mirrors the Stellar metric test pattern).
// ---------------------------------------------------------------------------

/** Injectable recorder for unit-testing KPI metric calls without a live OTel pipeline. */
export interface KpiMetricsRecorder {
  recordTradeFunnelEvent(event: TradeFunnelEvent): void;
  recordTimeToFund(durationMs: number): void;
  recordTimeToRelease(durationMs: number, outcome: "released" | "refunded"): void;
  recordTradeGmv(amountUsdc: string, outcome: "released" | "refunded"): void;
  recordDisputeRateAnomaly(outcome: DisputeRateAlertOutcome): void;
}

let customKpiRecorder: KpiMetricsRecorder | null = null;

export function __setKpiRecorderForTests(recorder: KpiMetricsRecorder | null): void {
  customKpiRecorder = recorder;
}

// Trade funnel counter — one increment per state transition.
let tradesFunnelCounter: Counter | undefined;

function getTradesFunnelCounter(): Counter {
  if (!tradesFunnelCounter) {
    tradesFunnelCounter = getMeter().createCounter("amana_trades_total", {
      description:
        "Total trade lifecycle transitions by event type. Use to build funnel: created→funded→released/refunded.",
    });
  }
  return tradesFunnelCounter;
}

/**
 * Increment the funnel counter for a lifecycle event.
 * Call at each significant status transition in trade.service.ts / eventHandlers.ts.
 */
export function recordTradeFunnelEvent(event: TradeFunnelEvent): void {
  if (customKpiRecorder) { customKpiRecorder.recordTradeFunnelEvent(event); return; }
  getTradesFunnelCounter().add(1, { event });
}

// Time-to-fund histogram — ms from CREATED to FUNDED.
let timeToFundHistogram: Histogram | undefined;

function getTimeToFundHistogram(): Histogram {
  if (!timeToFundHistogram) {
    timeToFundHistogram = getMeter().createHistogram("amana_trade_time_to_fund_ms", {
      description: "Time from trade creation to escrow funded state, in milliseconds.",
      unit: "ms",
    });
  }
  return timeToFundHistogram;
}

export function recordTimeToFund(durationMs: number): void {
  if (customKpiRecorder) { customKpiRecorder.recordTimeToFund(durationMs); return; }
  getTimeToFundHistogram().record(durationMs);
}

// Time-to-release histogram — ms from FUNDED to COMPLETED (released or refunded).
let timeToReleaseHistogram: Histogram | undefined;

function getTimeToReleaseHistogram(): Histogram {
  if (!timeToReleaseHistogram) {
    timeToReleaseHistogram = getMeter().createHistogram("amana_trade_time_to_release_ms", {
      description:
        "Time from escrow funded to funds released or refunded, in milliseconds. Tracks median settlement speed.",
      unit: "ms",
    });
  }
  return timeToReleaseHistogram;
}

/**
 * Record the time from funding to final settlement (release or refund).
 * `outcome` distinguishes released vs refunded in dashboards.
 */
export function recordTimeToRelease(
  durationMs: number,
  outcome: "released" | "refunded",
): void {
  if (customKpiRecorder) { customKpiRecorder.recordTimeToRelease(durationMs, outcome); return; }
  getTimeToReleaseHistogram().record(durationMs, { outcome });
}

// GMV histogram — approximate gross merchandise value per completed trade (in USDC cents).
// Using integer centusdc (amount * 100) keeps the histogram bucket math integer-safe.
let tradeGmvHistogram: Histogram | undefined;

function getTradeGmvHistogram(): Histogram {
  if (!tradeGmvHistogram) {
    tradeGmvHistogram = getMeter().createHistogram("amana_trade_gmv_usdc_cents", {
      description:
        "Gross merchandise value per completed/released trade in USDC cents (amount * 100). Proxy for revenue scale.",
      unit: "1",
    });
  }
  return tradeGmvHistogram;
}

/**
 * Record the value of a completed trade.
 * @param amountUsdc — string representation from the DB (e.g. "125.50")
 * @param outcome    — whether funds were released or refunded (for label segmentation)
 */
export function recordTradeGmv(
  amountUsdc: string,
  outcome: "released" | "refunded",
): void {
  if (customKpiRecorder) { customKpiRecorder.recordTradeGmv(amountUsdc, outcome); return; }
  const cents = Math.round(parseFloat(amountUsdc) * 100);
  if (Number.isFinite(cents) && cents > 0) {
    getTradeGmvHistogram().record(cents, { outcome });
  }
}

// Dispute-spike anomaly counter — incremented whenever the rolling dispute rate
// exceeds the configured threshold (see recordDisputeRateAnomaly).
let disputeAnomalyCounter: Counter | undefined;

function getDisputeAnomalyCounter(): Counter {
  if (!disputeAnomalyCounter) {
    disputeAnomalyCounter = getMeter().createCounter("amana_dispute_rate_anomalies_total", {
      description:
        "Number of times the rolling dispute-rate window exceeded the anomaly threshold. " +
        "Pair with amana_trades_total{event='disputed'} for rate calculation.",
    });
  }
  return disputeAnomalyCounter;
}

/**
 * Call when a dispute-rate anomaly is detected (e.g. >X% of funded trades in
 * a rolling window are disputed).  The counter drives alerting in Prometheus
 * Alertmanager — a recording rule computes the rate, this counter records each
 * detection event for notification deduplication.
 */
export function recordDisputeRateAnomaly(outcome: DisputeRateAlertOutcome): void {
  if (customKpiRecorder) { customKpiRecorder.recordDisputeRateAnomaly(outcome); return; }
  getDisputeAnomalyCounter().add(1, { outcome });
}

// ---------------------------------------------------------------------------
// Reset helper for KPI metrics test teardown
// ---------------------------------------------------------------------------

export function __resetKpiMetricsForTests(): void {
  customKpiRecorder = null;
  tradesFunnelCounter = undefined;
  timeToFundHistogram = undefined;
  timeToReleaseHistogram = undefined;
  tradeGmvHistogram = undefined;
  disputeAnomalyCounter = undefined;
}

// ---------------------------------------------------------------------------
// SLO SLI metrics (#SLO)
//
// Feeds the SLO recording/alerting rules in infra/prometheus. Each metric is
// the raw numerator/denominator of an SLI; the error budget is computed from
// these in Prometheus (see docs/slo.md for the SLO policy and targets).
// ---------------------------------------------------------------------------

/**
 * Injectable recorder for unit-testing SLO metric calls without a live OTel
 * pipeline (mirrors the KPI/Stellar recorder test pattern).
 */
export interface SloMetricsRecorder {
  recordEventListenerLag(seconds: number): void;
}

let customSloRecorder: SloMetricsRecorder | null = null;

export function __setSloRecorderForTests(recorder: SloMetricsRecorder | null): void {
  customSloRecorder = recorder;
}

export function __resetSloMetricsForTests(): void {
  customSloRecorder = null;
  eventListenerLagHistogram = undefined;
}

// Histogram: how far behind the event listener is, in seconds, behind a freshly
// processed ledger. A histogram (not a gauge) so Prometheus can compute the
// p95 ("event-processing lag" SLO, target p95 < 5 min). Sampled whenever a
// health check computes indexer lag.
let eventListenerLagHistogram: Histogram | undefined;

function getEventListenerLagHistogram(): Histogram {
  if (!eventListenerLagHistogram) {
    eventListenerLagHistogram = getMeter().createHistogram(
      "event_listener_processing_lag_seconds",
      {
        description:
          "Seconds since the most recently processed escrow event was recorded. " +
          "Drives the event-processing-lag SLO (p95 < 5 min).",
        unit: "seconds",
        explicitBucketBoundaries: [1, 5, 15, 60, 120, 300, 600, 1800, 3600],
      },
    );
  }
  return eventListenerLagHistogram;
}

/**
 * Record the event-processing lag SLI: time since the latest processed event
 * was persisted. A value <= 0 (no events yet / unknown) is treated as 0 so the
 * SLI never reports a spurious negative lag.
 */
export function recordEventListenerLag(seconds: number): void {
  if (customSloRecorder) {
    customSloRecorder.recordEventListenerLag(seconds);
    return;
  }
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  getEventListenerLagHistogram().record(safeSeconds);
}

// ---------------------------------------------------------------------------
// Cooperative pilot metrics (#46)
//
// Per-cooperative / per-region / per-cohort labels for the pilot dashboard
// (infra/grafana/dashboards/pilot-cohort.json). Cardinality is bounded: the
// pilot cohort is a handful of cooperatives, and labels reuse the existing
// low-cardinality funnel event names. See ADR-009.
// ---------------------------------------------------------------------------

export type BulkImportOutcome = "succeeded" | "failed";

/** Injectable recorder for unit-testing pilot metric calls without OTel. */
export interface PilotMetricsRecorder {
  recordCooperativeTradeEvent(cooperative: string, region: string, event: TradeFunnelEvent): void;
  recordCooperativeGmv(cooperative: string, region: string, amountUsdc: string): void;
  recordBulkImport(outcome: BulkImportOutcome, count: number): void;
}

let customPilotRecorder: PilotMetricsRecorder | null = null;

export function __setPilotRecorderForTests(recorder: PilotMetricsRecorder | null): void {
  customPilotRecorder = recorder;
}

export function __resetPilotMetricsForTests(): void {
  customPilotRecorder = null;
  cooperativeTradesCounter = undefined;
  cooperativeGmvHistogram = undefined;
  bulkImportCounter = undefined;
}

let cooperativeTradesCounter: Counter | undefined;

function getCooperativeTradesCounter(): Counter {
  if (!cooperativeTradesCounter) {
    cooperativeTradesCounter = getMeter().createCounter("amana_cooperative_trades_total", {
      description:
        "Pilot trade lifecycle transitions labelled by cooperative, region and event.",
    });
  }
  return cooperativeTradesCounter;
}

/** Increment the per-cooperative funnel counter for one lifecycle event. */
export function recordCooperativeTradeEvent(
  cooperative: string,
  region: string,
  event: TradeFunnelEvent,
): void {
  if (customPilotRecorder) {
    customPilotRecorder.recordCooperativeTradeEvent(cooperative, region, event);
    return;
  }
  getCooperativeTradesCounter().add(1, { cooperative, region, event });
}

let cooperativeGmvHistogram: Histogram | undefined;

function getCooperativeGmvHistogram(): Histogram {
  if (!cooperativeGmvHistogram) {
    cooperativeGmvHistogram = getMeter().createHistogram("amana_cooperative_gmv_usdc_cents", {
      description:
        "Pilot gross merchandise value per trade in USDC cents, labelled by cooperative and region.",
      unit: "1",
    });
  }
  return cooperativeGmvHistogram;
}

/** Record the value of one pilot trade for per-region GMV panels. */
export function recordCooperativeGmv(
  cooperative: string,
  region: string,
  amountUsdc: string,
): void {
  if (customPilotRecorder) {
    customPilotRecorder.recordCooperativeGmv(cooperative, region, amountUsdc);
    return;
  }
  const cents = Math.round(parseFloat(amountUsdc) * 100);
  if (Number.isFinite(cents) && cents > 0) {
    getCooperativeGmvHistogram().record(cents, { cooperative, region });
  }
}

let bulkImportCounter: Counter | undefined;

function getBulkImportCounter(): Counter {
  if (!bulkImportCounter) {
    bulkImportCounter = getMeter().createCounter("amana_bulk_import_total", {
      description: "Bulk-import row outcomes for cooperative onboarding batches.",
    });
  }
  return bulkImportCounter;
}

/** Record how many bulk-import rows succeeded or failed validation. */
export function recordBulkImport(outcome: BulkImportOutcome, count: number): void {
  if (count <= 0) return;
  if (customPilotRecorder) {
    customPilotRecorder.recordBulkImport(outcome, count);
    return;
  }
  getBulkImportCounter().add(count, { outcome });
}
