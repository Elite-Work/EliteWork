import { render, screen } from "@testing-library/react";
import { DisabledHint } from "../DisabledHint";

const ISSUES = ["Select a commodity", "Quantity must be greater than 0"];

describe("DisabledHint", () => {
  it("renders the control untouched when there is nothing to explain", () => {
    render(
      <DisabledHint hintId="hint" title="Why is this disabled?" issues={[]}>
        <button type="button">Lock Funds</button>
      </DisabledHint>,
    );

    expect(screen.getByRole("button", { name: "Lock Funds" })).toBeInTheDocument();
    expect(screen.queryByTestId("disabled-hint")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Lock Funds" }),
    ).not.toHaveAttribute("aria-describedby");
  });

  it("lists every blocking issue in the visible tooltip", () => {
    render(
      <DisabledHint hintId="hint" title="Why is this disabled?" issues={ISSUES}>
        <button type="button" disabled>
          Lock Funds
        </button>
      </DisabledHint>,
    );

    const hint = screen.getByTestId("disabled-hint");
    expect(hint).toHaveTextContent("Why is this disabled?");
    for (const issue of ISSUES) {
      expect(hint).toHaveTextContent(issue);
    }
  });

  it("exposes the same text to assistive tech via aria-describedby", () => {
    render(
      <DisabledHint hintId="hint" title="Why is this disabled?" issues={ISSUES}>
        <button type="button" disabled>
          Lock Funds
        </button>
      </DisabledHint>,
    );

    const describedBy = screen
      .getByRole("button", { name: "Lock Funds" })
      .closest("span");
    expect(describedBy).toHaveAttribute("aria-describedby", "hint");
    expect(document.getElementById("hint")).toHaveTextContent(
      /Why is this disabled\?.*Select a commodity.*Quantity must be greater than 0/,
    );
  });

  it("stays reachable for keyboard users, since a disabled button cannot take focus", () => {
    render(
      <DisabledHint hintId="hint" title="Why is this disabled?" issues={ISSUES}>
        <button type="button" disabled>
          Lock Funds
        </button>
      </DisabledHint>,
    );

    const focusable = screen
      .getByRole("button", { name: "Lock Funds" })
      .closest("span");
    expect(focusable).toHaveAttribute("tabindex", "0");
  });

  it("keeps the tooltip out of the accessibility tree (the sr-only copy carries the text)", () => {
    render(
      <DisabledHint hintId="hint" title="Why is this disabled?" issues={ISSUES}>
        <button type="button" disabled>
          Lock Funds
        </button>
      </DisabledHint>,
    );

    expect(screen.getByTestId("disabled-hint")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
