/**
 * Typed Mock Factories for Tests
 * 
 * Replaces `any` casts that bypass TypeScript's type checking and can silently
 * break when real function signatures change.
 * 
 * Usage:
 *   import { createMockPrisma, createMockTrade, MockedPrisma } from './factories/mockFactories';
 */

import type { Prisma, Trade, ChainEventOutbox, EscrowAudit, ProcessedEvent, TradeEvidence } from "@prisma/client";

// =============================================================================
// Prisma Client Mocks
// =============================================================================

/**
 * Creates a fully typed mock Prisma client for testing.
 * All database operations return properly typed promises.
 */
export function createMockPrisma(): MockedPrisma {
  return {
    $transaction: jest.fn().mockImplementation(async <T>(fn: (tx: MockedPrisma) => Promise<T>): Promise<T> => {
      return fn(mockTransactionPrisma);
    }),
    trade: createMockTradeDelegate(),
    chainEventOutbox: createMockChainEventOutboxDelegate(),
    escrowAudit: createMockEscrowAuditDelegate(),
    processedEvent: createMockProcessedEventDelegate(),
    tradeEvidence: createMockTradeEvidenceDelegate(),
    adminActionAudit: createMockAdminActionAuditDelegate(),
  };
}

const mockTransactionPrisma = createMockPrisma();

function createMockTradeDelegate(): MockedDelegate<Prisma.TradeDelegate> {
  return {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  };
}

function createMockChainEventOutboxDelegate(): MockedDelegate<Prisma.ChainEventOutboxDelegate> {
  return {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  };
}

function createMockEscrowAuditDelegate(): MockedDelegate<Prisma.EscrowAuditDelegate> {
  return {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  };
}

function createMockProcessedEventDelegate(): MockedDelegate<Prisma.ProcessedEventDelegate> {
  return {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  };
}

function createMockTradeEvidenceDelegate(): MockedDelegate<Prisma.TradeEvidenceDelegate> {
  return {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  };
}

function createMockAdminActionAuditDelegate(): MockedDelegate<Prisma.AdminActionAuditDelegate> {
  return {
    create: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
  };
}

// =============================================================================
// Prisma Model Fixture Builders
// =============================================================================

/**
 * Creates a Trade fixture with sensible defaults.
 * Use .with() to override specific fields.
 */
export function createMockTrade(overrides: Partial<Trade> = {}): Trade {
  const now = new Date();
  return {
    id: 1,
    tradeId: overrides.tradeId ?? "trade-001",
    buyerAddress: "GBUQWP3BOUZX34ULNQG23RQ6F4OXTBIQF7XNVFQY2VQWT5FJA7RJIUU",
    sellerAddress: "GCFVBVQZZW4IXX3LRFIPWWVKXNX3SBR6VS5KW4YGRCL4ADF6XNKFMJM",
    amountUsdc: "1000",
    buyerLossBps: 100,
    sellerLossBps: 100,
    status: "PENDING_SIGNATURE" as Trade["status"],
    version: 0,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    contractId: null,
    fundedAt: null,
    deliveredAt: null,
    completedAt: null,
    disputedAt: null,
    resolvedAt: null,
    ...overrides,
  };
}

/**
 * Creates a ChainEventOutbox fixture with sensible defaults.
 */
export function createMockChainEventOutbox(overrides: Partial<ChainEventOutbox> = {}): ChainEventOutbox {
  const now = new Date();
  return {
    id: 1,
    tradeId: overrides.tradeId ?? "trade-001",
    contractId: "CADDR123",
    ledgerSequence: 1000,
    eventId: "event-001",
    eventType: "TradeFunded" as ChainEventOutbox["eventType"],
    payload: { amount_usdc: "1000" },
    status: "PENDING" as ChainEventOutbox["status"],
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    processedAt: null,
    ...overrides,
  };
}

/**
 * Creates a ProcessedEvent fixture with sensible defaults.
 */
export function createMockProcessedEvent(overrides: Partial<ProcessedEvent> = {}): ProcessedEvent {
  return {
    id: 1,
    ledgerSequence: overrides.ledgerSequence ?? 1000,
    contractId: overrides.contractId ?? "CADDR123",
    eventId: overrides.eventId ?? "event-001",
    processedAt: overrides.processedAt ?? new Date(),
    ...overrides,
  };
}

