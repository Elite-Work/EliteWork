import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MediatorPanelClient from "../[id]/MediatorPanelClient";
import { useFreighterIdentity } from "@/hooks/useFreighterIdentity";
import { signTransaction } from "@stellar/freighter-api";
import { _clearAllForTests } from "@/lib/actionDedup";

const MEDIATOR_ADDRESS = "GEXAMPLEMEDIATORPUBLICKEY1";

jest.mock("@/hooks/useFreighterIdentity");
jest.mock("@stellar/freighter-api", () => ({
  signTransaction: jest.fn(),
}));

const mockSendTransaction = jest.fn();

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    Address: {
      fromString: jest.fn().mockReturnValue({
        toScVal: jest.fn(),
      }),
    },
    BASE_FEE: "100",
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn(),
    })),
    Networks: { TESTNET: "testnet", PUBLIC: "public" },
    TransactionBuilder: Object.assign(
      jest.fn().mockImplementation(() => ({
        addOperation: jest.fn().mockReturnThis(),
        setTimeout: jest.fn().mockReturnThis(),
        build: jest.fn().mockReturnValue({
          toXDR: jest.fn().mockReturnValue("mock-xdr"),
        }),
      })),
      {
        fromXDR: jest.fn().mockReturnValue({}),
      },
    ),
    nativeToScVal: jest.fn(),
    rpc: {
      Server: jest.fn().mockImplementation(() => ({
        getAccount: jest.fn().mockResolvedValue({ sequence: "1" }),
        prepareTransaction: jest.fn().mockResolvedValue({
          toXDR: jest.fn().mockReturnValue("mock-prepared-xdr"),
        }),
        sendTransaction: mockSendTransaction,
      })),
    },
  };
});

jest.mock("@/lib/api", () => ({
  api: {
    trades: {
      getEvidence: jest.fn().mockResolvedValue({ evidence: [] }),
    },
  },
  ApiError: class ApiError extends Error {},
}));

const mockUseFreighterIdentity = useFreighterIdentity as jest.MockedFunction<
  typeof useFreighterIdentity
>;
const mockSignTransaction = signTransaction as jest.MockedFunction<
  typeof signTransaction
>;

beforeEach(() => {
  jest.clearAllMocks();
  _clearAllForTests();
  process.env.NEXT_PUBLIC_CONTRACT_ID = "CA1234567890";
  process.env.NEXT_PUBLIC_RPC_URL = "https://soroban-testnet.stellar.org";
  process.env.NEXT_PUBLIC_MEDIATOR_WALLETS = MEDIATOR_ADDRESS;

  mockUseFreighterIdentity.mockReturnValue({
    address: MEDIATOR_ADDRESS,
    isAuthorized: true,
    isLoading: false,
    connectWallet: jest.fn(),
  });

  mockSignTransaction.mockResolvedValue({
    signedTxXdr: "mock-signed-xdr",
  } as unknown as Awaited<ReturnType<typeof signTransaction>>);

  mockSendTransaction.mockResolvedValue({
    status: "SUCCESS",
    hash: "0123456789abcdef",
  });
});

describe("MediatorPanelClient — optimistic dispute resolution UI (#112)", () => {
  it("renders Accept Dispute and Reject Dispute buttons with nature-tone styling", () => {
    render(<MediatorPanelClient disputeId="1" />);

    const acceptBtn = screen.getByTestId("mediator-accept-button");
    const rejectBtn = screen.getByTestId("mediator-reject-button");

    expect(acceptBtn).toBeInTheDocument();
    expect(acceptBtn).toHaveTextContent("Accept Dispute");
    expect(acceptBtn).toHaveTextContent("100% Refund to Buyer");

    expect(rejectBtn).toBeInTheDocument();
    expect(rejectBtn).toHaveTextContent("Reject Dispute");
    expect(rejectBtn).toHaveTextContent("100% Release to Seller");
  });

  it("opens modal with 0 bps (100% buyer refund) when clicking Accept Dispute", async () => {
    const user = userEvent.setup();
    render(<MediatorPanelClient disputeId="1" />);

    await user.click(screen.getByTestId("mediator-accept-button"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Confirm Resolution")).toBeInTheDocument();
    expect(screen.getByText("Buyer Receives:")).toBeInTheDocument();
    expect(screen.getByText("100.00%")).toBeInTheDocument();
    expect(screen.getByText("0.00%")).toBeInTheDocument(); // Seller receives 0%
  });

  it("opens modal with 10000 bps (100% seller release) when clicking Reject Dispute", async () => {
    const user = userEvent.setup();
    render(<MediatorPanelClient disputeId="1" />);

    await user.click(screen.getByTestId("mediator-reject-button"));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Confirm Resolution")).toBeInTheDocument();
    expect(screen.getByText("Seller Receives:")).toBeInTheDocument();
    expect(screen.getByText("100.00%")).toBeInTheDocument();
    expect(screen.getByText("0.00%")).toBeInTheDocument(); // Buyer receives 0%
  });

  it("displays optimistic resolution banner immediately upon confirming resolution", async () => {
    const user = userEvent.setup();
    // Keep transaction pending
    mockSendTransaction.mockReturnValue(new Promise(() => {}));

    render(<MediatorPanelClient disputeId="1" />);

    await user.click(screen.getByTestId("mediator-accept-button"));
    await user.click(screen.getByRole("button", { name: /confirm and sign resolution/i }));

    // Banner is rendered immediately in the DOM (optimistic UI)
    await waitFor(() => {
      expect(screen.getByTestId("optimistic-resolution-banner")).toBeInTheDocument();
    });
    expect(screen.getByText(/Pending on-chain/i)).toBeInTheDocument();
    expect(screen.getByText(/UI updated immediately/i)).toBeInTheDocument();
  });

  it("rolls back optimistic resolution on transaction failure", async () => {
    const user = userEvent.setup();
    mockSignTransaction.mockRejectedValueOnce(new Error("User dismissed Freighter popup"));

    render(<MediatorPanelClient disputeId="1" />);

    await user.click(screen.getByTestId("mediator-accept-button"));
    await user.click(screen.getByRole("button", { name: /confirm and sign resolution/i }));

    // Upon error, optimistic resolution banner is removed (snapshot rollback)
    await waitFor(() => {
      expect(screen.queryByTestId("optimistic-resolution-banner")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/Resolution reverted: User dismissed Freighter popup/i)).toBeInTheDocument();
    // Buttons are re-enabled
    expect(screen.getByTestId("mediator-accept-button")).not.toBeDisabled();
  });
});
