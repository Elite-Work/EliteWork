/**
 * Tests for scripts/staging-reset.sh (Issue #125).
 *
 * The script is destructive, so the tests focus on the safety envelope that
 * lets CI/operators trust it: it must be executable, syntactically valid, keep
 * the synthetic-probes policy in sync, refuse non-staging databases, and offer
 * a side-effect-free dry run.
 */

import { execFileSync, spawnSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = join(HERE, "..");
const ROOT_DIR = join(SCRIPTS_DIR, "..");
const SCRIPT = join(SCRIPTS_DIR, "staging-reset.sh");
const POLICY = join(ROOT_DIR, "docs", "synthetic-probes-policy.md");

function runScript(args, env = {}) {
  return spawnSync("bash", [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

const STAGING_URL = "postgresql://postgres:staging-password@localhost:5434/amana_staging";
const PROD_URL = "postgresql://postgres:secret@db.internal:5432/amana_prod";

describe("staging-reset.sh", () => {
  it("exists and is executable", () => {
    expect(existsSync(SCRIPT)).toBe(true);
    const mode = statSync(SCRIPT).mode;
    // Owner execute bit.
    expect(mode & 0o100).toBeTruthy();
  });

  it("passes a bash syntax check", () => {
    expect(() => {
      execFileSync("bash", ["-n", SCRIPT], { stdio: "pipe" });
    }).not.toThrow();
  });

  it("is referenced by the synthetic probes policy", () => {
    const policy = readFileSync(POLICY, "utf8");
    expect(policy).toContain("staging-reset.sh");
    // The policy documents what the baseline actually is.
    expect(policy).toMatch(/seed\.staging\.ts/);
  });

  it("refuses to reset a database that does not look like staging", () => {
    const result = runScript(["--yes", "--dry-run"], {
      STAGING_DATABASE_URL: PROD_URL,
      STAGING_REDIS_PASSWORD: "irrelevant",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/does not look like staging/i);
  });

  it("allows a non-staging database only with --force", () => {
    const result = runScript(["--yes", "--dry-run", "--force"], {
      STAGING_DATABASE_URL: PROD_URL,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/dry run complete/i);
  });

  it("performs a side-effect-free dry run for the staging database", () => {
    const result = runScript(["--yes", "--dry-run"], {
      STAGING_DATABASE_URL: STAGING_URL,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/dry run/i);
    // The plan names the three baseline steps so operators know what will change.
    expect(result.stdout).toMatch(/migrate reset/);
    expect(result.stdout).toMatch(/seed\.staging\.ts/);
    expect(result.stdout).toMatch(/FLUSHALL/);
  });

  it("requires confirmation when not run with --yes and no TTY", () => {
    const result = runScript([], {
      STAGING_DATABASE_URL: STAGING_URL,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/--yes|interactive terminal/i);
  });
});
