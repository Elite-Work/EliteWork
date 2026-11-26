/**
 * End-to-end tests for scripts/check-lockfile-drift.sh
 *
 * The script is the "Lockfile Drift Check" CI gate. It resolves the repo root
 * from its own location and inspects fixed subprojects (`backend/`,
 * `frontend/`, `mobile/` as pnpm projects and the repo root as an npm
 * project). Each test therefore copies the script into a throwaway repo-shaped
 * directory and seeds real `package.json` / lockfile pairs with the actual
 * package managers, so a bug in the gate cannot silently disable it.
 *
 * Run: pnpm test:scripts
 */

import { jest } from "@jest/globals";
import { execFileSync } from "child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "..", "check-lockfile-drift.sh");
const PNPM_PROJECTS = ["backend", "frontend", "mobile"];
const ROOTS = [];

jest.setTimeout(60_000);

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "lockfile-drift-test-"));
  ROOTS.push(root);
  mkdirSync(join(root, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(root, "scripts", "check-lockfile-drift.sh"));
  return root;
}

function writeManifest(root, dir, manifest) {
  const target = dir ? join(root, dir) : root;
  mkdirSync(target, { recursive: true });
  writeFileSync(
    join(target, "package.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
}

function runTool(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: "pipe", encoding: "utf8" });
}

/** Creates valid pnpm lockfiles for every pnpm-managed subproject. */
function seedPnpm(root) {
  for (const project of PNPM_PROJECTS) {
    writeManifest(root, project, { name: project, version: "1.0.0" });
    runTool(
      "pnpm",
      ["install", "--lockfile-only", "--ignore-scripts"],
      join(root, project),
    );
  }
}

/** Creates a valid npm lockfile for the npm-managed repo root. */
function seedNpm(root) {
  writeManifest(root, "", { name: "fixture-root", version: "1.0.0" });
  runTool(
    "npm",
    [
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ],
    root,
  );
}

/**
 * Runs the gate script from inside the fixture root. Returns the exit code and
 * captured output instead of throwing, so both pass and fail branches can be
 * asserted.
 */
function runGate(root, args = []) {
  try {
    const stdout = execFileSync(
      "bash",
      [join(root, "scripts", "check-lockfile-drift.sh"), ...args],
      { cwd: root, stdio: "pipe", encoding: "utf8" },
    );
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
  for (const root of ROOTS) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
});

describe("scripts/check-lockfile-drift.sh — CLI", () => {
  it("prints usage and exits 0 for --help", () => {
    const root = makeRoot();
    const result = runGate(root, ["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Usage: ");
    expect(result.stdout).toContain("--pnpm-only");
  });

  it("rejects an unknown argument with exit 1", () => {
    const root = makeRoot();
    const result = runGate(root, ["--bogus"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unknown argument");
  });
});

describe("scripts/check-lockfile-drift.sh — pnpm projects", () => {
  it("passes when every pnpm lockfile is in sync and no stray npm lockfile exists", () => {
    const root = makeRoot();
    seedPnpm(root);
    const result = runGate(root, ["--pnpm-only"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("in sync with package.json");
    expect(result.stdout).toContain("[lockfile-drift] OK");
  });

  it("fails when a stray package-lock.json reappears in a pnpm-managed project", () => {
    const root = makeRoot();
    seedPnpm(root);
    writeFileSync(
      join(root, "backend", "package-lock.json"),
      '{"lockfileVersion": 3}\n',
      "utf8",
    );

    const result = runGate(root, ["--pnpm-only"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("backend/package-lock.json exists");
    expect(result.stderr).toContain("pnpm-managed");
  });

  it("fails when a pnpm-managed project is missing its lockfile", () => {
    const root = makeRoot();
    for (const project of PNPM_PROJECTS) {
      writeManifest(root, project, { name: project, version: "1.0.0" });
    }

    const result = runGate(root, ["--pnpm-only"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("backend/pnpm-lock.yaml not found");
  });

  it("fails when a pnpm lockfile has drifted from package.json", () => {
    const root = makeRoot();
    seedPnpm(root);

    // Add a local file dependency after the lockfile was generated. This is
    // offline and deterministic, but `--frozen-lockfile` sees an unrecorded
    // dependency in package.json and refuses to proceed.
    const localPkgDir = join(root, "backend", "local-pkg");
    mkdirSync(localPkgDir, { recursive: true });
    writeFileSync(
      join(localPkgDir, "package.json"),
      JSON.stringify({ name: "local-pkg", version: "1.0.0" }) + "\n",
      "utf8",
    );
    writeManifest(root, "backend", {
      name: "backend",
      version: "1.0.0",
      dependencies: { "local-pkg": "file:./local-pkg" },
    });

    const result = runGate(root, ["--pnpm-only"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "backend/pnpm-lock.yaml is out of sync with package.json",
    );
  });
});

describe("scripts/check-lockfile-drift.sh — npm project", () => {
  it("passes when the root package-lock.json is in sync", () => {
    const root = makeRoot();
    seedNpm(root);
    const result = runGate(root, ["--npm-only"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("<repo root>/package-lock.json in sync");
  });

  it("fails when the root package-lock.json has drifted from package.json", () => {
    const root = makeRoot();
    seedNpm(root);
    writeManifest(root, "", { name: "fixture-root", version: "2.0.0" });

    const result = runGate(root, ["--npm-only"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "<repo root>/package-lock.json is out of sync with package.json",
    );
  });

  it("fails when the root lockfile is missing", () => {
    const root = makeRoot();
    writeManifest(root, "", { name: "fixture-root", version: "1.0.0" });

    const result = runGate(root, ["--npm-only"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(
      "<repo root>/package-lock.json not found",
    );
  });
});

describe("scripts/check-lockfile-drift.sh — full gate", () => {
  it("passes when both pnpm and npm projects are in sync", () => {
    const root = makeRoot();
    seedPnpm(root);
    seedNpm(root);

    const result = runGate(root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(
      "[lockfile-drift] OK — all lockfiles in sync",
    );
  });
});
