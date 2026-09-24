/**
 * Inbound webhook HMAC conformance tests — Issue #197.
 *
 * Covers, per provider:
 *  - a correctly signed payload is accepted and reaches the handler
 *  - an unsigned payload is rejected
 *  - a payload signed with the wrong secret is rejected
 *  - a tampered body under a captured signature is rejected
 *  - a replayed payload outside the tolerance window is rejected
 *  - a replay inside the window is still accepted (the window is symmetric)
 *  - an unknown provider is rejected before any handler runs
 *  - a provider with no configured secret fails closed
 *  - both secrets are accepted mid-rotation
 *  - every rejection is counted on the verification metric
 */

import crypto from "crypto";
import express from "express";
import request from "supertest";

// `config/env` freezes its parsed object at import time, and ES imports are
// hoisted above plain statements — so the webhook fields are proxied back onto
// `process.env`, letting a test change the registry mid-run (a rotation) and
// call `resetWebhookSecretRegistry()` to pick it up.
jest.mock("../config/env", () => {
  const actual = jest.requireActual("../config/env");
  return {
    ...actual,
    env: new Proxy(actual.env, {
      get(target: Record<string, unknown>, key: string) {
        if (key === "INBOUND_WEBHOOK_SECRETS") {
          return process.env.INBOUND_WEBHOOK_SECRETS;
        }
        if (key === "INBOUND_WEBHOOK_TOLERANCE_SECONDS") {
          return Number(process.env.INBOUND_WEBHOOK_TOLERANCE_SECONDS ?? 300);
        }
        return target[key];
      },
    }),
  };
});

// ── Typed mock factories ─────────────────────────────────────────────────────

type MetricsMock = {
  recordWebhookSignatureVerification: jest.Mock<void, [string, string]>;
};

function createMockMetrics(): MetricsMock {
  return {
    recordWebhookSignatureVerification: jest.fn(),
  };
}

const mockMetrics = createMockMetrics();

jest.mock("../lib/metrics", () => ({
  recordWebhookSignatureVerification: mockMetrics.recordWebhookSignatureVerification,
}));

const DEFAULT_SECRETS = JSON.stringify({
  "stellar-anchor": "anchor-secret-value",
  "payments-psp": "psp-old-secret,psp-new-secret",
  "unsecured-provider": "placeholder-cleared-by-one-test",
});

