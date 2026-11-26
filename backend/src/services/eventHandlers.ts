import { DisputeStatus, Prisma, TradeStatus } from "@prisma/client";
import { EventType, ParsedEvent, EVENT_TO_STATUS } from "../types/events";
import { appLogger } from "../middleware/logger";
import { webhookService } from "./webhook.service";
import { TradeWatchlistService, WatchedTradeNotification } from "./trade.watchlist.service";
import { logEscrowEvent } from "../lib/escrowAudit";
import {
  recordTradeFunnelEvent,
  recordTimeToFund,
  recordTimeToRelease,
  recordTradeGmv,
} from "../lib/metrics";

type TradeCreatePayload = {
  tradeId: string;
  buyerAddress: string;
  sellerAddress: string;
  amountUsdc?: string;
  status: (typeof EVENT_TO_STATUS)[EventType];
  version: number;
};

/**
 * Fan a watched-trade event out to every user watching the trade (#497).
 *
 * Called from inside the chain-sync transaction so in-app notification rows
 * commit atomically with the status transition. Failures are logged rather
 * than rethrown: notification delivery must not stop escrow reconciliation,
 * and the originating event is already recorded as processed.
 */
async function dispatchWatchlistUpdate(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
  update: WatchedTradeNotification,
): Promise<void> {
  try {
    const service = new TradeWatchlistService(
      tx as unknown as ConstructorParameters<typeof TradeWatchlistService>[0],
    );
    await service.dispatchTradeNotification(event.tradeId, {
      ...update,
      eventId: event.eventId,
      metadata: { eventType: event.eventType, ledger: event.ledgerSequence, ...update.metadata },
    });
  } catch (error) {
    appLogger.warn(
      { error, tradeId: event.tradeId, eventType: event.eventType },
      "[EventHandler] Watchlist notification dispatch failed",
    );
  }
}

const VALID_PREDECESSORS: Partial<Record<EventType, TradeStatus[]>> = {
  [EventType.TradeFunded]: [TradeStatus.CREATED],
  [EventType.DeliveryConfirmed]: [TradeStatus.FUNDED],
  [EventType.FundsReleased]: [TradeStatus.DELIVERED],
  [EventType.DisputeInitiated]: [TradeStatus.FUNDED, TradeStatus.DELIVERED],
  [EventType.DisputeResolved]: [TradeStatus.DISPUTED],
};

async function applyStatusTransition(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
  createPayload: TradeCreatePayload,
): Promise<void> {
  const upsert = tx.trade.upsert;
  const findUnique = tx.trade.findUnique;

  // Some transaction doubles (and older Prisma-compatible adapters) expose
  // only upsert. Keep the atomic create path available for those clients.
  if (typeof findUnique !== "function") {
    if (typeof upsert !== "function") {
      throw new Error("Trade transaction client must expose findUnique or upsert");
    }
    await upsert({
      where: { tradeId: event.tradeId },
      update: {
        status: createPayload.status,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
      create: createPayload,
    });
    return;
  }

  const existing = await findUnique({
    where: { tradeId: event.tradeId },
  });

  if (!existing) {
    if (typeof upsert === "function") {
      await upsert({
        where: { tradeId: event.tradeId },
        update: {
          status: createPayload.status,
          version: { increment: 1 },
          updatedAt: new Date(),
        },
        create: createPayload,
      });
    } else {
      await tx.trade.create({ data: createPayload });
    }
    return;
  }

  const validPredecessors = VALID_PREDECESSORS[event.eventType];
  if (
    !validPredecessors ||
    !validPredecessors.includes(existing.status as TradeStatus)
  ) {
    return;
  }

  const result = await tx.trade.updateMany({
    where: {
      tradeId: event.tradeId,
      status: existing.status,
      version: existing.version,
    },
    data: {
      status: EVENT_TO_STATUS[event.eventType],
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  });

  if (result.count === 0) {
    throw new Error("Concurrency conflict");
  }
}

export async function handleTradeCreated(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
): Promise<void> {
  const status = EVENT_TO_STATUS[event.eventType];
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress: (event.data.buyer as string) || "",
    sellerAddress: (event.data.seller as string) || "",
    amountUsdc: String(event.data.amount_usdc ?? event.data.amount ?? "0"),
    status,
    version: 1,
  });
  logEscrowEvent({
    tradeId: event.tradeId,
    eventType: "TradeCreated",
    toStatus: TradeStatus.CREATED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
    actor: (event.data.buyer as string) || undefined,
    amountUsdc:
      event.data.amount_usdc != null
        ? String(event.data.amount_usdc)
        : undefined,
    extra: { seller: event.data.seller },
  });
  appLogger.debug(
    { tradeId: event.tradeId, ledger: event.ledgerSequence },
    "[EventHandler] TradeCreated",
  );
  // KPI: funnel counter
  recordTradeFunnelEvent("created");
  webhookService.dispatch(event.tradeId, TradeStatus.CREATED, {
    ledger: event.ledgerSequence,
  });
}

