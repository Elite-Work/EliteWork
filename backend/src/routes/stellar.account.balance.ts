import { Horizon, NetworkError } from "@stellar/stellar-sdk";
import { Router, Request, Response } from "express";
import { horizonServer } from "../config/stellar";
import { appLogger } from "../middleware/logger";

interface Balance {
  assetType: string;
  assetCode: string;
  issuer: string | null;
  balance: string;
  limit: string | null;
}

function parseBalances(rawBalances: Horizon.HorizonApi.BalanceLine[]): Balance[] {
  return rawBalances.map((b): Balance => {
    if (b.asset_type === "native") {
      return {
        assetType: "native",
        assetCode: "XLM",
        issuer: null,
        balance: b.balance,
        limit: null,
      };
    }
    if (b.asset_type === "liquidity_pool_shares") {
      // Pools have no asset code or issuing account; expose the pool id in
      // place of the issuer so the row is still identifiable downstream.
      return {
        assetType: b.asset_type,
        assetCode: "",
        issuer: b.liquidity_pool_id,
        balance: b.balance,
        limit: b.limit,
      };
    }
    return {
      assetType: b.asset_type,
      assetCode: b.asset_code,
      issuer: b.asset_issuer,
      balance: b.balance,
      limit: b.limit,
    };
  });
}

/** Structural shape of the Horizon/axios error carrying an HTTP status. */
type NetworkErrorLike = { response?: { status?: unknown } };

function isNetworkErrorLike(error: unknown): error is NetworkErrorLike {
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as NetworkErrorLike).response === "object"
  );
}

function isAccountNotFoundError(error: unknown): boolean {
  if (error instanceof NetworkError) {
    return error.response.status === 404;
  }
  // Lightweight doubles (and some environments) may throw a bare
  // { response: { status } } rather than a NetworkError instance.
  return isNetworkErrorLike(error) && error.response?.status === 404;
}

export function createStellarAccountBalanceRouter(): Router {
  const router = Router();

  // GET /stellar/account/:address/balance
  router.get("/:address/balance", async (req: Request, res: Response) => {
    // Express 5 types params values as `string | string[]` (repeated params);
    // this route declares a single-value pattern, so take the first occurrence.
    const raw = req.params.address;
    const address = Array.isArray(raw) ? raw[0] : raw;

    if (!address || address.length !== 56 || !address.startsWith("G")) {
      res.status(400).json({ error: "Invalid Stellar account address" });
      return;
    }

    try {
      const account = await horizonServer.loadAccount(address);
      const balances = parseBalances(account.balances);

      res.json({ address, balances });
    } catch (error: unknown) {
      // Account exists on the Stellar network but is not funded
      if (isAccountNotFoundError(error)) {
        res.json({ address, balances: [] });
        return;
      }

      appLogger.error({ error, address }, "Failed to fetch account balances");
      res.status(502).json({ error: "Failed to fetch account data from Stellar network" });
    }
  });

  return router;
}

export const stellarAccountBalanceRoutes = createStellarAccountBalanceRouter();
