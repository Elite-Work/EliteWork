/**
 * Issue #92 — CONTRIBUTING.md
 *
 * The CONTRIBUTING.md must exist at the repo root and document the Drips Wave
 * complexity-label convention (`complexity: trivial/medium/high` → 100/150/200
 * points, per https://docs.drips.network/wave) so contributors understand issue
 * sizing before picking an issue up.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readDoc(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

describe("CONTRIBUTING.md (issue #92)", () => {
  let contributing;

  beforeAll(() => {
    contributing = readDoc("CONTRIBUTING.md");
  });

  it("exists at the repository root", () => {
    expect(() => readDoc("CONTRIBUTING.md")).not.toThrow();
  });

  it("documents the complexity label convention", () => {
    expect(contributing).toMatch(/complexity:\s*trivial/);
    expect(contributing).toMatch(/complexity:\s*medium/);
    expect(contributing).toMatch(/complexity:\s*high/);
  });

  it("maps each complexity label to its Drips Wave point value", () => {
    expect(contributing).toMatch(/complexity:\s*trivial[^\n]*\|\s*100\b/);
    expect(contributing).toMatch(/complexity:\s*medium[^\n]*\|\s*150\b/);
    expect(contributing).toMatch(/complexity:\s*high[^\n]*\|\s*200\b/);
  });

  it("references the Drips Wave documentation", () => {
    expect(contributing).toContain("https://docs.drips.network/wave");
  });

  it("explains issue sizing so contributors understand it before picking an issue", () => {
    expect(contributing).toMatch(/How issue sizing works/i);
    expect(contributing).toMatch(/Before you pick up an issue/i);
  });

  it("follows the repo's documentation conventions (markdown H1 title, linked relative docs)", () => {
    expect(contributing.startsWith("# ")).toBe(true);
    // Cross-links existing docs rather than duplicating them.
    expect(contributing).toContain("docs/branch-protection-policy.md");
    expect(contributing).toContain("docs/admin-route-contribution-guide.md");
    expect(contributing).toContain("SECURITY.md");
  });
});
