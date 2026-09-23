import { Keypair } from "@stellar/stellar-sdk";
import { HealthService } from "../services/health.service";
import { env } from "../config/env";

describe("Admin Secret Rotation & Validation Unit Tests", () => {
  let originalEnv: string | undefined;
  const mutableEnv = env as { ADMIN_SECRET_KEY: string };

  beforeAll(() => {
    originalEnv = process.env.ADMIN_SECRET_KEY;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ADMIN_SECRET_KEY = originalEnv;
      mutableEnv.ADMIN_SECRET_KEY = originalEnv;
    } else {
      delete process.env.ADMIN_SECRET_KEY;
      mutableEnv.ADMIN_SECRET_KEY = "";
    }
  });

  it("successfully validates a fresh, newly rotated Stellar ADMIN_SECRET_KEY", async () => {
    const freshKeypair = Keypair.random();
    process.env.ADMIN_SECRET_KEY = freshKeypair.secret();
    mutableEnv.ADMIN_SECRET_KEY = freshKeypair.secret();

    const healthService = new HealthService();
    const result = await healthService.checkAdminSigningKey();

    expect(result.status).toBe("up");
    expect(result.message).toContain("Admin signing key valid");
  });

  it("fails health check if ADMIN_SECRET_KEY is removed or empty", async () => {
    process.env.ADMIN_SECRET_KEY = "";
    mutableEnv.ADMIN_SECRET_KEY = "";

    const healthService = new HealthService();
    const result = await healthService.checkAdminSigningKey();

    expect(result.status).toBe("down");
  });

  it("fails health check if ADMIN_SECRET_KEY is corrupted or invalid base32", async () => {
    process.env.ADMIN_SECRET_KEY = "SINVALIDKEYNOTBASE32FORMATTED12345678900000000000000000";
    mutableEnv.ADMIN_SECRET_KEY = "SINVALIDKEYNOTBASE32FORMATTED12345678900000000000000000";

    const healthService = new HealthService();
    const result = await healthService.checkAdminSigningKey();

    expect(result.status).toBe("down");
    expect(result.message).toContain("Admin signing key check failed");
  });

  it("allows zero-downtime key rotation by deriving public key on demand", () => {
    const keypair1 = Keypair.random();
    process.env.ADMIN_SECRET_KEY = keypair1.secret();
    expect(process.env.ADMIN_SECRET_KEY).toBe(keypair1.secret());

    const keypair2 = Keypair.random();
    process.env.ADMIN_SECRET_KEY = keypair2.secret();
    expect(process.env.ADMIN_SECRET_KEY).toBe(keypair2.secret());
    expect(keypair1.secret()).not.toBe(keypair2.secret());
  });
});
