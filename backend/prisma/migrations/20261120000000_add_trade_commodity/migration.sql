-- Off-chain commodity label for trade search (issue #504).
--
-- Additive and nullable: existing rows keep NULL, so no backfill or table
-- rewrite is required and the migration is safe to roll back by dropping the
-- column. The column is metadata only — it is never part of the on-chain
-- escrow terms. The matching full-text index lives in Supabase; see
-- supabase/migrations/20261120000000_create_trade_search_index.sql.
ALTER TABLE "Trade" ADD COLUMN "commodity" VARCHAR(100);
