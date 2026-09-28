describe("sms.service", () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
    delete process.env.AFRICAS_TALKING_API_KEY;
    delete process.env.AFRICAS_TALKING_USERNAME;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  it("isSmsConfigured is false without credentials", async () => {
    const { isSmsConfigured } = await import("../services/sms.service");
    expect(isSmsConfigured()).toBe(false);
  });

  it("sendSms no-ops (does not throw) when unconfigured", async () => {
    const { sendSms } = await import("../services/sms.service");
    const result = await sendSms("+2348012345678", "hello");
    expect(result).toEqual({ sent: false, reason: "not_configured" });
  });

  it("isSmsConfigured is true once both credentials are set", async () => {
    process.env.AFRICAS_TALKING_API_KEY = "key";
    process.env.AFRICAS_TALKING_USERNAME = "user";
    const { isSmsConfigured } = await import("../services/sms.service");
    expect(isSmsConfigured()).toBe(true);
  });

  it("sendSms posts to the Africa's Talking API when configured", async () => {
    process.env.AFRICAS_TALKING_API_KEY = "key";
    process.env.AFRICAS_TALKING_USERNAME = "user";

    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        SMSMessageData: { Recipients: [{ status: "Success", statusCode: 101 }] },
      }),
    });
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

    const { sendSms } = await import("../services/sms.service");
    const result = await sendSms("+2348012345678", "Trade Expired: Trade T-1 has expired.");

    expect(result).toEqual({ sent: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.africastalking.com/version1/messaging",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
