# Disaster-Recovery Runbook: AWS RDS PostgreSQL Failover

## Overview

Amana persists off-chain trade metadata, webhook subscriptions, audit trails, event outbox records, and orphan deposit ledgers in an **AWS RDS for PostgreSQL (Multi-AZ)** cluster, accessed by the backend via Prisma (`backend/src/lib/db.ts`) and `retryAsync` (`backend/src/lib/retry.ts`).

This runbook documents the step-by-step procedure for:
1. Handling **automatic** Multi-AZ failovers and executing **manual** failovers.
2. Resetting stale Prisma / PgBouncer connection pools if DNS caching pins connections to the former primary.
3. Validating ledger cursor continuity and on-chain vs. database integrity after failover completes.

---

## 1. Symptoms & Alert Triggers

| Signal | Source | Meaning |
| :--- | :--- | :--- |
| Prisma `P1001` / `P1002` / `P1017` / `P2024` spikes | `backend/src/lib/retry.ts` (`retry_attempts_total`) | Primary RDS instance unreachable or closing active TCP connections during promotion. |
| PostgreSQL `57P01` (`admin_shutdown`) / `57P03` (`cannot_connect_now`) | Backend error logs | Standby promotion in progress or backend still connected to demoted read-only instance. |
| `/api/health` returns `503 Service Unavailable` | `backend/src/services/health.service.ts` | Database health probe (`SELECT 1`) timed out or failed. |
| AWS Event `RDS-EVENT-0049` / `RDS-EVENT-0015` | CloudWatch / PagerDuty | Multi-AZ failover started / completed. |

---

## 2. Failover Scenarios

### Scenario A: Automatic Multi-AZ Failover (Unplanned Outage)

When AWS detects a primary AZ failure, storage degradation, or instance crash, RDS automatically promotes the synchronous standby in the secondary AZ (typical RTO: `60–120 seconds`).

1. **Monitor failover status**:
   ```bash
   aws rds describe-db-instances \
     --db-instance-identifier amana-prod-postgres \
     --query 'DBInstances[0].{Status:DBInstanceStatus,AZ:AvailabilityZone,SecondaryAZ:SecondaryAvailabilityZone}'
   ```
2. **Wait for `DBInstanceStatus: available`** and verifyRDS events:
   ```bash
   aws rds describe-events \
     --source-identifier amana-prod-postgres \
     --source-type db-instance \
     --duration 60
   ```
3. Proceed immediately to **Section 3 (Connection Pool Reset)** once the instance status is `available`.

---

### Scenario B: Manual Multi-AZ Failover (Planned Maintenance / Incident Mitigation)

Use this when the primary AZ exhibits elevated I/O latency or network packet loss without triggering an automatic AWS failover:

1. **Pause non-essential background cron jobs** (reconciliation & PII scanner) to minimize in-flight writes during promotion:
   ```bash
   kubectl set env deployment/amana-backend RECONCILIATION_CRON_ENABLED=false
   ```
2. **Trigger reboot with failover**:
   ```bash
   aws rds reboot-db-instance \
     --db-instance-identifier amana-prod-postgres \
     --force-failover
   ```
3. **Poll until promotion finishes**:
   ```bash
   aws rds wait db-instance-available --db-instance-identifier amana-prod-postgres
   ```
4. Proceed to **Section 3 (Connection Pool Reset)**.

---

## 3. Connection Pool Reset Procedure

Although RDS updates the CNAME record of the cluster endpoint to point to the newly promoted primary (TTL `5s`), Node.js / Prisma connection pools or PgBouncer sidecars may retain open sockets to the old IP or hit `read-only transaction` errors.

### Step 3.1 — Verify Endpoint DNS Resolution Inside Backend Pods

```bash
kubectl exec -it deploy/amana-backend -- getent hosts "$RDS_HOSTNAME"
```

### Step 3.2 — Rolling Restart of Backend Pods (Prisma Pool Recycle)

Perform a zero-downtime rolling restart of `amana-backend` so every Prisma client establishes fresh TLS connections to the promoted primary:

```bash
kubectl rollout restart deployment/amana-backend
kubectl rollout status deployment/amana-backend --timeout=120s
```

### Step 3.3 — Terminate Stale Connections on PostgreSQL (If Pool Exhausted)

If `P2024` (connection pool timeout) persists due to zombie sessions:

```sql
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = current_database()
  AND pid <> pg_backend_pid()
  AND state = 'idle in transaction'
  AND state_change < now() - interval '2 minutes';
```

---

## 4. Post-Failover Verification & Data Integrity Checklist

- [ ] **1. Confirm Primary Read/Write Mode**:
  ```sql
  SHOW transaction_read_only;
  -- Expected: off
  ```
- [ ] **2. Verify `/api/health` Endpoint**:
  ```bash
  curl -sf https://api.amana.work/api/health | jq .
  ```
- [ ] **3. Verify Soroban Event Listener Cursor Continuity**:
  Ensure `eventListener.service.ts` resumed polling from the last persisted ledger sequence without gaps, and check for stuck outbox rows:
  ```sql
  SELECT status, COUNT(*) FROM event_outbox GROUP BY status;
  ```
- [ ] **4. Run On-Chain vs. Database Reconciliation**:
  Re-enable `RECONCILIATION_CRON_ENABLED=true` and run `dailyReconciliation.service.ts` + `orphanDeposit.service.ts` checks to confirm `0` unrecorded deposits or state divergences during the failover window:
  ```sql
  SELECT COUNT(*) FROM orphan_deposits WHERE status = 'HELD';
  ```
- [ ] **5. Confirm Retry Metrics Stabilized**:
  Verify in Grafana that `retry_outcomes_total{outcome="exhausted"}` is `0` over the last 10 minutes.