export async function handleTradeFunded(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
): Promise<void> {
  const status = EVENT_TO_STATUS[event.eventType];
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress: "",
    sellerAddress: "",
    status,
    version: 1,
  });
  logEscrowEvent({
    tradeId: event.tradeId,
    eventType: "TradeFunded",
    toStatus: TradeStatus.FUNDED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
    amountUsdc:
      event.data.amount_usdc != null
        ? String(event.data.amount_usdc)
        : undefined,
    extra: { note: "funds_locked_in_escrow" },
  });
  appLogger.info(
    {
      requestId: undefined,
      userId: undefined,
      paymentId: event.tradeId,
      provider: "stellar",
      status: "authorization_approved",
      timestamp: new Date().toISOString(),
    },
    "Payment authorization approved",
  );
  appLogger.debug(
    { tradeId: event.tradeId, ledger: event.ledgerSequence },
    "[EventHandler] TradeFunded",
  );
  // KPI: funnel counter + time-to-fund duration (best-effort: only when createdAt available)
  recordTradeFunnelEvent("funded");
  webhookService.dispatch(event.tradeId, TradeStatus.FUNDED, {
    ledger: event.ledgerSequence,
  });
  await dispatchWatchlistUpdate(tx, event, {
    eventKey: "trade-funded",
    title: "Trade funded",
    message: `Watched trade ${event.tradeId} has been funded and the seller can now deliver.`,
    metadata: { status: TradeStatus.FUNDED },
  });
}

export async function handleDeliveryConfirmed(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
): Promise<void> {
  const status = EVENT_TO_STATUS[event.eventType];
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress: "",
    sellerAddress: "",
    status,
    version: 1,
  });
  logEscrowEvent({
    tradeId: event.tradeId,
    eventType: "DeliveryConfirmed",
    toStatus: TradeStatus.DELIVERED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
  });
  appLogger.debug(
    { tradeId: event.tradeId, ledger: event.ledgerSequence },
    "[EventHandler] DeliveryConfirmed",
  );
  // KPI: funnel counter
  recordTradeFunnelEvent("delivered");
  webhookService.dispatch(event.tradeId, TradeStatus.DELIVERED, {
    ledger: event.ledgerSequence,
  });
  await dispatchWatchlistUpdate(tx, event, {
    eventKey: "trade-delivered",
    title: "Delivery confirmed",
    message: `Delivery for watched trade ${event.tradeId} has been confirmed.`,
    metadata: { status: TradeStatus.DELIVERED },
  });
}

export async function handleFundsReleased(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
): Promise<void> {
  const status = EVENT_TO_STATUS[event.eventType];
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress: "",
    sellerAddress: "",
    status,
    version: 1,
  });
  logEscrowEvent({
    tradeId: event.tradeId,
    eventType: "FundsReleased",
    toStatus: TradeStatus.COMPLETED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
    amountUsdc:
      event.data.amount_usdc != null
        ? String(event.data.amount_usdc)
        : undefined,
    extra: { note: "funds_released_to_seller" },
  });
  appLogger.debug(
    { tradeId: event.tradeId, ledger: event.ledgerSequence },
    "[EventHandler] FundsReleased",
  );
  // KPI: funnel counter + time-to-release + GMV
  recordTradeFunnelEvent("released");
  const amountStr = event.data.amount_usdc != null ? String(event.data.amount_usdc) : "0";
  recordTradeGmv(amountStr, "released");
  webhookService.dispatch(event.tradeId, TradeStatus.COMPLETED, {
    ledger: event.ledgerSequence,
  });
  await dispatchWatchlistUpdate(tx, event, {
    eventKey: "trade-released",
    title: "Trade completed",
    message: `Funds for watched trade ${event.tradeId} have been released and the trade is complete.`,
    metadata: { status: TradeStatus.COMPLETED },
  });
}

async function syncDisputeFromEvent(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
  resolved: boolean,
): Promise<void> {
  const dispute = tx.dispute as Prisma.TransactionClient["dispute"] | undefined;
  if (!dispute || typeof dispute.findUnique !== "function") return;

  const existing = await dispute.findUnique({ where: { tradeId: event.tradeId } });
  if (!resolved) {
    if (!existing) {
      await dispute.create({
        data: {
          tradeId: event.tradeId,
          initiator: String(event.data.initiator ?? ""),
          reason: String(event.data.reason ?? "Dispute initiated on-chain"),
          status: DisputeStatus.OPEN,
          version: 0,
        },
      });
    }
    return;
  }

  if (existing) {
    await dispute.updateMany({
      where: { tradeId: event.tradeId, status: DisputeStatus.OPEN },
      data: {
        status: DisputeStatus.RESOLVED,
        resolvedAt: new Date(),
        version: { increment: 1 },
      },
    });
  }
}

