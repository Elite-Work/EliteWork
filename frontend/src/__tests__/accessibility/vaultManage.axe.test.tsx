import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import VaultManagePage from "@/app/vault/manage/page";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";

expect.extend(toHaveNoViolations);

jest.mock("next/link", () => {
  const MockLink = ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  );
  MockLink.displayName = "MockLink";
  return MockLink;
});

jest.mock("@/hooks/useAuth");
jest.mock("@/lib/api", () => ({
  api: {
    trades: {
      getStats: jest.fn(),
      list: jest.fn(),
      deposit: jest.fn(),
      releaseFunds: jest.fn(),
      initiateDispute: jest.fn(),
    },
    wallet: { getBalance: jest.fn() },
  },
  ApiError: class ApiError extends Error {},
}));

// Vault sub-components have their own coverage; stub them so this file audits the page itself
jest.mock("@/components/vault", () => ({
  PaymentOverviewCard: () => <div data-testid="payment-overview" />,
  AuditLogCard: () => <div data-testid="audit-log" />,
  NetworkBackboneCard: () => <div data-testid="network-backbone" />,
  VaultFooter: () => <div data-testid="vault-footer" />,
}));

const mockUseAuth = useAuth as jest.MockedFunction<typeof useAuth>;

const AUTH = {
  address: "GABCDEF1234567890",
  shortAddress: "GABCD...F1234",
  token: "jwt-token",
  isAuthenticated: true,
  isWalletConnected: true,
  isWalletDetected: true,
  isLoading: false,
  error: null,
  connectWallet: jest.fn(),
  authenticate: jest.fn(),
  logout: jest.fn(),
  refreshAuth: jest.fn(),
};

const TRADES = [
  {
    tradeId: "trade-pending-0001",
    buyerAddress: "GBUYER1234567890",
    sellerAddress: "GSELLER1234567890",
    amountCngn: "1000",
    buyerLossBps: 5000,
    sellerLossBps: 5000,
    status: "PENDING",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z",
  },
  {
    tradeId: "trade-locked-0002",
    buyerAddress: "GBUYER1234567890",
    sellerAddress: "GSELLER1234567890",
    amountCngn: "2500",
    buyerLossBps: 5000,
    sellerLossBps: 5000,
    status: "LOCKED",
    createdAt: "2026-08-03T00:00:00Z",
    updatedAt: "2026-08-04T00:00:00Z",
  },
];

async function renderLoadedPage() {
  const view = render(<VaultManagePage />);
  await screen.findByText("Escrow Positions");
  await waitFor(() => expect(screen.getByText("Deposit")).toBeInTheDocument());
  return view;
}

describe("Accessibility audit — /vault/manage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue(AUTH);
    (api.trades.getStats as jest.Mock).mockResolvedValue({ totalTrades: 2, openTrades: 2 });
    (api.trades.list as jest.Mock).mockResolvedValue({
      items: TRADES,
      pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
    });
    (api.wallet.getBalance as jest.Mock).mockResolvedValue({ balance: "5000", asset: "cNGN" });
  });

  it("unauthenticated auth gate has no axe violations", async () => {
    mockUseAuth.mockReturnValue({ ...AUTH, isAuthenticated: false, token: null });
    const { container } = render(<VaultManagePage />);
    expect(screen.getByText("Authentication required")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("loaded escrow positions table has no axe violations", async () => {
    const { container } = await renderLoadedPage();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("empty state has no axe violations", async () => {
    (api.trades.list as jest.Mock).mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 50, total: 0, totalPages: 0 },
    });
    const { container } = render(<VaultManagePage />);
    await waitFor(() => expect(api.wallet.getBalance).toHaveBeenCalled());
    await screen.findByText(/escrow\s+positions/i, { selector: "p" });
    expect(await axe(container)).toHaveNoViolations();
  });

  it("load error banner has no axe violations", async () => {
    (api.trades.getStats as jest.Mock).mockRejectedValue(new Error("Failed to load vault data"));
    const { container } = render(<VaultManagePage />);
    await screen.findByText("Failed to load vault data");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("release confirmation dialog has no axe violations", async () => {
    const user = userEvent.setup();
    const { container } = await renderLoadedPage();
    await user.click(screen.getByRole("button", { name: "Release" }));
    expect(screen.getByRole("dialog", { name: "Release Funds" })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("dispute dialog with its form fields has no axe violations", async () => {
    const user = userEvent.setup();
    const { container } = await renderLoadedPage();
    await user.click(screen.getAllByRole("button", { name: "Dispute" })[0]);
    expect(screen.getByRole("dialog", { name: "Initiate Dispute" })).toBeInTheDocument();
    expect(screen.getByLabelText("Category")).toBeInTheDocument();
    expect(screen.getByLabelText("Reason")).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
