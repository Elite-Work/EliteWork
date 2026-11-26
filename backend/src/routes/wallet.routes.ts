import { Router } from "express";
import { authMiddleware } from "../middleware/auth.middleware";
import { AuthRequest } from "../services/auth.service";
import { WalletService } from "../services/wallet.service";
import { PathPaymentService } from "../services/pathPayment.service";
import { TOKEN_CONFIG } from "../config/token";

export const walletRoutes = Router();
const walletService = new WalletService();
const pathPaymentService = new PathPaymentService();

function queryString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

walletRoutes.get("/balance", authMiddleware, async (req: AuthRequest, res) => {
  try {
    const walletAddress = req.user?.walletAddress;
    if (!walletAddress) {
      return res.status(400).json({ error: "Wallet address not found in token" });
    }
    const balance = await walletService.getUsdcBalance(walletAddress);
    res.json({ balance, asset: TOKEN_CONFIG.symbol });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});


walletRoutes.get("/path-payment-quote", authMiddleware, async (req, res) => {
  try {
    const sourceAmount = queryString(req.query.sourceAmount);
    const sourceAsset = queryString(req.query.sourceAsset);
    const sourceAssetIssuer = queryString(req.query.sourceAssetIssuer);
    if (!sourceAmount || !sourceAsset) {
      return res.status(400).json({ error: "Missing sourceAmount or sourceAsset" });
    }
    
    const quotes = await pathPaymentService.getPathPaymentQuote(
      sourceAmount,
      sourceAsset,
      sourceAssetIssuer,
    );
    res.json({ routes: quotes });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch quotes" });
  }
});

/**
 * OpenAPI coverage manifest for the wallet route group.
 *
 * Every endpoint registered on this router MUST be listed here so that the
 * OpenAPI coverage test can assert each one is documented in
 * `backend/src/docs/openapi.yaml`. The drift test only validates paths that
 * are already documented, so this manifest closes the gap for undocumented
 * routes. Keep this in sync whenever a route is added or removed.
 */
export const walletRouteManifest = [
  {
    method: "get",
    path: "/wallet/balance",
    operationId: "getWalletBalance",
    summary: "Get the authenticated wallet's USDC balance",
    security: [{ bearerAuth: [] }],
    responses: {
      "200": {
        description: "Current wallet balance",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["balance", "asset"],
              properties: {
                balance: { type: "string" },
                asset: { type: "string" },
              },
            },
          },
        },
      },
      "400": {
        description: "Wallet address not found in token",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["error"],
              properties: { error: { type: "string" } },
            },
          },
        },
      },
      "500": {
        description: "Failed to fetch balance",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["error"],
              properties: { error: { type: "string" } },
            },
          },
        },
      },
    },
  },
  {
    method: "get",
    path: "/wallet/path-payment-quote",
    operationId: "getPathPaymentQuote",
    summary: "Get path payment quotes for a source amount and asset",
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: "sourceAmount",
        in: "query",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "sourceAsset",
        in: "query",
        required: true,
        schema: { type: "string" },
      },
      {
        name: "sourceAssetIssuer",
        in: "query",
        required: false,
        schema: { type: "string" },
      },
    ],
    responses: {
      "200": {
        description: "Available path payment routes",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["routes"],
              properties: {
                routes: { type: "array", items: { type: "object" } },
              },
            },
          },
        },
      },
      "400": {
        description: "Missing sourceAmount or sourceAsset",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["error"],
              properties: { error: { type: "string" } },
            },
          },
        },
      },
      "500": {
        description: "Failed to fetch quotes",
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["error"],
              properties: { error: { type: "string" } },
            },
          },
        },
      },
    },
  },
] as const;
