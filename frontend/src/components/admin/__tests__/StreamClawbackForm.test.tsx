import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StreamClawbackForm } from "../StreamClawbackForm";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/hooks/useToast";

jest.mock("@/lib/api", () => {
  const { ApiError: RealApiError } = jest.requireActual("@/lib/api/client");
  return {
    api: {
      adminStreams: {
        clawbackPreview: jest.fn(),
      },
    },
    ApiError: RealApiError,
  };
});

const mockAddToast = jest.fn();
jest.mock("@/hooks/useToast", () => ({
  useToast: jest.fn(),
}));

const mockUseToast = useToast as jest.MockedFunction<typeof useToast>;
const mockClawbackPreview = api.adminStreams.clawbackPreview as jest.MockedFunction<
  typeof api.adminStreams.clawbackPreview
>;

describe("StreamClawbackForm", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseToast.mockReturnValue({
      toasts: [],
      addToast: mockAddToast,
      removeToast: jest.fn(),
      addToastWithCorrelation: jest.fn(),
      updateToast: jest.fn(),
      dismissByCorrelation: jest.fn(),
    });
  });

  const renderForm = (onSuccess?: jest.Mock) =>
    render(
      <StreamClawbackForm
        token="test-token"
        streamId="stream-abc-123"
        remainingVested="7500"
        onSuccess={onSuccess}
      />,
    );

  // ── Client-side validation (#57) ─────────────────────────────────────

  it("disables the review button while the amount field is empty", () => {
    renderForm();
    expect(screen.getByRole("button", { name: /review clawback/i })).toBeDisabled();
  });

  it("shows a clear validation error and disables review for an amount exceeding the remaining balance", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/clawback amount/i), "7501");

    expect(screen.getByText(/cannot exceed the remaining vested balance of 7500/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review clawback/i })).toBeDisabled();
  });

  it("shows a clear validation error for a zero amount", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/clawback amount/i), "0");

    expect(screen.getByText(/greater than zero/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review clawback/i })).toBeDisabled();
  });

  it("enables the review button for a valid amount within the remaining balance", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/clawback amount/i), "3000");

    expect(screen.queryByText(/cannot exceed|greater than zero|whole number/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /review clawback/i })).toBeEnabled();
  });

  // ── Confirmation modal (#56) ─────────────────────────────────────────

  it("opens the confirmation modal with the entered amount instead of submitting immediately", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/clawback amount/i), "3000");
    await user.click(screen.getByRole("button", { name: /review clawback/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mockClawbackPreview).not.toHaveBeenCalled();
    expect(screen.getByText("stream-abc-123")).toBeInTheDocument();
  });

  it("does not call the API when the modal is cancelled", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/clawback amount/i), "3000");
    await user.click(screen.getByRole("button", { name: /review clawback/i }));
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockClawbackPreview).not.toHaveBeenCalled();
  });

  // ── Submission + error mapping (#59) ─────────────────────────────────

  it("submits the clawback preview only after confirming, and reports success", async () => {
    const user = userEvent.setup();
    const onSuccess = jest.fn();
    mockClawbackPreview.mockResolvedValueOnce({
      streamId: "stream-abc-123",
      remainingVested: "7500",
      requestedClawback: "3000",
      postClawbackBalance: "4500",
      preview: true,
      timestamp: "2026-07-30T12:00:00.000Z",
    });

    renderForm(onSuccess);

    await user.type(screen.getByLabelText(/clawback amount/i), "3000");
    await user.click(screen.getByRole("button", { name: /review clawback/i }));
    await user.click(screen.getByRole("button", { name: /confirm clawback/i }));

    await waitFor(() => {
      expect(mockClawbackPreview).toHaveBeenCalledWith("test-token", "stream-abc-123", "3000");
    });
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ postClawbackBalance: "4500" }),
    );
    expect(mockAddToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success" }),
    );
  });

  it("shows the CLAWBACK_TOO_LARGE tailored message when the backend rejects the amount", async () => {
    const user = userEvent.setup();
    mockClawbackPreview.mockRejectedValueOnce(
      new ApiError(400, "Requested clawback 3000 exceeds remaining vested amount 2000", {
        code: "CLAWBACK_TOO_LARGE",
        message: "Requested clawback 3000 exceeds remaining vested amount 2000",
        details: { remainingVested: "2000" },
        timestamp: new Date().toISOString(),
      }),
    );

    renderForm();

    await user.type(screen.getByLabelText(/clawback amount/i), "3000");
    await user.click(screen.getByRole("button", { name: /review clawback/i }));
    await user.click(screen.getByRole("button", { name: /confirm clawback/i }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Amount Too Large" }),
      );
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a generic message for a 403 response", async () => {
    const user = userEvent.setup();
    mockClawbackPreview.mockRejectedValueOnce(
      new ApiError(403, "Forbidden: admin access required", {
        error: "Forbidden: admin access required",
      }),
    );

    renderForm();

    await user.type(screen.getByLabelText(/clawback amount/i), "3000");
    await user.click(screen.getByRole("button", { name: /review clawback/i }));
    await user.click(screen.getByRole("button", { name: /confirm clawback/i }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Error 403", type: "error" }),
      );
    });
  });

  it("shows a generic message for a 500 response", async () => {
    const user = userEvent.setup();
    mockClawbackPreview.mockRejectedValueOnce(
      new ApiError(500, "Internal server error", { error: "Internal server error" }),
    );

    renderForm();

    await user.type(screen.getByLabelText(/clawback amount/i), "3000");
    await user.click(screen.getByRole("button", { name: /review clawback/i }));
    await user.click(screen.getByRole("button", { name: /confirm clawback/i }));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Error 500", type: "error" }),
      );
    });
  });
});
