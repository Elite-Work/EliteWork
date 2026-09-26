"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

export interface CopyButtonProps {
  /** Full, untruncated value written to the clipboard. */
  value: string;
  /** What is being copied, e.g. "Trade ID" or "transaction hash". */
  label: string;
  className?: string;
}

type CopyState = "idle" | "copied" | "failed";

/**
 * Small copy-to-clipboard control for values that are rendered truncated in
 * the UI (trade IDs, transaction hashes). Renders the full `value`, never the
 * truncated display text.
 */
export function CopyButton({ value, label, className }: CopyButtonProps) {
  const [state, setState] = useState<CopyState>("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, []);

  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    // Trade rows and cards are clickable as a whole — a copy click must not
    // also navigate.
    event.stopPropagation();

    try {
      await navigator.clipboard.writeText(value);
      setState("copied");
    } catch {
      setState("failed");
    }

    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setState("idle"), 2000);
  };

  const title =
    state === "copied"
      ? `${label} copied`
      : state === "failed"
        ? `Could not copy ${label}`
        : `Copy ${label}`;

  return (
    <>
      <button
        type="button"
        onClick={(event) => void handleClick(event)}
        aria-label={`Copy ${label}`}
        title={title}
        data-state={state}
        data-testid={`copy-${label.toLowerCase().replace(/\s+/g, "-")}`}
        className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded border border-transparent transition-colors focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2 ${
          state === "copied"
            ? "border-emerald/30 bg-emerald-muted text-emerald"
            : state === "failed"
              ? "border-status-danger/30 bg-status-danger/10 text-status-danger"
              : "text-text-muted hover:border-gold/30 hover:bg-gold-muted hover:text-gold"
        } ${className ?? ""}`}
      >
        {state === "copied" ? (
          <Check aria-hidden="true" className="h-3.5 w-3.5" />
        ) : (
          <Copy aria-hidden="true" className="h-3.5 w-3.5" />
        )}
      </button>
      {/* Live region kept outside the button so the control's accessible
          name stays "Copy <label>" in every state. */}
      <span role="status" className="sr-only">
        {state === "copied" ? `${label} copied` : state === "failed" ? `Could not copy ${label}` : ""}
      </span>
    </>
  );
}
