"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { StrKey } from "@stellar/stellar-sdk";
import { signTransaction } from "@stellar/freighter-api";
import { useTrade } from "../TradeContext";
import { useAuth } from "@/hooks/useAuth";
import { api, apiConfig, ApiError } from "@/lib/api";
import { createTradeInputSchema, fieldErrors } from "@/lib/domain-schemas/trade";
import Link from "next/link";
import { LegalDisclaimerModal } from "@/components/ui/LegalDisclaimerModal";
import { useOffline } from "@/hooks/useOffline";
import { useOfflineQueueStore } from "@/stores/offlineQueueStore";
import { useToast } from "@/hooks/useToast";
import { shouldDedup, registerAction } from "@/lib/actionDedup";
import { generateIdempotencyKey } from "@/lib/idempotency";

type Row = { label: string; value: string };

function ReviewRow({ label, value }: Row) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-border-default last:border-0">
      <span className="text-sm text-text-secondary">{label}</span>
      <span className="text-sm text-text-primary font-medium text-right max-w-[60%] break-all">{value}</span>
    </div>
  );
}

export default function Step3Review() {
  const router = useRouter();
  const { data, setStep } = useTrade();
  const { token, isAuthenticated, connectWallet, authenticate, isWalletConnected } = useAuth();
  const { isOffline } = useOffline();
  const enqueue = useOfflineQueueStore((s) => s.enqueue);
  const pendingCount = useOfflineQueueStore((s) => s.queue.length);
  const { addToastWithCorrelation, updateToast } = useToast();
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [tradeId, setTradeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  const qty = parseFloat(data.quantity);
  const price = parseFloat(data.pricePerUnit);
  const rawAmount = !isNaN(qty) && !isNaN(price) ? qty * price : NaN;

  const total = !isNaN(rawAmount) && rawAmount > 0 ? rawAmount.toLocaleString("en-NG") : "—";

  const amountUsdc = !isNaN(rawAmount) && rawAmount > 0 ? rawAmount.toFixed(7) : "0";

  const isAddressValid =
    data.sellerAddress !== "" &&
    StrKey.isValidEd25519PublicKey(data.sellerAddress.trim());
  const isFormValid =
    data.commodity !== "" &&
    !isNaN(qty) && qty > 0 &&
    !isNaN(price) && price > 0 &&
    !isNaN(rawAmount) && rawAmount > 0 &&
    isAddressValid &&
    data.buyerRatio + data.sellerRatio === 100;

  const buyerLossBps = Math.round(data.buyerRatio * 100);
  const sellerLossBps = Math.round(data.sellerRatio * 100);

  const handleDisclaimerAccept = () => {
    setShowDisclaimer(false);
    void handleSubmit();
  };

  const handleSubmit = async () => {
    // Action de-duplication window preventing double-submit (rapid triple-click yields single intent)
    const dedupKey = `create-trade:${data.sellerAddress}:${amountUsdc}:${buyerLossBps}`;
    const dedup = shouldDedup(dedupKey);
    if (dedup.dedup || submittingRef.current) return;
    if (!isAuthenticated || !token) {
      setError("Please connect and authenticate your wallet first.");
      return;
    }

    if (!isFormValid) {
      setError("Please complete all required fields with valid values before submitting.");
      return;
    }

    // Validate against the shared domain schema — same rules the backend
    // enforces — so we never fire a request the server will reject with a 400.
    const payload = {
      sellerAddress: data.sellerAddress.trim(),
      amountUsdc,
      buyerLossBps,
      sellerLossBps,
    };
    const parsed = createTradeInputSchema.safeParse(payload);
    if (!parsed.success) {
      const errs = fieldErrors(parsed.error);
      setError(errs._form ?? Object.values(errs)[0] ?? "Trade details are invalid.");
      return;
    }

    const correlationId = `corr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const idempotencyKey = generateIdempotencyKey();
    registerAction(dedupKey, correlationId, idempotencyKey);

    // Offline queue: queue idempotent action locally while offline (draft trades survive refresh)
    if (isOffline) {
      enqueue({
        type: "create-trade",
        endpoint: "/trades",
        method: "POST",
        body: payload,
        idempotencyKey,
        correlationId,
      });
      // Pending-state UX showing what will send
      addToastWithCorrelation({
        type: "info",
        title: "Queued offline",
        message: `Draft trade (${data.commodity} ${amountUsdc} cNGN) will send when reconnected.`,
        correlationId,
        duration: 6000,
      });
      // Keep draft in localStorage (TradeContext) — survives refresh/restart via TradeContext persistence
      setError(null);
      return;
    }

    submittingRef.current = true;
    setLoading(true);
    setError(null);
    // Unified toast contract: pending w/ correlation ID
    addToastWithCorrelation({ type: "info", title: "In progress", message: "Locking funds…", correlationId, duration: 0 });

    try {
      const createResponse = await api.trades.create(token, payload, { idempotencyKey, correlationId });

      setTradeId(createResponse.tradeId);

      const signResult = await signTransaction(createResponse.unsignedXdr, {
        networkPassphrase: apiConfig.getStellarNetworkPassphrase(),
      });

      if (signResult.error !== undefined) {
        throw new Error(signResult.error.message || "Failed to sign transaction");
      }

      const signedXdr = signResult.signedTxXdr;

      const rpcUrl = apiConfig.getStellarRpcUrl();
      const submitResponse = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sendTransaction",
          params: { transaction: signedXdr },
        }),
      });

      const submitResult = await submitResponse.json();

      if (submitResult.error) {
        throw new Error(submitResult.error.message || "Transaction submission failed");
      }

      setTxHash(submitResult.result?.hash || createResponse.tradeId);
      updateToast(correlationId, { type: "success", title: "Success", message: "Trade created — funds locked.", duration: 5000 });
      // Clear draft on success
      try { localStorage.removeItem("amana:draft-trade"); } catch {}
    } catch (err) {
      let errorMessage = "Transaction failed. Please try again.";
      if (err instanceof ApiError) {
        errorMessage = err.message;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      }
      setError(errorMessage);
      // Snapshot-based rollback for store/state is not needed here (no optimistic patch yet), but ensure toast reflects error with correlation
      updateToast(correlationId, { type: "error", title: "Error", message: errorMessage, duration: 6000 });
    } finally {
      submittingRef.current = false;
      setLoading(false);
    }
  };

  if (txHash) {
    return (
      <div className="flex flex-col items-center gap-6 py-6 text-center">
        <div className="w-16 h-16 rounded-full bg-emerald-muted flex items-center justify-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#34D399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div>
          <p className="text-text-primary font-semibold text-lg">Trade Created</p>
          <p className="text-text-secondary text-sm mt-1">Funds locked in escrow vault</p>
        </div>
        <div className="w-full rounded-lg bg-bg-elevated border border-border-default px-4 py-3 text-left">
          <p className="text-xs text-text-muted mb-1">Trade ID</p>
          <p className="text-emerald font-mono text-sm break-all">{tradeId}</p>
        </div>
        <div className="w-full rounded-lg bg-bg-elevated border border-border-default px-4 py-3 text-left">
          <p className="text-xs text-text-muted mb-1">Transaction Hash</p>
          <p className="text-emerald font-mono text-sm break-all">{txHash}</p>
        </div>
        <button
          onClick={() => router.push(`/trades/${tradeId}`)}
          className="h-12 w-full flex items-center justify-center rounded-full bg-gradient-gold-cta text-text-inverse font-semibold"
        >
          View Trade Details
        </button>
        <Link
          href="/trades"
          className="text-sm text-text-secondary hover:text-text-primary"
        >
          View All Trades
        </Link>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center gap-6 py-6 text-center">
        <div className="w-16 h-16 rounded-full bg-gold/10 flex items-center justify-center">
          <svg className="w-8 h-8 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <div>
          <p className="text-text-primary font-semibold text-lg">Authentication Required</p>
          <p className="text-text-secondary text-sm mt-1">
            {isWalletConnected
              ? "Sign in with your wallet to create trades."
              : "Connect your Freighter wallet to create trades."}
          </p>
        </div>
        <button
          onClick={() => isWalletConnected ? authenticate() : connectWallet()}
          disabled={loading}
          className="h-12 w-full flex items-center justify-center rounded-full bg-gradient-gold-cta text-text-inverse font-semibold disabled:opacity-50"
        >
          {isWalletConnected ? "Sign In" : "Connect Wallet"}
        </button>
        <button
          onClick={() => setStep(2)}
          className="text-sm text-text-secondary hover:text-text-primary"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-lg bg-bg-elevated border border-border-default px-4 divide-y divide-border-default">
        <ReviewRow label="Commodity" value={data.commodity} />
        <ReviewRow label="Quantity" value={`${data.quantity} ${data.unit}`} />
        <ReviewRow label="Price per unit" value={`${data.currency} ${data.pricePerUnit}`} />
        <ReviewRow label="Total Value" value={`${data.currency} ${total}`} />
        <ReviewRow label="USDC Amount" value={`${amountUsdc} cNGN`} />
        <ReviewRow label="Seller Address" value={data.sellerAddress} />
        <ReviewRow label="Loss Ratio" value={`Buyer ${data.buyerRatio}% / Seller ${data.sellerRatio}%`} />
        <ReviewRow label="Delivery Window" value={`${data.deliveryDays} days`} />
        {data.notes && <ReviewRow label="Notes" value={data.notes} />}
      </div>

      <div className="rounded-lg bg-gold-muted border border-gold/20 px-4 py-3 text-sm text-gold">
        By submitting, you authorize a Stellar transaction to create an escrow trade,
        locking {amountUsdc} cNGN in the Amana escrow contract.
      </div>

      {error && (
        <p role="alert" aria-live="polite" className="text-status-danger text-sm text-center">{error}</p>
      )}
      {pendingCount > 0 && (
        <div className="rounded-lg bg-status-warning/10 border border-status-warning/30 px-4 py-3 flex items-center justify-between">
          <span className="text-sm text-status-warning">{pendingCount} queued action(s) will send when online</span>
          <span className="text-xs text-text-muted">Idempotency keys preserved — no duplicates</span>
        </div>
      )}

      <LegalDisclaimerModal
        isOpen={showDisclaimer}
        onAccept={handleDisclaimerAccept}
        onDecline={() => setShowDisclaimer(false)}
        lossRatio={{ buyer: data.buyerRatio * 100, seller: data.sellerRatio * 100 }}
        tradeValueCngn={amountUsdc}
      />

      <div className="flex gap-3">
        <button
          disabled={loading}
          onClick={() => setStep(2)}
          className="flex-1 h-12 rounded-full border border-border-default text-text-secondary hover:border-border-hover transition-colors disabled:opacity-40"
        >
          Back
        </button>
        <button
          disabled={loading || !isFormValid}
          onClick={() => setShowDisclaimer(true)}
          className="flex-1 h-12 rounded-full bg-gradient-gold-cta text-text-inverse font-semibold disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
                <path d="M12 2a10 10 0 0 1 10 10" />
              </svg>
              Creating Trade...
            </>
          ) : (
            "Lock Funds & Create Trade"
          )}
        </button>
      </div>
    </div>
  );
}
