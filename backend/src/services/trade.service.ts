import crypto from "crypto";
import { Prisma, PrismaClient, Trade, TradeStatus, DisputeStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import {
  isPrismaPoolExhaustionError,
  toPoolExhaustionAppError,
} from "../lib/dbPoolErrors";
import { ContractService } from "./contract.service";
import {
  createTradeSearchIndex,
  normalizeTradeSearchQuery,
  type TradeSearchIndex,
} from "./tradeSearch.service";
import { appLogger } from "../middleware/logger";
import { TracingHelper } from "../config/tracing";
import { formatStroopsToDecimal, parseDecimalToStroops } from "../lib/money";
import {
  CursorPageResult,
  decodeCursor,
  encodeCursor,
  normalizeCursorLimit,
  paginateWithCursor,
} from "../lib/cursorPagination";
import {
  recordTradeFunnelEvent,
  recordTimeToFund,
  recordTimeToRelease,
  recordTradeGmv,
} from "../lib/metrics";

function parseAdminPubkeys(): Set<string> {
  const raw = process.env.ADMIN_STELLAR_PUBKEYS ?? "";
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function sanitizeLogField(value: string, maxLength = 200): string {
  return String(value).replace(/[\r\n\t]/g, "_").slice(0, maxLength);
}

export interface CreatePendingTradeInput {
  tradeId: string;
  buyerAddress: string;
  sellerAddress: string;
  amountUsdc: string;
  buyerLossBps: number;
  sellerLossBps: number;
  /** Optional off-chain commodity label; also indexed for search (#504). */
  commodity?: string | null;
}

export type TradeListFilters = {
  status?: TradeStatus;
  /** @deprecated offset pagination — only used when an old client sends `page`. */
  page?: number;
  limit?: number;
  sort?: string;
  /** Free-text query over commodity and counterparty name (#504). */
  q?: string;
  /**
   * Opaque cursor from a previous response's `pageInfo.nextCursor` (#502).
   * When present — or when `page` is omitted — the endpoint returns
   * `{ items, pageInfo }` instead of the legacy `pagination` envelope.
   */
  cursor?: string;
};

/** One of the caller's watchlist entries, carrying the ordering key of the
 * watchlist row (not the trade) so pagination stays stable when a trade's
 * own timestamps are identical. */
type WatchedTradeEntry = {
  entryId: number;
  entryCreatedAt: Date;
  trade: Trade;
};

/** Cursor-mode response shape for the trades list. */
export type TradeListPage = CursorPageResult<Trade>;

/** Legacy offset-mode response shape, kept for pre-infinite-scroll clients. */
export type LegacyTradeListPage = {
  items: Trade[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
};

const DEFAULT_TRADES_PAGE_SIZE = 20;

type TradeDatabase = Pick<PrismaClient, "trade" | "dispute" | "disputeCategory"> &
  Partial<Pick<PrismaClient, "userWatchlist">>;

export class TradeAccessDeniedError extends Error {
  constructor() {
    super("Forbidden");
    this.name = "TradeAccessDeniedError";
  }
}

export class DisputeTradeStatusError extends Error {
  status = 400;
  constructor(status: string) {
    super(`Trade must be in FUNDED or DELIVERED status to initiate a dispute (current: ${status})`);
    this.name = "DisputeTradeStatusError";
  }
}

export class DisputeCategoryValidationError extends Error {
  status = 400;

  constructor(category: string | number) {
    super(`Invalid dispute category: ${category}`);
    this.name = "DisputeCategoryValidationError";
  }
}

export class TradeService {
  constructor(
    private readonly prisma: TradeDatabase = defaultPrisma,
    private readonly contractService: ContractService = new ContractService(),
    private readonly tradeSearch: TradeSearchIndex = createTradeSearchIndex(),
  ) { }

  async createPendingTrade(input: CreatePendingTradeInput): Promise<Trade> {
    appLogger.info({
      requestId: undefined, // Will be filled by context if available
      userId: sanitizeLogField(input.buyerAddress),
      paymentId: sanitizeLogField(input.tradeId),
      provider: "stellar",
      status: "authorization_started",
      timestamp: new Date().toISOString()
    }, "Payment authorization started");

    TracingHelper.addEvent("authorization_started", {
      paymentId: sanitizeLogField(input.tradeId),
      userId: sanitizeLogField(input.buyerAddress)
    });

    let trade: Trade;
    try {
      trade = await this.prisma.trade.create({
        data: {
          ...input,
          status: TradeStatus.PENDING_SIGNATURE,
        },
      });
    } catch (error) {
      // Trade creation is a non-idempotent INSERT, so it must never be
      // auto-retried. When the pool is saturated Prisma rejects with P2024 once
      // `pool_timeout` elapses; surface that as a clear, retryable 503 instead
      // of a generic 500. See docs/connection-pool-exhaustion.md.
      if (isPrismaPoolExhaustionError(error)) {
        appLogger.error(
          { error, operation: "create_pending_trade", tradeId: input.tradeId },
          "Database connection pool exhausted during trade creation",
        );
        throw toPoolExhaustionAppError("create_pending_trade");
      }
      throw error;
    }
    // KPI: record the pending creation so the funnel tracks attempts from the
    // DB side (the on-chain TradeCreated event handler records "created" again
    // once the tx is confirmed, keeping both counts for reconciliation).
    recordTradeFunnelEvent("created");

    // Best-effort search index write (#504). `indexTrade` never throws, and it
    // is intentionally not awaited: a slow/unavailable Supabase index must not
    // add latency to the escrow creation path.
    void this.tradeSearch.indexTrade({
      tradeId: trade.tradeId,
      buyerAddress: trade.buyerAddress,
      sellerAddress: trade.sellerAddress,
      commodity: trade.commodity ?? input.commodity ?? null,
    });

    return trade;
  }

  async listUserTrades(
    address: string,
    filters: TradeListFilters,
  ): Promise<TradeListPage | LegacyTradeListPage> {
    const limit = normalizeCursorLimit(filters.limit ?? DEFAULT_TRADES_PAGE_SIZE);
    const orderBy = this.parseSort(filters.sort);

    const where: Prisma.TradeWhereInput = {
      OR: [{ buyerAddress: address }, { sellerAddress: address }],
      ...(filters.status ? { status: filters.status } : {}),
    };

    // #504: free-text search. Supabase resolves the query against its
    // full-text index; when that index is unavailable (`null`) fall back to a
    // database-side substring match so local/dev environments still work.
    const search = this.normalizeQuery(filters.q);
    const matchedIds = search ? await this.tradeSearch.searchTradeIds(search) : null;
    // #502: cursor mode is the default; `page` is only honoured for clients
    // that have not migrated yet (and never together with a cursor).
    const cursorMode = filters.cursor !== undefined || filters.page === undefined;

    if (search && matchedIds && matchedIds.length === 0) {
      return cursorMode
        ? { items: [], pageInfo: { nextCursor: null, hasNextPage: false, limit } }
        : {
          items: [],
          pagination: { page: Math.max(1, filters.page ?? 1), limit, total: 0, totalPages: 1 },
        };
    }
    if (search && matchedIds) {
      where.tradeId = { in: matchedIds };
    } else if (search) {
      where.AND = [this.buildSubstringSearchFilter(search)];
    }
    const matchesSearch = (trade: Trade): boolean =>
      !search || (matchedIds ? matchedIds.includes(trade.tradeId) : this.matchesSubstringSearch(trade, search));

    const watchedEntries = await this.listWatchedEntries(address, filters.status, matchesSearch);
    const watchedIds = watchedEntries.map((entry) => entry.trade.tradeId);
    const unwatchedWhere: Prisma.TradeWhereInput = watchedIds.length > 0
      ? { AND: [where, { NOT: { tradeId: { in: watchedIds } } }] }
      : where;

    if (cursorMode) {
      return this.listTradesWithCursor({
        orderBy,
        limit,
        cursor: filters.cursor,
        watchedEntries,
        unwatchedWhere,
      });
    }

    // ── Legacy offset pagination (deprecated) ──────────────────────────────
    const page = Math.max(1, filters.page ?? 1);
    const skip = (page - 1) * limit;

    if (watchedEntries.length > 0) {
      // Prisma cannot order a relation by whether it belongs to *this* caller.
      // Fetch the caller's indexed bookmarks first, then query only the
      // remaining trades for the rest of the page. This keeps watched trades at
      // the top without incorrectly promoting trades watched by other users.
      const total = await this.prisma.trade.count({ where });
      const watchedPage = watchedEntries.slice(skip, skip + limit).map((entry) => entry.trade);
      const remainingSlots = limit - watchedPage.length;
      const remainingSkip = Math.max(0, skip - watchedEntries.length);
      const unwatchlisted = remainingSlots > 0
        ? await this.prisma.trade.findMany({
          where: unwatchedWhere,
          orderBy,
          skip: remainingSkip,
          take: remainingSlots,
        })
        : [];

      return {
        items: [...watchedPage, ...unwatchlisted],
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.trade.findMany({
        where,
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.trade.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /**
   * Loads the caller's watchlist entries that belong in this list, preserving
   * watchlist-recency order (the order watched trades are promoted in).
   *
   * Returning entries — not bare trades — matters for cursor pagination: the
   * cursor needs the watchlist row's own `(createdAt, id)` so a page boundary
   * survives the trade being un-watchlisted between requests.
   */
  private async listWatchedEntries(
    address: string,
    status: TradeStatus | undefined,
    matchesSearch: (trade: Trade) => boolean,
  ): Promise<WatchedTradeEntry[]> {
    const watchlist = this.prisma.userWatchlist;
    if (!watchlist) return [];

    const entries = await watchlist.findMany({
      where: { userAddress: address.toLowerCase() },
      include: { trade: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    return entries
      .filter(
        (entry) =>
          (!status || entry.trade.status === status) && matchesSearch(entry.trade),
      )
      .map((entry) => ({
        entryId: entry.id,
        entryCreatedAt: entry.createdAt,
        trade: entry.trade,
      }));
  }

  /**
   * Cursor pagination for the trades list (#502).
   *
   * The list is a merge of two sources: the caller's watchlisted trades
   * (promoted to the top) and everything else. A single offset- or key-based
   * cursor cannot express "position in source A, then source B", so cursors
   * carry a `segment`:
   *
   * - `watched` — anchored to the watchlist row's `(createdAt, id)`.
   * - `unwatched` — anchored to the trade `id` via `paginateWithCursor`.
   *
   * A page starts in the watched segment and spills into the unwatched one
   * when the watchlist is exhausted, exactly like the legacy implementation.
   */
  private async listTradesWithCursor(params: {
    orderBy: Prisma.TradeOrderByWithRelationInput[];
    limit: number;
    cursor?: string;
    watchedEntries: WatchedTradeEntry[];
    unwatchedWhere: Prisma.TradeWhereInput;
  }): Promise<TradeListPage> {
    const { orderBy, limit, cursor: cursorToken, watchedEntries, unwatchedWhere } = params;
    const cursor = decodeCursor(cursorToken ?? null);

    const fetchUnwatched = async (token: string | undefined, pageSize: number) => {
      const page = await paginateWithCursor<Trade>({
        findMany: (args) =>
          this.prisma.trade.findMany({ ...args, where: unwatchedWhere } as Prisma.TradeFindManyArgs),
        orderBy,
        cursor: token,
        limit: pageSize,
      });
      // Tag the cursor so a later request never re-enters the watched phase.
      const last = page.items[page.items.length - 1];
      return {
        items: page.items,
        pageInfo: {
          ...page.pageInfo,
          nextCursor:
            page.pageInfo.hasNextPage && last
              ? encodeCursor({ id: last.id, segment: "unwatched" })
              : null,
        },
      };
    };

    if (!cursor || cursor.segment === "watched") {
      const remainingWatched = cursor
        ? watchedEntries.filter((entry) => this.isWatchedEntryAfterCursor(entry, cursor))
        : watchedEntries;
      const watchedPage = remainingWatched.slice(0, limit);

      if (watchedPage.length === limit) {
        // The page is full of watched trades. `hasNextPage` is true when more
        // watched trades remain or an unwatched trade exists on the far side.
        const hasUnwatched = remainingWatched.length === limit
          ? (await this.prisma.trade.findFirst({ where: unwatchedWhere, select: { id: true } })) !== null
          : true;
        const last = watchedPage[watchedPage.length - 1];
        return {
          items: watchedPage.map((entry) => entry.trade),
          pageInfo: {
            nextCursor: encodeCursor({
              id: last.entryId,
              sortValue: last.entryCreatedAt.toISOString(),
              segment: "watched",
            }),
            hasNextPage: remainingWatched.length > limit || hasUnwatched,
            limit,
          },
        };
      }

      const unwatched = await fetchUnwatched(undefined, limit - watchedPage.length);
      return {
        items: [...watchedPage.map((entry) => entry.trade), ...unwatched.items],
        pageInfo: { ...unwatched.pageInfo, limit },
      };
    }

    return fetchUnwatched(cursorToken, limit);
  }

  /** True when a watchlist entry sorts after the cursor in
   * `(createdAt desc, id desc)` order. */
  private isWatchedEntryAfterCursor(
    entry: WatchedTradeEntry,
    cursor: { id: number; sortValue?: string },
  ): boolean {
    if (!cursor.sortValue) return entry.entryId < cursor.id;
    const cursorTime = new Date(cursor.sortValue).getTime();
    if (Number.isNaN(cursorTime)) return entry.entryId < cursor.id;
    const entryTime = entry.entryCreatedAt.getTime();
    return entryTime < cursorTime || (entryTime === cursorTime && entry.entryId < cursor.id);
  }

  /** Trim/cap a raw `q`; returns undefined for blank input. */
  private normalizeQuery(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const normalized = normalizeTradeSearchQuery(raw);
    return normalized.length > 0 ? normalized : undefined;
  }

  /**
   * Substring fallback used only when the Supabase index is unreachable.
   * Counterparty display names are not in the Prisma schema, so the fallback
   * covers the commodity label and the trade id.
   */
  private buildSubstringSearchFilter(query: string): Prisma.TradeWhereInput {
    return {
      OR: [
        { commodity: { contains: query, mode: "insensitive" } },
        { tradeId: { contains: query, mode: "insensitive" } },
      ],
    };
  }

  private matchesSubstringSearch(trade: Trade, query: string): boolean {
    const needle = query.toLowerCase();
    return (
      (trade.commodity ?? "").toLowerCase().includes(needle) ||
      trade.tradeId.toLowerCase().includes(needle)
    );
  }

  async getTradeById(id: string, callerAddress: string) {
    const numericId = Number(id);
    const orConditions: Prisma.TradeWhereInput[] = [{ tradeId: id }];

    if (Number.isInteger(numericId) && numericId > 0) {
      orConditions.push({ id: numericId });
    }

    const trade = await this.prisma.trade.findFirst({
      where: {
        OR: orConditions,
      },
    });

    if (!trade) {
      return null;
    }

    const caller = callerAddress.toLowerCase();
    if (
      trade.buyerAddress.toLowerCase() !== caller &&
      trade.sellerAddress.toLowerCase() !== caller &&
      !parseAdminPubkeys().has(caller)
    ) {
      throw new TradeAccessDeniedError();
    }

    return trade;
  }

  async getUserStats(address: string) {
    const trades = await this.prisma.trade.findMany({
      where: {
        OR: [{ buyerAddress: address }, { sellerAddress: address }],
      },
      select: {
        amountUsdc: true,
        status: true,
      },
    });

    const openStatuses = new Set<TradeStatus>([
      TradeStatus.PENDING_SIGNATURE,
      TradeStatus.CREATED,
      TradeStatus.FUNDED,
      TradeStatus.DELIVERED,
      TradeStatus.DISPUTED,
    ]);

    const totalTrades = trades.length;
    // Accumulated in integer stroops: summing `Number(amountUsdc)` lost
    // precision above 2^53 stroops and drifted further with every addition.
    const totalVolumeStroops = trades.reduce((sum, trade) => {
      try {
        return sum + parseDecimalToStroops(trade.amountUsdc);
      } catch {
        // A malformed legacy row must not take down the whole stats call.
        return sum;
      }
    }, 0n);
    const openTrades = trades.filter((trade) => openStatuses.has(trade.status)).length;

    return {
      totalTrades,
      totalVolume: formatStroopsToDecimal(totalVolumeStroops),
      openTrades,
    };
  }

  private parseSort(sort?: string): Prisma.TradeOrderByWithRelationInput[] {
    if (!sort) {
      return [{ createdAt: "desc" }, { id: "desc" }];
    }

    const [fieldRaw, dirRaw] = sort.split(":");
    const field = fieldRaw as keyof Prisma.TradeOrderByWithRelationInput;
    const direction = dirRaw?.toLowerCase() === "asc" ? "asc" : "desc";

    const allowedFields = new Set<string>([
      "id",
      "tradeId",
      "buyerAddress",
      "sellerAddress",
      "amountUsdc",
      "status",
      "createdAt",
      "updatedAt",
    ]);

    if (!allowedFields.has(fieldRaw)) {
      return [{ createdAt: "desc" }, { id: "desc" }];
    }

    if (fieldRaw === "id") {
      return [{ id: direction }];
    }

    return [{ [field]: direction }, { id: direction }];
  }

  async initiateDispute(
    id: string,
    callerAddress: string,
    reason: string,
    category: string,
    categoryId?: number,
  ) {
    const trade = await this.getTradeById(id, callerAddress);
    if (!trade) {
      throw new Error("Trade not found");
    }

    // Access check is already done by getTradeById, but let's be explicit
    if (trade.buyerAddress !== callerAddress && trade.sellerAddress !== callerAddress) {
      throw new TradeAccessDeniedError();
    }

    // Check status: FUNDED or DELIVERED
    if (trade.status !== TradeStatus.FUNDED && trade.status !== TradeStatus.DELIVERED) {
      throw new DisputeTradeStatusError(trade.status);
    }

    const resolvedCategoryId = await this.resolveDisputeCategoryId(category, categoryId);
    const reasonHash = sha256(reason);

    // Build contract transaction
    // Note: getTradeById handles both numeric and string IDs for local lookup,
    // but the contract needs the tradeId (the blockchain-sourced one).
    const { unsignedXdr } = await this.contractService.buildInitiateDisputeTx({
      tradeId: trade.tradeId,
      initiatorAddress: callerAddress,
      reasonHash,
    });

    // Create DB record
    // We store the plaintext reason for human review.
    await this.prisma.dispute.create({
      data: {
        tradeId: trade.tradeId,
        initiator: callerAddress,
        reason,
        status: DisputeStatus.OPEN,
        categoryId: resolvedCategoryId,
      },
    });

    return { unsignedXdr };
  }

  private async resolveDisputeCategoryId(category: string, categoryId?: number): Promise<number> {
    if (categoryId !== undefined) {
      const categoryRecord = await this.prisma.disputeCategory.findFirst({
        where: { id: categoryId, isActive: true },
        select: { id: true },
      });

      if (!categoryRecord) {
        throw new DisputeCategoryValidationError(categoryId);
      }

      return categoryRecord.id;
    }

    const normalizedCategory = category.trim();
    if (!normalizedCategory) {
      throw new DisputeCategoryValidationError(category);
    }

    const categoryRecord = await this.prisma.disputeCategory.findFirst({
      where: { name: normalizedCategory, isActive: true },
      select: { id: true },
    });

    if (!categoryRecord) {
      throw new DisputeCategoryValidationError(normalizedCategory);
    }

    return categoryRecord.id;
  }

  /** Alias for listUserTrades — used by trade.controller.test.ts */
  listTrades = this.listUserTrades.bind(this);

  /**
   * Read-only listing of every trade touching a cooperative's member wallets
   * (issue #44). The caller is authorized by the route layer
   * (`canViewCooperativeTrades`); this method only scopes the query.
   */
  async listCooperativeTrades(memberAddresses: string[], filters: TradeListFilters) {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const skip = (page - 1) * limit;
    const orderBy = this.parseSort(filters.sort);

    const where: Prisma.TradeWhereInput = {
      OR: [
        { buyerAddress: { in: memberAddresses } },
        { sellerAddress: { in: memberAddresses } },
      ],
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.trade.findMany({ where, orderBy, skip, take: limit }),
      this.prisma.trade.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }
}
