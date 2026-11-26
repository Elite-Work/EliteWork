import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = resolve(root, "scripts/check-contract-abi-drift.mjs");

describe("check-contract-abi-drift.mjs", () => {
  it("passes when the canonical event schema and generated outputs are current", () => {
    const output = execFileSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
    });

    expect(output).toContain("codegen-events:");
    expect(output).toContain("OK");
  });
});
