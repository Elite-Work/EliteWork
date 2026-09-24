import { Server } from "http";
import {
  ShutdownOrchestrator,
  Shutdownable,
} from "../lib/shutdown";
import { EventListenerService } from "../services/eventListener.service";

jest.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: jest.fn().mockImplementation(() => ({
      getEvents: jest.fn().mockResolvedValue({ events: [] }),
    })),
  },
  scValToNative: jest.fn(),
}));

jest.mock("../config/eventListener.config", () => ({
  getEventListenerConfig: jest.fn().mockReturnValue({
    rpcUrl: "https://rpc.example.com",
    contractId: "CONTRACT_CHAOS",
    pollIntervalMs: 50,
    backoffInitialMs: 50,
    backoffMaxMs: 200,
    processedLedgersCacheSize: 100,
    outboxMaxAttempts: 3,
  }),
}));

function createMockServer(): Server {
  return {
    close: jest.fn((cb?: (err?: Error) => void) => {
      cb?.();
      return {} as Server;
    }),
  } as unknown as Server;
}

function createMockPrisma() {
  return {
    processedEvent: {
      findMany: jest.fn().mockResolvedValue([
        { ledgerSequence: 100, contractId: "C", eventId: "e1" },
      ]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb({})),
  } as any;
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("ShutdownOrchestrator", () => {
  it("performs ordered, logged, bounded shutdown within timeout", async () => {
    const server = createMockServer();
    const order: string[] = [];

    const svc1: Shutdownable = {
      name: "svc1",
      stop: jest.fn(async () => {
        order.push("svc1");
      }),
    };
    const svc2: Shutdownable = {
      name: "svc2",
      stop: jest.fn(async () => {
        order.push("svc2");
      }),
    };

    const orchestrator = new ShutdownOrchestrator({
      drainTimeoutMs: 1000,
      forceExitTimeoutMs: 5000,
    });

    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as unknown as (code?: string | number | null) => never);

    await orchestrator.shutdown("SIGTERM", server, [svc1, svc2]);

    expect(server.close).toHaveBeenCalled();
    expect(order).toEqual(["svc1", "svc2"]);
    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(orchestrator.isShuttingDown()).toBe(true);
  });

  it("does not double-run shutdown if called twice", async () => {
    const server = createMockServer();
    const s1 = jest.fn(async () => {});
    const s2 = jest.fn(async () => {});
    const orchestrator = new ShutdownOrchestrator();

    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as unknown as (code?: string | number | null) => never);

    await orchestrator.shutdown("SIGTERM", server, [
      { name: "a", stop: s1 },
      { name: "b", stop: s2 },
    ]);
    await orchestrator.shutdown("SIGTERM", server, [
      { name: "a", stop: s1 },
      { name: "b", stop: s2 },
    ]);

    expect(s1).toHaveBeenCalledTimes(1);
    expect(s2).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledTimes(1);
  });

  it("forces exit if a service hangs beyond the force-exit timeout", async () => {
    const server = createMockServer();
    const hangy: Shutdownable = {
      name: "hangy",
      stop: () =>
        new Promise<void>((resolve) => {
          // never resolves
          void resolve;
        }),
    };

    const orchestrator = new ShutdownOrchestrator({
      drainTimeoutMs: 100,
      forceExitTimeoutMs: 120,
    });

    const exitSpy = jest
      .spyOn(process, "exit")
      .mockImplementation(((
        code?: number,
      ) => undefined) as unknown as (code?: string | number | null) => never);

    await orchestrator.shutdown("SIGTERM", server, [hangy]);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe("EventListenerService graceful drain + cursor resume", () => {
  it("returns the last processed ledger cursor on drain", async () => {
    const prisma = createMockPrisma();
    const service = new EventListenerService(prisma);
    await service.start();

    // Simulate an in-flight poll that is mid-processing
    const pollSpy = jest
      .spyOn(service as any, "pollEvents")
      .mockResolvedValue(undefined);

    const drainedCursor = await service.drain();

    expect(drainedCursor).toBe(100);
    expect(pollSpy).not.toHaveBeenCalled();
    // Process is stopped — no more polls scheduled
    expect((service as any).running).toBe(false);
    expect((service as any).timeoutHandle).toBeNull();
  });

  it("records cursor without gap when events resume after restart", async () => {
    const prisma = createMockPrisma();
    const service = new EventListenerService(prisma);
    await service.start();

    // Before restart: last ledger is 100
    expect(service.getLastLedger()).toBe(100);

    // Restart hydrates from DB (findMany returns latest sequences)
    const restartPrisma = createMockPrisma();
    restartPrisma.processedEvent.findMany.mockResolvedValue([
      { ledgerSequence: 105, contractId: "C", eventId: "e105" },
    ]);
    const restarted = new EventListenerService(restartPrisma);
    await restarted.start();

    expect(restarted.getLastLedger()).toBe(105);

    // A poll resuming from cursor 105 will request startLedger = 106 (no gap)
    const getEvents = (restarted as any).server.getEvents;
    await restarted.pollEvents();
    const request = getEvents.mock.calls[0][0];
    expect(request.startLedger).toBe(106);
  });
});