/**
 * Creates a EscrowAudit fixture with sensible defaults.
 */
export function createMockEscrowAudit(overrides: Partial<EscrowAudit> = {}): EscrowAudit {
  const now = new Date();
  return {
    id: 1,
    tradeId: overrides.tradeId ?? "trade-001",
    eventType: overrides.eventType ?? "TradeCreated",
    fromStatus: overrides.fromStatus ?? null,
    toStatus: overrides.toStatus ?? "CREATED",
    actor: overrides.actor ?? "GBUQWP3BOUZX34ULNQG23RQ6F4OXTBIQF7XNVFQY2VQWT5FJA7RJIUU",
    contractId: "CADDR123",
    ledgerSequence: 1000,
    extra: {},
    createdAt: now,
    ...overrides,
  };
}

/**
 * Creates a TradeEvidence fixture with sensible defaults.
 */
export function createMockTradeEvidence(overrides: Partial<TradeEvidence> = {}): TradeEvidence {
  const now = new Date();
  return {
    id: 1,
    tradeId: overrides.tradeId ?? "trade-001",
    ipfsCid: "bafy123",
    fileName: "evidence.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    uploadedAt: now,
    ...overrides,
  };
}

// =============================================================================
// Stellar/RPC Event Mocks
// =============================================================================

/**
 * Creates a raw Soroban event for testing event listener.
 */
export function createRawSorobanEvent(overrides: {
  ledger?: number;
  id?: string;
  contractId?: string;
  topics?: Array<{ _scval: string }>;
  value?: { type: string; value: unknown };
} = {}): RawSorobanEvent {
  return {
    ledger: overrides.ledger ?? 1000,
    id: overrides.id ?? `evt-${overrides.ledger ?? 1000}`,
    contractId: overrides.contractId ?? "CONTRACT_TEST_123",
    topic: overrides.topics ?? [
      { _scval: "symbol" },
      { _scval: "tradeId" },
    ],
    value: overrides.value ?? { type: "test", value: {} },
  };
}

/**
 * Types for raw Stellar SDK events
 */
export interface RawSorobanEvent {
  ledger: number;
  id: string;
  contractId: string;
  topic: Array<{ _scval: string }>;
  value: { type: string; value: unknown };
}

// =============================================================================
// Service Mock Factories
// =============================================================================

/**
 * Creates a typed mock of a service class.
 * Uses jest.Mocked to ensure method signatures are checked.
 */
export function createMockService<T extends object>(implementation: Partial<T>): jest.Mocked<T> {
  return implementation as jest.Mocked<T>;
}

/**
 * Creates a mock Stellar service with typed methods.
 */
export function createMockStellarService(): jest.Mocked<StellarServiceMock> {
  return {
    getAccountBalance: jest.fn(),
    submitTransaction: jest.fn(),
  };
}

interface StellarServiceMock {
  getAccountBalance: (publicKey: string, assetCode?: string) => Promise<string>;
  submitTransaction: (signedXdr: string) => Promise<unknown>;
}

/**
 * Creates a mock EventListener service with typed methods.
 */
export function createMockEventListenerService(): jest.Mocked<EventListenerServiceMock> {
  return {
    start: jest.fn(),
    stop: jest.fn(),
    pollEvents: jest.fn(),
    processEvent: jest.fn(),
  };
}

interface EventListenerServiceMock {
  start: () => Promise<void>;
  stop: () => void;
  pollEvents: () => Promise<void>;
  processEvent: (event: RawSorobanEvent) => Promise<void>;
}

// =============================================================================
// Partial Builder Pattern
// =============================================================================

/**
 * Creates a partial fixture that requires explicit typing.
 * Use when you need to test specific fields without full object.
 */
export function partial<T>(overrides: Partial<T>): Partial<T> {
  return overrides;
}

/**
 * Builds a mock response with typed fields.
 * Useful for mocking HTTP responses or external API calls.
 */
