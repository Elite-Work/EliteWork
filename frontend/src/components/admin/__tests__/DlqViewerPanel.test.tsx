import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DlqViewerPanel } from "../DlqViewerPanel";
import { adminApi, type DlqEventSummary } from "@/lib/api/admin";

jest.mock("@/hooks/useAuth", () => ({
  useAuth: jest.fn(() => ({
    token: "admin-jwt-token",
    isAuthenticated: true,
    isLoading: false,
  })),
}));

jest.mock("@/lib/api/admin", () => {
  const actual = jest.requireActual("@/lib/api/admin");
  return {
    ...actual,
    adminApi: {
      ...actual.adminApi,
      dlq: {
        list: jest.fn(),
        replay: jest.fn(),
      },
    },
  };
});

const mockList = adminApi.dlq.list as jest.Mock;
const mockReplay = adminApi.dlq.replay as jest.Mock;

const SAMPLE_EVENTS: DlqEventSummary[] = [
  {
    eventId: "evt-101",
    queue: "webhooks",
    jobName: "dispatch",
    payloadHash: "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
    failureReason: "Webhook delivery returned HTTP 503",
    errorClass: "Error",
    retryCount: 3,
    failedAt: "2026-11-19T10:00:00.000Z",
  },
  {
    eventId: "evt-102",
    queue: "webhooks",
    jobName: "dispatch",
    payloadHash: "ff00ee11dd22cc33bb44aa5599668877ff00ee11dd22cc33bb44aa5599668877",
    failureReason: "ECONNRESET",
    errorClass: "FetchError",
    retryCount: 3,
    failedAt: "2026-11-19T10:05:00.000Z",
  },
];

describe("DlqViewerPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders dead-letter events with failure reasons, payload hashes, and retry counts", async () => {
    mockList.mockResolvedValue({
      queue: "webhooks",
      depth: 2,
      page: 1,
      limit: 25,
      events: SAMPLE_EVENTS,
    });

    render(<DlqViewerPanel />);

    expect(await screen.findByTestId("dlq-event-row-evt-101")).toBeInTheDocument();
    expect(screen.getByTestId("dlq-depth-badge")).toHaveTextContent("2 failed");
    expect(screen.getByText("Webhook delivery returned HTTP 503")).toBeInTheDocument();
    expect(screen.getByText("ECONNRESET")).toBeInTheDocument();
    expect(screen.getByText("a1b2c3d4…7e8f90")).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledWith("admin-jwt-token", {
      queue: "webhooks",
      page: 1,
      limit: 25,
    });
  });

  it("retries a dead-letter event when the Retry button is clicked and removes it from the list", async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({
      queue: "webhooks",
      depth: 2,
      page: 1,
      limit: 25,
      events: SAMPLE_EVENTS,
    });
    mockReplay.mockResolvedValue({
      success: true,
      queue: "webhooks",
      replayedJobId: "evt-101",
    });

    render(<DlqViewerPanel />);

    const retryButton = await screen.findByRole("button", { name: "Retry event evt-101" });
    await user.click(retryButton);

    await waitFor(() => {
      expect(mockReplay).toHaveBeenCalledWith("admin-jwt-token", "webhooks", "evt-101");
    });

    expect(screen.queryByTestId("dlq-event-row-evt-101")).not.toBeInTheDocument();
    expect(screen.getByTestId("dlq-event-row-evt-102")).toBeInTheDocument();
    expect(screen.getByTestId("dlq-depth-badge")).toHaveTextContent("1 failed");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Re-enqueued event evt-101 for retry.",
    );
  });

  it("displays an error status and keeps the row when retry fails", async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({
      queue: "webhooks",
      depth: 1,
      page: 1,
      limit: 25,
      events: [SAMPLE_EVENTS[0]],
    });
    mockReplay.mockRejectedValue(new Error("Redis unavailable"));

    render(<DlqViewerPanel />);

    const retryButton = await screen.findByRole("button", { name: "Retry event evt-101" });
    await user.click(retryButton);

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Retry failed for event evt-101: Redis unavailable",
    );
    expect(screen.getByTestId("dlq-event-row-evt-101")).toBeInTheDocument();
  });

  it("renders empty state when there are no dead-letter events", async () => {
    mockList.mockResolvedValue({
      queue: "webhooks",
      depth: 0,
      page: 1,
      limit: 25,
      events: [],
    });

    render(<DlqViewerPanel />);

    expect(await screen.findByTestId("dlq-empty")).toHaveTextContent(
      "No dead-letter events in the webhooks queue.",
    );
  });

  it("renders error state and reloads when Try again is clicked", async () => {
    const user = userEvent.setup();
    mockList
      .mockRejectedValueOnce(new Error("Service unavailable"))
      .mockResolvedValueOnce({
        queue: "webhooks",
        depth: 1,
        page: 1,
        limit: 25,
        events: [SAMPLE_EVENTS[0]],
      });

    render(<DlqViewerPanel />);

    expect(await screen.findByTestId("dlq-error")).toHaveTextContent("Service unavailable");

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByTestId("dlq-event-row-evt-101")).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it("switches queues when the queue selector changes", async () => {
    const user = userEvent.setup();
    mockList.mockResolvedValue({
      queue: "webhooks",
      depth: 0,
      page: 1,
      limit: 25,
      events: [],
    });

    render(<DlqViewerPanel />);
    await screen.findByTestId("dlq-empty");

    const select = screen.getByLabelText("Queue");
    await user.selectOptions(select, "notifications");

    await waitFor(() => {
      expect(mockList).toHaveBeenLastCalledWith("admin-jwt-token", {
        queue: "notifications",
        page: 1,
        limit: 25,
      });
    });
  });
});
