import {
  SupabaseTradeSearchIndex,
  TRADE_SEARCH_MAX_RESULTS,
  buildTradeSearchText,
  normalizeTradeSearchQuery,
} from "../tradeSearch.service";
import { getSupabaseClient } from "../../lib/supabase";
import { appLogger } from "../../middleware/logger";

jest.mock("../../lib/supabase", () => ({ getSupabaseClient: jest.fn() }));
jest.mock("../../middleware/logger", () => ({
  appLogger: { warn: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

const mockGetClient = getSupabaseClient as jest.MockedFunction<
  typeof getSupabaseClient
>;

/**
 * Minimal PostgREST builder double. Supabase queries are thenable chains, so
 * the double records the chain and resolves to `result` when awaited.
 */
function makeBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, jest.Mock> & { then?: unknown } = {
    select: jest.fn(() => builder),
    textSearch: jest.fn(() => builder),
    limit: jest.fn(() => builder),
    upsert: jest.fn(() => builder),
    in: jest.fn(() => builder),
    eq: jest.fn(() => builder),
  };
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return builder;
}

function clientReturning(builders: Record<string, ReturnType<typeof makeBuilder>>) {
  return {
    from: jest.fn((table: string) => {
      const builder = builders[table];
      if (!builder) throw new Error(`unexpected table ${table}`);
      return builder;
    }),
  } as unknown as ReturnType<typeof getSupabaseClient>;
}

describe("normalizeTradeSearchQuery", () => {
  it("collapses whitespace, strips control characters and trims", () => {
    expect(normalizeTradeSearchQuery("  maize\t\n  seller  ")).toBe("maize seller");
    expect(normalizeTradeSearchQuery("a\u0000b")).toBe("a b");
  });

  it("caps the query at 100 characters", () => {
    expect(normalizeTradeSearchQuery("x".repeat(250))).toHaveLength(100);
  });

  it("keeps websearch operators so users can express phrases", () => {
    expect(normalizeTradeSearchQuery('"yellow maize" -bad')).toBe('"yellow maize" -bad');
  });
});

describe("buildTradeSearchText", () => {
  it("joins the commodity and counterparty names, skipping empties", () => {
    expect(buildTradeSearchText("Maize", "Ada", "Bola")).toBe("Maize Ada Bola");
    expect(buildTradeSearchText(null, null, null)).toBe("");
    expect(buildTradeSearchText("Rice", undefined, "Bola")).toBe("Rice Bola");
  });
});

describe("SupabaseTradeSearchIndex.searchTradeIds", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("queries the tsvector column with a websearch tsquery", async () => {
    const builder = makeBuilder({
      data: [{ trade_id: "T1" }, { trade_id: "T2" }],
      error: null,
    });
    mockGetClient.mockReturnValue(clientReturning({ trade_search: builder }));

    const ids = await new SupabaseTradeSearchIndex().searchTradeIds("maize");

    expect(ids).toEqual(["T1", "T2"]);
    expect(builder.textSearch).toHaveBeenCalledWith("search_vector", "maize", {
      config: "english",
      type: "websearch",
    });
    expect(builder.limit).toHaveBeenCalledWith(TRADE_SEARCH_MAX_RESULTS);
  });

  it("returns [] without querying for a blank query", async () => {
    const ids = await new SupabaseTradeSearchIndex().searchTradeIds("   ");
    expect(ids).toEqual([]);
    expect(mockGetClient).not.toHaveBeenCalled();
  });

  it("returns null when Supabase reports an error so the caller can fall back", async () => {
    const builder = makeBuilder({ data: null, error: { message: "boom" } });
    mockGetClient.mockReturnValue(clientReturning({ trade_search: builder }));

    await expect(
      new SupabaseTradeSearchIndex().searchTradeIds("maize"),
    ).resolves.toBeNull();
    expect(appLogger.warn).toHaveBeenCalled();
  });

  it("returns null when Supabase is not configured", async () => {
    mockGetClient.mockImplementation(() => {
      throw new Error("Supabase is not configured");
    });

    await expect(
      new SupabaseTradeSearchIndex().searchTradeIds("maize"),
    ).resolves.toBeNull();
  });
});

describe("SupabaseTradeSearchIndex.indexTrade", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("upserts one document with display names copied from users", async () => {
    const users = makeBuilder({
      data: [
        { address: "gbuyer", display_name: "Ada Buyer" },
        { address: "gseller", display_name: "Bola Seller" },
      ],
      error: null,
    });
    const tradeSearch = makeBuilder({ data: null, error: null });
    mockGetClient.mockReturnValue(
      clientReturning({ users, trade_search: tradeSearch }),
    );

    await new SupabaseTradeSearchIndex().indexTrade({
      tradeId: "T1",
      buyerAddress: "GBUYER",
      sellerAddress: "GSeller",
      commodity: "Maize",
    });

    expect(users.in).toHaveBeenCalledWith("address", ["gbuyer", "gseller"]);
    expect(tradeSearch.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        trade_id: "T1",
        buyer_address: "gbuyer",
        seller_address: "gseller",
        commodity: "Maize",
        buyer_name: "Ada Buyer",
        seller_name: "Bola Seller",
        search_vector: "Maize Ada Buyer Bola Seller",
      }),
      { onConflict: "trade_id" },
    );
  });

  it("never throws when the index is unavailable", async () => {
    mockGetClient.mockImplementation(() => {
      throw new Error("not configured");
    });

    await expect(
      new SupabaseTradeSearchIndex().indexTrade({
        tradeId: "T1",
        buyerAddress: "GBUYER",
        sellerAddress: "GSELLER",
      }),
    ).resolves.toBeUndefined();
    expect(appLogger.warn).toHaveBeenCalled();
  });
});
