# Outbound Webhook Retry & Exponential Backoff

## Overview

`WebhookService` (`backend/src/services/webhook.service.ts`) dispatches trade lifecycle events (`trade.created`, `trade.funded`, `trade.completed`, `trade.disputed`, `trade.cancelled`, etc.) to active subscriber endpoints and any configured global `WEBHOOK_URL`.

To ensure transient receiver outages or network blips do not drop critical escrow notifications, `WebhookService` implements automatic retry-on-failure with **exponential backoff and bounded jitter**.

---

## Configuration

Retry behavior is controlled via environment variables validated in `backend/src/config/env.ts` (and can also be overridden per instance via `WebhookRetryOptions`):

| Environment Variable | Default | Description |
| :--- | :--- | :--- |
| `WEBHOOK_MAX_ATTEMPTS` | `3` | Maximum total delivery attempts per target (initial try + retries). |
| `WEBHOOK_RETRY_BASE_MS` | `1000` | Base backoff window in milliseconds for attempt 1. |
| `WEBHOOK_RETRY_MAX_MS` | `30000` | Upper bound (cap) in milliseconds for any single retry delay. |
| `WEBHOOK_URL` | *(optional)* | Global fallback webhook destination URL. |
| `WEBHOOK_SECRET` | *(optional)* | Shared HMAC-SHA256 secret used to sign payloads (`X-Webhook-Signature`). |

---

## Exponential Backoff & Jitter Formula

For retry attempt $k \in \{1, \dots, N - 1\}$:

1. **Exponential Window**:
   $$\text{window}_k = \min\left(\text{WEBHOOK\_RETRY\_BASE\_MS} \times 2^{k - 1},\ \text{WEBHOOK\_RETRY\_MAX\_MS}\right)$$

2. **Bounded Equal Jitter** ($\text{jitterFactor} = 0.25$ by default):
   $$\text{delay}_k = \text{round}\Big(\text{window}_k \times (1 - \text{jitterFactor} + \text{rand}() \times \text{jitterFactor})\Big)$$

Adding jitter prevents synchronized retry waves ("thundering herd") when multiple trade transitions occur simultaneously during a downstream webhook receiver restart.

---

## Retry Classification

| Failure Condition | Retryable? | Behavior |
| :--- | :--- | :--- |
| Network / DNS / Socket Error (`fetch` throws) | **Yes** | Retried up to `WEBHOOK_MAX_ATTEMPTS` with backoff + jitter. |
| HTTP `5xx` (`500`, `502`, `503`, `504`) | **Yes** | Retried up to `WEBHOOK_MAX_ATTEMPTS` with backoff + jitter. |
| HTTP `429 Too Many Requests` | **Yes** | Retried up to `WEBHOOK_MAX_ATTEMPTS` with backoff + jitter. |
| HTTP `4xx` (except `429`, e.g., `400`, `401`, `404`) | **No** | Aborts immediately and logs a non-retryable final failure. |

---

## Headers & Monitoring

Every delivery request includes:
- `Content-Type: application/json`
- `X-Webhook-Attempt: <1..N>` — current attempt number for receiver observability
- `X-Webhook-Signature: <hex>` — HMAC-SHA256 digest of the raw JSON body when a secret is configured

When all retry attempts are exhausted (or a permanent `4xx` status is encountered), `WebhookService` emits an `appLogger.error` structured log entry with `finalFailure: true`, `attemptsExhausted`, `subscriptionId`, `webhookUrl`, and `lastStatusCode` so log-based alerting and monitoring pipelines can trigger operator notifications.
