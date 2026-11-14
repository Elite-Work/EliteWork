/**
 * Tests for scripts/check-lockfile-drift.sh
 *
 * Executes the real bash gate script inside isolated temporary repositories
 * with deterministic PATH-scoped pnpm/npm shims so every sync, drift,
 * stray-lockfile, missing-manifest, CLI flag, and missing-tool branch is
 * exercised offline without mutating the repository working tree.
 *
 * Run: pnpm test:scripts
 */

import { execFileSync, spawnSync } from "child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(HERE, "..");
const ROOT_DIR = join(SCRIPTS_DIR, "..");
const SCRIPT = join(SCRIPTS_DIR, "check-lockfile-drift.sh");
const CI_WORKFLOW = join(ROOT_DIR, ".github", "workflows", "ci.yml");

const BASH_BIN = execFileSync("which", ["bash"], { encoding: "utf8" }).trim();
const CORE_UTILS = ["dirname", "mktemp", "cp", "rm", "cmp"].map((tool) => ({
  name: tool,
  target: execFileSync("which", [tool], { encoding: "utf8" }).trim(),
}));

const TEMP_DIRS = [];

const DEFAULT_ROOT_MANIFEST = {
  private: true,
  scripts: {
    "test:scripts": "jest",
  },
};

const DEFAULT_ROOT_LOCKFILE = {
  lockfileVersion: 3,
  requires: true,
  packages: {},
};

function makeMockPnpmSource() {
  return `#!${process.execPath}
const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
const dirIdx = args.indexOf("--dir");
const targetDir = dirIdx >= 0 ? path.basename(args[dirIdx + 1] || "") : "";
if (process.env.MOCK_TRACE_FILE) {
  fs.appendFileSync(process.env.MOCK_TRACE_FILE, "pnpm:" + targetDir + "\\n");
}
const failDirs = (process.env.MOCK_PNPM_FAIL_DIRS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
process.exit(failDirs.includes(targetDir) ? 1 : 0);
`;
}

function makeMockNpmSource() {
  return `#!${process.execPath}
const fs = require("fs");
if (process.env.MOCK_TRACE_FILE) {
  fs.appendFileSync(process.env.MOCK_TRACE_FILE, "npm\\n");
}
if (process.env.MOCK_NPM_FAIL === "1") {
  process.exit(1);
}
if (process.env.MOCK_NPM_REGEN_LOCKFILE) {
  fs.writeFileSync("package-lock.json", process.env.MOCK_NPM_REGEN_LOCKFILE, "utf8");
}
process.exit(0);
`;
}

function createFixtureWorkspace({
  includePnpm = true,
  includeNpm = true,
  rootManifest = DEFAULT_ROOT_MANIFEST,
  rootLockfile = DEFAULT_ROOT_LOCKFILE,
  omitPnpmManifests = [],
  omitPnpmLockfiles = [],
  strayFiles = [],
} = {}) {
  const dir = join(
    tmpdir(),
    `lockfile-drift-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  TEMP_DIRS.push(dir);

  const scriptsDir = join(dir, "scripts");
  const binDir = join(dir, "bin");
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(binDir, { recursive: true });

  const scriptCopy = join(scriptsDir, "check-lockfile-drift.sh");
  copyFileSync(SCRIPT, scriptCopy);
  chmodSync(scriptCopy, 0o755);

  for (const { name, target } of CORE_UTILS) {
    symlinkSync(target, join(binDir, name));
  }
  symlinkSync(process.execPath, join(binDir, "node"));

  if (includePnpm) {
    const pnpmPath = join(binDir, "pnpm");
    writeFileSync(pnpmPath, makeMockPnpmSource(), "utf8");
    chmodSync(pnpmPath, 0o755);
  }
  if (includeNpm) {
    const npmPath = join(binDir, "npm");
    writeFileSync(npmPath, makeMockNpmSource(), "utf8");
    chmodSync(npmPath, 0o755);
  }

  for (const pkg of ["backend", "frontend", "mobile"]) {
    const pkgDir = join(dir, pkg);
    mkdirSync(pkgDir, { recursive: true });
    if (!omitPnpmManifests.includes(pkg)) {
      writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: pkg }), "utf8");
    }
    if (!omitPnpmLockfiles.includes(pkg)) {
      writeFileSync(join(pkgDir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    }
  }

  for (const relPath of strayFiles) {
    writeFileSync(join(dir, relPath), "{}\n", "utf8");
  }

  if (rootManifest !== null) {
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify(rootManifest, null, 2)}\n`,
      "utf8",
    );
  }
  if (rootLockfile !== null) {
    writeFileSync(
      join(dir, "package-lock.json"),
      `${JSON.stringify(rootLockfile, null, 2)}\n`,
      "utf8",
    );
  }

  return {
    dir,
    binDir,
    scriptCopy,
    run(args = [], extraEnv = {}) {
      return spawnSync(BASH_BIN, [scriptCopy, ...args], {
        cwd: dir,
        encoding: "utf8",
        env: {
          PATH: binDir,
          ...extraEnv,
        },
      });
    },
  };
}

