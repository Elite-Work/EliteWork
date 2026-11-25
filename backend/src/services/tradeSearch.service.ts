import { getSupabaseClient } from "../lib/supabase";
import { appLogger } from "../middleware/logger";

/**
 * Supabase-backed full-text search index for trades (issue #504).
 *
 * `trade_search` is a denormalised PostgREST table with a `tsvector` column
 * built from the commodity label and the two counterparty display names, so a
 * single websearch tsquery covers "search by commodity or counterparty".
 * The table is created by
 * `supabase/migrations/20261120000000_create_trade_search_index.sql` and is
 * written by {@link TradeSearchIndex.indexTrade} when a trade is created.
 */

/** Maximum accepted search string length (matches the `q` query validation). */
export const TRADE_SEARCH_QUERY_MAX_LENGTH = 100;

/** Upper bound on ids returned by one search; the list endpoint pages below this. */
export const TRADE_SEARCH_MAX_RESULTS = 500;

const TRADE_SEARCH_TABLE = "trade_search";
const USERS_TABLE = "users";

export interface TradeSearchDocument {
  tradeId: string;
  buyerAddress: string;
  sellerAddress: string;
  commodity?: string | null;
}

export interface TradeSearchIndex {
  /**
   * Resolve a free-text query to matching trade ids.
   *
   * Returns `null` — not an empty array — when the index is unavailable
   * (Supabase not configured, network/auth failure) so the caller can fall back
   * to a database-side substring filter instead of silently reporting "no
   * results". An empty array means the index is reachable and nothing matched.
   */
  searchTradeIds(query: string): Promise<string[] | null>;

  /** Create or replace the search document for one trade. Never throws. */
  indexTrade(document: TradeSearchDocument): Promise<void>;
}

/**
 * Normalise a raw `q` value into something safe to hand to
 * `websearch_to_tsquery`: strip control characters, collapse whitespace and
 * cap the length. Unlike a hand-rolled `to_tsquery` builder this deliberately
 * keeps quotes/`-`/`or`, which `websearch_to_tsquery` interprets as user-facing
 * search syntax rather than as SQL.
 */
export function normalizeTradeSearchQuery(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TRADE_SEARCH_QUERY_MAX_LENGTH);
}

/** Build the tsvector payload the SQL `search_vector` column is derived from. */
export function buildTradeSearchText(
  commodity: string | null | undefined,
  buyerName: string | null | undefined,
  sellerName: string | null | undefined,
): string {
  return [commodity, buyerName, sellerName].filter(Boolean).join(" ");
}

export class SupabaseTradeSearchIndex implements TradeSearchIndex {
  public async searchTradeIds(query: string): Promise<string[] | null> {
    const normalized = normalizeTradeSearchQuery(query);
    if (!normalized) return [];

    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from(TRADE_SEARCH_TABLE)
        .select("trade_id")
        .textSearch("search_vector", normalized, {
          config: "english",
          type: "websearch",
        })
        .limit(TRADE_SEARCH_MAX_RESULTS);

      if (error) {
        appLogger.warn(
          { error, operation: "trade_search_query" },
          "Trade full-text search failed; falling back to substring match",
        );
        return null;
      }

      return (data ?? []).map((row: { trade_id: string }) => row.trade_id);
    } catch (error) {
      // getSupabaseClient throws when SUPABASE_URL/SERVICE_ROLE_KEY are unset
      // (local dev, unit tests). Degrade instead of failing the list request.
      appLogger.warn(
        { error, operation: "trade_search_query" },
        "Trade full-text search unavailable; falling back to substring match",
      );
      return null;
    }
  }

  public async indexTrade(document: TradeSearchDocument): Promise<void> {
    try {
      const supabase = getSupabaseClient();
      const [buyerName, sellerName] = await this.resolveDisplayNames(supabase, [
        document.buyerAddress,
        document.sellerAddress,
      ]);

      const { error } = await supabase.from(TRADE_SEARCH_TABLE).upsert(
        {
          trade_id: document.tradeId,
          buyer_address: document.buyerAddress.toLowerCase(),
          seller_address: document.sellerAddress.toLowerCase(),
          commodity: document.commodity ?? null,
          buyer_name: buyerName,
          seller_name: sellerName,
          search_vector: buildTradeSearchText(
            document.commodity,
            buyerName,
            sellerName,
          ),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "trade_id" },
      );

      if (error) {
        appLogger.warn(
          { error, operation: "trade_search_index", tradeId: document.tradeId },
          "Failed to index trade for search",
        );
      }
    } catch (error) {
      // Indexing is best-effort: a missing Supabase config or an unreachable
      // index must never fail trade creation.
      appLogger.warn(
        { error, operation: "trade_search_index", tradeId: document.tradeId },
        "Trade search index unavailable; skipping document",
      );
    }
  }

  /**
   * Display names live in the Supabase `users` table (see user.service.ts),
   * not in the Prisma schema, so they are copied into the document at index
   * time. A missing row simply means an unnamed counterparty.
   */
  private async resolveDisplayNames(
    supabase: ReturnType<typeof getSupabaseClient>,
    addresses: string[],
  ): Promise<[string | null, string | null]> {
    const normalized = addresses.map((address) => address.toLowerCase());
    const { data, error } = await supabase
      .from(USERS_TABLE)
      .select("address, display_name")
      .in("address", normalized);

    if (error || !data) return [null, null];

    const names = new Map<string, string>();
    for (const row of data as Array<{ address: string; display_name: string | null }>) {
      if (row.display_name) names.set(row.address.toLowerCase(), row.display_name);
    }

    return [
      names.get(normalized[0]) ?? null,
      names.get(normalized[1]) ?? null,
    ];
  }
}

/** Default index used by TradeService; swaps in a fake in tests. */
export function createTradeSearchIndex(): TradeSearchIndex {
  return new SupabaseTradeSearchIndex();
}
