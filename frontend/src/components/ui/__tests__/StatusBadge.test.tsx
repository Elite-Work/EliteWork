import { render } from "@testing-library/react";
import { StatusBadge, type TradeStatus } from "../StatusBadge";

const STATUSES: TradeStatus[] = [
  "delivered",
  "in-transit",
  "disputed",
  "locked",
  "draft",
  "pending",
];

describe("StatusBadge", () => {
  it.each(STATUSES)("matches snapshot for status %s", (status) => {
    const { container } = render(<StatusBadge status={status} />);
    expect(container).toMatchSnapshot();
  });

  it.each(STATUSES)("matches snapshot for status %s without icon", (status) => {
    const { container } = render(
      <StatusBadge status={status} size="sm" showIcon={false} />,
    );
    expect(container).toMatchSnapshot();
  });
});
