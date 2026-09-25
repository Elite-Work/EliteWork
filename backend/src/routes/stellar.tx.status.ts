import { Router, Request, Response } from "express";
import * as StellarSdk from "@stellar/stellar-sdk";
import { horizonServer } from "../config/stellar";
import { appLogger } from "../middleware/logger";

interface NamedXdrEnum {
  name: string;
}

function isNamedXdrEnum(value: unknown): value is NamedXdrEnum {
  return (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof (value as { name: unknown }).name === "string"
  );
}

function extractXdrCodeName(value: unknown): string {
  if (isNamedXdrEnum(value) && value.name.length > 0) {
    return value.name;
  }
  return "unknown";
}

interface ErrorWithResponse {
  response?: {
    status?: number;
  };
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "response" in error) {
    const res = (error as ErrorWithResponse).response;
    return typeof res === "object" && res !== null && res.status === 404;
  }
  return false;
}

function parseResultCodes(resultXdr: string): { transaction: string; operations: string[] } {
  try {
    const xdr = Buffer.from(resultXdr, "base64");
    const result = StellarSdk.xdr.TransactionResult.fromXDR(xdr);
    const resultCode = result.result().switch();
    const transactionCode = extractXdrCodeName(resultCode);

    const opResults = result.result().results() || [];
    const operationCodes = opResults.map((op) => {
      const opResult = op.tr().switch();
      return extractXdrCodeName(opResult);
    });

    return {
      transaction: transactionCode,
      operations: operationCodes,
    };
  } catch {
    return { transaction: "unknown", operations: [] };
  }
}

export function createStellarTxStatusRouter(): Router {
  const router = Router();

  router.get("/:hash/status", async (req: Request, res: Response) => {
    const hash = req.params.hash as string;

    if (!hash || hash.length !== 64) {
      res.status(400).json({ error: "Invalid transaction hash" });
      return;
    }

    try {
      const txResponse = await horizonServer
        .transactions()
        .transaction(hash)
        .call();

      const resultCodes = parseResultCodes(txResponse.result_xdr);
      const status = txResponse.successful ? "success" : "failed";

      res.json({
        status,
        resultCodes,
        ledger: txResponse.ledger,
        hash: txResponse.id,
        createdAt: txResponse.created_at,
      });
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        res.status(404).json({
          status: "pending",
          hash,
          message: "Transaction not found on Stellar network (may still be pending)",
        });
        return;
      }

      appLogger.error({ error, hash }, "Failed to fetch transaction status");
      res.status(502).json({
        error: "Failed to fetch transaction status from Stellar network",
      });
    }
  });

  return router;
}

export const stellarTxStatusRoutes = createStellarTxStatusRouter();
