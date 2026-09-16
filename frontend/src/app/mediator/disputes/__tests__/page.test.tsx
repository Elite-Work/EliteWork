import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MediatorDisputesPage from "../page";
import { useAuth } from "@/hooks/useAuth";
import { useFreighterIdentity } from "@/hooks/useFreighterIdentity";
import { api, ApiError } from "@/lib/api";
import type { DisputeResponse } from "@/lib/api/types";

jest.mock("@/hooks/useAuth");
jest.mock("@/hooks/useFreighterIdentity");
jest.mock("@/lib/api", () => ({
  api: {
    disputes: {
      list: jest.fn(),
    },
  },
  ApiError: class ApiError extends Error {
    status: number;
    data: unknown;
    constructor(status: number, message: string, data?: unknown) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.data = data;
    }
  },
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockUseFreighterIdentity = useFreighterIdentity as jest.MockedFunction<
  typeof useFreighterIdentity
>;
const mockList = api.disputes.list as jest.MockedFunction<typeof api.disputes.list>;

const MEDIATOR_ADDRESS = "GEXAMPLEMEDIATORPUBLICKEY1";

function makeDispute(overrides: Partial<DisputeResponse> = {}): DisputeResponse {
  return {
    id: 1,
    tradeId: "trade-1",
    status: "OPEN",
    initiator: "GBUYER1234567890",
    reason: "Goods not delivered",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    trade: {
      buyerAddress: "GBUYER1234567890",
      sellerAddress: "GSELLER1234567890",
      amountUsdc: "100",
    },
    ...overrides,
  };
}

describe("MediatorDisputesPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      token: "test-token",
      isAuthenticated: true,
    } as ReturnType<typeof useAuth>);
    mockUseFreighterIdentity.mockReturnValue({
      address: MEDIATOR_ADDRESS,
    } as ReturnType<typeof useFreighterIdentity>);
  });

  it("shows a skeleton while loading", async () => {
    mockList.mockReturnValue(new Promise(() => {}));

    const { container } = render(<MediatorDisputesPage />);

    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
  });

  it("shows a retryable error state with actionable messaging when the fetch fails", async () => {
    mockList.mockRejectedValueOnce(new ApiError(500, "Failed to reach disputes service"));

    render(<MediatorDisputesPage />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load disputes")).toBeInTheDocument();
    });
    expect(screen.getByText("Failed to reach disputes service")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("refetches disputes when the retry button is clicked", async () => {
    mockList
      .mockRejectedValueOnce(new ApiError(500, "Failed to reach disputes service"))
      .mockResolvedValueOnce({
        items: [makeDispute()],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      });

    render(<MediatorDisputesPage />);

    await waitFor(() => {
      expect(screen.getByText("Couldn't load disputes")).toBeInTheDocument();
    });

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => {
      expect(screen.getByText(/Trade trade-1/)).toBeInTheDocument();
    });
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it("renders status filters as the shared Tabs component", async () => {
    mockList.mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 1 } });

    render(<MediatorDisputesPage />);

    await waitFor(() => {
      expect(screen.getByRole("tablist")).toBeInTheDocument();
    });
    expect(screen.getByRole("tab", { name: "Open" })).toBeInTheDocument();
  });
});
