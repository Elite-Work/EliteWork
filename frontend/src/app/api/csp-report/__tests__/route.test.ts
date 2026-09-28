/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "../route";

const legacyReport = {
  "csp-report": {
    "document-uri": "https://amana.example/trades",
    referrer: "",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "original-policy": "default-src 'self'; script-src 'self'; report-uri /api/csp-report",
    disposition: "report",
    "blocked-uri": "https://evil.example/inject.js",
    "status-code": 200,
    "script-sample": "",
  },
};

const reportingApiPayload = [
  {
    type: "csp-violation",
    age: 12,
    url: "https://amana.example/trades",
    user_agent: "Mozilla/5.0",
    body: {
      documentURL: "https://amana.example/trades",
      effectiveDirective: "script-src-elem",
      blockedURL: "https://evil.example/inject.js",
      disposition: "report",
      statusCode: 200,
    },
  },
];

function post(body: string, contentType: string) {
  return POST(
    new NextRequest("http://localhost/api/csp-report", {
      method: "POST",
      headers: { "content-type": contentType },
      body,
    }),
  );
}

describe("POST /api/csp-report", () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warn.mockRestore();
  });

  describe("real violation payloads", () => {
    it("accepts the legacy application/csp-report shape and logs the inner violation", async () => {
      const res = await post(JSON.stringify(legacyReport), "application/csp-report");

      expect(res.status).toBe(204);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "[csp-violation]",
        JSON.stringify(legacyReport["csp-report"]),
      );
    });

    it("accepts the Reporting API application/reports+json shape and logs the report body", async () => {
      const res = await post(JSON.stringify(reportingApiPayload), "application/reports+json");

      expect(res.status).toBe(204);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "[csp-violation]",
        JSON.stringify(reportingApiPayload[0].body),
      );
    });

    it("logs every report in a batched Reporting API payload", async () => {
      const batch = [reportingApiPayload[0], reportingApiPayload[0]];
      const res = await post(JSON.stringify(batch), "application/reports+json");

      expect(res.status).toBe(204);
      expect(warn).toHaveBeenCalledTimes(2);
    });

    it("returns an empty body", async () => {
      const res = await post(JSON.stringify(legacyReport), "application/csp-report");

      expect(await res.text()).toBe("");
    });
  });

  describe("malformed payloads never fail the request", () => {
    it.each([
      ["truncated JSON", "{\"csp-report\": {\"blocked-uri\": ", "application/csp-report"],
      ["non-JSON text", "not json at all", "application/csp-report"],
      ["empty body", "", "application/csp-report"],
      ["JSON null", "null", "application/csp-report"],
      ["JSON string", "\"just a string\"", "application/reports+json"],
      ["JSON number", "42", "application/reports+json"],
      ["empty array", "[]", "application/reports+json"],
      ["empty object", "{}", "application/csp-report"],
      ["array containing null", "[null]", "application/reports+json"],
      ["csp-report set to null", JSON.stringify({ "csp-report": null }), "application/csp-report"],
      ["Reporting API entry without body", JSON.stringify([{ type: "csp-violation" }]), "application/reports+json"],
      ["wrong content type", JSON.stringify(legacyReport), "text/plain"],
    ])("returns 204 for %s", async (_name, body, contentType) => {
      const res = await post(body, contentType);

      expect(res.status).toBe(204);
    });

    it("logs reports preceding a bad entry in a mixed batch and still returns 204", async () => {
      const res = await post(
        JSON.stringify([reportingApiPayload[0], null]),
        "application/reports+json",
      );

      expect(res.status).toBe(204);
      expect(warn).toHaveBeenCalledTimes(1);
    });
  });
});
