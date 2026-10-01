/**
 * env.config.test.ts — Issue #412 / #518
 *
 * Tests for env parsing and startup config validation using the live schema.
 */

import {
  envSchema,
  parseEnvConfig,
  collectEnvIssues,
  assertValidEnv,
  EnvironmentValidationError,
  SECRET_ENV_KEYS,
  redactEnvValue,
  formatConfigFingerprint,
  getEnvSpecificIssues,
} from '../config/env';

type EnvInput = Record<string, string | undefined>;

const VALID_BASE: EnvInput = {
  NODE_ENV: 'test',
  JWT_SECRET: 'a-valid-secret-that-is-at-least-32-chars-long',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/amana',
  AMANA_ESCROW_CONTRACT_ID: 'CESCROW000000000000000000000000000000000000000000000000000',
  USDC_CONTRACT_ID: 'CUSDC0000000000000000000000000000000000000000000000000000000',
  ADMIN_SECRET_KEY: 'a-valid-admin-secret-key',
};

function parseEnv(input: EnvInput) {
  return parseEnvConfig(input);
}

describe('env config — valid inputs', () => {
  it('accepts a minimal valid config', () => {
    const result = parseEnv(VALID_BASE);
    expect(result.success).toBe(true);
  });

  it('defaults PORT to 4000 when not supplied', () => {
    const result = parseEnv(VALID_BASE);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.PORT).toBe(4000);
  });

  it('accepts a custom PORT', () => {
    const result = parseEnv({ ...VALID_BASE, PORT: '8080' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.PORT).toBe(8080);
  });

  it('defaults REDIS_URL when not supplied', () => {
    const result = parseEnv(VALID_BASE);
    if (result.success) expect(result.data.REDIS_URL).toBe('redis://localhost:6379');
  });

  it('defaults JWT_EXPIRES_IN to 86400', () => {
    const result = parseEnv(VALID_BASE);
    if (result.success) expect(result.data.JWT_EXPIRES_IN).toBe('86400');
  });

  it('accepts production NODE_ENV', () => {
    const result = parseEnv({ ...VALID_BASE, NODE_ENV: 'production' });
    expect(result.success).toBe(true);
  });

  it('accepts development NODE_ENV', () => {
    const result = parseEnv({ ...VALID_BASE, NODE_ENV: 'development' });
    expect(result.success).toBe(true);
  });

  it('accepts staging NODE_ENV', () => {
    const result = parseEnv({ ...VALID_BASE, NODE_ENV: 'staging' });
    expect(result.success).toBe(true);
  });

  it('treats SUPABASE_URL as optional', () => {
    const { SUPABASE_URL: _, ...withoutSupabase } = VALID_BASE as EnvInput;
    const result = parseEnv(withoutSupabase);
    expect(result.success).toBe(true);
  });

  it('treats STELLAR_RPC_URL as optional', () => {
    const result = parseEnv({ ...VALID_BASE, STELLAR_RPC_URL: undefined });
    expect(result.success).toBe(true);
  });

  it('maps CONTRACT_ID to AMANA_ESCROW_CONTRACT_ID', () => {
    const { AMANA_ESCROW_CONTRACT_ID: _, ...withoutEscrow } = VALID_BASE;
    const result = parseEnv({
      ...withoutEscrow,
      CONTRACT_ID: 'legacy-contract-id-value-here-1234567890',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.AMANA_ESCROW_CONTRACT_ID).toBe('legacy-contract-id-value-here-1234567890');
    }
  });

  it('defaults STELLAR_NETWORK invalid values to testnet', () => {
    const result = parseEnv({ ...VALID_BASE, STELLAR_NETWORK: 'invalid' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.STELLAR_NETWORK).toBe('testnet');
  });
});

describe('env config — missing required fields', () => {
  it('fails when JWT_SECRET is absent', () => {
    const { JWT_SECRET: _, ...rest } = VALID_BASE;
    const result = parseEnv(rest);
    expect(result.success).toBe(false);
  });

  it('fails when DATABASE_URL is absent', () => {
    const { DATABASE_URL: _, ...rest } = VALID_BASE;
    const result = parseEnv(rest);
    expect(result.success).toBe(false);
  });

  it('fails when AMANA_ESCROW_CONTRACT_ID is absent', () => {
    const { AMANA_ESCROW_CONTRACT_ID: _, ...rest } = VALID_BASE;
    const result = parseEnv(rest);
    expect(result.success).toBe(false);
  });

  it('fails when USDC_CONTRACT_ID is absent', () => {
    const { USDC_CONTRACT_ID: _, ...rest } = VALID_BASE;
    const result = parseEnv(rest);
    expect(result.success).toBe(false);
  });

  it('fails when ADMIN_SECRET_KEY is absent', () => {
    const { ADMIN_SECRET_KEY: _, ...rest } = VALID_BASE;
    const result = parseEnv(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.errors.map((e: { path: (string | number)[] }) => e.path.join('.'));
      expect(paths).toContain('ADMIN_SECRET_KEY');
    }
  });

  it('fails when ADMIN_SECRET_KEY is an empty string', () => {
    const result = parseEnv({ ...VALID_BASE, ADMIN_SECRET_KEY: '' });
    expect(result.success).toBe(false);
  });
});

describe('env config — invalid formats', () => {
  it('fails when JWT_SECRET is shorter than 32 characters', () => {
    const result = parseEnv({ ...VALID_BASE, JWT_SECRET: 'too-short' });
    expect(result.success).toBe(false);
  });

  it('fails when NODE_ENV is an unexpected value', () => {
    const result = parseEnv({ ...VALID_BASE, NODE_ENV: 'qa' });
    expect(result.success).toBe(false);
  });

  it('fails when PORT is not a number string', () => {
    const result = parseEnv({ ...VALID_BASE, PORT: 'not-a-number' });
    expect(result.success).toBe(false);
  });

  it('fails when AMANA_ESCROW_CONTRACT_ID is an empty string', () => {
    const result = parseEnv({ ...VALID_BASE, AMANA_ESCROW_CONTRACT_ID: '' });
    expect(result.success).toBe(false);
  });

  it('coerces PORT "3000" to number 3000', () => {
    const result = parseEnv({ ...VALID_BASE, PORT: '3000' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.PORT).toBe(3000);
  });

  it('coerces EVIDENCE_SCAN_REQUIRED to boolean', () => {
    const result = parseEnv({ ...VALID_BASE, EVIDENCE_SCAN_REQUIRED: 'true' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.EVIDENCE_SCAN_REQUIRED).toBe(true);
  });
});

describe('env config — optional fields absent or malformed', () => {
  it('accepts config with all optional fields absent', () => {
    const minimal: EnvInput = {
      JWT_SECRET: 'a-valid-secret-that-is-at-least-32-chars-long',
      DATABASE_URL: 'postgresql://localhost:5432/amana',
      AMANA_ESCROW_CONTRACT_ID: 'CESCROW',
      USDC_CONTRACT_ID: 'CUSDC',
      ADMIN_SECRET_KEY: 'a-valid-admin-secret-key',
    };
    const result = parseEnv(minimal);
    expect(result.success).toBe(true);
  });

  it('provides stable error messages when required fields are missing', () => {
    const { JWT_SECRET: _, DATABASE_URL: __, ...rest } = VALID_BASE;
    const result = parseEnv(rest);
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.errors.map((e: { path: (string | number)[] }) => e.path.join('.'));
      expect(paths).toContain('JWT_SECRET');
      expect(paths).toContain('DATABASE_URL');
    }
  });

  it('exports envSchema for coverage checks', () => {
    expect(envSchema).toBeDefined();
  });
});

describe('env config — aggregated boot validation (multi-error report)', () => {
  it('reports ALL missing required variables, not just the first', () => {
    const {
      JWT_SECRET: _,
      DATABASE_URL: __,
      AMANA_ESCROW_CONTRACT_ID: ___,
      USDC_CONTRACT_ID: ____,
      ADMIN_SECRET_KEY: _____,
      ...rest
    } = VALID_BASE;
    const issues = collectEnvIssues(rest);
    const keys = issues.map((i) => i.key);
    expect(keys).toContain('JWT_SECRET');
    expect(keys).toContain('DATABASE_URL');
    expect(keys).toContain('AMANA_ESCROW_CONTRACT_ID');
    expect(keys).toContain('USDC_CONTRACT_ID');
    expect(keys).toContain('ADMIN_SECRET_KEY');
    expect(issues.length).toBeGreaterThanOrEqual(5);
  });

  it('throws an EnvironmentValidationError carrying every issue', () => {
    const {
      JWT_SECRET: _,
      DATABASE_URL: __,
      USDC_CONTRACT_ID: ___,
      AMANA_ESCROW_CONTRACT_ID: ____,
      ...rest
    } = VALID_BASE;
    expect(() => assertValidEnv(rest)).toThrow(EnvironmentValidationError);
    try {
      assertValidEnv(rest);
      throw new Error('should not reach here');
    } catch (err) {
      if (err instanceof EnvironmentValidationError) {
        const keys = err.issues.map((i) => i.key);
        expect(keys).toContain('JWT_SECRET');
        expect(keys).toContain('DATABASE_URL');
        expect(keys).toContain('USDC_CONTRACT_ID');
        expect(keys).toContain('AMANA_ESCROW_CONTRACT_ID');
      }
    }
  });

  it('does not throw when the config is valid', () => {
    expect(() => assertValidEnv(VALID_BASE)).not.toThrow();
  });
});

describe('env config — every required variable absence/bad-shape', () => {
  const REQUIRED: Array<[string, EnvInput]> = [
    ['JWT_SECRET', {}],
    ['DATABASE_URL', {}],
    ['AMANA_ESCROW_CONTRACT_ID', {}],
    ['USDC_CONTRACT_ID', {}],
    ['ADMIN_SECRET_KEY', {}],
  ];

  for (const [key] of REQUIRED) {
    it(`fails when ${key} is absent`, () => {
      const { [key]: _, ...rest } = VALID_BASE;
      const issues = collectEnvIssues(rest);
      expect(issues.map((i) => i.key)).toContain(key);
    });

    it(`fails when ${key} is an empty string`, () => {
      const issues = collectEnvIssues({ ...VALID_BASE, [key]: '' });
      expect(issues.map((i) => i.key)).toContain(key);
    });
  }

  it('fails on empty-string AMANA_ESCROW_CONTRACT_ID', () => {
    expect(parseEnv({ ...VALID_BASE, AMANA_ESCROW_CONTRACT_ID: '' }).success).toBe(false);
  });

  it('fails on empty-string USDC_CONTRACT_ID', () => {
    expect(parseEnv({ ...VALID_BASE, USDC_CONTRACT_ID: '' }).success).toBe(false);
  });

  it('fails when ADMIN_SECRET_KEY is empty', () => {
    expect(parseEnv({ ...VALID_BASE, ADMIN_SECRET_KEY: '' }).success).toBe(false);
  });
});

describe('env config — typed bad-shape paths', () => {
  it('fails when PORT is non-numeric', () => {
    const issues = collectEnvIssues({ ...VALID_BASE, PORT: 'not-a-port' });
    expect(issues.map((i) => i.key)).toContain('PORT');
  });

  it('fails when TRACE_BASELINE_RATE is out of [0,1]', () => {
    const issues = collectEnvIssues({ ...VALID_BASE, TRACE_BASELINE_RATE: '2.5' });
    expect(issues.map((i) => i.key)).toContain('TRACE_BASELINE_RATE');
  });

  it('fails when QUOTE_MAX_SLIPPAGE_BPS exceeds 10000', () => {
    const issues = collectEnvIssues({ ...VALID_BASE, QUOTE_MAX_SLIPPAGE_BPS: '99999' });
    expect(issues.map((i) => i.key)).toContain('QUOTE_MAX_SLIPPAGE_BPS');
  });

  it('fails when IPFS_URL_TTL_SECONDS is over the max', () => {
    const issues = collectEnvIssues({ ...VALID_BASE, IPFS_URL_TTL_SECONDS: '99999' });
    expect(issues.map((i) => i.key)).toContain('IPFS_URL_TTL_SECONDS');
  });

  it('fails when WEBHOOK_URL is malformed', () => {
    const issues = collectEnvIssues({ ...VALID_BASE, WEBHOOK_URL: 'not-a-url' });
    expect(issues.map((i) => i.key)).toContain('WEBHOOK_URL');
  });

  it('fails when NODE_ENV is an unexpected value', () => {
    const issues = collectEnvIssues({ ...VALID_BASE, NODE_ENV: 'qa' });
    expect(issues.map((i) => i.key)).toContain('NODE_ENV');
  });
});

describe('env config — environment-specific requirements', () => {
  it('rejects production without a tracing backend', () => {
    const issues = getEnvSpecificIssues({
      ...VALID_BASE,
      NODE_ENV: 'production',
    });
    expect(issues.map((i) => i.key)).toContain('JAEGER_ENDPOINT');
  });

  it('accepts production when a tracing backend is configured', () => {
    const issues = getEnvSpecificIssues({
      ...VALID_BASE,
      NODE_ENV: 'production',
      JAEGER_ENDPOINT: 'http://jaeger:14268/api/traces',
    });
    expect(issues.map((i) => i.key)).not.toContain('JAEGER_ENDPOINT');
  });

  it('accepts production when an OTEL exporter is configured', () => {
    const issues = getEnvSpecificIssues({
      ...VALID_BASE,
      NODE_ENV: 'production',
      OTEL_EXPORTER_JAEGER_AGENT_HOST: 'jaeger-agent',
    });
    expect(issues.map((i) => i.key)).not.toContain('JAEGER_ENDPOINT');
  });

  it('does not require a tracing backend outside production', () => {
    const issues = getEnvSpecificIssues({ ...VALID_BASE, NODE_ENV: 'development' });
    expect(issues.map((i) => i.key)).not.toContain('JAEGER_ENDPOINT');
  });
});

describe('env config — secret redaction (no secret in diagnostics)', () => {
  it('redacts every secret key', () => {
    for (const key of SECRET_ENV_KEYS) {
      expect(redactEnvValue(key, 'super-secret-value')).toBe('***REDACTED***');
    }
  });

  it('does not redact non-secret keys', () => {
    expect(redactEnvValue('PORT', '4000')).toBe('4000');
    expect(redactEnvValue('STELLAR_RPC_URL', 'https://rpc.example.com')).toBe('https://rpc.example.com');
  });

  it('aggregated report never leaks a secret value (grep check)', () => {
    const secret = 'ULTRASECRET_VALUE_987654321';
    const issues = collectEnvIssues({
      ...VALID_BASE,
      JWT_SECRET: 'short', // violates min length — error message references value
      ADMIN_SECRET_KEY: '',
      WEBHOOK_SECRET: secret,
      ALERT_WEBHOOK_SECRET: secret,
      PINATA_JWT: secret,
      IPFS_URL_SIGNING_SECRET: 'x', // violates min length
    });

    const reportText = JSON.stringify(issues) + issues.map((i) => i.message).join(' ');
    expect(reportText).not.toContain(secret);
    expect(reportText).not.toContain('ULTRASECRET');
  });

  it('redacts secrets in the config fingerprint', () => {
    const fp = formatConfigFingerprint({
      ...VALID_BASE,
      PORT: '4000',
      JWT_SECRET: 'a-really-secret-jwt-value-that-is-long-enough-123456789',
      ADMIN_SECRET_KEY: 'admin-secret',
    });
    expect(fp.JWT_SECRET).toBe('***REDACTED***');
    expect(fp.ADMIN_SECRET_KEY).toBe('***REDACTED***');
    expect(fp.PORT).toBe('4000');
  });

  it('EnvIssue value field never holds an unfiltered secret (grep check)', () => {
    const secret = 'TOP_SECRET_PINATA_KEY';
    const issues = collectEnvIssues({ ...VALID_BASE, PINATA_SECRET: secret });
    const values = issues.map((i) => i.value).join(' ');
    expect(values).not.toContain(secret);
  });
});

describe('env config — config fingerprint', () => {
  it('marks missing vars as (empty)', () => {
    const fp = formatConfigFingerprint({ ...VALID_BASE, PORT: undefined });
    expect(fp.PORT).toBe('(empty)');
  });

  it('reports non-secret values literally', () => {
    const fp = formatConfigFingerprint({
      ...VALID_BASE,
      STELLAR_RPC_URL: 'https://rpc.example.com',
    });
    expect(fp.STELLAR_RPC_URL).toBe('https://rpc.example.com');
  });

  it('only includes keys defined in the schema', () => {
    const fp = formatConfigFingerprint({ ...VALID_BASE, SOME_UNDEFINED_VAR: 'x' } as EnvInput);
    expect(Object.keys(fp)).not.toContain('SOME_UNDEFINED_VAR');
  });
});
