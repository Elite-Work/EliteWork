#!/usr/bin/env node
/**
 * Check that the contract's generated event interface matches its canonical
 * schema. The existing code generator validates the Rust event definitions
 * against schemas/events/ and checks both generated clients without rewriting
 * files.
 */
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const codegen = resolve(root, "scripts/codegen-events.mjs");

execFileSync(process.execPath, [codegen, "--check"], {
  cwd: root,
  stdio: "inherit",
});
