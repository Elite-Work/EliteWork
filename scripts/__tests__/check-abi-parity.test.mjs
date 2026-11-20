/**
 * Tests for scripts/check-abi-parity.mjs
 *
 * The script guards the backend's frozen ABI snapshot against the contract's
 * public entrypoints. A bug in the gate would let a renamed function or a
 * changed return type ship silently, so both the pass and fail branches are
 * exercised — pure helpers against fixtures, and the CLI end-to-end against
 * the real repository plus deliberately drifted temp copies.
 *
 * Run: pnpm test:scripts
 */

import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import {
  compareAbi,
  parseContractEntrypoints,
  parseFrozenAbi,
} from "../check-abi-parity.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "check-abi-parity.mjs");
const ROOTS = [];

const ABI_FIXTURE = `const FROZEN_CONTRACT_ABI = {
  version: "1.0.0",

  functions: {
    create_trade: {
      args: ["buyer:Address", "seller:Address", "amount:i128"],
      returnType: "u64",
    },
    release_funds: {
      args: ["trade_id:u64", "caller:Address"],
      returnType: "void",
    },
  },

  storageKeys: ["Trade"],
} as const;
`;

const CONTRACT_FIXTURE = `
impl EscrowContract {
    pub fn create_trade(
        env: Env,
        buyer: Address,
        seller: Address,
        amount: i128,
        expires_at: Option<u64>,
    ) -> u64 {
        let _ = env;
        1
    }

    pub fn release_funds(env: Env, trade_id: u64, caller: Address) {
        let _ = (env, trade_id, caller);
    }

    fn helper_not_public() {}
}
`;

function makeFixture(abi, contract) {
  const dir = mkdtempSync(join(tmpdir(), "abi-parity-test-"));
  ROOTS.push(dir);
  const abiPath = join(dir, "abi.ts");
  const contractPath = join(dir, "lib.rs");
  writeFileSync(abiPath, abi, "utf8");
  writeFileSync(contractPath, contract, "utf8");
  return { dir, abiPath, contractPath };
}

function runCli(args) {
  try {
    const stdout = execFileSync("node", [SCRIPT, ...args], {
      stdio: "pipe",
      encoding: "utf8",
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return {
      code: err.status ?? -1,
      stdout: err.stdout?.toString() ?? "",
      stderr: err.stderr?.toString() ?? "",
    };
  }
}

afterAll(() => {
  for (const dir of ROOTS) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  }
});

describe("parseFrozenAbi", () => {
  it("extracts every function with its args and return type", () => {
    const frozen = parseFrozenAbi(ABI_FIXTURE);
    expect([...frozen.keys()]).toEqual(["create_trade", "release_funds"]);
    expect(frozen.get("create_trade").returnType).toBe("u64");
    expect(frozen.get("create_trade").args).toEqual([
      "buyer:Address",
      "seller:Address",
      "amount:i128",
    ]);
    expect(frozen.get("release_funds").returnType).toBe("void");
  });

  it("throws when the frozen snapshot is absent", () => {
    expect(() => parseFrozenAbi("const other = {};")).toThrow(
      /FROZEN_CONTRACT_ABI/,
    );
  });
});

describe("parseContractEntrypoints", () => {
  it("reads multiline signatures and normalizes a missing return type to void", () => {
    const entrypoints = parseContractEntrypoints(CONTRACT_FIXTURE);
    expect(entrypoints.get("create_trade").returnType).toBe("u64");
    expect(entrypoints.get("release_funds").returnType).toBe("void");
  });

  it("ignores non-public functions", () => {
    const entrypoints = parseContractEntrypoints(CONTRACT_FIXTURE);
    expect(entrypoints.has("helper_not_public")).toBe(false);
  });

  it("handles generic return types", () => {
    const entrypoints = parseContractEntrypoints(
      "    pub fn get_trade(env: Env, id: u64) -> Option<Trade> { unreachable!() }\n",
    );
    expect(entrypoints.get("get_trade").returnType).toBe("Option<Trade>");
  });
});

describe("compareAbi", () => {
  it("reports no drift when every frozen function is present", () => {
    const result = compareAbi(
      parseFrozenAbi(ABI_FIXTURE),
      parseContractEntrypoints(CONTRACT_FIXTURE),
    );
    expect(result.missing).toEqual([]);
    expect(result.returnTypeMismatches).toEqual([]);
  });

  it("reports a function that the contract no longer exposes", () => {
    const contract = parseContractEntrypoints(CONTRACT_FIXTURE);
    contract.delete("release_funds");

    const result = compareAbi(parseFrozenAbi(ABI_FIXTURE), contract);
    expect(result.missing).toEqual(["release_funds"]);
  });

  it("reports a changed return type", () => {
    const contract = parseContractEntrypoints(
      CONTRACT_FIXTURE.replace(
        "pub fn create_trade(",
        "pub fn create_trade(",
      ).replace(
        "    ) -> u64 {",
        "    ) -> u32 {",
      ),
    );

    const result = compareAbi(parseFrozenAbi(ABI_FIXTURE), contract);
    expect(result.returnTypeMismatches).toEqual([
      { name: "create_trade", expected: "u64", actual: "u32" },
    ]);
  });
});

describe("check-abi-parity.mjs — CLI", () => {
  it("passes node --check (no syntax errors)", () => {
    expect(() => {
      execFileSync("node", ["--check", SCRIPT], { stdio: "pipe" });
    }).not.toThrow();
  });

  it("passes against the real backend snapshot and contract (read-only smoke test)", () => {
    const result = runCli([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("[abi-parity] OK");
  });

  it("fails with exit 1 when the contract drops a frozen function", () => {
    const { abiPath, contractPath } = makeFixture(
      ABI_FIXTURE,
      CONTRACT_FIXTURE.replace("pub fn release_funds", "fn release_funds"),
    );

    const result = runCli([
      "--abi",
      abiPath,
      "--contract",
      contractPath,
    ]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("release_funds");
  });

  it("fails with exit 2 when an input file cannot be read", () => {
    const { abiPath } = makeFixture(ABI_FIXTURE, CONTRACT_FIXTURE);
    const result = runCli([
      "--abi",
      abiPath,
      "--contract",
      join(abiPath, "..", "missing.rs"),
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("could not read ABI inputs");
  });
});
