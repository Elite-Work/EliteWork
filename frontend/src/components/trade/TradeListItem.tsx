"use client";

import React from "react";
import { Eye, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { CopyButton } from "@/components/ui/CopyButton";
import type { TradeStatus } from "@/types/trade";

export interface TradeListItemProps {
  tradeId: string;
  commodity: string;
  counterparty: { role: string; address: string };
  amountCngn: string;
  status: TradeStatus;
  createdAt: string;
  onView: () => void;
  onDeposit?: () => void;
  onWithdraw?: () => void;
}

const STATUS_STYLES: Record<TradeStatus, string> = {
  "IN TRANSIT": "bg-emerald-muted text-emerald border border-emerald/30",
  PENDING:
    "bg-status-warning/10 text-status-warning border border-status-warning/30",
  SETTLED: "bg-status-info/10 text-status-info border border-status-info/30",
  DISPUTED:
    "bg-status-danger/10 text-status-danger border border-status-danger/30",
  DRAFT: "bg-status-draft/10 text-status-draft border border-status-draft/30",
};

function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function TradeListItem({
  tradeId,
  commodity,
  counterparty,
  amountCngn,
  status,
  createdAt,
  onView,
  onDeposit,
  onWithdraw,
}: TradeListItemProps) {
  const statusStyle = STATUS_STYLES[status] ?? STATUS_STYLES["DRAFT"];

  return (
    <div className="group flex items-center justify-between gap-3 p-4 bg-card border border-border-default rounded-lg mb-3 hover:border-gold/30 hover:bg-elevated transition-colors">
      {/*
        Interactive region. It intentionally holds no focusable descendants:
        a control nested inside an element with role="button" trips axe's
        nested-interactive rule, so the row actions live beside it instead.
      */}
      <div
        onClick={onView}
        role="button"
        tabIndex={0}
        aria-label={`View trade ${tradeId} — ${commodity} ${amountCngn} cNGN, status ${status}`}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onView();
          }
        }}
        className="flex flex-1 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2"
      >
        {/* Left — commodity + meta */}
        <div className="flex flex-col gap-1 min-w-0">
          <span className="text-lg font-medium text-text-primary truncate">
            {commodity}
          </span>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="bg-white/5 text-teal text-xs px-2 py-1 rounded">
              {counterparty.role}
            </span>
            <span className="font-mono text-text-muted text-sm">
              {truncateAddress(counterparty.address)}
            </span>
          </div>

          <span className="font-mono text-text-muted text-sm">{tradeId}</span>
        </div>

        {/* Right — amount + status */}
        <div className="flex items-center gap-3">
          <div className="hidden sm:flex flex-col items-end gap-1">
            <span className="text-text-primary font-semibold text-sm">
              {amountCngn}{" "}
              <span className="text-text-muted font-normal">cNGN</span>
            </span>
            <span className="text-text-muted text-xs">{createdAt}</span>
          </div>

          <span
            className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide ${statusStyle}`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            {status}
          </span>
        </div>
      </div>

      {/* Row actions — siblings of the interactive region, never nested in it */}
      <div className="flex items-center gap-3">
        <CopyButton value={tradeId} label="Trade ID" />

        <button
          onClick={onView}
          aria-label={`View trade ${tradeId}`}
          title="View trade"
          className="p-2 rounded-lg border border-border-default text-text-muted hover:border-border-hover hover:text-text-primary transition-colors focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2"
        >
          <Eye aria-hidden="true" className="w-4 h-4" />
        </button>

        {onDeposit && (
          <button
            onClick={onDeposit}
            aria-label={`Deposit for trade ${tradeId}`}
            title="Deposit"
            className="p-2 rounded-lg border border-border-default text-text-muted hover:border-emerald/40 hover:text-emerald transition-colors focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2"
          >
            <ArrowDownToLine aria-hidden="true" className="w-4 h-4" />
          </button>
        )}

        {onWithdraw && (
          <button
            onClick={onWithdraw}
            aria-label={`Withdraw for trade ${tradeId}`}
            title="Withdraw"
            className="p-2 rounded-lg border border-border-default text-text-muted hover:border-status-danger/40 hover:text-status-danger transition-colors focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2"
          >
            <ArrowUpFromLine aria-hidden="true" className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
