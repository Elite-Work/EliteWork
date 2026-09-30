import { act } from "@testing-library/react";
import { useDisputeStore } from "@/stores/disputeStore";
import type { DisputeResponse } from "@/lib/api/types";
import { _clearAllForTests } from "@/lib/actionDedup";

jest.mock("@/lib/api/disputes", () => ({
  disputesApi: {
    list: jest.fn(),
    transition: jest.fn(),
  },
}));

const makeDispute = (tradeId: string, status: "OPEN" | "UNDER_REVIEW" | "RESOLVED" | "CLOSED" = "OPEN"): DisputeResponse => ({
  id: 1,
  tradeId,
  initiator: "GBUYER",
  reason: "Defective goods delivered",
  status,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  trade: {
    buyerAddress: "GBUYER",
    sellerAddress: "GSELLER",
    amountUsdc: "100",
  },
});

beforeEach(() => {
  useDisputeStore.setState({
    disputes: [],
    total: 0,
    page: 1,
    filters: {},
    isLoading: false,
    error: null,
    pendingActions: {},
  });
  _clearAllForTests();
});

describe("Optimistic dispute resolution with snapshot-based rollback (Issue #112)", () => {
  it("forced failure mid-flight restores exact prior dispute state", async () => {
    useDisputeStore.setState({
      disputes: [makeDispute("trade-1", "OPEN")],
      total: 1,
    });
    const before = JSON.stringify(useDisputeStore.getState().disputes);

    await act(async () => {
      await expect(
        useDisputeStore.getState().resolveDisputeOptimistic("trade-1", "accept", async () => {
          throw new Error("RPC submission failed mid-flight");
        }),
      ).rejects.toThrow("RPC submission failed mid-flight");
    });

    const after = JSON.stringify(useDisputeStore.getState().disputes);
    expect(after).toBe(before);
    expect(useDisputeStore.getState().disputes[0].status).toBe("OPEN");
    expect(useDisputeStore.getState().pendingActions).toEqual({});
  });

  it("success keeps optimistic patch", async () => {
    useDisputeStore.setState({
      disputes: [makeDispute("trade-1", "OPEN")],
      total: 1,
    });

    await act(async () => {
      await useDisputeStore.getState().acceptDispute("trade-1", async () => {
        // Simulates successful round-trip
      });
    });

    expect(useDisputeStore.getState().disputes[0].status).toBe("RESOLVED");
    expect(useDisputeStore.getState().pendingActions).toEqual({});
  });

  it("rejectDispute updates status optimistically and clears pending on success", async () => {
    useDisputeStore.setState({
      disputes: [makeDispute("trade-2", "UNDER_REVIEW")],
      total: 1,
    });

    await act(async () => {
      await useDisputeStore.getState().rejectDispute("trade-2", async () => {
        // Simulates on-chain settlement
      });
    });

    expect(useDisputeStore.getState().disputes[0].status).toBe("RESOLVED");
  });

  it("rapid double-submit is suppressed by action de-duplication window", async () => {
    useDisputeStore.setState({
      disputes: [makeDispute("trade-1", "OPEN")],
      total: 1,
    });
    const serverFn = jest.fn().mockImplementation(() => new Promise((res) => setTimeout(res, 50)));
    const { acceptDispute } = useDisputeStore.getState();

    const p1 = acceptDispute("trade-1", serverFn);
    const p2 = acceptDispute("trade-1", serverFn);

    await act(async () => {
      await Promise.allSettled([p1, p2]);
    });

    expect(serverFn).toHaveBeenCalledTimes(1);
  });

  it("withDedup wrapper prevents duplicate intents across callers", async () => {
    const { withDedup } = useDisputeStore.getState();
    const fn = jest.fn().mockResolvedValue("done");
    const key = "resolve:trade-1";

    const r1 = withDedup(key, fn);
    const r2 = withDedup(key, fn);
    const [v1, v2] = await Promise.all([r1, r2]);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(v1).toBe("done");
    expect(v2).toBeNull();
  });
});
