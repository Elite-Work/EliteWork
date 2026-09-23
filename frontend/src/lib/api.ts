import { adminAuditApi } from "./api/adminAudit";
import { adminStreamsApi } from "./api/adminStreams";
import { authApi } from "./api/auth";
import { ApiError } from "./api/client";
import { disputesApi } from "./api/disputes";
import { getApiBaseUrl, getStellarNetworkPassphrase, getStellarRpcUrl } from "./api/env";
import { reputationApi } from "./api/reputation";
import { searchApi } from "./api/search";
import { streamsApi } from "./api/streams";
import { tradesApi } from "./api/trades";
import { walletApi } from "./api/wallet";

export type {
  AdminAuditEntry,
  AdminAuditListResponse,
  AdminStreamSummary,
  AdminStreamListResponse,
  StreamClawbackPreviewResponse,
  StreamStatus,
  VestingState,
  BulkCreateResponse,
  ChallengeResponse,
  CreateTradeRequest,
  CreateTradeResponse,
  DepositResponse,
  DisputeListResponse,
  DisputeResponse,
  EvidenceRecord,
  EvidenceResponse,
  PathPaymentQuote,
  ReputationEvent,
  ReputationResponse,
  SearchResponse,
  SearchResultItem,
  TradeHistoryEvent,
  TradeHistoryResponse,
  TradeListResponse,
  TradeResponse,
  TradeStatsResponse,
  VerifyResponse,
} from "./api/types";

export type {
  ClawbackPreviewRequest,
  ClawbackPreviewResponse,
  ResumeStreamRequest,
  ResumeStreamResponse,
  StreamRemainingResponse,
  StreamResponse,
  SuspendStreamRequest,
  SuspendStreamResponse,
} from "./api/streams";

export const api = {
  auth: authApi,
  adminAudit: adminAuditApi,
  adminStreams: adminStreamsApi,
  disputes: disputesApi,
  reputation: reputationApi,
  search: searchApi,
  streams: streamsApi,
  trades: tradesApi,
  wallet: walletApi,
};

export const apiConfig = {
  getBaseUrl: getApiBaseUrl,
  getStellarRpcUrl,
  getStellarNetworkPassphrase,
};

export { ApiError };
