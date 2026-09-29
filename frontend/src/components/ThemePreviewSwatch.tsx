"use client";

import React from "react";

export type PreviewTheme = "light" | "dark" | "system";

interface Palette {
  bg: string;
  card: string;
  text: string;
  textMuted: string;
  gold: string;
  emerald: string;
  border: string;
}

/**
 * Fixed palettes for the preview swatches. These read the `--preview-*`
 * tokens in `globals.css` rather than the live `--surface-*` / `--text-*`
 * tokens, so a swatch keeps showing the theme it represents even while a
 * different theme is applied to <html>.
 */
const LIGHT: Palette = {
  bg: "var(--preview-light-bg)",
  card: "var(--preview-light-card)",
  text: "var(--preview-light-text)",
  textMuted: "var(--preview-light-text-muted)",
  gold: "var(--preview-light-gold)",
  emerald: "var(--preview-light-emerald)",
  border: "var(--preview-light-border)",
};

const DARK: Palette = {
  bg: "var(--preview-dark-bg)",
  card: "var(--preview-dark-card)",
  text: "var(--preview-dark-text)",
  textMuted: "var(--preview-dark-text-muted)",
  gold: "var(--preview-dark-gold)",
  emerald: "var(--preview-dark-emerald)",
  border: "var(--preview-dark-border)",
};

/** Miniature of an app screen: title bar + gold accent + body text lines. */
function MiniScreen({ palette }: { palette: Palette }) {
  return (
    <div
      aria-hidden="true"
      className="h-full w-full overflow-hidden"
      style={{ background: palette.bg, color: palette.text }}
    >
      <div
        className="flex items-center gap-1.5 px-2 py-1.5"
        style={{ background: palette.card, borderBottom: `1px solid ${palette.border}` }}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: palette.emerald }}
        />
        <span
          className="h-1 w-10 rounded-full"
          style={{ background: palette.textMuted, opacity: 0.7 }}
        />
      </div>
      <div className="space-y-1.5 px-2 py-2">
        <span
          className="block h-1.5 w-8 rounded-full"
          style={{ background: palette.gold }}
        />
        <span
          className="block h-1 w-full rounded-full"
          style={{ background: palette.text, opacity: 0.75 }}
        />
        <span
          className="block h-1 w-2/3 rounded-full"
          style={{ background: palette.textMuted }}
        />
      </div>
    </div>
  );
}

/**
 * Live preview swatch for one theme option.
 *
 * The "system" option is rendered as a split swatch — light on the left, dark
 * on the right — because its appearance depends on the visitor's device.
 * Decorative only: every element is `aria-hidden` and the accessible name
 * comes from the surrounding control.
 */
export function ThemePreviewSwatch({ theme }: { theme: PreviewTheme }) {
  if (theme === "system") {
    return (
      <div
        aria-hidden="true"
        className="flex h-full w-full overflow-hidden"
        data-testid="theme-preview-system"
      >
        <div className="w-1/2 overflow-hidden">
          <MiniScreen palette={LIGHT} />
        </div>
        <div className="w-1/2 overflow-hidden">
          <MiniScreen palette={DARK} />
        </div>
      </div>
    );
  }

  return (
    <div
      aria-hidden="true"
      className="h-full w-full overflow-hidden"
      data-testid={`theme-preview-${theme}`}
    >
      <MiniScreen palette={theme === "dark" ? DARK : LIGHT} />
    </div>
  );
}