export function createMockAxiosResponse<T>(data: T, overrides: Partial<{
  status: number;
  headers: Record<string, string>;
  data: T;
}> = {}): MockAxiosResponse<T> {
  return {
    status: overrides.status ?? 200,
    headers: overrides.headers ?? { "content-type": "application/json" },
    data: data,
    ...overrides,
  };
}

export interface MockAxiosResponse<T> {
  status: number;
  headers: Record<string, string>;
  data: T;
}

// =============================================================================
// Type Utilities
// =============================================================================

/**
 * Helper type for creating mock delegate objects
 */
type MockedDelegate<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? jest.Mock<Promise<R>, A>
    : T[K] extends object
      ? MockedDelegate<T[K]>
      : T[K];
};

/**
 * Complete mock Prisma client type
 */
export interface MockedPrisma {
  $transaction: <T>(fn: (tx: MockedPrisma) => Promise<T>) => Promise<T>;
  trade: MockedDelegate<Prisma.TradeDelegate>;
  chainEventOutbox: MockedDelegate<Prisma.ChainEventOutboxDelegate>;
  escrowAudit: MockedDelegate<Prisma.EscrowAuditDelegate>;
  processedEvent: MockedDelegate<Prisma.ProcessedEventDelegate>;
  tradeEvidence: MockedDelegate<Prisma.TradeEvidenceDelegate>;
  adminActionAudit: MockedDelegate<Prisma.AdminActionAuditDelegate>;
}

// =============================================================================
// Test Config Factories
// =============================================================================

/**
 * Creates a test configuration for event listener.
 */
export function createTestEventListenerConfig(overrides: Partial<TestEventListenerConfig> = {}): TestEventListenerConfig {
  return {
    rpcUrl: "https://test-rpc.example.com",
    contractId: "CONTRACT_TEST_123",
    pollIntervalMs: 1000,
    backoffInitialMs: 100,
    backoffMaxMs: 5000,
    processedLedgersCacheSize: 100,
    outboxMaxAttempts: 5,
    ...overrides,
  };
}

export interface TestEventListenerConfig {
  rpcUrl: string;
  contractId: string;
  pollIntervalMs: number;
  backoffInitialMs: number;
  backoffMaxMs: number;
  processedLedgersCacheSize: number;
  outboxMaxAttempts: number;
}

/**
 * Creates a mock Stellar RPC response for transaction submission.
 */
export function createMockSendTransactionResponse(overrides: {
  status?: "PENDING" | "SUCCESS" | "ERROR";
  hash?: string;
  errorResult?: unknown;
} = {}): MockSendTransactionResponse {
  return {
    status: overrides.status ?? "PENDING",
    hash: overrides.hash ?? "abc123def456",
    latestLedger: 12345,
    latestLedgerCloseTime: 1234567890,
    ...(overrides.errorResult && { errorResult: overrides.errorResult }),
  };
}

export interface MockSendTransactionResponse {
  status: "PENDING" | "SUCCESS" | "ERROR";
  hash: string;
  latestLedger: number;
  latestLedgerCloseTime: number;
  errorResult?: unknown;
}

/**
 * Creates a mock account response from Horizon.
 */
export function createMockHorizonAccount(overrides: {
  balances?: Array<{ asset_type: string; asset_code?: string; balance: string }>;
} = {}): MockHorizonAccount {
  return {
    id: "https://horizon-testnet.stellar.org/accounts/GBUQWP3BOUZX34ULNQG23RQ6F4OXTBIQF7XNVFQY2VQWT5FJA7RJIUU",
    account_id: "GBUQWP3BOUZX34ULNQG23RQ6F4OXTBIQF7XNVFQY2VQWT5FJA7RJIUU",
    sequence: "1",
    balances: overrides.balances ?? [
      { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "1000.0000000" },
      { asset_type: "native", balance: "500.0000000" },
    ],
    thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
    flags: { auth_required: false, auth_revocable: false, auth_immutable: false },
  };
}

export interface MockHorizonAccount {
  id: string;
  account_id: string;
  sequence: string;
  balances: Array<{ asset_type: string; asset_code?: string; balance: string }>;
  thresholds: { low_threshold: number; med_threshold: number; high_threshold: number };
  flags: { auth_required: boolean; auth_revocable: boolean; auth_immutable: boolean };
}