afterAll(() => {
  for (const dir of TEMP_DIRS) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("check-lockfile-drift.sh — script & CI validation", () => {
  it("exists and has owner execute permission", () => {
    expect(existsSync(SCRIPT)).toBe(true);
    expect(statSync(SCRIPT).mode & 0o100).toBeTruthy();
  });

  it("passes bash syntax check (bash -n)", () => {
    const res = spawnSync(BASH_BIN, ["-n", SCRIPT], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stderr).toBe("");
  });

  it("is invoked in .github/workflows/ci.yml", () => {
    const ciContent = readFileSync(CI_WORKFLOW, "utf8");
    expect(ciContent).toContain("./scripts/check-lockfile-drift.sh");
  });
});

describe("check-lockfile-drift.sh — CLI flags & toolchain guards", () => {
  it.each(["-h", "--help"])("prints usage and exits 0 on %s", (flag) => {
    const res = spawnSync(BASH_BIN, [SCRIPT, flag], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Usage:");
  });

  it("exits 1 on unknown CLI arguments", () => {
    const res = spawnSync(BASH_BIN, [SCRIPT, "--unknown-flag"], { encoding: "utf8" });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("unknown argument '--unknown-flag'");
  });

  it("skips npm root check when --pnpm-only is passed", () => {
    const ws = createFixtureWorkspace({ rootLockfile: null });
    const traceFile = join(ws.dir, "trace.log");
    const res = ws.run(["--pnpm-only"], { MOCK_TRACE_FILE: traceFile });

    expect(res.status).toBe(0);
    const trace = readFileSync(traceFile, "utf8").trim().split("\n");
    expect(trace).toEqual(["pnpm:backend", "pnpm:frontend", "pnpm:mobile"]);
  });

  it("skips pnpm subproject checks when --npm-only is passed", () => {
    const ws = createFixtureWorkspace({ strayFiles: ["backend/package-lock.json"] });
    const traceFile = join(ws.dir, "trace.log");
    const res = ws.run(["--npm-only"], { MOCK_TRACE_FILE: traceFile });

    expect(res.status).toBe(0);
    const trace = readFileSync(traceFile, "utf8").trim().split("\n");
    expect(trace).toEqual(["npm"]);
  });

  it("exits 1 when pnpm is not found on PATH", () => {
    const ws = createFixtureWorkspace({ includePnpm: false });
    const res = ws.run(["--pnpm-only"]);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("pnpm not found on PATH");
  });

  it("exits 1 when npm is not found on PATH", () => {
    const ws = createFixtureWorkspace({ includeNpm: false });
    const res = ws.run(["--npm-only"]);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("npm not found on PATH");
  });
});

describe("check-lockfile-drift.sh — pnpm subprojects & root npm checks", () => {
  it("exits 0 when all pnpm lockfiles and root npm lockfile are in sync", () => {
    const ws = createFixtureWorkspace();
    const res = ws.run();

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("[lockfile-drift] OK");
  });

  it.each(["backend/package-lock.json", "frontend/npm-shrinkwrap.json", "mobile/package-lock.json"])(
    "exits 1 when stray %s exists in a pnpm-managed directory",
    (strayFile) => {
      const ws = createFixtureWorkspace({ strayFiles: [strayFile] });
      const res = ws.run(["--pnpm-only"]);

      expect(res.status).toBe(1);
      expect(res.stderr).toContain(`${strayFile} exists`);
      expect(res.stderr).toContain(`git rm ${strayFile}`);
    },
  );

  it("exits 1 when a pnpm subproject is missing package.json or pnpm-lock.yaml", () => {
    const ws = createFixtureWorkspace({
      omitPnpmManifests: ["backend"],
      omitPnpmLockfiles: ["mobile"],
    });
    const res = ws.run(["--pnpm-only"]);

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("backend/package.json not found");
    expect(res.stderr).toContain("mobile/pnpm-lock.yaml not found");
    expect(res.stderr).toContain("2 check(s) failed");
  });

  it("exits 1 when pnpm frozen-lockfile verification reports drift", () => {
    const ws = createFixtureWorkspace();
    const res = ws.run(["--pnpm-only"], { MOCK_PNPM_FAIL_DIRS: "frontend" });

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("frontend/pnpm-lock.yaml is out of sync with package.json");
  });

  it("exits 0 when root package.json is nameless and regenerated lockfile only differs in name", () => {
    const ws = createFixtureWorkspace();
    const stampedLockfile = `${JSON.stringify(
      {
        name: basename(ws.dir),
        ...DEFAULT_ROOT_LOCKFILE,
      },
      null,
      2,
    )}\n`;

    const res = ws.run(["--npm-only"], {
      MOCK_NPM_REGEN_LOCKFILE: stampedLockfile,
    });

    expect(res.status).toBe(0);
    expect(res.stdout).toContain("<repo root>/package-lock.json in sync with package.json");
  });

  it("exits 1 when regenerated root package-lock.json has real dependency drift", () => {
    const ws = createFixtureWorkspace();
    const driftedLockfile = `${JSON.stringify(
      {
        lockfileVersion: 3,
        requires: true,
        packages: { "node_modules/jest": { version: "30.3.1" } },
      },
      null,
      2,
    )}\n`;

    const res = ws.run(["--npm-only"], {
      MOCK_NPM_REGEN_LOCKFILE: driftedLockfile,
    });

    expect(res.status).toBe(1);
    expect(res.stderr).toContain("<repo root>/package-lock.json is out of sync with package.json");
  });

  it("exits 1 when root package-lock.json is missing or npm install fails", () => {
    const missingWs = createFixtureWorkspace({ rootLockfile: null });
    const missingRes = missingWs.run(["--npm-only"]);
    expect(missingRes.status).toBe(1);
    expect(missingRes.stderr).toContain("<repo root>/package-lock.json not found");

    const failWs = createFixtureWorkspace();
    const failRes = failWs.run(["--npm-only"], { MOCK_NPM_FAIL: "1" });
    expect(failRes.status).toBe(1);
    expect(failRes.stderr).toContain("'npm install --package-lock-only' failed");
  });
});
