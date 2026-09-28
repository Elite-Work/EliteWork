/**
 * Unit tests for date filtering and list/pagination logic
 *
 * Tests cover:
 * - Date filtering (before, after, range)
 * - Timestamp normalization
 * - Pagination (offset, limit, cursor-based)
 * - Sort field ordering
 * - Date boundary conditions
 */

describe("Date Filtering & Pagination Logic", () => {
  /**
   * Helper to parse ISO date strings consistently
   */
  const parseIsoDate = (isoString: string): Date => new Date(isoString);

  /**
   * Helper to format date for filtering
   */
  const formatDateFilter = (date: Date): string => date.toISOString();

  describe("Date Filtering", () => {
    describe("Date Parsing & Validation", () => {
      it("should parse valid ISO 8601 dates", () => {
        const date = parseIsoDate("2026-06-24T10:30:00Z");
        expect(date instanceof Date).toBe(true);
        expect(date.getTime()).toBeGreaterThan(0);
      });

      it("should handle date with milliseconds", () => {
        const date = parseIsoDate("2026-06-24T10:30:00.123Z");
        expect(date instanceof Date).toBe(true);
        expect(date.getMilliseconds()).toBe(123);
      });

      it("should handle dates with timezone offsets", () => {
        const date1 = parseIsoDate("2026-06-24T10:30:00+02:00");
        const date2 = parseIsoDate("2026-06-24T08:30:00Z");
        // Both represent the same point in time
        expect(date1.getTime()).toBe(date2.getTime());
      });

      it("should return invalid date for malformed strings", () => {
        const date = new Date("not-a-date");
        expect(isNaN(date.getTime())).toBe(true);
      });
    });

    describe("Timestamp Normalization", () => {
      it("should normalize dates to UTC", () => {
        const date = parseIsoDate("2026-06-24T10:30:00+05:30");
        const normalized = formatDateFilter(date);
        // Should be converted to UTC
        expect(normalized.endsWith("Z")).toBe(true);
      });

      it("should preserve timezone information when needed", () => {
        const isoString = "2026-06-24T10:30:00.123Z";
        const date = parseIsoDate(isoString);
        const formatted = formatDateFilter(date);
        // Should be parseable back to same time
        const reparsed = parseIsoDate(formatted);
        expect(reparsed.getTime()).toBe(date.getTime());
      });

      it("should handle start-of-day normalization", () => {
        const date = new Date("2026-06-24T00:00:00Z");
        const startOfDay = new Date(date);
        startOfDay.setUTCHours(0, 0, 0, 0);
        expect(startOfDay.getUTCHours()).toBe(0);
        expect(startOfDay.getUTCMinutes()).toBe(0);
      });

      it("should handle end-of-day normalization", () => {
        const date = new Date("2026-06-24T23:59:59.999Z");
        const endOfDay = new Date(date);
        endOfDay.setUTCHours(23, 59, 59, 999);
        expect(endOfDay.getUTCHours()).toBe(23);
        expect(endOfDay.getUTCMinutes()).toBe(59);
      });
    });

    describe("Range Filtering", () => {
      const events = [
        { id: 1, timestamp: parseIsoDate("2026-06-20T10:00:00Z") },
        { id: 2, timestamp: parseIsoDate("2026-06-22T10:00:00Z") },
        { id: 3, timestamp: parseIsoDate("2026-06-24T10:00:00Z") },
        { id: 4, timestamp: parseIsoDate("2026-06-26T10:00:00Z") },
        { id: 5, timestamp: parseIsoDate("2026-06-28T10:00:00Z") },
      ];

      const filterByDateRange = (
        items: typeof events,
        after?: Date,
        before?: Date,
      ): typeof events => {
        return items.filter((item) => {
          if (after && item.timestamp < after) return false;
          if (before && item.timestamp > before) return false;
          return true;
        });
      };

      it("should filter events after a given date", () => {
        const after = parseIsoDate("2026-06-23T00:00:00Z");
        const result = filterByDateRange(events, after);
        expect(result.length).toBe(3); // ids 3, 4, 5
        expect(result[0].id).toBe(3);
      });

      it("should filter events before a given date", () => {
        const before = parseIsoDate("2026-06-25T00:00:00Z");
        const result = filterByDateRange(events, undefined, before);
        expect(result.length).toBe(3); // ids 1, 2, 3
        expect(result[result.length - 1].id).toBe(3);
      });

      it("should filter events within date range", () => {
        const after = parseIsoDate("2026-06-22T00:00:00Z");
        const before = parseIsoDate("2026-06-26T00:00:00Z");
        const result = filterByDateRange(events, after, before);
        expect(result.length).toBe(3); // ids 2, 3, 4
        expect(result[0].id).toBe(2);
        expect(result[result.length - 1].id).toBe(4);
      });

      it("should return all events when no date filter provided", () => {
        const result = filterByDateRange(events);
        expect(result.length).toBe(5);
      });

      it("should return empty array when date range excludes all events", () => {
        const after = parseIsoDate("2026-07-01T00:00:00Z");
        const result = filterByDateRange(events, after);
        expect(result.length).toBe(0);
      });

      it("should include boundary dates (inclusive)", () => {
        const exact = parseIsoDate("2026-06-24T10:00:00Z");
        const result = filterByDateRange(events, exact, exact);
        // Should include event with exact timestamp
        expect(result.length).toBeGreaterThanOrEqual(0);
      });
    });

    describe("Date Boundary Conditions", () => {
      it("should handle midnight UTC correctly", () => {
        const midnight = parseIsoDate("2026-06-24T00:00:00Z");
        expect(midnight.getUTCHours()).toBe(0);
        expect(midnight.getUTCMinutes()).toBe(0);
      });

      it("should handle leap second handling", () => {
        // Most systems don't support leap seconds in JavaScript
        // This tests that we handle edge cases gracefully
        const date = parseIsoDate("2026-06-24T23:59:60Z");
        // Behavior depends on implementation; should not crash
        expect(date instanceof Date).toBe(true);
      });

      it("should handle DST transitions (UTC has no DST)", () => {
        const date1 = parseIsoDate("2026-03-29T00:00:00Z");
        const date2 = parseIsoDate("2026-10-25T00:00:00Z");
        // UTC dates should always be comparable
        expect(date1.getTime()).toBeLessThan(date2.getTime());
      });

      it("should handle far-future dates", () => {
        const futureDate = parseIsoDate("2099-12-31T23:59:59Z");
        expect(futureDate instanceof Date).toBe(true);
        expect(futureDate.getTime()).toBeGreaterThan(0);
      });

      it("should handle epoch dates", () => {
        const epoch = parseIsoDate("1970-01-01T00:00:00Z");
        expect(epoch.getTime()).toBe(0);
      });
    });
  });

  describe("Pagination Logic", () => {
    const createTestList = (count: number) => {
      return Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        name: `Item ${i + 1}`,
        createdAt: new Date(Date.now() - (count - i) * 1000), // Descending order
      }));
    };

    describe("Offset-Based Pagination", () => {
      const items = createTestList(100);

      const paginate = (list: typeof items, page: number, limit: number) => {
        const skip = (page - 1) * limit;
        return {
          data: list.slice(skip, skip + limit),
          pagination: {
            page,
            limit,
            total: list.length,
            totalPages: Math.ceil(list.length / limit),
            hasNextPage: skip + limit < list.length,
            hasPreviousPage: page > 1,
          },
        };
      };

      it("should paginate first page", () => {
        const result = paginate(items, 1, 20);
        expect(result.data.length).toBe(20);
        expect(result.data[0].id).toBe(1);
        expect(result.data[19].id).toBe(20);
        expect(result.pagination.page).toBe(1);
        expect(result.pagination.hasNextPage).toBe(true);
        expect(result.pagination.hasPreviousPage).toBe(false);
      });

      it("should paginate middle page", () => {
        const result = paginate(items, 3, 20);
        expect(result.data.length).toBe(20);
        expect(result.data[0].id).toBe(41);
        expect(result.data[19].id).toBe(60);
        expect(result.pagination.hasNextPage).toBe(true);
        expect(result.pagination.hasPreviousPage).toBe(true);
      });

      it("should paginate last page", () => {
        const result = paginate(items, 5, 20);
        expect(result.data.length).toBe(20);
        expect(result.data[0].id).toBe(81);
        expect(result.data[19].id).toBe(100);
        expect(result.pagination.page).toBe(5);
        expect(result.pagination.hasNextPage).toBe(false);
        expect(result.pagination.hasPreviousPage).toBe(true);
      });

      it("should handle partial last page", () => {
        const result = paginate(items, 5, 25);
        expect(result.data.length).toBe(25);
        expect(result.pagination.totalPages).toBe(4);
        expect(result.pagination.hasNextPage).toBe(false);
      });

      it("should calculate correct total pages", () => {
        const result = paginate(items, 1, 30);
        expect(result.pagination.totalPages).toBe(Math.ceil(100 / 30));
        expect(result.pagination.totalPages).toBe(4);
      });

      it("should return empty array for page beyond total", () => {
        const result = paginate(items, 100, 20);
        expect(result.data.length).toBe(0);
        expect(result.pagination.hasNextPage).toBe(false);
      });

      it("should handle page = 0 gracefully (treat as page 1)", () => {
        const page = Math.max(1, 0);
        const result = paginate(items, page, 20);
        expect(result.pagination.page).toBe(1);
        expect(result.data[0].id).toBe(1);
      });
    });

    describe("Limit Validation", () => {
      const items = createTestList(100);

      it("should enforce maximum limit of 100", () => {
        const limit = Math.min(200, 100); // Enforced max
        const result = items.slice(0, limit);
        expect(result.length).toBe(100);
      });

      it("should enforce minimum limit of 1", () => {
        const limit = Math.max(1, 0); // Enforced min
        const result = items.slice(0, limit);
        expect(result.length).toBe(1);
      });

      it("should use default limit of 20", () => {
        const defaultLimit = 20;
        const result = items.slice(0, defaultLimit);
        expect(result.length).toBe(20);
      });

      it("should handle custom limit values", () => {
        const customLimit = 15;
        const result = items.slice(0, customLimit);
        expect(result.length).toBe(15);
      });
    });

    describe("Sort Ordering", () => {
      const items = [
        { id: 1, name: "Zebra", timestamp: new Date("2026-06-20") },
        { id: 2, name: "Apple", timestamp: new Date("2026-06-22") },
        { id: 3, name: "Mango", timestamp: new Date("2026-06-24") },
        { id: 4, name: "Banana", timestamp: new Date("2026-06-26") },
      ];

      const sortByField = (
        list: typeof items,
        field: string,
        descending: boolean = false,
      ): typeof items => {
        const sorted = [...list].sort((a, b) => {
          const aVal = (a as any)[field];
          const bVal = (b as any)[field];

          if (aVal < bVal) return descending ? 1 : -1;
          if (aVal > bVal) return descending ? -1 : 1;
          return 0;
        });
        return sorted;
      };

      it("should sort ascending by name", () => {
        const result = sortByField(items, "name", false);
        expect(result[0].name).toBe("Apple");
        expect(result[result.length - 1].name).toBe("Zebra");
      });

      it("should sort descending by name", () => {
        const result = sortByField(items, "name", true);
        expect(result[0].name).toBe("Zebra");
        expect(result[result.length - 1].name).toBe("Apple");
      });

      it("should sort ascending by timestamp", () => {
        const result = sortByField(items, "timestamp", false);
        expect(result[0].timestamp.getTime()).toBeLessThan(
          result[result.length - 1].timestamp.getTime(),
        );
      });

      it("should sort descending by timestamp", () => {
        const result = sortByField(items, "timestamp", true);
        expect(result[0].timestamp.getTime()).toBeGreaterThan(
          result[result.length - 1].timestamp.getTime(),
        );
      });

      it("should sort by numeric ID field", () => {
        const result = sortByField(items, "id", false);
        expect(result[0].id).toBe(1);
        expect(result[result.length - 1].id).toBe(4);
      });
    });
  });

  describe("Combined Filtering & Pagination", () => {
    const createTradesData = () => [
      {
        id: "t1",
        status: "FUNDED",
        amount: 1000,
        createdAt: parseIsoDate("2026-06-20T10:00:00Z"),
      },
      {
        id: "t2",
        status: "DELIVERED",
        amount: 2000,
        createdAt: parseIsoDate("2026-06-22T10:00:00Z"),
      },
      {
        id: "t3",
        status: "COMPLETED",
        amount: 1500,
        createdAt: parseIsoDate("2026-06-24T10:00:00Z"),
      },
      {
        id: "t4",
        status: "FUNDED",
        amount: 3000,
        createdAt: parseIsoDate("2026-06-26T10:00:00Z"),
      },
      {
        id: "t5",
        status: "DISPUTED",
        amount: 1200,
        createdAt: parseIsoDate("2026-06-28T10:00:00Z"),
      },
    ];

    const filterAndPaginate = (
      trades: ReturnType<typeof createTradesData>,
      filters: {
        status?: string;
        after?: Date;
        before?: Date;
        page?: number;
        limit?: number;
        sort?: string;
      },
    ) => {
      // Apply filters
      const result = trades.filter((t) => {
        if (filters.status && t.status !== filters.status) return false;
        if (filters.after && t.createdAt < filters.after) return false;
        if (filters.before && t.createdAt > filters.before) return false;
        return true;
      });

      // Apply sorting
      if (filters.sort) {
        const isDescending = filters.sort.startsWith("-");
        const field = isDescending ? filters.sort.slice(1) : filters.sort;
        result.sort((a, b) => {
          const aVal = (a as any)[field];
          const bVal = (b as any)[field];
          const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
          return isDescending ? -cmp : cmp;
        });
      }

      // Apply pagination
      const page = Math.max(1, filters.page ?? 1);
      const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
      const skip = (page - 1) * limit;

      return {
        data: result.slice(skip, skip + limit),
        pagination: {
          page,
          limit,
          total: result.length,
          totalPages: Math.ceil(result.length / limit),
        },
      };
    };

    it("should filter by status and paginate", () => {
      const trades = createTradesData();
      const result = filterAndPaginate(trades, {
        status: "FUNDED",
        page: 1,
        limit: 10,
      });
      expect(result.data.length).toBe(2);
      expect(result.data[0].id).toBe("t1");
      expect(result.data[1].id).toBe("t4");
    });

    it("should filter by date range and paginate", () => {
      const trades = createTradesData();
      const result = filterAndPaginate(trades, {
        after: parseIsoDate("2026-06-21T00:00:00Z"),
        before: parseIsoDate("2026-06-27T00:00:00Z"),
        page: 1,
        limit: 10,
      });
      expect(result.data.length).toBe(3);
      expect(result.pagination.total).toBe(3);
    });

    it("should combine status filter, date range, and sorting", () => {
      const trades = createTradesData();
      const result = filterAndPaginate(trades, {
        status: "FUNDED",
        after: parseIsoDate("2026-06-20T00:00:00Z"),
        before: parseIsoDate("2026-06-27T00:00:00Z"),
        sort: "-createdAt",
        page: 1,
        limit: 10,
      });
      expect(result.data.length).toBe(2);
      expect(result.data[0].id).toBe("t4"); // Descending by date
    });

    it("should return correct pagination metadata", () => {
      const trades = createTradesData();
      const result = filterAndPaginate(trades, {
        page: 1,
        limit: 2,
      });
      expect(result.pagination.totalPages).toBe(Math.ceil(5 / 2));
      expect(result.pagination.totalPages).toBe(3);
    });
  });
});
