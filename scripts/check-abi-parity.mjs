#!/usr/bin/env node
/**
 * check-abi-parity.mjs
 *
 * Guards the ABI contract between the backend and the Soroban escrow contract.
 *
 * The backend pins a frozen ABI snapshot in
 * `backend/src/__tests__/abi.version.gate.test.ts` (`FROZEN_CONTRACT_ABI`).
 * That snapshot is what the backend believes the deployed contract exposes.
 * This check compares the snapshot against the contract's actual public
 * entrypoints in `contracts/amana_escrow/src/lib.rs` and fails when:
 *
 *   1. a function the backend depends on no longer exists in the contract, or
 *   2. a function's return type changed.
 *
 * Renames, removals and return-type changes are breaking ABI changes: they
 * would make backend calls fail at runtime even though both sides still
 * compile. Argument-level review stays in the backend ABI gate test, which
 * records the exact argument list the backend sends.
 *
 * Usage:
 *   node scripts/check-abi-parity.mjs
 *   node scripts/check-abi-parity.mjs --abi <path> --contract <path>
 *
 * Exit codes:
 *   0 — the frozen snapshot is satisfied by the contract entrypoints
 *   1 — an ABI drift was found (prints the offending functions)
 *   2 — the check could not run (file unreadable or snapshot unparseable)
 */

import { readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const DEFAULT_ABI_FILE = join(
  ROOT,
  "backend/src/__tests__/abi.version.gate.test.ts",
);
const DEFAULT_CONTRACT_FILE = join(
  ROOT,
  "contracts/amana_escrow/src/lib.rs",
);

function fail(message) {
  console.error(`[abi-parity] FAILED — ${message}`);
  process.exit(1);
}

/** Returns the index just past the block that opens at `startIndex`. */
function matchBraceBlock(source, startIndex) {
  let depth = 0;
  for (let i = startIndex; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Parses the frozen ABI snapshot embedded in the backend gate test.
 *
 * @param {string} source contents of abi.version.gate.test.ts
 * @returns {Map<string, { args: string[], returnType: string }>}
 */
export function parseFrozenAbi(source) {
  const snapshotStart = source.indexOf("const FROZEN_CONTRACT_ABI");
  if (snapshotStart === -1) {
    throw new Error("FROZEN_CONTRACT_ABI not found in the ABI gate test");
  }
  const functionsKey = source.indexOf("functions:", snapshotStart);
  if (functionsKey === -1) {
    throw new Error("functions block not found in FROZEN_CONTRACT_ABI");
  }
  const functionsStart = source.indexOf("{", functionsKey);
  const functionsEnd = matchBraceBlock(source, functionsStart);
  if (functionsStart === -1 || functionsEnd === -1) {
    throw new Error("could not delimit the FROZEN_CONTRACT_ABI functions block");
  }

  const block = source.slice(functionsStart + 1, functionsEnd - 1);
  const entryPattern =
    /(\w+):\s*\{\s*args:\s*\[([^\]]*)\],\s*returnType:\s*"([^"]+)"/g;
  const functions = new Map();
  for (const match of block.matchAll(entryPattern)) {
    const [, name, args, returnType] = match;
    functions.set(name, {
      args: args
        .split(",")
        .map((arg) => arg.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean),
      returnType,
    });
  }
  if (functions.size === 0) {
    throw new Error("FROZEN_CONTRACT_ABI functions block is empty or unparseable");
  }
  return functions;
}

/**
 * Parses every `pub fn` entrypoint from the contract source and records its
 * declared return type. A missing `->` means the function returns unit, which
 * is exposed as "void" to line up with the backend snapshot.
 *
 * @param {string} source contents of contracts/amana_escrow/src/lib.rs
 * @returns {Map<string, { returnType: string }>}
 */
export function parseContractEntrypoints(source) {
  const entrypoints = new Map();
  const declaration = /pub fn (\w+)\s*\(/g;

  for (const match of source.matchAll(declaration)) {
    const name = match[1];
    let index = match.index + match[0].length;
    let depth = 1;
    for (; index < source.length && depth > 0; index++) {
      if (source[index] === "(") depth++;
      else if (source[index] === ")") depth--;
    }

    let cursor = index;
    while (cursor < source.length && /\s/.test(source[cursor])) cursor++;

    let returnType = "void";
    if (source.startsWith("->", cursor)) {
      cursor += 2;
      while (cursor < source.length && /\s/.test(source[cursor])) cursor++;
      let end = cursor;
      while (end < source.length && source[end] !== "{") end++;
      returnType = source.slice(cursor, end).trim() || "void";
    }

    entrypoints.set(name, { returnType });
  }

  return entrypoints;
}

function normalizeReturnType(returnType) {
  const value = String(returnType ?? "").replace(/\s+/g, "");
  if (value === "" || value === "()") return "void";
  return value;
}

/**
 * Compares the frozen backend snapshot with the contract entrypoints.
 *
 * @param {Map<string, {args: string[], returnType: string}>} frozen
 * @param {Map<string, {returnType: string}>} contract
 * @returns {{ missing: string[], returnTypeMismatches: Array<{name: string, expected: string, actual: string}> }}
 */
export function compareAbi(frozen, contract) {
  const missing = [];
  const returnTypeMismatches = [];

  for (const [name, frozenSignature] of frozen) {
    const contractSignature = contract.get(name);
    if (!contractSignature) {
      missing.push(name);
      continue;
    }
    const expected = normalizeReturnType(frozenSignature.returnType);
    const actual = normalizeReturnType(contractSignature.returnType);
    if (expected !== actual) {
      returnTypeMismatches.push({ name, expected, actual });
    }
  }

  return { missing, returnTypeMismatches };
}

function parseArgs(argv) {
  const options = {
    abi: DEFAULT_ABI_FILE,
    contract: DEFAULT_CONTRACT_FILE,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      console.log(
        "Usage: node scripts/check-abi-parity.mjs [--abi <path>] [--contract <path>]",
      );
      process.exit(0);
    }
    if (arg === "--abi" || arg === "--contract") {
      const value = argv[i + 1];
      if (!value) fail(`${arg} requires a path`);
      options[arg.slice(2)] = resolve(value);
      i++;
      continue;
    }
    fail(`unknown argument '${arg}' (see --help)`);
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  let abiSource;
  let contractSource;
  try {
    abiSource = readFileSync(options.abi, "utf8");
    contractSource = readFileSync(options.contract, "utf8");
  } catch (error) {
    console.error(
      `[abi-parity] FAILED — could not read ABI inputs: ${error.message}`,
    );
    process.exit(2);
  }

  let frozen;
  let contract;
  try {
    frozen = parseFrozenAbi(abiSource);
    contract = parseContractEntrypoints(contractSource);
  } catch (error) {
    console.error(`[abi-parity] FAILED — ${error.message}`);
    process.exit(2);
  }

  const { missing, returnTypeMismatches } = compareAbi(frozen, contract);

  if (missing.length > 0) {
    fail(
      `contract is missing function(s) the backend depends on:\n  - ${missing.join(
        "\n  - ",
      )}\nUpdate the contract or the frozen ABI snapshot after a reviewed upgrade.`,
    );
  }

  if (returnTypeMismatches.length > 0) {
    const details = returnTypeMismatches
      .map(
        ({ name, expected, actual }) =>
          `  - ${name}: backend expects ${expected}, contract returns ${actual}`,
      )
      .join("\n");
    fail(
      `contract return type(s) drifted from the frozen ABI snapshot:\n${details}`,
    );
  }

  console.log(
    `[abi-parity] OK — all ${frozen.size} frozen ABI function(s) are present with matching return types.`,
  );
  process.exit(0);
}

// Only run the CLI when executed directly — the helpers above are imported by
// scripts/__tests__/check-abi-parity.test.mjs.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
