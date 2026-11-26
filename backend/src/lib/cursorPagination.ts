/**
 * Shared cursor-pagination codec and helper for high-volume list endpoints.
 *
 * Cursors are opaque to clients but internally carry the last-seen row's
 * sortable key (the field the list is ordered by, plus its unique `id` as a
 * tiebreaker). Because pagination is anchored to an actual row rather than a
 * numeric offset, results stay stable under concurrent inserts/deletes —
 * unlike `skip`/`take`, which can duplicate or drop rows when the underlying
 * set shifts between page fetches.
 */

export class InvalidCursorError extends Error {
  constructor(message = "Invalid pagination cursor") {
    super(message);
    this.name = "InvalidCursorError";
  }
}

export interface CursorKey {
  id: number;
  /** ISO-8601 string of the sort field (e.g. createdAt/timestamp), when the sort field isn't `id`. */
  sortValue?: string;
  /**
   * Optional logical list segment for endpoints that merge more than one
   * source into a single ordered list (e.g. watchlisted trades before the
   * rest of the caller's trades). Opaque to the client and ignored by
   * `paginateWithCursor`, which only ever reads `id`.
   */
  segment?: string;
}

/**
 * Encode a cursor key into an opaque, URL-safe token.
 * Not intended to be human-sortable — only round-trippable.
 */
export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

/**
 * Decode a client-supplied cursor token. Throws InvalidCursorError on any
 * malformed/tampered input so callers can return a 400 instead of leaking a
 * stack trace or silently misbehaving.
 */
export function decodeCursor(cursor: string | undefined | null): CursorKey | null {
  if (cursor === undefined || cursor === null || cursor === "") {
    return null;
  }

  try {
    const json = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.id !== "number" ||
      !Number.isFinite(parsed.id)
    ) {
      throw new Error("malformed cursor payload");
    }
    return { id: parsed.id, sortValue: parsed.sortValue, segment: parsed.segment };
  } catch {
    throw new InvalidCursorError();
  }
}

export interface CursorPageInfo {
  nextCursor: string | null;
  hasNextPage: boolean;
  limit: number;
}

export interface CursorPageResult<T> {
  items: T[];
  pageInfo: CursorPageInfo;
}

export const DEFAULT_CURSOR_LIMIT = 20;
export const MAX_CURSOR_LIMIT = 100;

export function normalizeCursorLimit(rawLimit: unknown): number {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CURSOR_LIMIT;
  }
  return Math.min(Math.floor(parsed), MAX_CURSOR_LIMIT);
}

/**
 * Runs a Prisma-style `findMany` using id-anchored cursor pagination.
 *
 * `findMany` must accept `{ take, cursor?, skip?, orderBy }` in the shape
 * Prisma models expose. Ordering must be deterministic (include `id` as the
 * final tiebreaker) so identical sort keys don't produce ambiguous pages.
 */
export async function paginateWithCursor<T extends { id: number }>(opts: {
  findMany: (args: {
    take: number;
    skip?: number;
    cursor?: { id: number };
    orderBy: unknown;
  }) => Promise<T[]>;
  orderBy: unknown;
  cursor?: string | null;
  limit?: number;
}): Promise<CursorPageResult<T>> {
  const decoded = decodeCursor(opts.cursor ?? null);
  const limit = normalizeCursorLimit(opts.limit);
  const take = limit + 1;

  const items = await opts.findMany({
    take,
    orderBy: opts.orderBy,
    ...(decoded ? { cursor: { id: decoded.id }, skip: 1 } : {}),
  });

  const hasNextPage = items.length > limit;
  const page = hasNextPage ? items.slice(0, limit) : items;
  const last = page[page.length - 1];

  return {
    items: page,
    pageInfo: {
      nextCursor: hasNextPage && last ? encodeCursor({ id: last.id }) : null,
      hasNextPage,
      limit,
    },
  };
}

/**
 * Response envelope helper for endpoints migrating from legacy offset
 * pagination (`page`/`limit`/`total`/`totalPages`) to cursors. Keeps the old
 * fields present — computed on a best-effort basis — while a deprecation
 * warning tells callers to move to `pageInfo.nextCursor`. Remove the legacy
 * fields and this helper once clients have migrated.
 */
export function withLegacyPaginationCompat<T>(
  page: CursorPageResult<T>,
  legacy: { page?: number; total?: number },
): CursorPageResult<T> & {
  pagination: { page: number; limit: number; total: number; totalPages: number };
} {
  const page_ = legacy.page ?? 1;
  const total = legacy.total ?? page.items.length;
  return {
    ...page,
    pagination: {
      page: page_,
      limit: page.pageInfo.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / page.pageInfo.limit)),
    },
  };
}

export const CURSOR_DEPRECATION_WARNING =
  '299 - "page/limit offset pagination is deprecated; use cursor/pageInfo.nextCursor instead"';
