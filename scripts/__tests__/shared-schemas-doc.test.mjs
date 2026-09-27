/**
 * Issue #97 — docs/shared-schemas.md promotion-milestone status update.
 *
 * The doc previously targeted the `packages/domain-schemas` extraction at
 * "after form 3". This suite pins the documented status against the actual
 * repository state so the doc cannot silently go stale: the milestone gate
 * must still read as open while the workspace prerequisites are missing, and
 * the extraction plan must be present for when the gate is met.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const doc = readFileSync(resolve(root, "docs/shared-schemas.md"), "utf8");

function readIfExists(relativePath) {
  const p = resolve(root, relativePath);
  return existsSync(p) ? readFileSync(p, "utf8") : null;
}

describe("docs/shared-schemas.md promotion milestone (issue #97)", () => {
  it("replaces the stale 'after form 3' trigger with a status section", () => {
    expect(doc).not.toMatch(/Promotion milestone \(after form 3\)/);
    expect(doc).toContain("## Promotion milestone status");
    expect(doc).toContain("has not been reached");
  });

  it("documents the milestone gate state with evidence", () => {
    for (const row of [
      "Driver manifest (order 3) migrated",
      "Evidence upload (order 4) migrated",
      "Treasury / vault ops (order 5) migrated",
      "Notification preferences (order 6) migrated",
      "Workspace prerequisites in place",
    ]) {
      expect(doc).toContain(row);
    }
    // Evidence must cite the observable signal (single guarded parity pair).
    expect(doc).toContain("scripts/check-schema-parity.mjs");
    expect(doc).toContain("one** pair");
  });

  it("keeps the mirror + CI-diff drift guard until the gate is met", () => {
    expect(doc).toMatch(/Do \*\*not\*\* delete the mirror file or the parity script/);
  });

  it("contains a concrete, ordered extraction plan", () => {
    expect(doc).toContain("## Extraction plan (execute once the gate is met)");
    const plan = doc.slice(doc.indexOf("## Extraction plan"));
    for (const step of [
      "pnpm-workspace.yaml",
      "packages/domain-schemas/package.json",
      "transpilePackages",
      "rootDir",
      "workspace:*",
      "Delete the drift guards",
    ]) {
      expect(plan).toContain(step);
    }
    // Steps must be an ordered numbered list covering workspace → package →
    // wiring → cleanup → verification.
    expect(plan).toMatch(/1\. \*\*Create the workspace\.\*\*/);
    expect(plan).toMatch(/2\. \*\*Create the package\.\*\*/);
    expect(plan).toMatch(/7\. \*\*Verify\.\*\*/);
    expect(doc).toContain("### Rollback");
  });

  it("plan does not delete the drift guards before verification runs", () => {
    const plan = doc.slice(doc.indexOf("## Extraction plan"));
    const deleteStep = plan.indexOf("Delete the drift guards");
    const verifyStep = plan.indexOf("7. **Verify.**");
    expect(deleteStep).toBeGreaterThan(-1);
    expect(verifyStep).toBeGreaterThan(deleteStep);
  });

  it("mirrors the current repo state (gate rows match the tree)", () => {
    // The doc claims these prerequisites are missing — assert that is true so
    // the doc goes stale the moment the extraction actually happens.
    expect(existsSync(resolve(root, "pnpm-workspace.yaml"))).toBe(false);
    expect(existsSync(resolve(root, "packages"))).toBe(false);

    // Only the trade pair is guarded today.
    const parity = readIfExists("scripts/check-schema-parity.mjs");
    expect(parity).toBeTruthy();
    const pairEntries = parity.split("name:").length - 1;
    expect(pairEntries).toBe(1);

    // The doc claims the mirror still exists and is identical for the trade
    // pair — both sides must be present for the guard to be meaningful.
    expect(readIfExists("backend/src/schemas/domain/trade.ts")).toBeTruthy();
    expect(readIfExists("frontend/src/lib/domain-schemas/trade.ts")).toBeTruthy();

    // The doc claims driver manifest / notification preferences schemas are
    // still in the legacy validation module, not under domain-schemas/.
    const legacy = readIfExists("frontend/src/lib/validation/schemas.ts");
    expect(legacy).toContain("export const ManifestSchema");
    expect(legacy).toContain("export const NotificationPreferencesSchema");
  });

  it("keeps the documented frontend canonical-schema paths intact", () => {
    expect(existsSync(resolve(root, "frontend/src/lib/domain-schemas/index.ts"))).toBe(true);
    expect(existsSync(resolve(root, "frontend/src/lib/domain-schemas/trade.ts"))).toBe(true);
  });
});
