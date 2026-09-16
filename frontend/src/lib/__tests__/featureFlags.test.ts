import { FLAG_CATALOG, getFeatureFlags, isAdminUIEnabled, isFeatureEnabled } from "../featureFlags";

describe("Feature Flags", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe("getFeatureFlags", () => {
    it("returns all feature flags", () => {
      const flags = getFeatureFlags();
      expect(flags).toHaveProperty("adminUI");
    });

    it("defaults adminUI to false when env var is not set", () => {
      delete process.env.NEXT_PUBLIC_ENABLE_ADMIN_UI;
      const flags = getFeatureFlags();
      expect(flags.adminUI).toBe(false);
    });

    it("sets adminUI to true when env var is 'true'", () => {
      process.env.NEXT_PUBLIC_ENABLE_ADMIN_UI = "true";
      const flags = getFeatureFlags();
      expect(flags.adminUI).toBe(true);
    });

    it("sets adminUI to false when env var is 'false'", () => {
      process.env.NEXT_PUBLIC_ENABLE_ADMIN_UI = "false";
      const flags = getFeatureFlags();
      expect(flags.adminUI).toBe(false);
    });

    it("sets adminUI to false for any non-'true' value", () => {
      const testValues = ["1", "yes", "TRUE", "True", "enabled", ""];
      
      testValues.forEach((value) => {
        process.env.NEXT_PUBLIC_ENABLE_ADMIN_UI = value;
        const flags = getFeatureFlags();
        expect(flags.adminUI).toBe(false);
      });
    });
  });

  describe("isAdminUIEnabled", () => {
    it("returns false when admin UI is disabled", () => {
      process.env.NEXT_PUBLIC_ENABLE_ADMIN_UI = "false";
      expect(isAdminUIEnabled()).toBe(false);
    });

    it("returns true when admin UI is enabled", () => {
      process.env.NEXT_PUBLIC_ENABLE_ADMIN_UI = "true";
      expect(isAdminUIEnabled()).toBe(true);
    });

    it("returns false by default", () => {
      delete process.env.NEXT_PUBLIC_ENABLE_ADMIN_UI;
      expect(isAdminUIEnabled()).toBe(false);
    });
  });

  describe("isFeatureEnabled", () => {
    it("returns correct value for adminUI feature", () => {
      process.env.NEXT_PUBLIC_ENABLE_ADMIN_UI = "true";
      expect(isFeatureEnabled("adminUI")).toBe(true);
    });

    it("returns false for disabled feature", () => {
      process.env.NEXT_PUBLIC_ENABLE_ADMIN_UI = "false";
      expect(isFeatureEnabled("adminUI")).toBe(false);
    });
  });

  describe("Safety - defaults match the catalog", () => {
    it("resolves each flag to its FLAG_CATALOG default when no env vars are set", () => {
      // Clear every flag's env override so only the catalog defaults apply.
      delete process.env.NEXT_PUBLIC_ENABLE_ADMIN_UI;
      delete process.env.NEXT_PUBLIC_ENABLE_CLAWBACK_UI;
      delete process.env.NEXT_PUBLIC_ENABLE_ADVANCED_REPORTING;
      delete process.env.NEXT_PUBLIC_DISABLE_OFFLINE_BANNER;
      delete process.env.NEXT_PUBLIC_ENABLE_TRADE_WIZARD_V2;

      const flags = getFeatureFlags();

      // UI-facing flags default to off; kill-switch flags (like
      // offlineBanner) default to on — both are safe, intentional defaults
      // per FLAG_CATALOG, not a blanket "everything is false" rule.
      expect(flags).toEqual(FLAG_CATALOG);
    });
  });
});
