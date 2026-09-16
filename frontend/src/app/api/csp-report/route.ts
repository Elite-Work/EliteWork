import { NextRequest, NextResponse } from "next/server";

/**
 * CSP violation telemetry endpoint (issue #202).
 *
 * The browser POSTs a violation report here (either the legacy
 * `application/csp-report` shape from `report-uri`, or the newer Reporting
 * API `application/reports+json` shape) whenever a request violates the
 * Content-Security-Policy set in `src/middleware.ts`. Reports are logged
 * server-side so violation volume/severity can be reviewed during the
 * report-only burn-in period before CSP_ENFORCE is flipped to `true`.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const reports = Array.isArray(body) ? body : [body];

    for (const report of reports) {
      const violation = report["csp-report"] ?? report.body ?? report;
      console.warn("[csp-violation]", JSON.stringify(violation));
    }
  } catch {
    // Malformed report bodies should never fail the request; the browser
    // does not read the response, so just no-op.
  }

  return new NextResponse(null, { status: 204 });
}
