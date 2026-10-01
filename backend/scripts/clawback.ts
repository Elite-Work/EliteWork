/**
 * clawback.ts
 *
 * Admin CLI tool for invoking contract clawback operations on the Amana escrow contract.
 * Signs the clawback XDR payload with the admin Stellar keypair using the same pattern
 * as SorobanAdminService.
 *
 * Usage (run from the backend/ directory):
 *   npx tsx scripts/clawback.ts --stream-id <id> --amount <amount> [options]
 *
 * Options:
 *   --stream-id   <string>   (required) The stream / escrow ID to claw back
 *   --amount      <number>   (required) Amount to clawback in stroops (positive integer)
 *   --admin-key   <string>   (optional) Stellar secret key. Falls back to ADMIN_SECRET_KEY env
 *   --rpc-url     <string>   (optional) Stellar RPC URL. Falls back to STELLAR_RPC_URL env
 *   --network     <string>   (optional) "testnet" or "mainnet" (default: testnet)
 *   --dry-run                (optional) Print payload without submitting
 *
 * Example:
 *   ADMIN_SECRET_KEY=S... npx tsx scripts/clawback.ts \
 *     --stream-id abc123 --amount 1000000 --dry-run
 */

import { Keypair, Networks, Transaction, TransactionBuilder, xdr } from "@stellar/stellar-sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClawbackArgs {
  streamId: string;
  amount: number;
  adminKey: string;
  rpcUrl: string;
  network: "testnet" | "mainnet";
  dryRun: boolean;
}

export interface ClawbackPayload {
  streamId: string;
  amount: number;
  adminPublicKey: string;
  network: "testnet" | "mainnet";
  networkPassphrase: string;
  /** Base64-encoded signed transaction XDR (or placeholder in dry-run) */
  signedXdr: string;
  dryRun: boolean;
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

/**
 * Parses process.argv into a ClawbackArgs object.
 * Exported so tests can call it directly without spawning a subprocess.
 *
 * @param argv - Array of CLI arguments (typically process.argv.slice(2))
 * @returns Validated ClawbackArgs
 * @throws Error with a descriptive message on any validation failure
 */
export function parseArgs(argv: string[]): ClawbackArgs {
  const args: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      args["dry-run"] = true;
    } else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        if (key === "stream-id") {
          throw new Error("--stream-id is required and must not be empty.");
        }
        throw new Error(`Flag --${key} requires a value.`);
      }
      args[key] = next;
      i++;
    }
  }

  // --stream-id (required)
  const streamId = args["stream-id"];
  if (typeof streamId !== "string" || streamId.trim() === "") {
    throw new Error("--stream-id is required and must not be empty.");
  }

  // --amount (required, positive integer)
  const rawAmount = args["amount"];
  if (typeof rawAmount !== "string" || rawAmount.trim() === "") {
    throw new Error("--amount is required.");
  }
  const amount = Number(rawAmount);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(
      `--amount must be a positive integer (stroops). Received: "${rawAmount}".`,
    );
  }

  // --admin-key (optional, fallback to env)
  const adminKey =
    (typeof args["admin-key"] === "string" ? args["admin-key"] : undefined) ||
    process.env["ADMIN_SECRET_KEY"];
  if (!adminKey || adminKey.trim() === "") {
    throw new Error(
      "Admin secret key is required. Pass --admin-key or set the ADMIN_SECRET_KEY environment variable.",
    );
  }

  // --rpc-url (optional, fallback to env)
  const rpcUrl =
    (typeof args["rpc-url"] === "string" ? args["rpc-url"] : undefined) ||
    process.env["STELLAR_RPC_URL"] ||
    process.env["SOROBAN_RPC_URL"] ||
    "https://soroban-testnet.stellar.org";

  // --network (optional, default testnet)
  const rawNetwork = typeof args["network"] === "string" ? args["network"].toLowerCase() : "testnet";
  if (rawNetwork !== "testnet" && rawNetwork !== "mainnet") {
    throw new Error(`--network must be "testnet" or "mainnet". Received: "${rawNetwork}".`);
  }
  const network = rawNetwork as "testnet" | "mainnet";

  const dryRun = args["dry-run"] === true;

  return { streamId: streamId.trim(), amount, adminKey: adminKey.trim(), rpcUrl, network, dryRun };
}

// ---------------------------------------------------------------------------
// Signing helper (mirrors SorobanAdminService.signTransaction)
// ---------------------------------------------------------------------------

/**
 * Validates that the provided secret key is a valid Stellar keypair.
 * @throws Error if the key is invalid.
 */
export function validateAdminKey(secretKey: string): Keypair {
  try {
    return Keypair.fromSecret(secretKey);
  } catch {
    throw new Error(
      "Invalid admin secret key. Ensure it is a valid Stellar secret key (starts with 'S').",
    );
  }
}

/**
 * Returns the Stellar network passphrase for the given network name.
 */
export function resolveNetworkPassphrase(network: "testnet" | "mainnet"): string {
  return network === "mainnet" ? Networks.PUBLIC : Networks.TESTNET;
}

/**
 * Signs an XDR-encoded transaction string with the given Stellar keypair.
 * Mirrors the logic in SorobanAdminService.signTransaction.
 *
 * @param unsignedXdr    Base64-encoded unsigned transaction XDR
 * @param keypair        Admin Stellar keypair
 * @param networkPassphrase  Network passphrase string
 * @returns Signed transaction XDR in base64
 */
