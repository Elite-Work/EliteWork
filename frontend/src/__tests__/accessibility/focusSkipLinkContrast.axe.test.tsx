import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import { usePathname } from "next/navigation";
import { GlobalSearch } from "@/components/GlobalSearch";
import { AppShell } from "@/components/layout/AppShell";
import MediatorPanelClient from "@/app/mediator/disputes/[id]/MediatorPanelClient";

expect.extend(toHaveNoViolations);

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: jest.fn(),
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ token: "test-token" }),
}));

jest.mock("@/lib/api", () => ({
  api: {
    search: { query: jest.fn() },
    trades: { getEvidence: jest.fn() },
  },
  ApiError: class ApiError extends Error {
    status = 500;
  },
}));

jest.mock("@/components/layout/AppTopNav", () => ({ AppTopNav: () => null }));
jest.mock("@/components/layout/AppSidebar", () => ({ AppSidebar: () => null }));
jest.mock("@/components/ui/ConnectivityBanner", () => ({
  ConnectivityBanner: () => null,
}));

jest.mock("@/hooks/useFreighterIdentity", () => ({
  useFreighterIdentity: () => ({
    address: null,
    isAuthorized: false,
    isLoading: false,
    connectWallet: jest.fn(),
  }),
}));
jest.mock("@stellar/freighter-api", () => ({ signTransaction: jest.fn() }));
jest.mock("@stellar/stellar-sdk", () => ({
  Address: jest.fn(),
  BASE_FEE: "100",
  Contract: jest.fn(),
  Networks: { TESTNET: "Test SDF Network ; September 2015" },
  TransactionBuilder: jest.fn(),
  nativeToScVal: jest.fn(),
  rpc: { Server: jest.fn() },
}));

const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;

describe("GlobalSearch focus management (#84)", () => {
  it("moves focus into the search input on open and back to the trigger on close", async () => {
    render(<GlobalSearch />);
    const trigger = screen.getByRole("button", { name: /open global search/i });

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("searchbox")).toHaveFocus());

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /open global search/i }),
    ).toHaveFocus();
    expect(trigger).not.toBeInTheDocument();
  });

  it("returns focus to the trigger when closed with the Esc button", () => {
    render(<GlobalSearch />);
    fireEvent.keyDown(document, { key: "k", metaKey: true });
    fireEvent.click(screen.getByRole("button", { name: /close search/i }));
    expect(
      screen.getByRole("button", { name: /open global search/i }),
    ).toHaveFocus();
  });
});

describe("Status badge contrast in dark mode (#85)", () => {
  // Dark-theme tokens from src/app/globals.css
  const SURFACES = ["#0B1A14", "#122A1F", "#1A3D2C"];
  const BADGES = { "status-warning": "#F59E0B", "status-locked": "#D4A853" };
  const AA_NORMAL_TEXT = 4.5;

  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);

  function luminance(rgb: number[]) {
    const [r, g, b] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function contrastOnTint(fg: string, surface: string, alpha: number) {
    const fgRgb = [1, 3, 5].map((i) => channel(fg, i));
    const bgRgb = [1, 3, 5].map((i) => channel(surface, i));
    const tint = fgRgb.map((v, i) => alpha * v + (1 - alpha) * bgRgb[i]);
    const [hi, lo] = [luminance(fgRgb), luminance(tint)].sort((a, b) => b - a);
    return (hi + 0.05) / (lo + 0.05);
  }

  it.each(Object.entries(BADGES))(
    "%s text meets WCAG AA on its /10 tint over every dark surface",
    (_name, fg) => {
      for (const surface of SURFACES) {
        expect(contrastOnTint(fg, surface, 0.1)).toBeGreaterThanOrEqual(
          AA_NORMAL_TEXT,
        );
      }
    },
  );
});

describe("Admin skip-to-content link (#86)", () => {
  it("renders a skip link targeting the main landmark on admin routes", async () => {
    mockUsePathname.mockReturnValue("/admin/streams");
    const { container } = render(
      <AppShell>
        <h1>Admin</h1>
      </AppShell>,
    );

    const link = screen.getByRole("link", { name: /skip to main content/i });
    expect(link).toHaveAttribute("href", "#main-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("does not render the skip link outside admin routes", () => {
    mockUsePathname.mockReturnValue("/trades");
    render(
      <AppShell>
        <h1>Trades</h1>
      </AppShell>,
    );
    expect(
      screen.queryByRole("link", { name: /skip to main content/i }),
    ).not.toBeInTheDocument();
  });
});

describe("Mediator evidence video keyboard operability (#87)", () => {
  it("uses native, focusable, labelled controls", async () => {
    window.history.replaceState(
      {},
      "",
      `/?cid=Qm${"a".repeat(44)}`,
    );
    render(<MediatorPanelClient disputeId="1" />);

    const video = await screen.findByLabelText("Dispute evidence video");
    expect(video.tagName).toBe("VIDEO");
    expect(video).toHaveAttribute("controls");
    expect(video).not.toHaveAttribute("tabindex", "-1");
  });
});
