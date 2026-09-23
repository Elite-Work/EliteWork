"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError, BulkCreateResponse } from "@/lib/api";
import { BULK_IMPORT_MAX_ROWS, parseBulkCsv } from "@/lib/bulkImport";
import { trackAdminEvent } from "@/lib/analytics";
import { Button } from "@/components/ui/Button";
import { ErrorState } from "@/components/ui/ErrorState";

const SAMPLE_CSV = `# sellerAddress,amountUsdc,buyerLossBps,sellerLossBps
GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF,25.50,5000,5000`;

type Phase = "editing" | "submitting" | "done";

/**
 * Minimal bulk-import UI for cooperative onboarding (issue #45).
 *
 * Paste CSV rows (one trade per line), preview the parse, submit to
 * POST /trades/bulk. Per-row failures stay on screen so the admin can fix
 * and resubmit just those rows. Any authenticated wallet may use it — the
 * endpoint carries the same permission as single-trade creation.
 */
export default function CooperativeBulkImportPage() {
  const { token, isAuthenticated } = useAuth();
  const [csv, setCsv] = useState(SAMPLE_CSV);
  const [phase, setPhase] = useState<Phase>("editing");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkCreateResponse | null>(null);

  const parsed = useMemo(() => parseBulkCsv(csv), [csv]);
  const canSubmit =
    isAuthenticated &&
    !!token &&
    phase !== "submitting" &&
    parsed.rows.length > 0 &&
    parsed.errors.length === 0;

  async function handleSubmit() {
    if (!token || parsed.rows.length === 0) return;
    setPhase("submitting");
    setSubmitError(null);
    setResult(null);
    try {
      const response = await api.trades.bulkCreate(token, { trades: parsed.rows });
      setResult(response);
      setPhase("done");
      trackAdminEvent("cooperative_bulk_import", "success", {
        created: response.created.length,
        failed: response.failed.length,
      });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Bulk import failed";
      setSubmitError(message);
      setPhase("editing");
      trackAdminEvent("cooperative_bulk_import", "failed", { reason: message });
    }
  }

  if (!isAuthenticated) {
    return (
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-xl font-semibold">Cooperative bulk import</h1>
        <p className="mt-2 text-text-secondary">
          Connect your wallet to import trades for your cooperative members.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-xl font-semibold">Cooperative bulk import</h1>
      <p className="mt-2 text-sm text-text-secondary">
        One trade per line: <code>sellerAddress,amountUsdc,buyerLossBps,sellerLossBps</code>.
        Loss splits default to 5000/5000 and must sum to 10000. Max{" "}
        {BULK_IMPORT_MAX_ROWS} rows per request.
      </p>

      <label htmlFor="bulk-csv" className="mt-4 block text-sm font-medium">
        Trades CSV
      </label>
      <textarea
        id="bulk-csv"
        rows={10}
        value={csv}
        onChange={(event) => {
          setCsv(event.target.value);
          setResult(null);
          if (phase === "done") setPhase("editing");
        }}
        className="mt-1 w-full rounded-md border border-border-default bg-bg-elevated p-2 font-mono text-sm"
      />

      <p className="mt-2 text-sm" aria-live="polite">
        {parsed.rows.length} valid row{parsed.rows.length === 1 ? "" : "s"}
        {parsed.errors.length > 0 && (
          <span className="text-status-error">
            {" "}
            — {parsed.errors.length} error{parsed.errors.length === 1 ? "" : "s"}:
            {parsed.errors.slice(0, 3).map((error) => (
              <span key={error.line}>
                {" "}
                line {error.line}: {error.message};
              </span>
            ))}
          </span>
        )}
      </p>

      {submitError && (
        <div className="mt-2">
          <ErrorState message={submitError} onRetry={handleSubmit} />
        </div>
      )}

      <div className="mt-4">
        <Button onClick={handleSubmit} disabled={!canSubmit}>
          {phase === "submitting" ? "Importing…" : `Import ${parsed.rows.length} trade(s)`}
        </Button>
      </div>

      {result && (
        <section className="mt-6" aria-live="polite">
          <h2 className="text-lg font-semibold">Result</h2>
          <p className="mt-1 text-sm">
            {result.created.length} created, {result.failed.length} failed.
          </p>
          {result.failed.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm text-status-error">
              {result.failed.map((failure) => (
                <li key={failure.index}>
                  Row {failure.index + 1}: {failure.error}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}
