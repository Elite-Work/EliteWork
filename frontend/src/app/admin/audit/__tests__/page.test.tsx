import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AdminAuditHistoryPage from "../page";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { api, ApiError } from "@/lib/api";
import { trackAdminEvent } from "@/lib/analytics";

jest.mock("@/hooks/useAuth");
jest.mock("@/hooks/useIsAdmin");
// The real virtualizer measures the DOM, so it renders no rows under jsdom.
// Render every item in order instead — that is what makes the sort assertions
// (and the entry assertions below) observable.
jest.mock("@/components/ui/VirtualizedList", () => ({
  VirtualizedList: ({
    items,
    isEmpty,
    emptyState,
    renderItem,
    keyExtractor,
  }: {
    items: { id: number }[];
    isEmpty?: boolean;
    emptyState?: React.ReactNode;
    renderItem: (item: unknown, index: number) => React.ReactNode;
    keyExtractor: (item: unknown, index: number) => string;
  }) =>
    isEmpty ? (
      <div role="list" aria-label="Empty list">
        {emptyState}
      </div>
    ) : (
      <div role="list" aria-label="Virtualized list">
        {items.map((item, index) => (
          <div key={keyExtractor(item, index)} role="listitem">
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    ),
}));
jest.mock("@/lib/analytics", () => ({
  trackAdminEvent: jest.fn(),
}));
jest.mock("@/lib/api", () => {
  const { ApiError: RealApiError } = jest.requireActual("@/lib/api/client");
  return {
    api: {
      adminAudit: {
        list: jest.fn(),
      },
    },
    ApiError: RealApiError,
  };
});

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseIsAdmin = useIsAdmin as jest.MockedFunction<typeof useIsAdmin>;
const mockList = api.adminAudit.list as jest.MockedFunction<typeof api.adminAudit.list>;
const mockTrackAdminEvent = trackAdminEvent as jest.MockedFunction<typeof trackAdminEvent>;

function makeEntry(overrides = {}) {
  return {
    id: 1,
    action: "TREASURY_WITHDRAW",
    actorAddress: "GADMIN1234567890",
    targetReference: "GDEST1234567890",
    note: "Reclaiming funds per OPS-42",
    createdAt: "2026-07-05T12:00:00.000Z",
    ...overrides,
  };
}

describe("AdminAuditHistoryPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      token: "test-token",
      isAuthenticated: true,
    } as ReturnType<typeof useAuth>);
    mockUseIsAdmin.mockReturnValue(true);
  });

  it("shows a ForbiddenState instead of fetching when the wallet is not an admin", () => {
    mockUseIsAdmin.mockReturnValue(false);

    render(<AdminAuditHistoryPage />);

    expect(screen.getByTestId("forbidden-state")).toBeInTheDocument();
    expect(mockList).not.toHaveBeenCalled();
  });

  it("shows a skeleton while loading", () => {
    mockList.mockReturnValue(new Promise(() => {}));

    const { container } = render(<AdminAuditHistoryPage />);

    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it("emits a page-view analytics event on mount", () => {
    mockList.mockReturnValue(new Promise(() => {}));

    render(<AdminAuditHistoryPage />);

    expect(mockTrackAdminEvent).toHaveBeenCalledWith("admin_audit_page_view", "viewed");
  });

  it("renders audit entries once loaded", async () => {
    mockList.mockResolvedValueOnce({
      items: [makeEntry()],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    render(<AdminAuditHistoryPage />);

    await waitFor(() => {
      expect(screen.getByText("Treasury Withdraw")).toBeInTheDocument();
    });
    expect(screen.getByText(/GADMIN1234567890/)).toBeInTheDocument();
    expect(mockTrackAdminEvent).toHaveBeenCalledWith("admin_audit_page_view", "success", { page: 1 });
  });

  it("shows a ForbiddenState when the backend returns a 403", async () => {
    mockList.mockRejectedValueOnce(new ApiError(403, "Forbidden: admin access required"));

    render(<AdminAuditHistoryPage />);

    await waitFor(() => {
      expect(screen.getByTestId("forbidden-state")).toBeInTheDocument();
    });
    expect(mockTrackAdminEvent).toHaveBeenCalledWith("admin_audit_page_view", "failed", {
      reason: "forbidden",
    });
  });

  it("shows a retryable error state for non-403 failures", async () => {
    mockList.mockRejectedValueOnce(new ApiError(500, "Failed to reach admin audit service"));

    render(<AdminAuditHistoryPage />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load admin action history")).toBeInTheDocument();
    });
    expect(screen.getByText("Failed to reach admin audit service")).toBeInTheDocument();
  });

  it("shows an empty state when there are no audit entries", async () => {
    mockList.mockResolvedValueOnce({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
    });

    render(<AdminAuditHistoryPage />);

    await waitFor(() => {
      expect(screen.getByText("No admin actions recorded yet")).toBeInTheDocument();
    });
  });

  describe("column sorting", () => {
    const sortableEntries = [
      makeEntry({
        id: 3,
        action: "STREAM_TERMINATE",
        actorAddress: "GCHARLIE000000000",
        createdAt: "2026-07-03T12:00:00.000Z",
      }),
      makeEntry({
        id: 1,
        action: "TREASURY_WITHDRAW",
        actorAddress: "GALPHA0000000000",
        createdAt: "2026-07-01T12:00:00.000Z",
      }),
      makeEntry({
        id: 2,
        action: "CLAWBACK_APPROVED",
        actorAddress: "GBRAVO0000000000",
        createdAt: "2026-07-05T12:00:00.000Z",
      }),
    ];

    async function renderSortable() {
      mockList.mockResolvedValue({
        items: sortableEntries,
        pagination: { page: 1, limit: 20, total: 3, totalPages: 2 },
      });

      const user = userEvent.setup();
      render(<AdminAuditHistoryPage />);

      await waitFor(() => {
        expect(screen.getByText("Treasury Withdraw")).toBeInTheDocument();
      });
      return user;
    }

    /** Rendered action labels, in list order. */
    function renderedActions(): string[] {
      return screen
        .getAllByTestId("audit-action")
        .map((el) => el.textContent ?? "");
    }

    it("defaults to newest first and marks the date column as sorted", async () => {
      await renderSortable();

      expect(renderedActions()).toEqual([
        "Clawback Approved",
        "Stream Terminate",
        "Treasury Withdraw",
      ]);
      expect(
        screen.getByRole("columnheader", { name: /date/i }),
      ).toHaveAttribute("aria-sort", "descending");
      expect(
        screen.getByRole("columnheader", { name: /action type/i }),
      ).toHaveAttribute("aria-sort", "none");
      expect(screen.getByTestId("audit-sort-status")).toHaveTextContent(
        "sorted by Date descending",
      );
    });

    it("sorts by date ascending when the date column is clicked", async () => {
      const user = await renderSortable();

      await user.click(screen.getByRole("button", { name: /sort by date/i }));

      expect(renderedActions()).toEqual([
        "Treasury Withdraw",
        "Stream Terminate",
        "Clawback Approved",
      ]);
      expect(
        screen.getByRole("columnheader", { name: /date/i }),
      ).toHaveAttribute("aria-sort", "ascending");
    });

    it("sorts by actor alphabetically and toggles direction on a second click", async () => {
      const user = await renderSortable();
      const actorHeader = screen.getByRole("columnheader", { name: /actor/i });

      await user.click(screen.getByRole("button", { name: /sort by actor/i }));
      expect(actorHeader).toHaveAttribute("aria-sort", "ascending");
      expect(screen.getByTestId("audit-sort-status")).toHaveTextContent(
        "sorted by Actor ascending",
      );

      await user.click(screen.getByRole("button", { name: /sort by actor/i }));
      expect(actorHeader).toHaveAttribute("aria-sort", "descending");
    });

    it("sorts by action type", async () => {
      const user = await renderSortable();

      await user.click(screen.getByRole("button", { name: /sort by action type/i }));

      // CLAWBACK_APPROVED < STREAM_TERMINATE < TREASURY_WITHDRAW
      expect(renderedActions()).toEqual([
        "Clawback Approved",
        "Stream Terminate",
        "Treasury Withdraw",
      ]);
      expect(
        screen.getByRole("columnheader", { name: /action type/i }),
      ).toHaveAttribute("aria-sort", "ascending");
    });

    it("emits a sort analytics event with the new key and direction", async () => {
      const user = await renderSortable();

      await user.click(screen.getByRole("button", { name: /sort by actor/i }));

      expect(mockTrackAdminEvent).toHaveBeenCalledWith("admin_audit_sort", "success", {
        sortBy: "actorAddress",
        sortDirection: "asc",
      });
    });

    it("keeps the chosen sort after paging to the next page", async () => {
      const user = await renderSortable();

      await user.click(screen.getByRole("button", { name: /sort by action type/i }));

      mockList.mockResolvedValue({
        items: [makeEntry({ id: 9, action: "ACCOUNT_FLAGGED" })],
        pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
      });
      await user.click(screen.getByRole("button", { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByText("Account Flagged")).toBeInTheDocument();
      });
      expect(
        screen.getByRole("columnheader", { name: /action type/i }),
      ).toHaveAttribute("aria-sort", "ascending");
    });

    it("does not render sort controls when there is nothing to sort", async () => {
      mockList.mockResolvedValue({
        items: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
      });

      render(<AdminAuditHistoryPage />);

      await waitFor(() => {
        expect(screen.getByText("No admin actions recorded yet")).toBeInTheDocument();
      });
      expect(screen.queryByRole("columnheader")).not.toBeInTheDocument();
    });
  });
});
