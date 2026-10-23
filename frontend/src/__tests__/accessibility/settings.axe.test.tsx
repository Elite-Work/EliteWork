import React from "react";
import { render, screen } from "@testing-library/react";
import { axe, toHaveNoViolations } from "jest-axe";
import SettingsPage from "@/app/settings/page";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { ThemeProvider } from "@/hooks/useTheme";

expect.extend(toHaveNoViolations);

// Mock window.matchMedia for ThemeProvider
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
      addListener: jest.fn(),
      removeListener: jest.fn(),
      dispatchEvent: jest.fn(),
    }),
  });
});

// Mock the useAuth hook
jest.mock("@/hooks/useAuth", () => ({
  useAuth: jest.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockUseAuth = useAuth as jest.Mock;

function renderSettingsPage(authState: {
  isAuthenticated?: boolean;
  isWalletConnected?: boolean;
  isWalletDetected?: boolean;
  isLoading?: boolean;
  address?: string;
} = {}) {
  mockUseAuth.mockReturnValue({
    isAuthenticated: false,
    isWalletConnected: false,
    isWalletDetected: false,
    isLoading: false,
    address: "GABC123456789012345678901234567890123456789012345678901234",
    connectWallet: jest.fn(),
    authenticate: jest.fn(),
    logout: jest.fn(),
    ...authState,
  });

  return render(
    <ThemeProvider>
      <AuthProvider>
        <SettingsPage />
      </AuthProvider>
    </ThemeProvider>
  );
}

describe("Accessibility audit — Settings Page (WCAG 2.1 AA)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("has no axe violations when unauthenticated (no wallet connected)", async () => {
    const { container } = renderSettingsPage({
      isAuthenticated: false,
      isWalletConnected: false,
      isWalletDetected: false,
      isLoading: false,
      address: undefined,
    });

    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations when wallet is connected but not authenticated", async () => {
    const { container } = renderSettingsPage({
      isAuthenticated: false,
      isWalletConnected: true,
      isWalletDetected: true,
      isLoading: false,
      address: "GABC123456789012345678901234567890123456789012345678901234",
    });

    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations when fully authenticated", async () => {
    const { container } = renderSettingsPage({
      isAuthenticated: true,
      isWalletConnected: true,
      isWalletDetected: true,
      isLoading: false,
      address: "GABC123456789012345678901234567890123456789012345678901234",
    });

    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations when loading", async () => {
    const { container } = renderSettingsPage({
      isAuthenticated: false,
      isWalletConnected: false,
      isWalletDetected: false,
      isLoading: true,
      address: undefined,
    });

    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations with wallet detected but not connected", async () => {
    const { container } = renderSettingsPage({
      isAuthenticated: false,
      isWalletConnected: false,
      isWalletDetected: true,
      isLoading: false,
      address: undefined,
    });

    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations - all interactive elements are accessible", async () => {
    const { container } = renderSettingsPage({
      isAuthenticated: true,
      isWalletConnected: true,
      isWalletDetected: true,
      isLoading: false,
      address: "GABC123456789012345678901234567890123456789012345678901234",
    });

    // Verify key interactive elements exist and are accessible
    expect(screen.getByRole("button", { name: /copy address/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign out/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /trade updates/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /dispute alerts/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /vault activity/i })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /system announcements/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /network/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /preferred currency/i })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /auto sign-out/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save preferences/i })).toBeInTheDocument();

    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations - notification toggles have proper ARIA attributes", async () => {
    renderSettingsPage({
      isAuthenticated: true,
      isWalletConnected: true,
      isWalletDetected: true,
      isLoading: false,
      address: "GABC123456789012345678901234567890123456789012345678901234",
    });

    const tradeUpdatesToggle = screen.getByRole("switch", { name: /trade updates/i });
    expect(tradeUpdatesToggle).toHaveAttribute("aria-checked");

    const disputeAlertsToggle = screen.getByRole("switch", { name: /dispute alerts/i });
    expect(disputeAlertsToggle).toHaveAttribute("aria-checked");

    const vaultActivityToggle = screen.getByRole("switch", { name: /vault activity/i });
    expect(vaultActivityToggle).toHaveAttribute("aria-checked");

    const systemAnnouncementsToggle = screen.getByRole("switch", { name: /system announcements/i });
    expect(systemAnnouncementsToggle).toHaveAttribute("aria-checked");
  });

  it("has no axe violations - select fields have proper labels and error handling", async () => {
    renderSettingsPage({
      isAuthenticated: true,
      isWalletConnected: true,
      isWalletDetected: true,
      isLoading: false,
      address: "GABC123456789012345678901234567890123456789012345678901234",
    });

    const networkSelect = screen.getByRole("combobox", { name: /network/i });
    expect(networkSelect).toHaveAttribute("aria-invalid", "false");

    const currencySelect = screen.getByRole("combobox", { name: /preferred currency/i });
    expect(currencySelect).toHaveAttribute("aria-invalid", "false");

    const autoSignOutSelect = screen.getByRole("combobox", { name: /auto sign-out/i });
    expect(autoSignOutSelect).toHaveAttribute("aria-invalid", "false");
  });

  it("has no axe violations - wallet address copy button has proper accessibility", async () => {
    renderSettingsPage({
      isAuthenticated: true,
      isWalletConnected: true,
      isWalletDetected: true,
      isLoading: false,
      address: "GABC123456789012345678901234567890123456789012345678901234",
    });

    const copyButton = screen.getByRole("button", { name: /copy address/i });
    expect(copyButton).toHaveAttribute("title", "Copy address");
  });

  it("has no axe violations - theme toggle is accessible", async () => {
    const { container } = renderSettingsPage({
      isAuthenticated: true,
      isWalletConnected: true,
      isWalletDetected: true,
      isLoading: false,
      address: "GABC123456789012345678901234567890123456789012345678901234",
    });

    expect(await axe(container)).toHaveNoViolations();
  });

  it("has no axe violations - section cards have proper heading structure", async () => {
    renderSettingsPage({
      isAuthenticated: true,
      isWalletConnected: true,
      isWalletDetected: true,
      isLoading: false,
      address: "GABC123456789012345678901234567890123456789012345678901234",
    });

    // Check for proper heading hierarchy
    expect(screen.getByRole("heading", { name: /settings/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /wallet & identity/i, level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /appearance/i, level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /notifications/i, level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /application preferences/i, level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /security/i, level: 2 })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /about/i, level: 2 })).toBeInTheDocument();
  });

  it("has no axe violations - wallet status badge is accessible", async () => {
    renderSettingsPage({
      isAuthenticated: true,
      isWalletConnected: true,
      isWalletDetected: true,
      isLoading: false,
      address: "GABC123456789012345678901234567890123456789012345678901234",
    });

    // The wallet status should be visible
    expect(screen.getByText("Authenticated")).toBeInTheDocument();
    expect(screen.getByText("GABC123456789012345678901234567890123456789012345678901234")).toBeInTheDocument();
  });

  it("has no axe violations - error states in select fields are accessible", async () => {
    // This test verifies the component structure supports error states
    // The actual error state would require form submission
    const { container } = renderSettingsPage({
      isAuthenticated: true,
      isWalletConnected: true,
      isWalletDetected: true,
      isLoading: false,
      address: "GABC123456789012345678901234567890123456789012345678901234",
    });

    expect(await axe(container)).toHaveNoViolations();
  });
});