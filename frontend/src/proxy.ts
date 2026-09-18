import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getStellarRpcUrl } from "@/lib/api/env";

/**
 * Per-request CSP nonce + security headers.
 *
 * Addresses issue #202 (Content-Security-Policy with nonces on Next.js
 * frontend). A fresh cryptographically random nonce is generated for every
 * request and forwarded to the app via the `x-nonce` request header so
 * Server Components can attach it to any inline `<script>` tags. Next.js
 * itself automatically applies the nonce (read back off the CSP response
 * header) to the scripts/styles it injects for the app router — see
 * https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy
 *
 * Rollout: controlled by CSP_ENFORCE. Defaults to report-only so violation
 * telemetry (via /api/csp-report) can be observed for a burn-in period
 * before flipping to enforcing mode. Set CSP_ENFORCE=true once telemetry
 * shows zero high-severity violations.
 *
 * Wallet-frame exemption process: third-party wallet UIs that must be
 * embedded in an iframe (e.g. a hosted signing widget) should be added to
 * the `frame-src` allowlist below via WALLET_FRAME_ALLOWLIST (comma
 * separated origins) rather than relaxing the policy ad-hoc. Requires
 * security sign-off before merging an addition.
 */

function buildConnectSrc(): string {
  const origins = new Set<string>(["'self'"]);
  for (const raw of [getApiBaseUrl(), getStellarRpcUrl()]) {
    try {
      origins.add(new URL(raw).origin);
    } catch {
      // ignore unparsable/relative values
    }
  }
  // WebSocket upgrades share the same origins as their HTTP counterparts.
  for (const origin of Array.from(origins)) {
    if (origin.startsWith("https://")) origins.add(`wss://${origin.slice("https://".length)}`);
    if (origin.startsWith("http://")) origins.add(`ws://${origin.slice("http://".length)}`);
  }
  return Array.from(origins).join(" ");
}

function buildFrameSrc(): string {
  const allowlist = (process.env.WALLET_FRAME_ALLOWLIST ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return ["'self'", ...allowlist].join(" ");
}

function buildCsp(nonce: string): string {
  const directives: Record<string, string> = {
    "default-src": "'self'",
    "script-src": `'self' 'nonce-${nonce}' 'strict-dynamic' https:`,
    "style-src": "'self' 'unsafe-inline'",
    "img-src": "'self' data: blob: https:",
    "font-src": "'self' data:",
    "connect-src": buildConnectSrc(),
    "frame-src": buildFrameSrc(),
    "object-src": "'none'",
    "base-uri": "'self'",
    "form-action": "'self'",
    "frame-ancestors": "'none'",
    "upgrade-insecure-requests": "",
    "report-uri": "/api/csp-report",
  };

  return Object.entries(directives)
    .map(([key, value]) => (value ? `${key} ${value}` : key))
    .join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID().replace(/-/g, "")).toString("base64");
  const csp = buildCsp(nonce);
  const enforce = process.env.CSP_ENFORCE === "true";
  const headerName = enforce
    ? "Content-Security-Policy"
    : "Content-Security-Policy-Report-Only";

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.headers.set(headerName, csp);
  response.headers.set("x-nonce", nonce);

  // Defense-in-depth headers that pair naturally with the CSP rollout.
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, manifest.json (metadata files)
     */
    "/((?!_next/static|_next/image|favicon.ico|manifest.json).*)",
  ],
};
