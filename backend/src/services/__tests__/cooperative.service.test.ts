import { CooperativeService, cooperativeService } from "../cooperative.service";

describe("CooperativeService (Issue #494)", () => {
  beforeEach(() => {
    CooperativeService.clearPilotRegistrations();
  });

  it("registers a pilot cooperative record with trial-period flag", async () => {
    const input = {
      name: "Northern Farmers Coop",
      adminWallet: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVWGS",
      contactEmail: "admin@northernfarmers.org",
      region: "Kaduna",
      description: "Regional agricultural grain producers cooperative",
      estimatedMembers: 120,
    };

    const record = await cooperativeService.registerPilotCooperative(input);

    expect(record.id).toMatch(/^coop-pilot-/);
    expect(record.name).toBe(input.name);
    expect(record.adminWallet).toBe(input.adminWallet.toLowerCase());
    expect(record.contactEmail).toBe(input.contactEmail.toLowerCase());
    expect(record.region).toBe(input.region);
    expect(record.trialPeriod).toBe(true);
    expect(record.isTrialPeriod).toBe(true);
    expect(record.trialDays).toBe(90);
    expect(record.status).toBe("ACTIVE");
    expect(new Date(record.trialEndsAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("throws validation error for empty fields", async () => {
    await expect(
      cooperativeService.registerPilotCooperative({
        name: "",
        adminWallet: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVWGS",
        contactEmail: "test@example.com",
        region: "Kano",
      }),
    ).rejects.toThrow(/Cooperative name is required/);

    await expect(
      cooperativeService.registerPilotCooperative({
        name: "Test Coop",
        adminWallet: "",
        contactEmail: "test@example.com",
        region: "Kano",
      }),
    ).rejects.toThrow(/Admin wallet address is required/);

    await expect(
      cooperativeService.registerPilotCooperative({
        name: "Test Coop",
        adminWallet: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVWGS",
        contactEmail: "invalid-email",
        region: "Kano",
      }),
    ).rejects.toThrow(/Valid contact email is required/);
  });

  it("retrieves and lists pilot cooperatives", async () => {
    const r1 = await cooperativeService.registerPilotCooperative({
      name: "Coop 1",
      adminWallet: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVWGS",
      contactEmail: "c1@example.com",
      region: "Region 1",
    });

    const retrieved = await cooperativeService.getPilotCooperative(r1.id);
    expect(retrieved).toEqual(r1);

    const list = await cooperativeService.listPilotCooperatives();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(r1.id);
  });
});
