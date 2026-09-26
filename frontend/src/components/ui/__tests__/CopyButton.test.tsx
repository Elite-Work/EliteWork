import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CopyButton } from "../CopyButton";

describe("CopyButton", () => {
  const tradeId = "trade-8f3c2b71-4d9a-4c6e-9f21-0a5b7d3e1c44";

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("labels the control after the value it copies", () => {
    render(<CopyButton value={tradeId} label="Trade ID" />);

    expect(screen.getByLabelText("Copy Trade ID")).toBeInTheDocument();
    expect(screen.getByTitle("Copy Trade ID")).toBeInTheDocument();
  });

  it("copies the full value to the clipboard, not the truncated display text", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CopyButton value={tradeId} label="Trade ID" />);
    fireEvent.click(screen.getByLabelText("Copy Trade ID"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(tradeId);
    });
  });

  it("shows a copied confirmation and returns to idle after 2s", async () => {
    jest.useFakeTimers();
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CopyButton value={tradeId} label="Trade ID" />);
    const button = screen.getByLabelText("Copy Trade ID");
    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toHaveAttribute("data-state", "copied");
    });
    expect(button).toHaveAttribute("title", "Trade ID copied");
    expect(screen.getByRole("status")).toHaveTextContent("Trade ID copied");

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(button).toHaveAttribute("data-state", "idle");
    expect(button).toHaveAttribute("title", "Copy Trade ID");
  });

  it("reports a failure instead of silently swallowing a rejected clipboard write", async () => {
    const writeText = jest.fn().mockRejectedValue(new Error("denied"));
    Object.assign(navigator, { clipboard: { writeText } });

    render(<CopyButton value={tradeId} label="transaction hash" />);
    const button = screen.getByLabelText("Copy transaction hash");
    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toHaveAttribute("data-state", "failed");
    });
    expect(button).toHaveAttribute("title", "Could not copy transaction hash");
  });

  it("does not let the click bubble into a clickable row", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const rowClick = jest.fn();

    render(
      <div onClick={rowClick}>
        <CopyButton value={tradeId} label="Trade ID" />
      </div>,
    );
    fireEvent.click(screen.getByLabelText("Copy Trade ID"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(rowClick).not.toHaveBeenCalled();
  });
});
