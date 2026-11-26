import { render, screen } from "@testing-library/react";
import { ThemePreviewSwatch } from "@/components/ThemePreviewSwatch";

describe("ThemePreviewSwatch", () => {
  it.each([
    ["light", "theme-preview-light", "--preview-light-bg"],
    ["dark", "theme-preview-dark", "--preview-dark-bg"],
  ] as const)("renders the %s palette", (theme, testId, background) => {
    render(<ThemePreviewSwatch theme={theme} />);

    const swatch = screen.getByTestId(testId);
    expect(swatch).toHaveAttribute("aria-hidden", "true");
    expect(swatch.querySelector(`[style*="${background}"]`)).toBeInTheDocument();
  });

  it("renders system as a decorative light-and-dark split swatch", () => {
    render(<ThemePreviewSwatch theme="system" />);

    const swatch = screen.getByTestId("theme-preview-system");
    expect(swatch).toHaveAttribute("aria-hidden", "true");
    expect(swatch.children).toHaveLength(2);
    expect(swatch.querySelector('[style*="--preview-light-bg"]')).toBeInTheDocument();
    expect(swatch.querySelector('[style*="--preview-dark-bg"]')).toBeInTheDocument();
  });
});
