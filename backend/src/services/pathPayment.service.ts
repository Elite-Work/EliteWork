import { StellarService } from "./stellar.service";
import * as StellarSdk from "@stellar/stellar-sdk";
import { retryAsync } from "../lib/retry";
import { appLogger } from "../middleware/logger";
import { USDC_ISSUER_MAINNET, USDC_ISSUER_TESTNET } from "../config/stellar";
import { CircuitBreaker, CircuitBreakerOpenError } from "../lib/circuitBreaker";
import {
  getCachedQuote,
  setCachedQuote,
  QuoteRequest,
  CachedQuote,
} from "./quoteCache.service";

export interface PathPaymentQuoteResult {
  quotes: CachedQuote["quotes"];
  /** Whether the result came from cache. */
  cached: boolean;
  /** Freshness of the quote in milliseconds (0 if fresh from Horizon). */
  freshnessMs: number;
  /** ISO-8601 timestamp of when the quote was originally fetched. */
  quotedAt: string;
}

export class PathPaymentService {
  private stellarService: StellarService;
  private readonly circuitBreaker: CircuitBreaker;

  constructor(circuitBreaker?: CircuitBreaker) {
    this.stellarService = new StellarService();
    this.circuitBreaker =
      circuitBreaker ??
      new CircuitBreaker("horizon-path-payment", {
        failureThreshold: 5,
        successThreshold: 2,
        cooldownMs: 30_000,
      });
  }

  /**
   * Discovers NGN -> USDC (or any asset to USDC) conversion routes.
   * Retries on transient errors and trips a circuit breaker on sustained Horizon outages.
   *
   * Uses a short-TTL Redis cache keyed by asset pair + amount so repeated
   * requests for the same route within the TTL window return cached results.
   * The response includes quote freshness metadata for slippage protection.
   */
  public async getPathPaymentQuote(
    sourceAmount: string,
    sourceAssetCode: string,
    sourceAssetIssuer?: string,
  ): Promise<PathPaymentQuoteResult> {
    const request: QuoteRequest = {
      sourceAmount,
      sourceAssetCode,
      sourceAssetIssuer,
    };

    // Check cache first
    const cached = await getCachedQuote(request);
    if (cached) {
      return {
        quotes: cached.quotes,
        cached: true,
        freshnessMs: cached.freshnessMs,
        quotedAt: cached.quotedAt,
      };
    }

    try {
      const server = this.stellarService.getServer();

      const sourceAsset =
        sourceAssetCode === "XLM" || sourceAssetCode === "native"
          ? StellarSdk.Asset.native()
          : new StellarSdk.Asset(
              sourceAssetCode,
              sourceAssetIssuer || "GASIVS63V6PAKAMW3ZYEX2RNNB3Q4UMRKDIQHNMH3LRNTSWVHXMTANKE",
            );

      const network = this.stellarService.getNetworkPassphrase();
      const usdcIssuer =
        network === StellarSdk.Networks.PUBLIC
          ? USDC_ISSUER_MAINNET
          : USDC_ISSUER_TESTNET;

      const destAssets = [new StellarSdk.Asset("USDC", usdcIssuer)];

      const paths = await this.circuitBreaker.call(() =>
        retryAsync(
          () => server.strictSendPaths(sourceAsset, sourceAmount, destAssets).call(),
          {
            backoffMs: [1000, 2000, 4000, 8000],
            operationName: "stellar.pathPaymentQuote",
          },
        ),
      );

      const quotes = paths.records.map((record) => ({
        source_amount: record.source_amount,
        source_asset_type: record.source_asset_type,
        source_asset_code: record.source_asset_code,
        destination_amount: record.destination_amount,
        destination_asset_type: record.destination_asset_type,
        destination_asset_code: record.destination_asset_code,
        path: record.path,
      }));

      // Cache the result
      await setCachedQuote(request, quotes);

      return {
        quotes,
        cached: false,
        freshnessMs: 0,
        quotedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof CircuitBreakerOpenError) {
        appLogger.warn({ error }, "Path payment circuit breaker open");
        throw new Error("Payment service temporarily unavailable");
      }
      appLogger.error({ error }, "Path payment quote error");
      throw new Error("Failed to fetch path payment quotes");
    }
  }
}
