"use client";

import { useRef } from "react";
import { useTheme, type Theme } from "@/hooks/useTheme";
import { ThemePreviewSwatch } from "@/components/ThemePreviewSwatch";

const OPTIONS: {
  value: Theme;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    value: "system",
    label: "System",
    icon: "💻",
    description: "Matches your device setting",
  },
  { value: "light", label: "Light", icon: "☀️", description: "Brightened nature tones" },
  { value: "dark", label: "Dark", icon: "🌙", description: "Deep forest tones" },
];

/**
 * Theme picker with three modes: System (auto), Light, Dark.
 *
 * Each option carries a live preview swatch built from the fixed
 * `--preview-*` palette, so it shows the theme it represents regardless of
 * what is currently applied. Hovering or focusing an option previews it
 * (temporary, nothing is persisted); clicking commits the choice.
 *
 * Arrow keys move between options and preview them — commit stays on
 * click / Enter / Space so browsing never rewrites the stored preference.
 */
export function ThemeToggle() {
  const { themePreference, setTheme, previewTheme, clearThemePreview } = useTheme();
  const groupRef = useRef<HTMLDivElement>(null);

  const focusOption = (index: number) => {
    const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>(
      '[role="radio"]',
    );
    if (!buttons || buttons.length === 0) return;
    const next = (index + buttons.length) % buttons.length;
    const button = buttons[next];
    button.focus();
    previewTheme(button.dataset.theme as Theme);
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Theme preference"
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      onKeyDown={(e) => {
        const current = OPTIONS.findIndex((o) => o.value === themePreference);
        const focused = OPTIONS.findIndex(
          (o) => o.value === (e.target as HTMLElement | null)?.dataset?.theme,
        );
        const from = focused >= 0 ? focused : Math.max(current, 0);
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          focusOption(from + 1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          focusOption(from - 1);
        }
      }}
      onBlur={(e) => {
        // Only reset the preview when focus leaves the group entirely.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          clearThemePreview();
        }
      }}
    >
      {OPTIONS.map((opt) => {
        const isActive = themePreference === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            data-theme={opt.value}
            aria-checked={isActive}
            onClick={() => setTheme(opt.value)}
            onMouseEnter={() => previewTheme(opt.value)}
            onMouseLeave={clearThemePreview}
            onFocus={() => previewTheme(opt.value)}
            className={`group flex flex-col overflow-hidden rounded-lg border text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${
              isActive
                ? "border-gold bg-gold-muted"
                : "border-border-default bg-surface-2 hover:border-border-hover hover:bg-surface-1"
            }`}
          >
            <span className="block h-16 w-full border-b border-border-default">
              <ThemePreviewSwatch theme={opt.value} />
            </span>
            <span className="flex flex-col gap-0.5 p-3">
              <span className="flex items-center gap-1.5 text-sm font-medium">
                <span aria-hidden="true">{opt.icon}</span>
                <span className={isActive ? "text-gold" : "text-text-primary"}>
                  {opt.label}
                </span>
                {isActive && (
                  <span className="ml-auto rounded-full bg-gold px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-inverse">
                    Current
                  </span>
                )}
              </span>
              <span className="text-xs text-text-muted">{opt.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