export async function handleDisputeInitiated(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
): Promise<void> {
  const status = EVENT_TO_STATUS[event.eventType];
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress: "",
    sellerAddress: "",
    status,
    version: 1,
  });
  await syncDisputeFromEvent(tx, event, false);
  logEscrowEvent({
    tradeId: event.tradeId,
    eventType: "DisputeInitiated",
    toStatus: TradeStatus.DISPUTED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
    actor: (event.data.initiator as string) || undefined,
    extra: { reason: event.data.reason },
  });
  appLogger.debug(
    { tradeId: event.tradeId, ledger: event.ledgerSequence },
    "[EventHandler] DisputeInitiated",
  );
  // KPI: funnel counter (dispute spike is tracked by Prometheus alerting rule against this counter)
  recordTradeFunnelEvent("disputed");
  webhookService.dispatch(event.tradeId, TradeStatus.DISPUTED, {
    ledger: event.ledgerSequence,
  });
  await dispatchWatchlistUpdate(tx, event, {
    eventKey: "trade-disputed",
    title: "Dispute opened",
    message: `A dispute has been opened on watched trade ${event.tradeId}.`,
    metadata: { status: TradeStatus.DISPUTED },
  });
}

export async function handleDisputeResolved(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
): Promise<void> {
  const status = EVENT_TO_STATUS[event.eventType];
  await applyStatusTransition(tx, event, {
    tradeId: event.tradeId,
    buyerAddress: "",
    sellerAddress: "",
    status,
    version: 1,
  });
  await syncDisputeFromEvent(tx, event, true);
  logEscrowEvent({
    tradeId: event.tradeId,
    eventType: "DisputeResolved",
    toStatus: TradeStatus.COMPLETED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
    actor: (event.data.resolver as string) || undefined,
    extra: { resolution: event.data.resolution },
  });
  appLogger.debug(
    { tradeId: event.tradeId, ledger: event.ledgerSequence },
    "[EventHandler] DisputeResolved",
  );
  webhookService.dispatch(event.tradeId, TradeStatus.COMPLETED, {
    ledger: event.ledgerSequence,
  });
  await dispatchWatchlistUpdate(tx, event, {
    eventKey: "trade-dispute-resolved",
    title: "Dispute resolved",
    message: `The dispute on watched trade ${event.tradeId} has been resolved.`,
    metadata: { status: TradeStatus.COMPLETED },
  });
}

export async function handleStreamClawback(tx: Prisma.TransactionClient, event: ParsedEvent): Promise<void> {
  const streamId = String(event.data.stream_id ?? event.data.streamId ?? event.tradeId ?? "");
  const admin = String(event.data.admin ?? "");
  const amount = String(event.data.amount ?? "0");

  if (!streamId) return;

  logEscrowEvent({
    tradeId: streamId,
    eventType: "StreamClawback",
    toStatus: TradeStatus.CANCELLED,
    ledgerSequence: event.ledgerSequence,
    contractId: event.contractId,
    actor: admin,
    amountUsdc: amount,
    extra: { stream_id: streamId },
  });

  await tx.streamClawbackEvent.upsert({
    where: {
      streamId_txHash: { streamId, txHash: event.eventId },
    },
    update: {},
    create: {
      streamId,
      admin,
      amount,
      txHash: event.eventId,
    timestamp: new Date(),
    },
  });

  appLogger.debug({ streamId, admin, amount, ledger: event.ledgerSequence }, "[EventHandler] StreamClawback");
}

/** Dispatch a parsed event to the correct handler */
export async function dispatchEvent(
  tx: Prisma.TransactionClient,
  event: ParsedEvent,
): Promise<void> {
  const handlers: Record<
    EventType,
    (t: Prisma.TransactionClient, e: ParsedEvent) => Promise<void>
  > = {
    [EventType.TradeCreated]: handleTradeCreated,
    [EventType.TradeFunded]: handleTradeFunded,
    [EventType.DeliveryConfirmed]: handleDeliveryConfirmed,
    [EventType.FundsReleased]: handleFundsReleased,
    [EventType.DisputeInitiated]: handleDisputeInitiated,
    [EventType.DisputeResolved]: handleDisputeResolved,
    [EventType.StreamClawback]: handleStreamClawback,
  };

  const handler = handlers[event.eventType];
  if (handler) {
    await handler(tx, event);
  } else {
    appLogger.warn(
      { eventType: event.eventType },
      "[EventHandler] Unknown event type",
    );
  }
}