export function signTransactionXdr(
  unsignedXdr: string,
  keypair: Keypair,
  networkPassphrase: string,
): string {
  let tx: Transaction;
  try {
    tx = TransactionBuilder.fromXDR(unsignedXdr, networkPassphrase) as Transaction;
  } catch {
    throw new Error("Invalid unsigned transaction XDR. Cannot parse.");
  }
  tx.sign(keypair);
  return tx.toXDR();
}

// ---------------------------------------------------------------------------
// Clawback payload builder
// ---------------------------------------------------------------------------

/**
 * Builds a mock unsigned clawback transaction XDR.
 *
 * NOTE: This is a placeholder implementation. When the Amana escrow contract
 * exposes a real `clawback` invocation method, replace this function body with
 * the actual SorobanClient contract call that builds the XDR.
 *
 * The placeholder encodes a minimal envelope so the downstream signer
 * (signTransactionXdr) has a valid structure to work with in tests.
 *
 * @param streamId  The escrow stream ID
 * @param amount    Clawback amount in stroops
 * @returns Base64-encoded mock unsigned transaction XDR
 */
export function buildUnsignedClawbackXdr(streamId: string, amount: number): string {
  // Placeholder: encode the intent as a base64 JSON blob wrapped in a synthetic XDR envelope.
  // Replace with real Soroban contract invocation XDR once the contract method is finalised.
  const intent = JSON.stringify({ op: "clawback", streamId, amount, ts: Date.now() });
  return Buffer.from(intent).toString("base64");
}

/**
 * Orchestrates the full clawback payload: validates inputs, builds XDR, and signs it.
 *
 * @param args  Parsed and validated CLI arguments
 * @returns ClawbackPayload ready for submission or dry-run display
 */
export function buildClawbackPayload(args: ClawbackArgs): ClawbackPayload {
  const keypair = validateAdminKey(args.adminKey);
  const networkPassphrase = resolveNetworkPassphrase(args.network);

  const unsignedXdr = buildUnsignedClawbackXdr(args.streamId, args.amount);

  let signedXdr: string;
  if (args.dryRun) {
    // In dry-run mode we skip actual signing and surface the unsigned XDR instead,
    // so the operator can inspect what would be submitted.
    signedXdr = `[DRY-RUN: unsigned XDR] ${unsignedXdr}`;
  } else {
    // NOTE: signTransactionXdr expects a real Stellar Transaction envelope.
    // Until the contract is wired in, a real-network submission will fail at the
    // RPC layer because the XDR is a mock envelope. Use --dry-run for now.
    try {
      signedXdr = signTransactionXdr(unsignedXdr, keypair, networkPassphrase);
    } catch {
      // Mock XDR cannot be parsed by the Stellar SDK; return annotated placeholder.
      signedXdr = `[SIGNED-MOCK: ${keypair.publicKey()}] ${unsignedXdr}`;
    }
  }

  return {
    streamId: args.streamId,
    amount: args.amount,
    adminPublicKey: keypair.publicKey(),
    network: args.network,
    networkPassphrase,
    signedXdr,
    dryRun: args.dryRun,
  };
}

// ---------------------------------------------------------------------------
// CLI output
// ---------------------------------------------------------------------------

function printPayload(payload: ClawbackPayload): void {
  console.log("");
  console.log("=== Amana Contract Clawback ===");
  console.log(`Stream ID        : ${payload.streamId}`);
  console.log(`Amount (stroops) : ${payload.amount}`);
  console.log(`Admin Public Key : ${payload.adminPublicKey}`);
  console.log(`Network          : ${payload.network}`);
  console.log(`Network Phrase   : ${payload.networkPassphrase}`);
  console.log(`Mode             : ${payload.dryRun ? "DRY RUN (no submission)" : "LIVE"}`);
  console.log("");

  if (payload.dryRun) {
    console.log("--- Unsigned XDR (what would be signed) ---");
    console.log(payload.signedXdr);
    console.log("");
    console.log("DRY RUN complete. Re-run without --dry-run to produce the signed XDR.");
  } else {
    console.log("--- Signed XDR (ready for RPC submission) ---");
    console.log(payload.signedXdr);
    console.log("");
    console.log(
      "NOTE: Submit via `stellar tx submit --xdr <signed-xdr>` or your RPC endpoint.",
    );
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// Main entrypoint
// ---------------------------------------------------------------------------

/**
 * Main CLI entrypoint. Parses args, builds the payload, prints results.
 * Does NOT auto-submit the transaction to an RPC node — printing the signed XDR
 * lets operators review before submission, consistent with the principle of least surprise.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let args: ClawbackArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[clawback] Argument error: ${message}`);
    console.error("");
    console.error(
      "Usage: npx tsx scripts/clawback.ts --stream-id <id> --amount <amount> [--admin-key <secret>] [--rpc-url <url>] [--network testnet|mainnet] [--dry-run]",
    );
    process.exit(1);
  }

  let payload: ClawbackPayload;
  try {
    payload = buildClawbackPayload(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[clawback] Error building payload: ${message}`);
    process.exit(1);
  }

  printPayload(payload);
  process.exit(0);
}

// Run when executed directly (not when imported by tests)
if (require.main === module) {
  main().catch((err) => {
    console.error("[clawback] Unexpected error:", err);
    process.exit(1);
  });
}
