import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Step1Details from "../steps/Step1Details";
import Step2Negotiation from "../steps/Step2Negotiation";
import Step3Review from "../steps/Step3Review";
import { TradeProvider, useTrade } from "../TradeContext";
import { ToastProvider } from "@/hooks/useToast";

jest.mock("@stellar/stellar-sdk", () => ({
  StrKey: {
    isValidEd25519PublicKey: jest.fn((address: string) => address.startsWith("G")),
  },
}));

jest.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    token: "test-token",
    isAuthenticated: true,
    isWalletConnected: true,
    connectWallet: jest.fn(),
    authenticate: jest.fn(),
  }),
}));

jest.mock("@/hooks/useOffline", () => ({ useOffline: () => ({ isOffline: false }) }));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => "/trades/create",
}));

jest.mock("@/stores/offlineQueueStore", () => ({
  useOfflineQueueStore: (selector: (s: { queue: unknown[] }) => unknown) =>
    selector({ queue: [] }),
}));

const VALID_SELLER = `G${"A".repeat(55)}`;

function renderStep(node: React.ReactNode) {
  return render(
    <TradeProvider>
      <ToastProvider>{node}</ToastProvider>
    </TradeProvider>,
  );
}

/** Surfaces the wizard step so we can assert the shortcut actually advanced it. */
function StepProbe() {
  const { step } = useTrade();
  return <span data-testid="current-step">{step}</span>;
}

async function fillStep1(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText(/commodity/i), "Maize");
  await user.type(screen.getByLabelText(/quantity/i), "500");
  await user.type(screen.getByLabelText(/price per unit/i), "450");
  await user.type(screen.getByLabelText(/seller stellar address/i), VALID_SELLER);
}

describe("trade wizard keyboard hints", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  describe("step 1 — details", () => {
    it("tells the user how to continue once the form is valid", async () => {
      const user = userEvent.setup();
      renderStep(
        <>
          <StepProbe />
          <Step1Details />
        </>,
      );
      await fillStep1(user);

      expect(screen.getByText("Press")).toBeInTheDocument();
      expect(screen.getByText("Enter")).toBeInTheDocument();
      expect(screen.getByText("to continue")).toBeInTheDocument();
    });

    it("prompts for the missing fields instead of advertising a shortcut that cannot fire", () => {
      renderStep(<Step1Details />);

      expect(
        screen.getByText("Complete the required fields to continue"),
      ).toBeInTheDocument();
      expect(screen.queryByText("Press")).not.toBeInTheDocument();
    });

    it("advances to step 2 when Enter is pressed in a field", async () => {
      const user = userEvent.setup();
      renderStep(
        <>
          <StepProbe />
          <Step1Details />
        </>,
      );
      await fillStep1(user);

      screen.getByLabelText(/seller stellar address/i).focus();
      await user.keyboard("{Enter}");

      expect(screen.getByTestId("current-step")).toHaveTextContent("2");
    });
  });

  describe("step 2 — negotiation", () => {
    it("advertises Enter to review", () => {
      renderStep(<Step2Negotiation />);

      expect(screen.getByText("Press")).toBeInTheDocument();
      expect(screen.getByText("Enter")).toBeInTheDocument();
      expect(screen.getByText("to review the trade")).toBeInTheDocument();
    });

    it("advances to step 3 when Enter is pressed", async () => {
      const user = userEvent.setup();
      renderStep(
        <>
          <StepProbe />
          <Step2Negotiation />
        </>,
      );

      screen.getByLabelText(/delivery window/i).focus();
      await user.keyboard("{Enter}");

      expect(screen.getByTestId("current-step")).toHaveTextContent("3");
    });

    it("does not advance when Enter is pressed on the Back button", async () => {
      const user = userEvent.setup();
      renderStep(
        <>
          <StepProbe />
          <Step2Negotiation />
        </>,
      );

      screen.getByRole("button", { name: "Back" }).focus();
      await user.keyboard("{Enter}");

      expect(screen.getByTestId("current-step")).toHaveTextContent("1");
    });
  });

  describe("step 3 — review", () => {
    it("explains the confirmation step rather than advertising Enter, which would lock funds", () => {
      renderStep(<Step3Review />);

      expect(
        screen.getByText("Confirm the legal disclaimer to lock funds"),
      ).toBeInTheDocument();
      expect(screen.queryByText("Press")).not.toBeInTheDocument();
    });

    it("offers Esc as the way out once the legal disclaimer is open", async () => {
      const user = userEvent.setup();
      localStorage.setItem(
        "amana:draft-trade",
        JSON.stringify({
          data: {
            commodity: "Maize",
            quantity: "500",
            unit: "kg",
            pricePerUnit: "450",
            currency: "NGN",
            sellerAddress: VALID_SELLER,
            buyerRatio: 50,
            sellerRatio: 50,
            deliveryDays: "7",
            notes: "",
          },
          step: 3,
        }),
      );

      renderStep(<Step3Review />);

      await user.click(
        screen.getByRole("button", { name: /lock funds & create trade/i }),
      );

      expect(screen.getByText("Esc")).toBeInTheDocument();
      expect(screen.getByText("to go back without locking funds")).toBeInTheDocument();
    });
  });
});
