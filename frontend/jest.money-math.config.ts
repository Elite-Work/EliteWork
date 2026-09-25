import type { Config } from "jest";
import nextJest from "next/jest.js";

const createJestConfig = nextJest({
  dir: "./",
});

/**
 * The money-math fixture lives beside the frontend rather than under its
 * source tree. Keep a small, dedicated config so CI can execute that shared
 * TypeScript/Jest test without broadening the frontend's normal test scope.
 */
const config: Config = {
  rootDir: "..",
  testEnvironment: "node",
  testMatch: ["<rootDir>/shared-test-fixtures/__tests__/money_math_parity.test.ts"],
  testPathIgnorePatterns: ["<rootDir>/frontend/tests/", "<rootDir>/node_modules/"],
  setupFilesAfterEnv: [],
};

export default createJestConfig(config);
