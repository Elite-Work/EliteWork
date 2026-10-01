import { execSync } from "child_process";
import * as path from "path";

describe("CI Admin Regression Test Policy Script Unit Tests", () => {
  const scriptPath = path.resolve(__dirname, "../../../scripts/check-admin-test-coverage.sh");

  it("script exists and is executable", () => {
    if (process.platform === "win32") return;
    expect(() => execSync(`test -x "${scriptPath}"`)).not.toThrow();
  });

  it("passes when no admin source files are changed relative to HEAD", () => {
    if (process.platform === "win32") return;
    const output = execSync(`"${scriptPath}" HEAD`, { encoding: "utf8" });
    expect(output).toContain("CI Admin Regression Test Policy Enforcer");
    expect(output.includes("No file changes detected") || output.includes("CI admin regression test policy satisfied")).toBe(true);
  });
});
