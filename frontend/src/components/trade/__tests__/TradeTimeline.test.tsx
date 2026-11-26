import { render, screen } from "@testing-library/react";
import { TradeTimeline } from "../TradeTimeline";
import type { TimelineEvent } from "@/types/trade";

const events: TimelineEvent[] = [
  { id: "1", type: "escrow_funded", title: "Escrow Funded", status: "completed", timestamp: "Jan 1" },
  { id: "2", type: "inspection_passed", title: "Inspection Passed", status: "completed" },
  {
    id: "3",
    type: "dispatched",
    title: "Dispatched",
    description: "On the way",
    status: "current",
    tracking: { trackingNumber: "TRK-123" },
  },
  { id: "4", type: "settlement", title: "Settlement", status: "pending" },
];

describe("TradeTimeline", () => {
  it("renders milestones in the given order", () => {
    render(<TradeTimeline events={events} />);
    const titles = screen
      .getAllByText(/Escrow Funded|Inspection Passed|Dispatched|Settlement/)
      .map((el) => el.textContent);
    expect(titles).toEqual(["Escrow Funded", "Inspection Passed", "Dispatched", "Settlement"]);
  });

  it("styles completed, current and pending steps differently", () => {
    render(<TradeTimeline events={events} />);
    const node = (title: string) => screen.getByText(title).closest(".flex-1")!.previousElementSibling!;
    expect(node("Escrow Funded").className).toContain("bg-emerald");
    expect(node("Dispatched").className).toContain("bg-status-warning");
    expect(node("Settlement").className).toContain("bg-elevated");
    expect(screen.getByText("Settlement").className).toContain("text-text-muted");
    expect(screen.getByText("Escrow Funded").className).toContain("text-text-primary");
  });

  it("shows the CURRENT STATE badge only on the current step", () => {
    render(<TradeTimeline events={events} />);
    expect(screen.getAllByText("CURRENT STATE")).toHaveLength(1);
  });

  it("renders optional timestamp, description and tracking info", () => {
    render(<TradeTimeline events={events} />);
    expect(screen.getByText("Jan 1")).toBeInTheDocument();
    expect(screen.getByText("On the way")).toBeInTheDocument();
    expect(screen.getByText("Tracking #: TRK-123")).toBeInTheDocument();
  });

  it("renders no steps for an empty list", () => {
    render(<TradeTimeline events={[]} />);
    expect(screen.getByText("Trade Lifecycle")).toBeInTheDocument();
    expect(screen.queryByText("CURRENT STATE")).not.toBeInTheDocument();
  });
});
