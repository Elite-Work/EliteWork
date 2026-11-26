"use client";

import { Spinner } from "@/components/ui/Spinner";

export interface WalletBalanceProps {
  /** Wallet connection state. */
  connected: boolean;
  loading?: boolean;
  balance?: string;
  asset?: string;
}

/** Shows the wallet balance, a spinner while loading, or a connect prompt. */
export function WalletBalance({ connected, loading = false, balance, asset }: WalletBalanceProps) {
  if (!connected) return <p>Connect your wallet to see your balance</p>;
  if (loading) return <Spinner />;
  return (
    <p data-testid="wallet-balance">
      {balance ? `${parseFloat(balance).toLocaleString()} ${asset ?? ""}`.trim() : "—"}
    </p>
  );
}
