import { tradesApi } from "../trades";

const BASE = "http://localhost:4000/api/v1";
const TOKEN = "test-token";

function mockFetchOnce(body: unknown, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: "OK",
    json: async () => body,
  }) as unknown as typeof fetch;
}

function lastCall() {
  const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
  return { url, options };
}

describe("tradesApi consumer contract", () => {
  it("list: GET /trades with filters and bearer token", async () => {
    mockFetchOnce({ items: [], pagination: { page: 2, limit: 10, total: 0, totalPages: 0 } });

    const result = await tradesApi.list(TOKEN, { status: "FUNDED", page: 2, limit: 10, q: "cocoa" });

    const { url, options } = lastCall();
    expect(url).toBe(`${BASE}/trades?status=FUNDED&page=2&limit=10&q=cocoa`);
    expect(options.method).toBeUndefined();
    expect(options.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(result).toHaveProperty("items");
    expect(result).toHaveProperty("pagination");
  });

  it("get: GET /trades/:id", async () => {
    mockFetchOnce({ tradeId: "42", status: "CREATED" });

    const result = await tradesApi.get(TOKEN, "42");

    const { url, options } = lastCall();
    expect(url).toBe(`${BASE}/trades/42`);
    expect(options.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(result).toMatchObject({ tradeId: "42", status: "CREATED" });
  });

  it("getStats: GET /trades/stats", async () => {
    mockFetchOnce({ totalTrades: 1, totalVolume: 100, openTrades: 1 });

    await tradesApi.getStats(TOKEN);

    expect(lastCall().url).toBe(`${BASE}/trades/stats`);
  });

  it("create: POST /trades with JSON body and idempotency headers", async () => {
    mockFetchOnce({ tradeId: "42", unsignedXdr: "AAAA" }, 201);
    const payload = {
      sellerAddress: "GSELLER",
      amountUsdc: "100.00",
      buyerLossBps: 5000,
      sellerLossBps: 5000,
    };

    const result = await tradesApi.create(TOKEN, payload as never, {
      idempotencyKey: "key-1",
      correlationId: "corr-1",
    });

    const { url, options } = lastCall();
    expect(url).toBe(`${BASE}/trades`);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual(payload);
    expect(options.headers["Idempotency-Key"]).toBe("key-1");
    expect(options.headers["X-Correlation-Id"]).toBe("corr-1");
    expect(result).toHaveProperty("unsignedXdr");
  });

  it.each([
    ["deposit", "deposit"],
    ["confirmDelivery", "confirm"],
    ["releaseFunds", "release"],
  ] as const)("%s: POST /trades/:id/%s returns unsignedXdr", async (method, path) => {
    mockFetchOnce({ unsignedXdr: "AAAA" });

    const result = await tradesApi[method](TOKEN, "42");

    const { url, options } = lastCall();
    expect(url).toBe(`${BASE}/trades/42/${path}`);
    expect(options.method).toBe("POST");
    expect(result).toEqual({ unsignedXdr: "AAAA" });
  });

  it("initiateDispute: POST /trades/:id/dispute with reason and category", async () => {
    mockFetchOnce({ unsignedXdr: "AAAA" });

    await tradesApi.initiateDispute(TOKEN, "42", "Not delivered", "delivery_issue");

    const { url, options } = lastCall();
    expect(url).toBe(`${BASE}/trades/42/dispute`);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toEqual({ reason: "Not delivered", category: "delivery_issue" });
  });

  it("surfaces backend errors as ApiError with status", async () => {
    mockFetchOnce({ error: "Trade not found" }, 404);

    await expect(tradesApi.get(TOKEN, "missing")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      message: "Trade not found",
    });
  });
});
