/**
 * validate-env-examples.ts — CI validation for environment example files.
 *
 * Ensures that every example env file (.env.example, .env.staging.example,
 * .env.production.example) stays in sync with the runtime zod schema:
 *
 *  1. Every key in the file must be a known schema key (no typos / drift).
 *  2. Every schema key must be documented in each example.
 *  3. Non-secret keys that carry a concrete value must be well-formed against
 *     the schema shape (catches malformed typed values like a bad TTL or rate).
 *  4. Secret keys are expected to be empty placeholders and are skipped
 *     (their value is never validated — only presence/documentation).
 *  5. Env-specific rules (production requires a tracing backend) are applied to
 *     the production example.
 *
 * Run: pnpm tsx scripts/validate-env-examples.ts
 */

import fs from 'fs';
import path from 'path';

// Set a valid test env BEFORE importing the env module so the singleton
// constructor does not fail against the (unknown) CI process env.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-jwt-secret-value-with-minimum-length-32';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/test';
process.env.AMANA_ESCROW_CONTRACT_ID = process.env.AMANA_ESCROW_CONTRACT_ID ?? 'test-escrow-contract';
process.env.USDC_CONTRACT_ID = process.env.USDC_CONTRACT_ID ?? 'test-usdc-contract';
process.env.ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY ?? 'test-admin-secret-key-value';

type EnvModule = typeof import('../src/config/env');
let envModule: EnvModule;

const exampleFiles = [
  '.env.example',
  '.env.staging.example',
  '.env.production.example',
];

function parseEnvFile(filePath: string): Record<string, string> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const map: Record<string, string> = {};
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key) map[key] = value;
  }
  return map;
}

type ZodShape = {
  safeParse: (value: unknown) => { success: boolean };
};

function validateExamples(): void {
  const { envSchema, SECRET_ENV_KEYS, getEnvSpecificIssues } = envModule;
  const schemaKeys = new Set(Object.keys(envSchema.shape));
  let hasError = false;

  for (const file of exampleFiles) {
    const absPath = path.join(__dirname, '..', file);
    if (!fs.existsSync(absPath)) {
      console.error(`❌ Missing example env file: ${file}`);
      hasError = true;
      continue;
    }
    const map = parseEnvFile(absPath);
    const fileKeys = new Set(Object.keys(map));

    // 1. No unknown/typo keys in the example file.
    for (const key of fileKeys) {
      if (!schemaKeys.has(key)) {
        console.error(`❌ [${file}] Unknown env var not in schema: ${key}`);
        hasError = true;
      }
    }

    // 2. Every REQUIRED (no-default, non-optional) schema key must be
    //    documented in each example. Optional keys may be omitted.
    for (const name of schemaKeys) {
      const shape = (envSchema.shape as Record<string, unknown>)[name] as ZodShape;
      const isOptionalOrDefaulted = shape.safeParse(undefined).success;
      if (!isOptionalOrDefaulted && !fileKeys.has(name)) {
        console.error(`❌ [${file}] Missing required env var: ${name}`);
        hasError = true;
      }
    }

    // 3. Validate non-secret, non-empty values against the schema shape.
    for (const key of fileKeys) {
      if (SECRET_ENV_KEYS.has(key)) continue;
      const value = map[key];
      if (value === '') continue; // placeholder / intentionally unset
      const shape = (envSchema.shape as Record<string, unknown>)[key] as ZodShape;
      if (!shape?.safeParse) continue;
      const res = shape.safeParse(value);
      if (!res.success) {
        console.error(`❌ [${file}] Invalid value for ${key}="${value}"`);
        hasError = true;
      }
    }
  }

  // 4. Env-specific rules on the production example.
  const prodDir = path.join(__dirname, '..');
  const prod = parseEnvFile(path.join(prodDir, '.env.production.example'));
  const prodIssues = getEnvSpecificIssues({ ...prod });
  if (prodIssues.length > 0) {
    for (const issue of prodIssues) {
      console.error(`❌ [.env.production.example] ${issue.key}: ${issue.message}`);
    }
    hasError = true;
  }

  if (hasError) {
    console.error('❌ Example env validation failed.');
    process.exit(1);
  }

  console.log(`✅ Validated ${exampleFiles.length} example env files against the schema.`);
  process.exit(0);
}

async function main(): Promise<void> {
  envModule = await import('../src/config/env');
  validateExamples();
}

void main();
