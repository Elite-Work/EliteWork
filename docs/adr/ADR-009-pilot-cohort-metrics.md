# ADR-009: Pilot Cohort Metrics

## Status

Accepted (implemented in `backend/src/lib/metrics.ts` pilot recorders and
`infra/grafana/dashboards/pilot-cohort.json`, documented in
`docs/dashboards.md`).

## Context

The pilot needs cohort-level visibility the golden-signals dashboard does
not provide: trades per cooperative, GMV per region, dispute rate per
cohort. The existing KPI metrics (`amana_trades_total`,
`amana_trade_gmv_usdc_cents` in `backend/src/lib/metrics.ts`) are global —
they carry no cooperative/region dimension, and retrofitting labels onto
the hot single-trade path before the ADR-006 migration would misattribute
trades that have no cooperative context yet.

## Decision

**Separate pilot metrics with strict attribution, dashboard alongside
golden-signals:**

- **New instruments, bounded cardinality:** `amana_cooperative_trades_total
  {cooperative, region, event}`, `amana_cooperative_gmv_usdc_cents
  {cooperative, region}`, and `amana_bulk_import_total {outcome}`. Labels
  reuse the existing funnel event names; the pilot cohort is a handful of
  cooperatives, so cardinality is safe. A dedicated `PilotMetricsRecorder`
  test hook mirrors the existing KPI/Stellar recorder pattern without
  touching `KpiMetricsRecorder`.
- **Attribution only where verifiable:** `recordCooperativeBatch` in
  `TradeController` emits funnel/GMV points solely when the bulk caller
  belongs to the labelled cooperative (admin or member) and the caller
  supplied the label; otherwise the batch is left unattributed. Metrics
  never throw into the import path. Single-trade creation stays unlabeled
  until `Trade.cooperativeId` lands (ADR-006).
- **Dashboard as code:** `infra/grafana/dashboards/pilot-cohort.json`
  (uid `amana-pilot-cohort`, same provisioning directory as
  golden-signals, so no provisioning change was needed) with four panels:
  trades per cooperative, GMV per region (USDC/hour), dispute rate per
  cooperative, bulk-import rows by outcome. The 7-day default window suits
  a pilot better than the 6-hour golden-signals window.

## Consequences

- **Positive:** Pilot panels populate from the real onboarding flow (bulk
  import) from day one, while global funnel metrics stay untouched and
  comparable.
- **Positive:** No label-cardinality risk and no PII in labels —
  cooperative slugs and regions only, never wallet addresses.
- **Negative:** Until the ADR-006 migration, single-trade and on-chain
  lifecycle events (funded/disputed) from non-bulk flows are invisible to
  the per-cooperative panels; dispute-rate panels need disputed events
  with cooperative context, which arrive with the migration.
- **Negative:** `region` currently defaults to the cooperative slug when
  the importer omits it — convenient for single-region cooperatives,
  slightly lossy for multi-region ones until cohorts are modelled
  explicitly.
