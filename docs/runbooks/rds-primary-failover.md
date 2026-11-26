# RDS Primary Failover Runbook

Use this runbook when an Aurora PostgreSQL cluster's writer instance is
unavailable, unhealthy, or must be replaced during planned maintenance. It
covers a same-region cluster failover; a regional outage requires the
environment's separate regional recovery plan.

## Safety and scope

- Treat a production writer outage or suspected data loss as P0/P1 and follow
  the [incident response runbook](./incident-response.md). Name an Incident
  Commander before taking action.
- Only an authorized database operator should initiate a production failover.
  Record the incident/ticket, cluster identifier, region, selected target, and
  timestamps in the incident timeline.
- Do not delete or recreate the cluster, disable deletion protection, restore
  over the production cluster, or manually change the writer endpoint's DNS.
- Aurora manages the cluster writer endpoint. It normally keeps the same DNS
  name through a failover; clients must reconnect and resolve that name again.

## 1. Assess and select a target

1. Confirm the affected environment, AWS account, region, cluster identifier,
   and current writer using the approved operator role. Do not copy database
   credentials into shell history or the incident channel.
2. Check AWS RDS events and CloudWatch for instance health, storage/cluster
   status, `AuroraReplicaLag`, connection errors, and recent deployments or
   maintenance. Identify whether the outage is isolated to the writer or also
   affects readers and the cluster endpoint.
3. If the current writer is responding and this is planned maintenance, check
   application health, pending migrations, and business-critical write
   activity with the Incident Commander before proceeding.
4. Choose a healthy reader in the same cluster and region as the promotion
   target. Confirm it is caught up as closely as possible and has suitable
   capacity. If there is no healthy reader, do not repeatedly trigger
   promotions; escalate to the database owner and follow the recovery plan.

For the environment's configured cluster name and instance inventory, consult
the matching Terraform environment and the
[RDS module documentation](../../infra/terraform/modules/rds/README.md).

## 2. Initiate failover

Prefer the AWS RDS console's **Failover** action when the operator needs to
verify the selected cluster and target interactively. For an approved
automation/CLI procedure, use the AWS CLI command below with the confirmed
cluster, region, and reader identifiers:

```bash
aws rds failover-db-cluster \
  --db-cluster-identifier "<cluster-identifier>" \
  --target-db-instance-identifier "<reader-instance-identifier>" \
  --region "<aws-region>"
```

If automatic selection is intended, omit the target instance option only
after the Incident Commander agrees. The operation is asynchronous: a
successful API response means the request was accepted, not that the new
writer is ready. Record the request time and monitor RDS events and cluster
status until the operation completes.

## 3. Verify promotion and endpoint recovery

Confirm exactly one cluster member is marked as writer and the selected reader
has become the writer. For example:

```bash
aws rds describe-db-clusters \
  --db-cluster-identifier "<cluster-identifier>" \
  --region "<aws-region>" \
  --query 'DBClusters[0].DBClusterMembers[].{Instance:DBInstanceIdentifier,Writer:IsClusterWriter,PromotionTier:PromotionTier}' \
  --output table
```

Then:

1. Verify the writer endpoint is still the expected cluster endpoint and the
   cluster is available. Do not replace it with an instance endpoint or an IP
   address.
2. Allow DNS caches and connection pools to refresh. Restart or recycle only
   the application workers that continue using stale connections; do not
   change the endpoint in application configuration as a failover workaround.
3. Check backend readiness and database connection errors using the normal
   health and monitoring dashboards. Confirm that read and write transactions
   succeed with a small, approved application-level check.
4. Verify replicas return to a healthy state and replication lag is falling.
   Keep the incident open if application errors, elevated lag, or failed
   writes continue.

## 4. Assess possible data loss

Do not assume that a completed failover proves every acknowledged transaction
survived. Compare the last known successful writes before the event with
application/database logs, durable audit or ledger records, and the recovered
database state. Check for:

- Missing, duplicated, or partially completed trade and payment records.
- Gaps between application acknowledgements and durable database/audit
  records around the failover time.
- Transactions retried by clients or queues, including their idempotency
  outcomes.
- The final observed replication lag and RDS event timeline before promotion.

Coordinate any reconciliation with the application and finance/operations
owners. Preserve evidence and timestamps. If the extent of loss is uncertain,
stop risky writes and escalate; do not manually replay or delete transactions
until an owner approves a reconciliation plan. If point-in-time comparison is
needed, restore a separate cluster for analysis rather than overwriting the
production cluster.

## 5. Stand down and follow up

The Incident Commander may stand down only after the writer and application
are healthy, replicas have recovered, and the data-loss assessment has an
owner and documented result. Continue monitoring connection errors, write
failures, and replica lag through a normal traffic cycle.

Record the promoted instance, endpoint behavior, recovery timeline, and any
reconciliation in the incident ticket. For a P0/P1, complete the
[postmortem](./postmortem-template.md) within the incident-response policy's
timeframe. Review whether replica capacity, promotion tiers, backups, alerts,
and application reconnect behavior need follow-up changes.
