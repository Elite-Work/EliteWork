# Incident Runbook: `orphanDeposit.service.ts` Reconciliation Failures

## Overview

`OrphanDepositService` (`backend/src/services/orphanDeposit.service.ts`) detects and holds inbound Stellar token transfers (`cNGN` / `USDC`) arriving at the Amana escrow contract that cannot be matched to an active database `Trade` record in `CREATED` status.

Orphan deposits are classified into four reasons (`OrphanReason`):
- `TRADE_NOT_FOUND`: Deposit `contractTradeId` or memo does not match any `Trade` row in PostgreSQL.
- `INVALID_TRADE_STATUS`: The referenced `Trade` is already `FUNDED`, `COMPLETED`, `CANCELLED`, or `DISPUTED`.
- `AMOUNT_MISMATCH`: On-chain deposit amount differs from `trade.amount` beyond `AMOUNT_TOLERANCE` (`0.0001`).
- `DUPLICATE_DEPOSIT`: Another `OrphanDeposit` already exists for the same `txHash` or funded trade.

When an orphan deposit is flagged (`OrphanStatus.HELD`), `AlertService.sendAlert` dispatches a `WARNING` (or `CRITICAL` if `amount >= 1,000,000` cNGN) webhook notification to on-call operators.

---

## 1. Symptoms & Alert Triggers

| Alert / Log Message | Severity | Root Cause |
| :--- | :--- | :--- |
| `"Orphan deposit detected — holding for manual review"` | `WARN` / `CRITICAL` | `OrphanDepositService.classifyAndHoldDeposit()` created a `HELD` record in `orphan_deposits`. |
| `"Failed to classify deposit — manual investigation required"` | `ERROR` | Database connectivity error or unexpected schema exception during `classifyAndHoldDeposit()`. |
| `"Failed to dispatch orphan deposit alert"` | `WARN` | `ALERT_WEBHOOK_URL` delivery failed while holding an orphan deposit. |
| Daily Reconciliation mismatch (`dailyReconciliation.service.ts`) | `CRITICAL` | On-chain escrow contract token balance exceeds the sum of `FUNDED` / `DISPUTED` database trades. |

---

## 2. Diagnostic Steps

### Step 2.1 — List Held Orphan Deposits

Query all pending `HELD` orphan deposits via the Admin API or directly via PostgreSQL:

```sql
SELECT
  id,
  tx_hash,
  ledger_sequence,
  sender_address,
  amount,
  asset_code,
  contract_trade_id,
  matched_trade_id,
  reason,
  reason_detail,
  detected_at
FROM orphan_deposits
WHERE status = 'HELD'
ORDER BY detected_at DESC;
```

### Step 2.2 — Cross-Check On-Chain Transaction & Soroban Event

Inspect the Stellar transaction on Horizon and Soroban RPC using `tx_hash`:

```bash
curl -s "https://horizon.stellar.org/transactions/<TX_HASH>/operations" | jq '._embedded.records'
```

Verify whether the transfer originated from:
1. A legitimate buyer whose frontend `POST /api/trades` request failed or timed out before DB persistence (`TRADE_NOT_FOUND`).
2. A double-click / duplicate wallet submission (`INVALID_TRADE_STATUS` or `DUPLICATE_DEPOSIT`).
3. A manual transfer sent directly to the contract address with an incorrect amount (`AMOUNT_MISMATCH`).

---

## 3. Resolution Procedures

### Case A: Match to an Existing `CREATED` Trade (`matchToTrade`)

Use this when the buyer intended to fund a valid `CREATED` trade (e.g., memo was omitted or off-chain trade row was synced late, and amounts match within tolerance):

1. Verify the target `tradeId` is in `CREATED` status:
   ```sql
   SELECT id, contract_trade_id, buyer_address, amount, status
   FROM trades
   WHERE id = '<TARGET_TRADE_ID>';
   ```
2. Invoke `orphanDepositService.matchToTrade(orphanId, tradeId, adminWalletAddress, notes)` via the Admin Reconciliation endpoint.
3. Confirm that:
   - `orphan_deposits.status` transitions to `MATCHED`
   - `trades.status` transitions to `FUNDED` within the same Prisma `$transaction`

### Case B: Refund Deposit to Sender (`markRefunded`)

Use this for `DUPLICATE_DEPOSIT`, `INVALID_TRADE_STATUS` (already funded/cancelled), or `AMOUNT_MISMATCH` where the trade should not proceed:

1. Execute the on-chain return transfer (or admin clawback `admin_clawback` / `queue_clawback` to `sender_address`) and record the resulting `refundTxHash`.
2. Record the refund in PostgreSQL via `orphanDepositService.markRefunded(orphanId, refundTxHash, adminWalletAddress, notes)`.
3. Verify `orphan_deposits.status = 'REFUNDED'` and `refund_tx_hash` is populated.

### Case C: Dismiss Non-Actionable Dust / Test Transfers (`dismiss`)

If the transfer is negligible dust (`< 1` cNGN) or an internal test probe:

1. Call `orphanDepositService.dismiss(orphanId, adminWalletAddress, "Dust / test probe — no refund required")`.
2. Confirm `orphan_deposits.status = 'DISMISSED'`.

---

## 4. Verification & Post-Incident Checklist

- Ensure `SELECT COUNT(*) FROM orphan_deposits WHERE status = 'HELD'` returns `0`.
- Trigger a manual run of `dailyReconciliation.service.ts` to confirm 0 bps deviation between on-chain escrow balance and PostgreSQL active trade balances.
- Verify audit trail entries (`resolvedBy`, `resolvedAt`, `resolutionNotes`) are recorded on every resolved `OrphanDeposit` row.
