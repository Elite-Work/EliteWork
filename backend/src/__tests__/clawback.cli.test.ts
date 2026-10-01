/**
 * Tests for the admin clawback CLI tool (Issue #100).
 *
 * Tests exercise the exported functions from backend/scripts/clawback.ts without
 * spawning a subprocess, giving fast, deterministic coverage of argument parsing,
 * key validation, network resolution, and payload building.
 */

import {
  parseArgs,
  validateAdminKey,
  resolveNetworkPassphrase,
  buildClawbackPayload,
  buildUnsignedClawbackXdr,
  type ClawbackArgs,
} from "../../scripts/clawback";
import { Keypair, Networks } from "@stellar/stellar-sdk";

// A valid Stellar testnet secret key for testing
const TEST_SECRET = Keypair.random().secret();

// ---------------------------------------------------------------------------
// parseArgs
// ---------------------------------------------------------------------------

describe("parseArgs", () => {
  beforeEach(() => {
    delete process.env["ADMIN_SECRET_KEY"];
    delete process.env["STELLAR_RPC_URL"];
  });

  it("parses required --stream-id and --amount with env admin key", () => {
    process.env["ADMIN_SECRET_KEY"] = TEST_SECRET;
    const args = parseArgs(["--stream-id", "stream-abc", "--amount", "1000"]);
    expect(args.streamId).toBe("stream-abc");
    expect(args.amount).toBe(1000);
    expect(args.adminKey).toBe(TEST_SECRET);
    expect(args.network).toBe("testnet");
    expect(args.dryRun).toBe(false);
  });

  it("parses --admin-key flag overriding env variable", () => {
    process.env["ADMIN_SECRET_KEY"] = "env-key";
    const args = parseArgs([
      "--stream-id", "s1",
      "--amount", "500",
      "--admin-key", TEST_SECRET,
    ]);
    expect(args.adminKey).toBe(TEST_SECRET);
  });

  it("parses --dry-run flag", () => {
    process.env["ADMIN_SECRET_KEY"] = TEST_SECRET;
    const args = parseArgs(["--stream-id", "s1", "--amount", "100", "--dry-run"]);
    expect(args.dryRun).toBe(true);
  });

  it("parses --network mainnet", () => {
    process.env["ADMIN_SECRET_KEY"] = TEST_SECRET;
    const args = parseArgs([
      "--stream-id", "s1",
      "--amount", "100",
      "--network", "mainnet",
    ]);
    expect(args.network).toBe("mainnet");
  });

  it("parses --rpc-url flag", () => {
    process.env["ADMIN_SECRET_KEY"] = TEST_SECRET;
    const args = parseArgs([
      "--stream-id", "s1",
      "--amount", "100",
      "--rpc-url", "https://custom-rpc.example.com",
    ]);
    expect(args.rpcUrl).toBe("https://custom-rpc.example.com");
  });

  it("throws when --stream-id is missing", () => {
    process.env["ADMIN_SECRET_KEY"] = TEST_SECRET;
    expect(() => parseArgs(["--amount", "100"])).toThrow(/--stream-id is required/i);
  });

  it("throws when --stream-id is empty string", () => {
    process.env["ADMIN_SECRET_KEY"] = TEST_SECRET;
    expect(() => parseArgs(["--stream-id", "", "--amount", "100"])).toThrow(
      /--stream-id is required/i,
    );
  });

  it("throws when --amount is missing", () => {
    process.env["ADMIN_SECRET_KEY"] = TEST_SECRET;
    expect(() => parseArgs(["--stream-id", "s1"])).toThrow(/--amount is required/i);
  });

  it("throws when --amount is zero", () => {
    process.env["ADMIN_SECRET_KEY"] = TEST_SECRET;
    expect(() => parseArgs(["--stream-id", "s1", "--amount", "0"])).toThrow(
      /positive integer/i,
    );
  });

  it("throws when --amount is negative", () => {
    process.env["ADMIN_SECRET_KEY"] = TEST_SECRET;
    expect(() => parseArgs(["--stream-id", "s1", "--amount", "-50"])).toThrow(
      /positive integer/i,
    );
  });

  it("throws when --amount is non-numeric", () => {
    process.env["ADMIN_SECRET_KEY"] = TEST_SECRET;
    expect(() => parseArgs(["--stream-id", "s1", "--amount", "abc"])).toThrow(
      /positive integer/i,
    );
  });

  it("throws when no admin key is provided and env is unset", () => {
    expect(() => parseArgs(["--stream-id", "s1", "--amount", "100"])).toThrow(
      /Admin secret key is required/i,
    );
  });

  it("throws when --network is invalid", () => {
    process.env["ADMIN_SECRET_KEY"] = TEST_SECRET;
    expect(() =>
      parseArgs(["--stream-id", "s1", "--amount", "100", "--network", "futurenet"]),
    ).toThrow(/testnet.*mainnet/i);
  });

  it("falls back to STELLAR_RPC_URL env when --rpc-url not passed", () => {
    process.env["ADMIN_SECRET_KEY"] = TEST_SECRET;
    process.env["STELLAR_RPC_URL"] = "https://env-rpc.example.com";
    const args = parseArgs(["--stream-id", "s1", "--amount", "100"]);
    expect(args.rpcUrl).toBe("https://env-rpc.example.com");
  });

  it("defaults rpcUrl to soroban-testnet when no env or flag provided", () => {
    process.env["ADMIN_SECRET_KEY"] = TEST_SECRET;
    const args = parseArgs(["--stream-id", "s1", "--amount", "100"]);
    expect(args.rpcUrl).toContain("soroban-testnet");
  });
});

