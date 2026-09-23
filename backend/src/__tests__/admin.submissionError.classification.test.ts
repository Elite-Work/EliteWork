/**
 * Admin submission error classification (#37).
 *
 * Classifies failed Soroban submissions into validation, network, contract,
 * and authorization errors. Tests assert correct classification for mocked
 * failure cases and verify that response codes distinguish failure types.
 */

import { AppError, ErrorCode } from "../errors/errorCodes";
import {
  classifyAdminSubmissionError,
  SUBMISSION_ERROR_DESCRIPTIONS,
} from "../errors/adminSubmissionError";
import { StellarError } from "../errors/service.errors";

describe("classifyAdminSubmissionError (#37)", () => {
  describe("classification by error category", () => {
    it("classifies timeout errors as SUBMISSION_NETWORK_ERROR with 504", () => {
      const error = Object.assign(new Error("Connection timed out after 30000ms"), { code: "ETIMEDOUT" });

      const result = classifyAdminSubmissionError(error, "stream_terminate");

      expect(result.code).toBe(ErrorCode.SUBMISSION_NETWORK_ERROR);
      expect(result.statusCode).toBe(504);
      expect(result.details).toMatchObject({
        category: "timeout",
        retryable: true,
        service: "stellar",
        context: "stream_terminate",
      });
    });

    it("classifies connection refused as SUBMISSION_NETWORK_ERROR with 503", () => {
      const error = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8000"), { code: "ECONNREFUSED" });

      const result = classifyAdminSubmissionError(error, "add_mediator");

      expect(result.code).toBe(ErrorCode.SUBMISSION_NETWORK_ERROR);
      expect(result.statusCode).toBe(503);
      expect(result.details).toMatchObject({
        category: "connection_refused",
        retryable: true,
      });
    });

    it("classifies rate limiting as SUBMISSION_NETWORK_ERROR with 429", () => {
      const error = new Error("TRY_AGAIN_LATER");

      const result = classifyAdminSubmissionError(error);

      expect(result.code).toBe(ErrorCode.SUBMISSION_NETWORK_ERROR);
      expect(result.statusCode).toBe(429);
      expect(result.details).toMatchObject({
        category: "rate_limited",
        retryable: true,
      });
    });

    it("classifies invalid XDR as SUBMISSION_VALIDATION_ERROR with 400", () => {
      const error = new Error("Invalid transaction XDR: malformed base64");

      const result = classifyAdminSubmissionError(error, "stream_terminate");

      expect(result.code).toBe(ErrorCode.SUBMISSION_VALIDATION_ERROR);
      expect(result.statusCode).toBe(400);
      expect(result.details).toMatchObject({
        category: "invalid_xdr",
        retryable: false,
      });
    });

    it("classifies contract panic as SUBMISSION_CONTRACT_ERROR with 502", () => {
      const error = new Error("Contract Panic: user invoked function with wrong args");

      const result = classifyAdminSubmissionError(error);

      expect(result.code).toBe(ErrorCode.SUBMISSION_CONTRACT_ERROR);
      expect(result.statusCode).toBe(502);
      expect(result.details).toMatchObject({
        category: "contract_panic",
        retryable: false,
      });
    });

    it("classifies not-found as SUBMISSION_CONTRACT_ERROR with 404", () => {
      const error = new Error("not found");

      const result = classifyAdminSubmissionError(error);

      expect(result.code).toBe(ErrorCode.SUBMISSION_CONTRACT_ERROR);
      expect(result.statusCode).toBe(404);
      expect(result.details).toMatchObject({
        category: "not_found",
        retryable: false,
      });
    });

    it("classifies RPC errors as SUBMISSION_CONTRACT_ERROR with 502", () => {
      const error = new Error("rpc error: unexpected response");

      const result = classifyAdminSubmissionError(error);

      expect(result.code).toBe(ErrorCode.SUBMISSION_CONTRACT_ERROR);
      expect(result.statusCode).toBe(502);
      expect(result.details).toMatchObject({
        category: "rpc_error",
        retryable: false,
      });
    });

    it("classifies unknown network errors as SUBMISSION_NETWORK_ERROR with 502", () => {
      const error = new Error("something went wrong on the network");

      const result = classifyAdminSubmissionError(error);

      expect(result.code).toBe(ErrorCode.SUBMISSION_NETWORK_ERROR);
      expect(result.statusCode).toBe(502);
      expect(result.details).toMatchObject({
        category: "network_error",
        retryable: true,
      });
    });
  });

  describe("preserves existing AppError classification", () => {
    it("passes through an existing AppError with its original code and status", () => {
      const error = new AppError(
        ErrorCode.SUBMISSION_CONTRACT_ERROR,
        "Contract rejected",
        502,
        { category: "contract_panic" },
      );

      const result = classifyAdminSubmissionError(error);

      expect(result.code).toBe(ErrorCode.SUBMISSION_CONTRACT_ERROR);
      expect(result.statusCode).toBe(502);
      expect(result.message).toBe("Contract rejected");
    });

    it("passes through a ClassifiedServiceError preserving its code", () => {
      const error = new StellarError({
        code: "STELLAR_TIMEOUT",
        message: "Stellar service timed out",
        httpStatus: 504,
        retryable: true,
      });

      const result = classifyAdminSubmissionError(error, "update_fee_bps");

      expect(result.code).toBe("STELLAR_TIMEOUT");
      expect(result.statusCode).toBe(504);
      expect(result.details).toMatchObject({
        context: "update_fee_bps",
        retryable: true,
      });
    });
  });

  describe("context propagation", () => {
    it("includes context in error details when provided", () => {
      const error = new Error("timeout");

      const result = classifyAdminSubmissionError(error, "remove_mediator");

      expect(result.details).toMatchObject({
        context: "remove_mediator",
      });
    });

    it("omits context from details when not provided", () => {
      const error = new Error("timeout");

      const result = classifyAdminSubmissionError(error);

      expect(result.details).not.toHaveProperty("context");
    });
  });

  describe("user-facing messages", () => {
    it("returns a user-friendly message for each error category", () => {
      const testCases = [
        { error: new Error("Invalid XDR"), expectedCode: ErrorCode.SUBMISSION_VALIDATION_ERROR },
        { error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }), expectedCode: ErrorCode.SUBMISSION_NETWORK_ERROR },
        { error: new Error("Contract Panic"), expectedCode: ErrorCode.SUBMISSION_CONTRACT_ERROR },
      ];

      for (const { error, expectedCode } of testCases) {
        const result = classifyAdminSubmissionError(error);
        expect(result.code).toBe(expectedCode);
        expect(typeof result.message).toBe("string");
        expect(result.message.length).toBeGreaterThan(0);
      }
    });
  });

  describe("error code documentation map", () => {
    it("has descriptions for all submission error codes", () => {
      expect(SUBMISSION_ERROR_DESCRIPTIONS[ErrorCode.SUBMISSION_VALIDATION_ERROR]).toBeDefined();
      expect(SUBMISSION_ERROR_DESCRIPTIONS[ErrorCode.SUBMISSION_NETWORK_ERROR]).toBeDefined();
      expect(SUBMISSION_ERROR_DESCRIPTIONS[ErrorCode.SUBMISSION_CONTRACT_ERROR]).toBeDefined();
      expect(SUBMISSION_ERROR_DESCRIPTIONS[ErrorCode.SUBMISSION_AUTHORIZATION_ERROR]).toBeDefined();
    });

    it("each description is a non-empty string", () => {
      for (const description of Object.values(SUBMISSION_ERROR_DESCRIPTIONS)) {
        expect(typeof description).toBe("string");
        expect((description as string).length).toBeGreaterThan(0);
      }
    });
  });
});
