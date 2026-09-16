# Health Probe Semantics — EliteWork Backend

Issue #224 introduces three distinct probe tiers to prevent self-inflicted outages
during third-party dependency brownouts (e.g. Stellar RPC slowness).

---

## Probe Tiers

### 1. Liveness — `GET /health/live`

**Purpose:** Confirms the Node.js process is alive and the event loop is
running. Contains **zero I/O**; it can never hang or fail due to an external
dependency.

**k8s probe type:** `livenessProbe`
**Failure action:** Pod is killed and restarted by the kubelet.

**When it fails:** Never, unless the process itself is frozen/deadlocked.
Do **not** add any database or network calls here.

**Response (200 OK):**
```json
{ "status": "alive", "timestamp": "2026-01-01T00:00:00.000Z" }
```

---

### 2. Readiness — `GET /health/ready`

**Purpose:** Confirms the pod can handle production traffic. Checks **only**
the critical internal dependencies: **PostgreSQL (Prisma)** and **Redis**.

**k8s probe type:** `readinessProbe`
**Failure action:** Pod is removed from the Service's load-balancer rotation.
No restart; the pod stays alive and rejoins when deps recover.

**Intentionally excluded:**
- Stellar Horizon RPC — external, degraded-but-tolerable
- Soroban RPC — external, degraded-but-tolerable
- IPFS/Pinata — optional, non-blocking
- On-chain indexer — lag is expected; not grounds to remove a pod

Including any of the above in readiness would cause a deploy storm during
Stellar RPC slowness, where all pods are simultaneously un-readied.

**Response (200 OK — ready):**
```json
{
  "status": "ready",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "checks": {
    "database": { "status": "up", "message": "Database connection healthy", "responseTime": 4 },
    "redis":    { "status": "up", "message": "Redis connection healthy",    "responseTime": 2 }
  }
}
```

**Response (503 — not ready):**
```json
{
  "status": "not_ready",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "checks": {
    "database": { "status": "down", "message": "Database check failed: ECONNREFUSED", "responseTime": 201 },
    "redis":    { "status": "up",   "message": "Redis connection healthy",              "responseTime": 2 }
  }
}
```

---

### 3. Startup — `GET /health/startup`

**Purpose:** Validates the minimum requirements for the container to enter
service. Checks DB, Redis, critical environment variables, and the
ADMIN_SECRET_KEY signing key. Run once on boot; replaced by liveness/readiness
after `initialDelaySeconds`.

**k8s probe type:** `startupProbe`
**Failure action:** Pod is killed if startup doesn't succeed within
`failureThreshold × periodSeconds`.

**Response (200 OK — ready):**
```json
{
  "status": "ready",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "checks": {
    "database":       { "status": "up", ... },
    "redis":          { "status": "up", ... },
    "config":         { "status": "up", ... },
    "adminSigningKey":{ "status": "up", ... }
  }
}
```

---

### 4. Full dependency check — `GET /health`

**Not a k8s probe.** Used by observability dashboards (Datadog, UptimeRobot,
Grafana) for the full dependency matrix including Stellar, IPFS, indexer, and
circuit-breaker states.

Returns `200` for `healthy` and `degraded`; `503` for `unhealthy`.

---

## Kubernetes Manifest Example

```yaml
# deployment.yaml (backend)
containers:
  - name: backend
    image: elitework/backend:latest
    ports:
      - containerPort: 4000

    # ── Startup probe ──────────────────────────────────────────────────────
    # Gives the app up to 30 s to initialise before liveness/readiness kick in.
    startupProbe:
      httpGet:
        path: /health/startup
        port: 4000
      failureThreshold: 6
      periodSeconds: 5
      timeoutSeconds: 3

    # ── Liveness probe ─────────────────────────────────────────────────────
    # Restarts the pod if the event loop is frozen.
    # Never checks external deps — must never fail due to Stellar/IPFS.
    livenessProbe:
      httpGet:
        path: /health/live
        port: 4000
      initialDelaySeconds: 0
      periodSeconds: 10
      failureThreshold: 3
      timeoutSeconds: 2

    # ── Readiness probe ────────────────────────────────────────────────────
    # Removes pod from LB rotation if DB or Redis are unavailable.
    # Does NOT check Stellar/IPFS/indexer — those are tolerable externals.
    readinessProbe:
      httpGet:
        path: /health/ready
        port: 4000
      initialDelaySeconds: 0
      periodSeconds: 10
      failureThreshold: 3
      successThreshold: 1
      timeoutSeconds: 3
```

---

## Brownout Simulation

The tiered design was load-tested under the following failure scenarios:

| Scenario                        | `/health/live` | `/health/ready` | Pods in rotation? |
|---------------------------------|---------------|-----------------|-------------------|
| All healthy                     | 200 alive     | 200 ready       | Yes               |
| Stellar RPC slow (>5 s)         | 200 alive     | 200 ready       | **Yes** ✓         |
| IPFS unavailable                | 200 alive     | 200 ready       | **Yes** ✓         |
| Indexer lag >15 s               | 200 alive     | 200 ready       | **Yes** ✓         |
| DB connection refused           | 200 alive     | 503 not_ready   | No (correct)      |
| Redis connection refused        | 200 alive     | 503 not_ready   | No (correct)      |
| DB + Redis both down            | 200 alive     | 503 not_ready   | No (correct)      |
| Process frozen (liveness fails) | fails         | —               | Pod restarted     |

**Key insight:** Before this fix, `/health/ready` called `performHealthCheck()` which includes
Stellar/IPFS/indexer checks. A Stellar RPC brownout would fail readiness on all pods
simultaneously, causing a deploy storm. With `performReadinessCheck()` (DB+Redis only),
pods remain in rotation during external brownouts and degrade gracefully.

---

## Correlation ID Support

The `/health/detail` endpoint retains full correlation ID support via
`correlationIdMiddleware` registered in `app.ts`. All health responses include
the `X-Correlation-ID` header for distributed tracing.
