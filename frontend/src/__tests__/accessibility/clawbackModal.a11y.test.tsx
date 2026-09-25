import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { StreamClawbackForm } from "@/components/admin/StreamClawbackForm";

expect.extend(toHaveNoViolations);

jest.mock("@/lib/api", () => ({ api: { adminStreams: { clawbackPreview: jest.fn() } } }));
jest.mock("@/hooks/useToast", () => ({
  useToast: () => ({ toasts: [], addToast: jest.fn(), removeToast: jest.fn() }),
}));

describe("Admin clawback confirmation — trigger and modal (WCAG 2.1 AA)", () => {
  const renderForm = () =>
    render(<StreamClawbackForm token="t" streamId="stream-abc-123" remainingVested="7500" />);

  it("trigger is a native button that is not nested inside another interactive element", () => {
    const { container } = renderForm();
    const trigger = screen.getByRole("button", { name: "Review clawback" });
    expect(trigger.tagName).toBe("BUTTON");
    expect(trigger.querySelector("button, a, input, select, textarea, [role=button], [tabindex]")).toBeNull();
    expect(trigger.parentElement?.closest('[role="button"], a, button')).toBeNull();
    expect(container.querySelectorAll('[role="button"] button, button button')).toHaveLength(0);
  });

  it("has no axe violations with the confirmation modal open", async () => {
    renderForm();
    await userEvent.type(screen.getByRole("textbox"), "3000");
    await userEvent.click(screen.getByRole("button", { name: "Review clawback" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const results = await axe(document.body);
    const blocking = results.violations.filter((v) => ["critical", "serious"].includes(v.impact!));
    expect(blocking).toEqual([]);
  });
});
