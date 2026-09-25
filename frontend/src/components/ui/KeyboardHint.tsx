"use client";

import React from "react";

/**
 * One key cap inside a {@link KeyboardHint}. Renders a real `<kbd>` so screen
 * readers and browser "find as you type" behave as expected.
 */
export function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-border-default bg-bg-elevated px-1.5 py-0.5 font-sans text-[11px] font-semibold leading-4 text-text-secondary shadow-[0_1px_0_var(--border-default)]">
      {children}
    </kbd>
  );
}

export interface KeyboardHintProps {
  /**
   * The key that triggers the action, e.g. "Enter" or "Esc". Omit it to render
   * a plain instruction with no key cap — useful when the shortcut only becomes
   * available once the step is valid.
   */
  keys?: string;
  /** What the key does, e.g. "to continue". */
  children: React.ReactNode;
  /** Extra classes for the wrapper. */
  className?: string;
}

/**
 * Small, non-blocking hint telling keyboard-first users which key advances the
 * current step. Purely decorative — the shortcut works without it — so it never
 * traps focus or interrupts a screen reader.
 *
 * ```tsx
 * <KeyboardHint keys="Enter">to continue</KeyboardHint>
 * ```
 */
export function KeyboardHint({ keys, children, className = "" }: KeyboardHintProps) {
  if (!keys) {
    return (
      <p className={`text-center text-xs text-text-muted ${className}`}>{children}</p>
    );
  }

  return (
    <p
      className={`flex items-center justify-center gap-1.5 text-xs text-text-muted ${className}`}
    >
      <span>Press</span>
      <KeyCap>{keys}</KeyCap>
      <span>{children}</span>
    </p>
  );
}
