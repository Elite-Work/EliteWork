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
