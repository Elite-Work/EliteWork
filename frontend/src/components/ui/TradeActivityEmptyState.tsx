import Link from "next/link";
import { ArrowLeftRight, Vault } from "lucide-react";
import { EmptyState } from "./EmptyState";

export function TradeActivityEmptyState({ variant }: { variant: "trades" | "vault" }) {
  const isVault = variant === "vault";
  const Illustration = isVault ? Vault : ArrowLeftRight;

  return (
    <EmptyState
      className="rounded-lg border border-border-default bg-surface-1"
      icon={
        <span aria-hidden="true" className="rounded-xl border border-gold/30 bg-gold-muted p-3 text-gold">
          <Illustration className="h-7 w-7" strokeWidth={1.5} />
        </span>
      }
      title={isVault ? "No vault activity yet" : "No trades yet"}
      description={isVault
        ? "Escrow activity will appear here after you create a trade."
        : "Create a trade to start settling transactions through escrow."}
      action={
        <Link
          href="/trades/create"
          className="inline-flex rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-text-inverse transition-colors hover:bg-gold-hover focus-visible:outline-2 focus-visible:outline-gold focus-visible:outline-offset-2"
        >
          {isVault ? "Create Trade" : "Create Your First Trade"}
        </Link>
      }
    />
  );
}
