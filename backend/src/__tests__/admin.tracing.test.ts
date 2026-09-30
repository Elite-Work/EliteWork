import { trace, Span } from "@opentelemetry/api";
import { Response } from "express";
import { adminMiddleware } from "../middleware/admin.middleware";
import { getTraceContext } from "../middleware/tracing.middleware";
import { AuthRequest } from "../services/auth.service";

// Mock redis so tests never attempt network connections
jest.mock("../lib/redis", () => ({
  redis: {
    exists: jest.fn().mockResolvedValue(0),
    set: jest.fn().mockResolvedValue("OK"),
  },
}));

// Mock accessControl to control admin allowlist
jest.mock("../lib/accessControl", () => ({
  isMediatorAddress: jest.fn(),
}));

const { isMediatorAddress } = require("../lib/accessControl");

// Mock OpenTelemetry trace.getActiveSpan for controlled testing
const mockSetAttributes = jest.fn();
const mockSetStatus = jest.fn();
const mockAddEvent = jest.fn();
const mockEnd = jest.fn();
const mockRecordException = jest.fn();
const mockSpanContext = jest.fn().mockReturnValue({
  traceId: "00000000000000000000000000000001",
  spanId: "0000000000000002",
});

const mockSpan = {
  setAttributes: mockSetAttributes,
  setStatus: mockSetStatus,
  addEvent: mockAddEvent,
  end: mockEnd,
  recordException: mockRecordException,
  spanContext: mockSpanContext,
  isRecording: jest.fn().mockReturnValue(true),
};

jest.spyOn(trace, "getActiveSpan").mockReturnValue(mockSpan as unknown as Span);

describe("adminMiddleware — tracing integration", () => {
  let mockReq: Partial<AuthRequest>;
  let mockRes: Partial<Response>;
  let mockNext: jest.Mock;

  beforeEach(() => {
    mockReq = {
      user: {
        walletAddress: "GADMINVALIDTESTACCOUNT000000000000000000000000000000",
        sub: "admin-test",
        jti: "admin-jti-123",
        tv: 1,
      },
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("calls next() when admin access is granted", async () => {
    (isMediatorAddress as jest.Mock).mockReturnValue(true);

    await adminMiddleware(mockReq as AuthRequest, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockRes.status).not.toHaveBeenCalled();
  });

  it("returns 403 when access is denied", async () => {
    (isMediatorAddress as jest.Mock).mockReturnValue(false);

    await adminMiddleware(mockReq as AuthRequest, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockRes.json).toHaveBeenCalledWith({ error: "Forbidden: admin access required" });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("returns 403 when user is not on request", async () => {
    (isMediatorAddress as jest.Mock).mockReturnValue(true);
    mockReq.user = undefined;

    await adminMiddleware(mockReq as AuthRequest, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it("propagates isAdmin flag on user context when access is granted", async () => {
    (isMediatorAddress as jest.Mock).mockReturnValue(true);

    await adminMiddleware(mockReq as AuthRequest, mockRes as Response, mockNext);

    expect(mockReq.user?.isAdmin).toBe(true);
    expect(mockNext).toHaveBeenCalled();
  });

  it("annotates the active span with admin identity when access is granted", async () => {
    (isMediatorAddress as jest.Mock).mockReturnValue(true);

    await adminMiddleware(mockReq as AuthRequest, mockRes as Response, mockNext);

    expect(mockNext).toHaveBeenCalled();
    // Verify the span received admin attributes
    const calls = mockSetAttributes.mock.calls.map((c: unknown[]) => JSON.stringify(c[0]));
    const hasAdminAttrs = calls.some((call: string) =>
      call.includes('"is_admin"') && call.includes('"admin.address"')
    );
    expect(hasAdminAttrs).toBe(true);
  });

  it("annotates the active span with denial verdict when access is denied", async () => {
    (isMediatorAddress as jest.Mock).mockReturnValue(false);

    await adminMiddleware(mockReq as AuthRequest, mockRes as Response, mockNext);

    expect(mockRes.status).toHaveBeenCalledWith(403);
    const calls = mockSetAttributes.mock.calls.map((c: unknown[]) => JSON.stringify(c[0]));
    const hasDeniedAttrs = calls.some((call: string) =>
      call.includes('"admin.verdict"') && call.includes('"denied"')
    );
    expect(hasDeniedAttrs).toBe(true);
  });

  it("getTraceContext returns traceId and spanId when active span exists", () => {
    const result = getTraceContext();

    expect(result).not.toBeNull();
    expect(result?.traceId).toBe("00000000000000000000000000000001");
    expect(result?.spanId).toBe("0000000000000002");
  });

  it("getTraceContext returns null when no active span exists", () => {
    // Temporarily return null from mock
    (trace.getActiveSpan as jest.Mock).mockReturnValueOnce(null);

    const result = getTraceContext();
    expect(result).toBeNull();
  });
});
