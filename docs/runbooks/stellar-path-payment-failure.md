# Incident Runbook: Stellar Path-Payment Failures

## Overview

Amana supports funding escrow trades via multi-hop Stellar DEX path payments (`PathPaymentService` in `backend/src/services/pathPayment.service.ts` and `deposit_with_path` / `finalize_path_payment` in `contracts/amana_escrow/src/lib.rs`).

A path payment failure occurs during either:
1. **Off-chain route discovery (`getPathPaymentQuote`)**: Horizon `strictSendPaths` fails, returns empty liquidity routes, or trips the `horizon-path-payment` circuit breaker (`CircuitBreakerOpenError`).
2. **On-chain settlement (`deposit_with_path` / `finalize_path_payment`)**: DEX orderbook liquidity shifts between quote generation and transaction submission, causing `Path payment: dest_amount below dest_min` or leaving a pending `PathPaymentIntent` unfinalized.

---

## 1. Symptoms & Alert Triggers

| Signal | Source | Meaning |
| :--- | :--- | :--- |
| `"Path payment circuit breaker open"` | `backend/src/services/pathPayment.service.ts` (`WARN`) | 5+ consecutive Horizon `strictSendPaths` failures tripped the `horizon-path-payment` circuit breaker (`30s` cooldown). |
| `"Path payment quote error"` | `backend/src/services/pathPayment.service.ts` (`ERROR`) | Upstream Horizon query failed after `retryAsync` backoff (`[1000, 2000, 4000, 8000] ms`). |
| `"Path payment: dest_amount below dest_min"` | Soroban RPC simulation / contract panic | Actual converted settlement token (`cNGN` / `USDC`) received by escrow was lower than the buyer's `dest_min` slippage floor. |
| `"Path payment already pending"` | `EscrowContract::deposit_with_path` | A `DataKey::PathPaymentIntent(trade_id)` record already exists on-chain because a prior path payment initiation was not finalized. |

---

## 2. Diagnostic Steps

### Step 2.1 — Inspect Circuit Breaker & Quote Cache Health

1. Check backend health and circuit breaker state:
   ```bash
   curl -s https://api.amana.work/api/health | jq '.circuitBreakers'
   ```
2. Check backend logs for `stellar.pathPaymentQuote` retries and Horizon HTTP status codes:
   ```bash
   kubectl logs -l app=amana-backend --tail=200 | grep -E "Path payment|QuoteCache|strictSendPaths"
   ```
3. Verify whether cached quotes in Redis (`quote:path:<asset>:<issuer>:<amount>`) are stale:
   ```bash
   redis-cli --scan --pattern "quote:path:*"
   ```

### Step 2.2 — Check Horizon Orderbook Liquidity (`strictSendPaths`)

Query Horizon directly for the failing asset pair (e.g., `NGN -> USDC`):

```bash
curl -s "https://horizon.stellar.org/paths/strict-send?source_amount=100000&source_asset_type=credit_alphanum4&source_asset_code=NGN&source_asset_issuer=GASIVS63V6PAKAMW3ZYEX2RNNB3Q4UMRKDIQHNMH3LRNTSWVHXMTANKE&destination_assets=USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVV" | jq '. _embedded.records'
```

- If `_embedded.records` is empty (`[]`), SDEX liquidity pools / orderbooks for the intermediate hop lack sufficient depth for `source_amount`.
- If Horizon returns `502`/`503`/`504`, the primary Horizon endpoint is degraded.

### Step 2.3 — Inspect On-Chain `PathPaymentIntent` & Escrow Balance

For a specific `trade_id` stuck in `Created` status after `deposit_with_path`:

```bash
stellar contract invoke \
  --id "$AMANA_ESCROW_CONTRACT_ID" \
  --network "$STELLAR_NETWORK" \
  -- get_trade \
  --trade_id <TRADE_ID>
```

Check whether `PTHINT` (`PathPaymentInitiatedEvent`) was emitted without a corresponding `PTHPAY` (`PathPaymentExecutedEvent`).

---

## 3. Resolution & Recovery Procedures

### Scenario A: Horizon Upstream Outage / Circuit Breaker Tripped

1. Verify `STELLAR_RPC_URL` and Horizon endpoint availability.
2. Fail over to the secondary Horizon provider by updating the backend configuration and rolling pods:
   ```bash
   kubectl set env deployment/amana-backend HORIZON_URL=https://horizon-fallback.stellar.org
   kubectl rollout status deployment/amana-backend
   ```
3. Flush stale path-payment quotes from Redis so fresh routes are fetched immediately:
   ```bash
   redis-cli EVAL "for _,k in ipairs(redis.call('keys','quote:path:*')) do redis.call('del',k) end" 0
   ```

### Scenario B: Slippage Rejection (`dest_amount below dest_min`)

1. If market volatility exceeds the default `QUOTE_MAX_SLIPPAGE_BPS` (`500` bps = 5%) or `QUOTE_CACHE_TTL_SECONDS` (`30s`), reduce the cache TTL so buyers receive near-real-time quotes:
   ```bash
   kubectl set env deployment/amana-backend QUOTE_CACHE_TTL_SECONDS=10
   ```
2. Instruct the buyer to refresh their quote and re-submit, or fund the trade directly in settlement tokens (`USDC` / `cNGN`) via `deposit(trade_id)`.

### Scenario C: Stuck `PathPaymentIntent` on a `Created` Trade

1. Verify whether settlement tokens were credited to the escrow contract (`cngn_after - cngn_balance_before >= dest_min`).
2. **If settlement tokens arrived (`>= dest_min`)**:
   - Trigger `finalize_path_payment(trade_id, admin_address)` using the admin key so the trade transitions to `Funded` and clears `DataKey::PathPaymentIntent(trade_id)`.
3. **If swap did not settle or trade should be aborted**:
   - Cancel the un-funded trade via `cancel_trade(trade_id, admin_address)` and reconcile any source tokens held by the contract via the Orphan Deposit runbook (`docs/runbooks/orphan-deposit-reconciliation.md`).

---

## 4. Escalation & Post-Incident Verification

- Confirm `horizon-path-payment` circuit breaker returns to `CLOSED`.
- Confirm `retry_outcomes_total{operation="stellar.pathPaymentQuote",outcome="success"}` recovers in Prometheus/Grafana.
- Run daily reconciliation (`dailyReconciliation.service.ts`) to verify on-chain escrow balances match database trade records.
