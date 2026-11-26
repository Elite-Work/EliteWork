/**
 * Tests for the trades-list infinite scroll (#503)
 *
 * Covers: the first page is requested without a cursor, reaching the bottom
 * of the virtualized list requests the next cursor page, and the last page
 * stops requesting more.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import TradesPage from "@/app/trades/page";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";

jest.mock("@/hooks/useAuth", () => ({ useAuth: jest.fn() }));
jest.mock("@/components/AnalyticsProvider", () => ({
  useAnalytics: () => ({
    trackApiFailure: jest.fn(),
    trackFunnelStep: jest.fn(),
  }),
}));
jest.mock("@/hooks/useToast", () => ({
  useToast: () => ({ addToast: jest.fn() }),
}));
jest.mock("@/lib/api", () => ({
  api: { trades: { list: jest.fn() } },
  ApiError: class ApiError extends Error {},
}));

const mockList = api.trades.list as jest.MockedFunction<typeof api.trades.list>;
const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

const TRADE = (tradeId: string) => ({
  tradeId,
  buyerAddress: "GBUYER",
  sellerAddress: "GSELLER",
  amountCngn: "100",
  buyerLossBps: 5000,
  sellerLossBps: 5000,
  status: "FUNDED",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

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

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TradesPage />
    </QueryClientProvider>,
  );
}

/** jsdom does not lay elements out, so set the scroll geometry explicitly. */
function scrollToBottom(element: HTMLElement) {
  Object.defineProperty(element, "scrollTop", { configurable: true, value: 1000 });
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: 1000 });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: 600 });
  fireEvent.scroll(element);
}

describe("Trades page infinite scroll (#503)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue(AUTH);
  });

  it("requests the first page without a cursor", async () => {
    mockList.mockResolvedValueOnce({
      items: [TRADE("T1")],
      pageInfo: { nextCursor: "cursor-2", hasNextPage: true, limit: 20 },
    });

    renderPage();

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));
    expect(mockList.mock.calls[0][1]).toMatchObject({ limit: 20 });
    expect(mockList.mock.calls[0][1]?.cursor).toBeUndefined();
    expect(mockList.mock.calls[0][1]?.page).toBeUndefined();
  });

  it("loads the next page when the list is scrolled to the bottom", async () => {
    mockList
      .mockResolvedValueOnce({
        items: [TRADE("T1")],
        pageInfo: { nextCursor: "cursor-2", hasNextPage: true, limit: 20 },
      })
      .mockResolvedValueOnce({
        items: [TRADE("T2")],
        pageInfo: { nextCursor: null, hasNextPage: false, limit: 20 },
      });

    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));

    scrollToBottom(await screen.findByRole("list"));

    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
    expect(mockList.mock.calls[1][1]?.cursor).toBe("cursor-2");
  });

  it("does not request more once the last page is loaded", async () => {
    mockList.mockResolvedValueOnce({
      items: [TRADE("T1")],
      pageInfo: { nextCursor: null, hasNextPage: false, limit: 20 },
    });

    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(1));

    scrollToBottom(await screen.findByRole("list"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockList).toHaveBeenCalledTimes(1);
  });
});
