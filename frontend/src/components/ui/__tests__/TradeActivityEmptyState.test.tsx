import { render, screen } from "@testing-library/react";
import { TradeActivityEmptyState } from "../TradeActivityEmptyState";

it.each([
  ["trades", "No trades yet", "Create Your First Trade"],
  ["vault", "No vault activity yet", "Create Trade"],
] as const)("shows the %s empty state and its trade creation link", (variant, title, cta) => {
  const { container } = render(<TradeActivityEmptyState variant={variant} />);

  expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: cta })).toHaveAttribute("href", "/trades/create");
  expect(container.querySelector('[aria-hidden="true"] svg')).toBeInTheDocument();
});
