/**
 * Tests for the trades-list search input (#505)
 *
 * Covers: debounced `q` requests (300 ms, no request per keystroke), the
 * commodity/counterparty empty state, and clearing the query.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TradesPage from "@/app/trades/page";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

jest.mock("@/hooks/useAuth", () => ({ useAuth: jest.fn() }));
// Stable identities: the page lists these in its fetch effect deps, so a new
// function per render would re-trigger the request forever.
const trackApiFailure = jest.fn();
const trackFunnelStep = jest.fn();
const addToast = jest.fn();
jest.mock("@/components/AnalyticsProvider", () => ({
  useAnalytics: () => ({ trackApiFailure, trackFunnelStep }),
}));
jest.mock("@/hooks/useToast", () => ({
  useToast: () => ({ addToast }),
}));
jest.mock("@/lib/api", () => ({
  api: { trades: { list: jest.fn() } },
  ApiError: class ApiError extends Error {},
}));

const mockList = api.trades.list as jest.MockedFunction<typeof api.trades.list>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

const EMPTY_PAGE = {
  items: [],
  pagination: { page: 1, limit: 100, total: 0, totalPages: 1 },
};

const AUTH = {
  token: "test-token",
  address: null,
  shortAddress: null,
  isAuthenticated: true,
  isWalletConnected: true,
  isWalletDetected: true,
  isLoading: false,
  error: null,
  connectWallet: jest.fn(),
  authenticate: jest.fn(),
  logout: jest.fn(),
  refreshAuth: jest.fn(),
} as unknown as ReturnType<typeof useAuth>;

const SEARCH_LABEL = "Search trades by commodity or counterparty";

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

async function renderPage() {
  const utils = renderWithQueryClient(<TradesPage />);
  const input = await screen.findByLabelText(SEARCH_LABEL);
  return { ...utils, input };
}

describe("Trades page search (#505)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue(AUTH);
    mockList.mockResolvedValue(EMPTY_PAGE);
  });

  it("debounces rapid typing into a single request with the final query", async () => {
    const { input } = await renderPage();

    // Initial load has no query.
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));
    expect(mockList.mock.calls[0][1]?.q).toBeUndefined();

    fireEvent.change(input, { target: { value: "ma" } });
    fireEvent.change(input, { target: { value: "mai" } });
    fireEvent.change(input, { target: { value: "maize" } });

    // Three keystrokes, one request, carrying only the final value.
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2), {
      timeout: 2000,
    });
    expect(mockList.mock.calls[1][1]?.q).toBe("maize");

    // Give the 300 ms window a chance to fire any (unexpected) extra requests.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it("shows a search-specific empty state and clears the query", async () => {
    const { input } = await renderPage();

    fireEvent.change(input, { target: { value: "cocoa" } });

    expect(await screen.findByText("No matching trades")).toBeInTheDocument();
    expect(screen.getByText(/No trades match “cocoa”/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    await waitFor(() => expect(screen.queryByText("No matching trades")).toBeNull());
    expect(screen.getByText("No trades yet")).toBeInTheDocument();
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("ignores whitespace-only input", async () => {
    const { input } = await renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));

    fireEvent.change(input, { target: { value: "   " } });

    // Trimmed to the same empty query key, so no refetch is issued at all.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(mockList.mock.calls[0][1]?.q).toBeUndefined();
  });
});