// ---------------------------------------------------------------------------
// validateAdminKey
// ---------------------------------------------------------------------------

describe("validateAdminKey", () => {
  it("returns a Keypair for a valid Stellar secret key", () => {
    const kp = validateAdminKey(TEST_SECRET);
    expect(kp.publicKey()).toMatch(/^G/);
  });

  it("throws for an obviously invalid key", () => {
    expect(() => validateAdminKey("not-a-key")).toThrow(/Invalid admin secret key/i);
  });

  it("throws for an empty string", () => {
    expect(() => validateAdminKey("")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// resolveNetworkPassphrase
// ---------------------------------------------------------------------------

describe("resolveNetworkPassphrase", () => {
  it("returns testnet passphrase for testnet", () => {
    expect(resolveNetworkPassphrase("testnet")).toBe(Networks.TESTNET);
  });

  it("returns mainnet passphrase for mainnet", () => {
    expect(resolveNetworkPassphrase("mainnet")).toBe(Networks.PUBLIC);
  });
});

// ---------------------------------------------------------------------------
// buildUnsignedClawbackXdr
// ---------------------------------------------------------------------------

describe("buildUnsignedClawbackXdr", () => {
  it("returns a non-empty base64 string", () => {
    const xdr = buildUnsignedClawbackXdr("stream-1", 5000);
    expect(typeof xdr).toBe("string");
    expect(xdr.length).toBeGreaterThan(0);
  });

  it("encodes the stream ID and amount in the payload", () => {
    const xdr = buildUnsignedClawbackXdr("stream-xyz", 9999);
    const decoded = Buffer.from(xdr, "base64").toString("utf8");
    expect(decoded).toContain("stream-xyz");
    expect(decoded).toContain("9999");
  });
});

// ---------------------------------------------------------------------------
// buildClawbackPayload
// ---------------------------------------------------------------------------

describe("buildClawbackPayload", () => {
  const baseArgs: ClawbackArgs = {
    streamId: "stream-test",
    amount: 1000,
    adminKey: TEST_SECRET,
    rpcUrl: "https://soroban-testnet.stellar.org",
    network: "testnet",
    dryRun: false,
  };

  it("returns a payload with correct stream ID, amount, and network", () => {
    const payload = buildClawbackPayload(baseArgs);
    expect(payload.streamId).toBe("stream-test");
    expect(payload.amount).toBe(1000);
    expect(payload.network).toBe("testnet");
    expect(payload.networkPassphrase).toBe(Networks.TESTNET);
  });

  it("derives the admin public key from the secret key", () => {
    const payload = buildClawbackPayload(baseArgs);
    expect(payload.adminPublicKey).toMatch(/^G/);
  });

  it("marks payload as not a dry run when dryRun is false", () => {
    const payload = buildClawbackPayload(baseArgs);
    expect(payload.dryRun).toBe(false);
  });

  it("marks payload as dry run and prefixes signedXdr when dryRun is true", () => {
    const payload = buildClawbackPayload({ ...baseArgs, dryRun: true });
    expect(payload.dryRun).toBe(true);
    expect(payload.signedXdr).toMatch(/DRY-RUN/i);
  });

  it("throws for an invalid admin key", () => {
    expect(() => buildClawbackPayload({ ...baseArgs, adminKey: "BADKEY" })).toThrow(
      /Invalid admin secret key/i,
    );
  });

  it("returns mainnet passphrase when network is mainnet", () => {
    const payload = buildClawbackPayload({ ...baseArgs, network: "mainnet" });
    expect(payload.networkPassphrase).toBe(Networks.PUBLIC);
  });

  it("signedXdr is a non-empty string in live mode", () => {
    const payload = buildClawbackPayload(baseArgs);
    expect(typeof payload.signedXdr).toBe("string");
    expect(payload.signedXdr.length).toBeGreaterThan(0);
  });
});