import { recordWebhookSignatureVerification } from "../lib/metrics";
import {
  captureRawBody,
  computeWebhookSignature,
  parseWebhookSecrets,
  resetWebhookSecretRegistry,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "../middleware/webhookSignature.middleware";
import {
  inboundWebhooksRoutes,
  registerInboundWebhookHandler,
  __resetInboundWebhookHandlers,
} from "../routes/webhooks.inbound.routes";

const ANCHOR_SECRET = "anchor-secret-value";

function buildApp() {
  const app = express();
  app.use(express.json({ verify: captureRawBody }));
  app.use("/webhooks/inbound", inboundWebhooksRoutes);
  return app;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Signs `body` exactly as a provider would. `body` is serialised once and both
 * signed and sent, so the bytes on the wire are the bytes that were signed.
 */
function signedPost(
  app: express.Express,
  provider: string,
  body: unknown,
  options: { secret?: string; timestamp?: number; overrideBody?: unknown } = {},
) {
  const secret = options.secret ?? ANCHOR_SECRET;
  const timestamp = String(options.timestamp ?? nowSeconds());
  const raw = JSON.stringify(body);
  const signature = computeWebhookSignature(secret, timestamp, raw);

  return request(app)
    .post(`/webhooks/inbound/${provider}`)
    .set("Content-Type", "application/json")
    .set(WEBHOOK_SIGNATURE_HEADER, signature)
    .set(WEBHOOK_TIMESTAMP_HEADER, timestamp)
    .send(
      options.overrideBody === undefined ? raw : JSON.stringify(options.overrideBody),
    );
}

describe("parseWebhookSecrets", () => {
  it("returns an empty registry when unset", () => {
    expect(parseWebhookSecrets(undefined).size).toBe(0);
    expect(parseWebhookSecrets("   ").size).toBe(0);
  });

  it("lowercases provider names and splits rotation secrets", () => {
    const registry = parseWebhookSecrets('{"Stellar-Anchor":"a , b"}');
    expect(registry.get("stellar-anchor")).toEqual(["a", "b"]);
  });

  it("rejects malformed input rather than silently accepting no secrets", () => {
    expect(() => parseWebhookSecrets("not json")).toThrow(/must be a JSON object/);
    expect(() => parseWebhookSecrets('["a"]')).toThrow(/must be a JSON object/);
    expect(() => parseWebhookSecrets('{"p":123}')).toThrow(/must be a string/);
    expect(() => parseWebhookSecrets('{"p":" , "}')).toThrow(/is empty/);
  });
});

describe("inbound webhook signature verification", () => {
  let app: express.Express;
  let handler: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    __resetInboundWebhookHandlers();
    process.env.INBOUND_WEBHOOK_SECRETS = DEFAULT_SECRETS;
    process.env.INBOUND_WEBHOOK_TOLERANCE_SECONDS = "300";
    resetWebhookSecretRegistry();
    handler = jest.fn().mockResolvedValue(undefined);
    registerInboundWebhookHandler("stellar-anchor", handler);
    app = buildApp();
  });

  it("accepts a correctly signed payload and passes it to the handler", async () => {
    const body = { event: "deposit.completed", amount: "125.5000000" };
    const res = await signedPost(app, "stellar-anchor", body);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", handled: true });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toEqual(body);
    expect(recordWebhookSignatureVerification).toHaveBeenCalledWith(
      "stellar-anchor",
      "verified",
    );
  });

  it("rejects a payload with no signature header", async () => {
    const res = await request(app)
      .post("/webhooks/inbound/stellar-anchor")
      .set(WEBHOOK_TIMESTAMP_HEADER, String(nowSeconds()))
      .send({ event: "deposit.completed" });

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(recordWebhookSignatureVerification).toHaveBeenCalledWith(
      "stellar-anchor",
      "missing_signature",
    );
  });

  it("rejects a payload with no timestamp header", async () => {
    const res = await request(app)
      .post("/webhooks/inbound/stellar-anchor")
      .set(WEBHOOK_SIGNATURE_HEADER, "deadbeef")
      .send({ event: "deposit.completed" });

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(recordWebhookSignatureVerification).toHaveBeenCalledWith(
      "stellar-anchor",
      "missing_timestamp",
    );
  });

  it("rejects a non-numeric timestamp", async () => {
    const res = await request(app)
      .post("/webhooks/inbound/stellar-anchor")
      .set(WEBHOOK_SIGNATURE_HEADER, "deadbeef")
      .set(WEBHOOK_TIMESTAMP_HEADER, "not-a-number")
      .send({ event: "deposit.completed" });

    expect(res.status).toBe(400);
    expect(recordWebhookSignatureVerification).toHaveBeenCalledWith(
      "stellar-anchor",
      "malformed_timestamp",
    );
  });

  it("rejects a payload signed with the wrong secret", async () => {
    const res = await signedPost(
      app,
      "stellar-anchor",
      { event: "deposit.completed" },
      { secret: "attacker-guess" },
    );

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(recordWebhookSignatureVerification).toHaveBeenCalledWith(
      "stellar-anchor",
      "invalid_signature",
    );
  });

  it("rejects a tampered body carrying a signature captured from the original", async () => {
    // Signature is computed over the honest payout; the body on the wire pays
    // the attacker instead. The digest no longer matches the bytes received.
    const res = await signedPost(
      app,
      "stellar-anchor",
      { event: "payout.released", destination: "GHONEST", amount: "1.0000000" },
      {
        overrideBody: {
          event: "payout.released",
          destination: "GATTACKER",
          amount: "10000.0000000",
        },
      },
    );

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(recordWebhookSignatureVerification).toHaveBeenCalledWith(
      "stellar-anchor",
      "invalid_signature",
    );
  });

  it("rejects a replay from outside the tolerance window", async () => {
    const res = await signedPost(
      app,
      "stellar-anchor",
      { event: "deposit.completed" },
      { timestamp: nowSeconds() - 3600 },
    );

    expect(res.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(recordWebhookSignatureVerification).toHaveBeenCalledWith(
      "stellar-anchor",
      "stale_timestamp",
    );
  });

  it("rejects a timestamp skewed far into the future", async () => {
    const res = await signedPost(
      app,
      "stellar-anchor",
      { event: "deposit.completed" },
      { timestamp: nowSeconds() + 3600 },
    );

    expect(res.status).toBe(401);
    expect(recordWebhookSignatureVerification).toHaveBeenCalledWith(
      "stellar-anchor",
      "stale_timestamp",
    );
  });

  it("still accepts a delivery inside the tolerance window", async () => {
    const res = await signedPost(
      app,
      "stellar-anchor",
      { event: "deposit.completed" },
      { timestamp: nowSeconds() - 60 },
    );

    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown provider before any handler runs", async () => {
    const res = await signedPost(app, "does-not-exist", { event: "x" });

    expect(res.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
    expect(recordWebhookSignatureVerification).toHaveBeenCalledWith(
      "does-not-exist",
      "missing_secret",
    );
  });

  it("fails closed when a provider has no configured secret", async () => {
    process.env.INBOUND_WEBHOOK_SECRETS = JSON.stringify({
      "stellar-anchor": ANCHOR_SECRET,
    });
    resetWebhookSecretRegistry();

    const res = await signedPost(app, "unsecured-provider", { event: "x" });

    expect(res.status).toBe(503);
    expect(handler).not.toHaveBeenCalled();
    expect(recordWebhookSignatureVerification).toHaveBeenCalledWith(
      "unsecured-provider",
      "missing_secret",
    );
  });

  it("accepts both the old and the new secret mid-rotation", async () => {
    const pspHandler = jest.fn().mockResolvedValue(undefined);
    registerInboundWebhookHandler("payments-psp", pspHandler);

    const withOld = await signedPost(
      app,
      "payments-psp",
      { event: "charge.settled" },
      { secret: "psp-old-secret" },
    );
    const withNew = await signedPost(
      app,
      "payments-psp",
      { event: "charge.settled" },
      { secret: "psp-new-secret" },
    );

    expect(withOld.status).toBe(200);
    expect(withNew.status).toBe(200);
    expect(pspHandler).toHaveBeenCalledTimes(2);
  });

  it("acknowledges a verified payload that has no registered handler", async () => {
    __resetInboundWebhookHandlers();

    const res = await signedPost(app, "stellar-anchor", { event: "deposit.completed" });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ handled: false });
  });

  it("surfaces a handler failure as a 500 so the provider retries", async () => {
    handler.mockRejectedValueOnce(new Error("downstream unavailable"));

    const res = await signedPost(app, "stellar-anchor", { event: "deposit.completed" });

    expect(res.status).toBe(500);
  });
});

describe("computeWebhookSignature", () => {
  it("binds the timestamp into the digest", () => {
    const body = '{"event":"x"}';
    const a = computeWebhookSignature("s", "1000", body);
    const b = computeWebhookSignature("s", "2000", body);
    expect(a).not.toEqual(b);
  });

  it("matches a straightforward HMAC-SHA256 over `${timestamp}.${body}`", () => {
    const expected = crypto
      .createHmac("sha256", "s")
      .update('1000.{"event":"x"}')
      .digest("hex");
    expect(computeWebhookSignature("s", "1000", '{"event":"x"}')).toEqual(expected);
  });
});