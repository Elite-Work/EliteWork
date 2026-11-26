import fs from "fs";
import path from "path";

const YAML = require("yamljs");

type OpenApiOperation = {
  security?: Array<Record<string, unknown>>;
  parameters?: Array<{ name?: string; in?: string; $ref?: string }>;
};

type OpenApiPathItem = Partial<
  Record<"get" | "post" | "put" | "delete" | "patch", OpenApiOperation>
>;

describe("OpenAPI documentation coverage", () => {
  const docsDir = path.join(__dirname, "..", "docs");
  const yamlPath = path.join(docsDir, "openapi.yaml");
  const jsonPath = path.join(docsDir, "openapi.json");
  const spec = YAML.load(yamlPath) as {
    paths: Record<string, OpenApiPathItem>;
  };
  const jsonSpec = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
    paths: Record<string, OpenApiPathItem>;
  };

  function resolvesHeaderParameter(
    parameter: { name?: string; in?: string; $ref?: string },
    name: string,
  ) {
    if (parameter.in === "header" && parameter.name === name) {
      return true;
    }

    const refName = parameter.$ref?.replace("#/components/parameters/", "");
    return refName === name || refName === `${name.replace(/-/g, "")}Header`;
  }

  const liveRouteMap: Record<string, Array<keyof OpenApiPathItem>> = {
    "/health": ["get"],
    "/health/live": ["get"],
    "/health/ready": ["get"],
    "/health/startup": ["get"],
    "/auth/challenge": ["post"],
    "/auth/verify": ["post"],
    "/auth/logout": ["post"],
    "/wallet/balance": ["get"],
    "/wallet/path-payment-quote": ["get"],
    "/users/me": ["get", "put"],
    "/users/{address}": ["get"],
    "/disputes": ["get"],
    "/disputes/{id}/transition": ["post"],
    "/dispute-categories": ["get", "post"],
    "/dispute-categories/{id}": ["get", "patch", "delete"],
    "/trades": ["get", "post"],
    "/trades/export": ["get"],
    "/trades/stats": ["get"],
    "/trades/{id}": ["get"],
    "/trades/{id}/receipt": ["get"],
    "/trades/{id}/deposit": ["post"],
    "/trades/{id}/confirm": ["post"],
    "/trades/{id}/release": ["post"],
    "/trades/{id}/dispute": ["post"],
    "/trades/{id}/manifest": ["get", "post"],
    "/trades/{id}/evidence": ["get"],
    "/evidence/{cid}/stream": ["get"],
    "/evidence/video": ["post"],
    "/trades/{id}/history": ["get"],
    "/trades/{id}/history/verify": ["get"],
    "/goals": ["get"],
    "/stellar/account/{address}/balance": ["get"],
    "/stellar/account/create": ["post"],
    "/stellar/assets": ["get"],
    "/stellar/assets/{code}": ["get"],
    "/stellar/fees": ["get"],
    "/stellar/tx/{hash}/status": ["get"],
  };

  const protectedOperations = [
    ["/auth/logout", "post"],
    ["/wallet/balance", "get"],
    ["/wallet/path-payment-quote", "get"],
    ["/users/me", "get"],
    ["/users/me", "put"],
    ["/disputes", "get"],
    ["/disputes/{id}/transition", "post"],
    ["/dispute-categories", "get"],
    ["/dispute-categories", "post"],
    ["/dispute-categories/{id}", "get"],
    ["/dispute-categories/{id}", "patch"],
    ["/dispute-categories/{id}", "delete"],
    ["/trades", "get"],
    ["/trades", "post"],
    ["/trades/export", "get"],
    ["/trades/stats", "get"],
    ["/trades/{id}", "get"],
    ["/trades/{id}/receipt", "get"],
    ["/trades/{id}/deposit", "post"],
    ["/trades/{id}/confirm", "post"],
    ["/trades/{id}/release", "post"],
    ["/trades/{id}/dispute", "post"],
    ["/trades/{id}/manifest", "get"],
    ["/trades/{id}/manifest", "post"],
    ["/trades/{id}/evidence", "get"],
    ["/evidence/{cid}/stream", "get"],
    ["/evidence/video", "post"],
    ["/trades/{id}/history", "get"],
    ["/trades/{id}/history/verify", "get"],
    ["/goals", "get"],
  ] as const;

  const idempotentOperations = [
    ["/trades", "post"],
    ["/trades/{id}/deposit", "post"],
    ["/trades/{id}/release", "post"],
    ["/trades/{id}/dispute", "post"],
    ["/evidence/video", "post"],
  ] as const;

  it("documents every live backend endpoint under backend/src/routes", () => {
    for (const [route, methods] of Object.entries(liveRouteMap)) {
      expect(spec.paths[route]).toBeDefined();

      for (const method of methods) {
        expect(spec.paths[route]?.[method]).toBeDefined();
      }
    }
  });

  it("documents request and response schemas for every Stellar endpoint", () => {
    const stellarResponses = [
      ["/stellar/account/{address}/balance", "get", "200"],
      ["/stellar/account/create", "post", "201"],
      ["/stellar/assets", "get", "200"],
      ["/stellar/assets/{code}", "get", "200"],
      ["/stellar/fees", "get", "200"],
      ["/stellar/tx/{hash}/status", "get", "200"],
    ] as const;

    for (const [route, method, status] of stellarResponses) {
      const operation = spec.paths[route]?.[method] as any;
      expect(operation.summary).toBeTruthy();
      expect(operation.responses[status].content["application/json"].schema).toBeDefined();
    }

    const paths = spec.paths as any;
    const accountBalance = paths["/stellar/account/{address}/balance"].get;
    expect(accountBalance.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ in: "path", name: "address", required: true }),
      ]),
    );
    expect(
      accountBalance.responses["200"].content["application/json"].schema.properties
        .balances.items.properties.issuer.nullable,
    ).toBe(true);

    const accountCreate = paths["/stellar/account/create"].post;
    expect(
      accountCreate.requestBody.content["application/json"].schema.properties.fund.type,
    ).toBe("boolean");
    expect(
      accountCreate.responses["201"].content["application/json"].schema.required,
    ).toEqual(expect.arrayContaining(["publicKey", "encryptedSecretKey", "funded"]));

    const assets = paths["/stellar/assets"].get;
    expect(assets.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ in: "query", name: "issuer", required: false }),
      ]),
    );
    expect(
      assets.responses["200"].content["application/json"].schema.properties.cached.type,
    ).toBe("boolean");

    const transactionStatus = paths["/stellar/tx/{hash}/status"].get;
    expect(transactionStatus.responses["404"].content["application/json"].schema.properties.status.enum)
      .toEqual(["pending"]);
  });

  it("marks every protected endpoint with bearer authentication", () => {
    for (const [route, method] of protectedOperations) {
      expect(spec.paths[route]?.[method]?.security).toEqual([
        { bearerAuth: [] },
      ]);
    }
  });

  it("documents idempotency header support for mutation endpoints that use the middleware", () => {
    for (const [route, method] of idempotentOperations) {
      const parameters = spec.paths[route]?.[method]?.parameters ?? [];
      expect(
        parameters.some((parameter) =>
          resolvesHeaderParameter(parameter, "Idempotency-Key"),
        ),
      ).toBe(true);
    }
  });

  it("keeps openapi.json in sync with openapi.yaml", () => {
    // Strip operationIds (auto-generated at runtime) for comparison
    function stripOperationIds(obj: unknown): unknown {
      if (Array.isArray(obj)) return obj.map(stripOperationIds);
      if (obj && typeof obj === "object") {
        const copy: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(
          obj as Record<string, unknown>,
        )) {
          if (key === "operationId") continue;
          copy[key] = stripOperationIds(value);
        }
        return copy;
      }
      return obj;
    }
    expect(stripOperationIds(jsonSpec)).toEqual(stripOperationIds(spec));
  });
});
