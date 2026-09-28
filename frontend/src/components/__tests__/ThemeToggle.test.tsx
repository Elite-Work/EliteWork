import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ThemeProvider, useTheme } from "@/hooks/useTheme";

expect.extend(toHaveNoViolations);

const STORAGE_KEY = "amana-theme-preference";

/** Mirrors what ThemeProvider applies to <html>. */
function CurrentTheme() {
  const { themePreference, resolvedTheme, isPreviewing } = useTheme();
  return (
    <div>
      <span data-testid="preference">{themePreference}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <span data-testid="previewing">{String(isPreviewing)}</span>
    </div>
  );
}

function renderToggle(preference: "light" | "dark" | "system" = "dark") {
  localStorage.setItem(STORAGE_KEY, preference);
  return render(
    <ThemeProvider>
      <CurrentTheme />
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe("ThemeToggle live preview", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    // jsdom ships no matchMedia; ThemeProvider subscribes to the OS theme.
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        addListener: jest.fn(),
        removeListener: jest.fn(),
        dispatchEvent: jest.fn(),
      }),
    });
  });

  it("renders a preview swatch for every option", () => {
    renderToggle();

    expect(screen.getByTestId("theme-preview-light")).toBeInTheDocument();
    expect(screen.getByTestId("theme-preview-dark")).toBeInTheDocument();
    // System is a split swatch — the theme it shows depends on the device.
    expect(screen.getByTestId("theme-preview-system")).toBeInTheDocument();
  });

  it("previews a theme on hover without persisting it", async () => {
    const user = userEvent.setup();
    renderToggle("dark");

    const lightOption = screen.getByRole("radio", { name: /light/i });
    await user.hover(lightOption);

    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(document.documentElement).toHaveClass("light");
    // Committed preference is untouched.
    expect(screen.getByTestId("preference")).toHaveTextContent("dark");
    expect(screen.getByTestId("previewing")).toHaveTextContent("true");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
  });

  it("restores the committed theme when the pointer leaves", async () => {
    const user = userEvent.setup();
    renderToggle("dark");

    await user.hover(screen.getByRole("radio", { name: /light/i }));
    await user.unhover(screen.getByRole("radio", { name: /light/i }));

    expect(screen.getByTestId("resolved")).toHaveTextContent("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByTestId("previewing")).toHaveTextContent("false");
  });

  it("previews on keyboard focus too", async () => {
    const user = userEvent.setup();
    renderToggle("dark");

    await user.tab();

    // System resolves through the (light) mocked OS preference.
    expect(screen.getByRole("radio", { name: /system/i })).toHaveFocus();
    expect(screen.getByTestId("resolved")).toHaveTextContent("light");
    expect(screen.getByTestId("preference")).toHaveTextContent("dark");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");
  });

  it("commits the choice on click and persists it", async () => {
    const user = userEvent.setup();
    renderToggle("dark");

    await user.click(screen.getByRole("radio", { name: /light/i }));

    expect(screen.getByTestId("preference")).toHaveTextContent("light");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("light");
    expect(screen.getByTestId("previewing")).toHaveTextContent("false");
    expect(screen.getByRole("radio", { name: /light/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("moves between options with the arrow keys and previews without committing", async () => {
    const user = userEvent.setup();
    renderToggle("dark");

    const darkOption = screen.getByRole("radio", { name: /dark/i });
    darkOption.focus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("radio", { name: /system/i })).toHaveFocus();
    expect(screen.getByTestId("preference")).toHaveTextContent("dark");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("dark");

    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("radio", { name: /dark/i })).toHaveFocus();
  });

  it("marks the stored preference as current on load", () => {
    renderToggle("light");

    expect(screen.getByRole("radio", { name: /light/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: /dark/i })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByText("Current")).toBeInTheDocument();
  });

  it("has no WCAG 2.1 AA violations", async () => {
    const { container } = renderToggle("dark");

    expect(await axe(container)).toHaveNoViolations();
  });
});
