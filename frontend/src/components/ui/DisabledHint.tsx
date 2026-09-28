"use client";

import type { ReactNode } from "react";

export interface DisabledHintProps {
  /** Stable DOM id used by aria-describedby on the control. */
  hintId: string;
  /** Heading shown at the top of the tooltip, e.g. "Why is this disabled?". */
  title: string;
  /** One entry per blocking issue, in the order the user should fix them. */
  issues: string[];
  /** The control the tooltip explains — usually a disabled button. */
  children: ReactNode;
  className?: string;
}

/**
 * Wraps a disabled control and explains why it is disabled.
 *
 * A disabled `<button>` fires no pointer events, so a `title` on the button
 * itself never shows — the hint therefore lives on this wrapper: hovering the
 * wrapper (and therefore the button) reveals the tooltip, and the wrapper is
 * focusable so keyboard and switch users reach it too. Screen readers get the
 * same text through aria-describedby, whether or not the tooltip is visible.
 *
 * When there is nothing to explain the wrapper is not rendered at all, so
 * enabled controls keep their original markup and tab order.
 */
export function DisabledHint({
  hintId,
  title,
  issues,
  children,
  className,
}: DisabledHintProps) {
  if (issues.length === 0) return <>{children}</>;

  const summary = `${title} ${issues.join("; ")}`;

  return (
    <div className={`relative group ${className ?? ""}`}>
      <span className="flex" tabIndex={0} aria-describedby={hintId}>
        {children}
      </span>

      {/* Referenced by aria-describedby — always in the DOM, never shown. */}
      <span id={hintId} className="sr-only">
        {summary}
      </span>

      <div
        aria-hidden="true"
        data-testid="disabled-hint"
        className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 w-max max-w-xs -translate-x-1/2 rounded-lg border border-gold/30 bg-bg-card px-3 py-2 text-left shadow-card opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <span className="block text-xs font-semibold text-gold">{title}</span>
        <ul className="mt-1 space-y-0.5 text-xs text-text-secondary">
          {issues.map((issue) => (
            <li key={issue} className="flex gap-1.5">
              <span aria-hidden="true" className="text-gold">
                •
              </span>
              <span>{issue}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
