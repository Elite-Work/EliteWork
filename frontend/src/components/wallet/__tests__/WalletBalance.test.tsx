import { render, screen } from "@testing-library/react";
import { WalletBalance } from "../WalletBalance";

describe("WalletBalance", () => {
  it("connected: shows the formatted balance and asset", () => {
    render(<WalletBalance connected balance="1234.5" asset="cNGN" />);
    expect(screen.getByTestId("wallet-balance")).toHaveTextContent("1,234.5 cNGN");
  });

  it("connected: shows a placeholder when no balance is available", () => {
    render(<WalletBalance connected />);
    expect(screen.getByTestId("wallet-balance")).toHaveTextContent("—");
  });

  it("disconnected: prompts to connect and hides the balance", () => {
    render(<WalletBalance connected={false} balance="10" asset="cNGN" />);
    expect(screen.getByText(/connect your wallet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("wallet-balance")).not.toBeInTheDocument();
  });

  it("loading: hides the balance while fetching", () => {
    render(<WalletBalance connected loading balance="10" asset="cNGN" />);
    expect(screen.queryByTestId("wallet-balance")).not.toBeInTheDocument();
  });
});
