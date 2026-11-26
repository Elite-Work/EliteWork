/**
 * backfill-trade-search.ts
 *
 * Populates the Supabase `trade_search` full-text index (issue #504) for trades
 * that were created before the index existed. New trades are indexed by
 * TradeService.createPendingTrade; this script covers the historical rows.
 *
 * Idempotent: indexTrade upserts on trade_id, so re-running only rewrites the
 * same documents. Safe to resume after an interruption.
 *
 * Usage:
 *   DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     npx tsx scripts/backfill-trade-search.ts [--limit=1000]
 *
 * Verify afterwards with:
 *   SELECT count(*) FROM trade_search;
 *
 * Rollback: the index is derived data — `TRUNCATE public.trade_search;`.
 */

import { PrismaClient } from "@prisma/client";
import { createTradeSearchIndex } from "../src/services/tradeSearch.service";

const prisma = new PrismaClient();
const BATCH_SIZE = 500;

function parseLimit(): number | undefined {
  const arg = process.argv.find((value) => value.startsWith("--limit="));
  if (!arg) return undefined;
  const parsed = Number(arg.split("=")[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function main() {
  const limit = parseLimit();
  const index = createTradeSearchIndex();

  console.log("=== Trade Search Index Backfill ===");
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Limit: ${limit ?? "none (all trades)"}`);
  console.log();

  let cursor: number | undefined;
  let indexed = 0;

  for (;;) {
    const batch = await prisma.trade.findMany({
      select: {
        id: true,
        tradeId: true,
        buyerAddress: true,
        sellerAddress: true,
        commodity: true,
      },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
      ...(cursor !== undefined ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (batch.length === 0) break;

    for (const trade of batch) {
      await index.indexTrade(trade);
      indexed += 1;
      if (limit !== undefined && indexed >= limit) break;
    }

    cursor = batch[batch.length - 1].id;
    console.log(`  indexed ${indexed} trade(s)…`);

    if (limit !== undefined && indexed >= limit) break;
    if (batch.length < BATCH_SIZE) break;
  }

  console.log();
  console.log(`Documents written: ${indexed}`);
  console.log(`Completed at: ${new Date().toISOString()}`);
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
