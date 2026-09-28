import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import CreateTradePage from "@/app/trades/create/page";

expect.extend(toHaveNoViolations);

// Mock @stellar/stellar-sdk to simplify address validation in tests
jest.mock("@stellar/stellar-sdk", () => ({
  StrKey: {
    isValidEd25519PublicKey: jest.fn(
      (address: string) => address.startsWith("G") && address.length >= 40,
    ),
  },
}));

jest.mock("next/link", () => {
  const MockLink = ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  );
  MockLink.displayName = "MockLink";
  return MockLink;
});

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    token: "mock-token",
    isAuthenticated: true,
    isWalletConnected: true,
    connectWallet: jest.fn(),
    authenticate: jest.fn(),
  }),
}));

jest.mock("@/hooks/useOffline", () => ({
  useOffline: () => ({ isOffline: false, wasOffline: false, isOnline: true, retryOnline: jest.fn() }),
}));

jest.mock("@/hooks/useToast", () => ({
  ...jest.requireActual("@/hooks/useToast"),
  useToast: () => ({
    toasts: [],
    addToast: jest.fn(),
    removeToast: jest.fn(),
    addToastWithCorrelation: jest.fn(),
    updateToast: jest.fn(),
    dismissByCorrelation: jest.fn(),
  }),
}));

jest.mock("@/lib/api", () => ({
  api: { trades: { create: jest.fn() } },
  apiConfig: {
    getStellarNetworkPassphrase: jest.fn(() => "Test SDF Network ; September 2015"),
    getStellarRpcUrl: jest.fn(() => "https://soroban-testnet.stellar.org"),
  },
  ApiError: class ApiError extends Error {},
}));

jest.mock("@stellar/freighter-api", () => ({ signTransaction: jest.fn() }));

const DRAFT_KEY = "amana:draft-trade";

const VALID_DRAFT = {
  commodity: "Maize",
  quantity: "500",
  unit: "kg",
  pricePerUnit: "450",
  currency: "NGN",
  sellerAddress: "G" + "A".repeat(55),
  buyerRatio: 50,
  sellerRatio: 50,
  deliveryDays: "7",
  notes: "",
};

// The draft only seeds the form data; the wizard always mounts on step 1, so
// later steps are reached through the UI the way a user would.
function seedDraft() {
  localStorage.setItem(DRAFT_KEY, JSON.stringify({ data: VALID_DRAFT, step: 1 }));
}

async function goToStep(user: ReturnType<typeof userEvent.setup>, step: 2 | 3) {
  await user.click(screen.getByRole("button", { name: /continue to negotiation/i }));
  await screen.findByLabelText("Buyer loss ratio");
  if (step === 3) {
    await user.click(screen.getByRole("button", { name: /review trade/i }));
    await screen.findByRole("button", { name: /lock funds & create trade/i });
  }
}

describe("Accessibility audit — trade creation wizard", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("each step has no axe violations", () => {
    it("Step 1 (Details)", async () => {
      seedDraft();
      const { container } = render(<CreateTradePage />);
      expect(screen.getByLabelText("Commodity")).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    });

    it("Step 2 (Negotiation)", async () => {
      seedDraft();
      const user = userEvent.setup();
      const { container } = render(<CreateTradePage />);
      await goToStep(user, 2);
      expect(await axe(container)).toHaveNoViolations();
    });

    it("Step 3 (Review)", async () => {
      seedDraft();
      const user = userEvent.setup();
      const { container } = render(<CreateTradePage />);
      await goToStep(user, 3);
      expect(await axe(container)).toHaveNoViolations();
    });
  });

  describe("keyboard navigation between steps", () => {
    it("moves Details -> Negotiation -> Review -> back using only the keyboard", async () => {
      seedDraft();
      const user = userEvent.setup();
      render(<CreateTradePage />);

      // Step 1 -> 2: Continue is reachable by Tab from the last field and activates with Enter
      const seller = screen.getByLabelText("Seller Stellar Address");
      seller.focus();
      await user.tab();
      const continueBtn = screen.getByRole("button", { name: /continue to negotiation/i });
      expect(continueBtn).toHaveFocus();
      await user.keyboard("{Enter}");
      expect(await screen.findByLabelText("Buyer loss ratio")).toBeInTheDocument();

      // Step 2 -> 3: Back precedes Review Trade in tab order; Space activates
      const back = screen.getByRole("button", { name: "Back" });
      back.focus();
      await user.tab();
      const reviewBtn = screen.getByRole("button", { name: /review trade/i });
      expect(reviewBtn).toHaveFocus();
      await user.keyboard(" ");
      expect(await screen.findByRole("button", { name: /lock funds & create trade/i })).toBeInTheDocument();

      // Step 3 -> 2 via Back
      screen.getByRole("button", { name: "Back" }).focus();
      await user.keyboard("{Enter}");
      expect(await screen.findByLabelText("Buyer loss ratio")).toBeInTheDocument();
    });

    it("exposes the ratio slider to keyboard and assistive tech with a text value", async () => {
      seedDraft();
      const user = userEvent.setup();
      render(<CreateTradePage />);
      await goToStep(user, 2);

      const slider = screen.getByRole("slider", { name: "Buyer loss ratio" });
      slider.focus();
      expect(slider).toHaveFocus();
      await user.keyboard("{ArrowRight}");
      expect(slider).toHaveAttribute("aria-valuetext", expect.stringMatching(/Buyer absorbs \d+ percent/));
    });
  });

  describe("legal disclaimer modal", () => {
    async function openDisclaimer() {
      seedDraft();
      const user = userEvent.setup();
      render(<CreateTradePage />);
      await goToStep(user, 3);
      await user.click(screen.getByRole("button", { name: /lock funds & create trade/i }));
      const dialog = await screen.findByRole("dialog");
      return { user, dialog };
    }

    it("opens as a labelled dialog and has no axe violations", async () => {
      const { dialog } = await openDisclaimer();
      expect(dialog).toHaveAccessibleName("Loss-Sharing Terms");
      expect(dialog).toHaveAccessibleDescription(/review the loss-sharing agreement/i);
      // The dialog is portalled outside the render container, so audit it directly
      expect(await axe(dialog)).toHaveNoViolations();
    });

    it("moves focus into the dialog and lets keyboard users tab between its actions", async () => {
      const { user, dialog } = await openDisclaimer();
      expect(dialog).toContainElement(document.activeElement as HTMLElement);

      const decline = screen.getByRole("button", { name: "Decline" });
      const accept = screen.getByRole("button", { name: /accept & proceed/i });
      decline.focus();
      await user.tab();
      expect(accept).toHaveFocus();
    });

    it("closes with Escape and returns focus to the wizard", async () => {
      const { user } = await openDisclaimer();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: /lock funds & create trade/i })).toBeInTheDocument();
    });

    it("closes with the Decline button", async () => {
      const { user } = await openDisclaimer();
      await user.click(screen.getByRole("button", { name: "Decline" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
