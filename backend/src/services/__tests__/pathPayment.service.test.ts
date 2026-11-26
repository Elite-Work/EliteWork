import * as StellarSdk from "@stellar/stellar-sdk";
import { PathPaymentService } from "../pathPayment.service";
import { StellarService } from "../stellar.service";
import { USDC_ISSUER_MAINNET, USDC_ISSUER_TESTNET } from "../../config/stellar";
import { CircuitBreaker, CircuitBreakerOpenError } from "../../lib/circuitBreaker";
import { getCachedQuote, setCachedQuote } from "../quoteCache.service";
import { appLogger } from "../../middleware/logger";

jest.mock("../stellar.service");
jest.mock("../quoteCache.service", () => ({
  getCachedQuote: jest.fn(),
  setCachedQuote: jest.fn(),
}));
jest.mock("../../lib/retry", () => ({
  retryAsync: jest.fn((operation: () => Promise<unknown>) => operation()),
}));

const mockedGetCachedQuote = getCachedQuote as jest.MockedFunction<typeof getCachedQuote>;
const mockedSetCachedQuote = setCachedQuote as jest.MockedFunction<typeof setCachedQuote>;
const MockedStellarService = StellarService as jest.MockedClass<typeof StellarService>;

describe("PathPaymentService", () => {
  let mockStrictSendCall: jest.Mock;
  let mockStrictSendPaths: jest.Mock;
  let mockGetServer: jest.Mock;
  let mockGetNetworkPassphrase: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockStrictSendCall = jest.fn();
    mockStrictSendPaths = jest.fn().mockReturnValue({
      call: mockStrictSendCall,
    });
    mockGetServer = jest.fn().mockReturnValue({
      strictSendPaths: mockStrictSendPaths,
    });
    mockGetNetworkPassphrase = jest.fn().mockReturnValue(StellarSdk.Networks.TESTNET);

    MockedStellarService.mockImplementation(
      () =>
        ({
          getServer: mockGetServer,
          getNetworkPassphrase: mockGetNetworkPassphrase,
        }) as unknown as StellarService,
    );
  });

  describe("getPathPaymentQuote", () => {
    it("returns cached quote metadata immediately without calling Horizon on cache hit", async () => {
      const cachedPayload = {
        sourceAssetCode: "NGN",
        sourceAssetIssuer: "GISSUER123456789012345678901234567890123456789012345678",
        sourceAmount: "50000",
        quotes: [
          {
            source_amount: "50000.0000000",
            source_asset_type: "credit_alphanum4",
            source_asset_code: "NGN",
            destination_amount: "31.2500000",
            destination_asset_type: "credit_alphanum4",
            destination_asset_code: "USDC",
            path: [],
          },
        ],
        quotedAt: "2026-03-30T12:00:00.000Z",
        freshnessMs: 4200,
      };
      mockedGetCachedQuote.mockResolvedValueOnce(cachedPayload);

      const service = new PathPaymentService();
      const result = await service.getPathPaymentQuote(
        "50000",
        "NGN",
        "GISSUER123456789012345678901234567890123456789012345678",
      );

      expect(result).toEqual({
        quotes: cachedPayload.quotes,
        cached: true,
        freshnessMs: 4200,
        quotedAt: "2026-03-30T12:00:00.000Z",
      });
      expect(mockGetServer).not.toHaveBeenCalled();
      expect(mockStrictSendPaths).not.toHaveBeenCalled();
      expect(mockedSetCachedQuote).not.toHaveBeenCalled();
    });

    it("fetches fresh path payment quotes from Horizon on cache miss, caches them, and uses testnet USDC issuer", async () => {
      mockedGetCachedQuote.mockResolvedValueOnce(null);
      mockStrictSendCall.mockResolvedValueOnce({
        records: [
          {
            source_amount: "100000.0000000",
            source_asset_type: "credit_alphanum4",
            source_asset_code: "NGN",
            destination_amount: "62.5000000",
            destination_asset_type: "credit_alphanum4",
            destination_asset_code: "USDC",
            path: [{ asset_type: "native" }],
            extra_horizon_field: "ignored",
          },
        ],
      });

      const service = new PathPaymentService();
      const result = await service.getPathPaymentQuote("100000", "NGN");

      expect(mockStrictSendPaths).toHaveBeenCalledTimes(1);
      const [sourceAssetArg, sourceAmountArg, destAssetsArg] = mockStrictSendPaths.mock.calls[0];
      expect(sourceAssetArg.getCode()).toBe("NGN");
      expect(sourceAssetArg.getIssuer()).toBe(
        "GASIVS63V6PAKAMW3ZYEX2RNNB3Q4UMRKDIQHNMH3LRNTSWVHXMTANKE",
      );
      expect(sourceAmountArg).toBe("100000");
      expect(destAssetsArg).toHaveLength(1);
      expect(destAssetsArg[0].getCode()).toBe("USDC");
      expect(destAssetsArg[0].getIssuer()).toBe(USDC_ISSUER_TESTNET);

      const expectedQuotes = [
        {
          source_amount: "100000.0000000",
          source_asset_type: "credit_alphanum4",
          source_asset_code: "NGN",
          destination_amount: "62.5000000",
          destination_asset_type: "credit_alphanum4",
          destination_asset_code: "USDC",
          path: [{ asset_type: "native" }],
        },
      ];

      expect(mockedSetCachedQuote).toHaveBeenCalledWith(
        {
          sourceAmount: "100000",
          sourceAssetCode: "NGN",
          sourceAssetIssuer: undefined,
        },
        expectedQuotes,
      );
      expect(result.quotes).toEqual(expectedQuotes);
      expect(result.cached).toBe(false);
      expect(result.freshnessMs).toBe(0);
      expect(() => new Date(result.quotedAt).toISOString()).not.toThrow();
    });

    it("uses native Stellar asset when sourceAssetCode is 'XLM' or 'native' and selects mainnet USDC issuer on PUBLIC network", async () => {
      mockedGetCachedQuote.mockResolvedValue(null);
      mockGetNetworkPassphrase.mockReturnValue(StellarSdk.Networks.PUBLIC);
      mockStrictSendCall.mockResolvedValue({ records: [] });

      const service = new PathPaymentService();
      await service.getPathPaymentQuote("250", "XLM");
      await service.getPathPaymentQuote("250", "native");

      expect(mockStrictSendPaths).toHaveBeenCalledTimes(2);
      const [firstSourceAsset, , firstDestAssets] = mockStrictSendPaths.mock.calls[0];
      const [secondSourceAsset] = mockStrictSendPaths.mock.calls[1];

      expect(firstSourceAsset.isNative()).toBe(true);
      expect(secondSourceAsset.isNative()).toBe(true);
      expect(firstDestAssets[0].getIssuer()).toBe(USDC_ISSUER_MAINNET);
    });

    it("throws 'Payment service temporarily unavailable' when the circuit breaker is open", async () => {
      mockedGetCachedQuote.mockResolvedValueOnce(null);
      const warnSpy = jest.spyOn(appLogger, "warn").mockImplementation();

      const openBreaker = {
        call: jest.fn().mockRejectedValue(new CircuitBreakerOpenError("horizon-path-payment")),
      } as unknown as CircuitBreaker;

      const service = new PathPaymentService(openBreaker);

      await expect(service.getPathPaymentQuote("1000", "NGN")).rejects.toThrow(
        "Payment service temporarily unavailable",
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ error: expect.any(CircuitBreakerOpenError) }),
        "Path payment circuit breaker open",
      );

      warnSpy.mockRestore();
    });

    it("logs error and throws 'Failed to fetch path payment quotes' on unexpected Horizon failure", async () => {
      mockedGetCachedQuote.mockResolvedValueOnce(null);
      const errorSpy = jest.spyOn(appLogger, "error").mockImplementation();
      const horizonError = new Error("Horizon 502 Bad Gateway");
      mockStrictSendCall.mockRejectedValueOnce(horizonError);

      const service = new PathPaymentService();

      await expect(service.getPathPaymentQuote("1000", "NGN")).rejects.toThrow(
        "Failed to fetch path payment quotes",
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.objectContaining({ error: horizonError }),
        "Path payment quote error",
      );

      errorSpy.mockRestore();
    });
  });
});
