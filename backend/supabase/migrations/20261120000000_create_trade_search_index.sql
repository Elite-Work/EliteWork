-- Full-text search index for GET /api/trades?q=… (issue #504).
--
-- Apply AFTER the Prisma migration that adds "Trade"."commodity"
-- (prisma/migrations/20261120000000_add_trade_commodity).
--
-- The backend writes one document per trade through the Supabase service-role
-- client (src/services/tradeSearch.service.ts -> TradeSearchIndex.indexTrade)
-- when the trade is created. Documents hold the commodity label plus the
-- buyer/seller display names copied at index time, so a single
-- `search_vector @@ websearch_to_tsquery('english', :q)` match covers both
-- "commodity" and "counterparty" search without joining on every request.

CREATE TABLE IF NOT EXISTS public.trade_search (
  trade_id        text PRIMARY KEY,
  buyer_address   text NOT NULL,
  seller_address  text NOT NULL,
  commodity       text,
  buyer_name      text,
  seller_name     text,
  search_vector   tsvector NOT NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Ranked/substring-free lookup by tsquery; trade_id is the primary key so the
-- backend can intersect the ids with its Prisma-scoped trade query.
CREATE INDEX IF NOT EXISTS trade_search_vector_idx
  ON public.trade_search USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS trade_search_buyer_address_idx
  ON public.trade_search (buyer_address);

CREATE INDEX IF NOT EXISTS trade_search_seller_address_idx
  ON public.trade_search (seller_address);

-- PostgREST access. The backend uses the service-role key, which bypasses RLS;
-- RLS is enabled anyway so an anon key can never read the index directly.
ALTER TABLE public.trade_search ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trade_search TO service_role;

COMMENT ON TABLE public.trade_search IS
  'Denormalised full-text search documents for trades (commodity + counterparty display names). Maintained by src/services/tradeSearch.service.ts.';
