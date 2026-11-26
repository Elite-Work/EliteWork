"use client";

import { Spinner } from "@/components/ui/Spinner";
import {
  describeWalletState,
  type WalletAction,
  type WalletState,
} from "@/lib/wallet/state-machine";

/**
 * Renders a distinct, actionable panel for every non-happy wallet state so a
 * blocked connection never looks like a dead button. One primary action per
 * state (install / unlock / retry / switch network).
 */
export interface WalletStateCalloutProps {
  state: WalletState;
  expectedNetwork?: string;
  onAction: (action: WalletAction) => void;
  /** Disable the CTA while an action is running. */
  busy?: boolean;
  className?: string;
}

export function WalletStateCallout({
  state,
  expectedNetwork,
  onAction,
  busy = false,
  className,
}: WalletStateCalloutProps) {
  if (state === "connected" || state === "idle") return null;

  const view = describeWalletState(state, { expectedNetwork });

  if (state === "connecting" || state === "detecting") {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center gap-3 rounded-lg border border-border-default bg-card px-4 py-3 ${className ?? ""}`}
      >
        <Spinner size="sm" />
        <span className="text-sm text-text-secondary">{view.title}</span>
      </div>
    );
  }

  return (
    <div
      role="alert"
      className={`flex flex-col gap-2 rounded-lg border border-border-raised bg-card p-4 ${className ?? ""}`}
      data-wallet-state={state}
    >
      <p className="text-sm font-semibold text-text-primary">{view.title}</p>
      {view.body && <p className="text-sm text-text-secondary">{view.body}</p>}
      {view.ctaLabel && view.action && (
        <div className="mt-1 flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => onAction(view.action as WalletAction)}
            className="inline-flex h-9 items-center rounded-full bg-gradient-gold-cta px-4 text-sm font-semibold text-text-inverse transition-opacity disabled:opacity-40"
          >
            {busy ? <Spinner size="sm" aria-label={view.ctaLabel} /> : view.ctaLabel}
          </button>
          {view.href && (
            <a
              href={view.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-text-secondary underline hover:text-text-primary"
            >
              {view.href.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
