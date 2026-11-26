import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { treasuryRoutes } from "../routes/treasury.routes";
import { walletRoutes } from "../routes/wallet.routes";

const backendRoot = join(__dirname, "..", "..");
const specPath = join(backendRoot, "src", "docs", "openapi.yaml");

const spec = parse(readFileSync(specPath, "utf8")) as {
  paths?: Record<string, Record<string, unknown>>;
};

const documentedPaths = new Set(Object.keys(spec.paths ?? {}));

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
] as const;

/**
 * Route files whose exported endpoints must be fully documented in the
 * OpenAPI spec. `openapi.drift.test.ts` only catches drift for paths that are
 * already documented, so this guard covers the undocumented-path gap for the
 * dispute/evidence route group.
 */
const ROUTE_FILES = [
  "src/routes/dispute.routes.ts",
  "src/routes/trade.evidence.routes.ts",
];

interface RouteEntry {
  method: string;
  path: string;
}

/**
 * Extract `router.<method>(<path>, ...)` registrations from a route file.
 * Only literal string paths are supported; anything else is reported so the
 * guard fails loudly instead of silently skipping a route.
 */
function extractRoutes(file: string): { routes: RouteEntry[]; unresolved: string[] } {
  const source = readFileSync(join(backendRoot, file), "utf8");
  const routes: RouteEntry[] = [];
  const unresolved: string[] = [];

  const callPattern = /\brouter\.(get|post|put|patch|delete|head|options)\s*\(/g;
  let match: RegExpExecArray | null;

  while ((match = callPattern.exec(source)) !== null) {
    const method = match[1];
    const rest = source.slice(match.index + match[0].length);
    const literal = /^\s*(["'`])([^"'`]+)\1/.exec(rest);

    if (!literal) {
      unresolved.push(`${file}: ${method}(...)`);
      continue;
    }

    routes.push({ method, path: literal[2] });
  }

  return { routes, unresolved };
}

/**
 * Convert an Express route path (e.g. `/disputes/:id/evidence`) into the
 * OpenAPI path template form (`/disputes/{id}/evidence`).
 */
function toOpenApiPath(routePath: string): string {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function isDocumented(method: string, routePath: string): boolean {
  const candidates = [routePath, toOpenApiPath(routePath)];
  return candidates.some((candidate) => {
    const entry = spec.paths?.[candidate];
    return Boolean(entry && HTTP_METHODS.includes(method as (typeof HTTP_METHODS)[number]) && entry[method]);
  });
}

describe("OpenAPI coverage for dispute/evidence routes", () => {
  for (const file of ROUTE_FILES) {
    describe(file, () => {
      const { routes, unresolved } = extractRoutes(file);

      it("registers at least one route", () => {
        expect(routes.length).toBeGreaterThan(0);
      });

      it("uses only literal route paths that can be audited", () => {
        expect(unresolved).toEqual([]);
      });

      it("documents every exported endpoint in openapi.yaml", () => {
        const missing = routes
          .filter((route) => !isDocumented(route.method, route.path))
          .map((route) => `${route.method.toUpperCase()} ${route.path}`);

        expect(missing).toEqual([]);
      });
    });
  }

  it("does not document paths that no route file exports", () => {
    const exported = new Set<string>();
    for (const file of ROUTE_FILES) {
      for (const route of extractRoutes(file).routes) {
        exported.add(toOpenApiPath(route.path));
      }
    }

    const orphaned = [...documentedPaths].filter(
      (path) => path.startsWith("/disputes") || path.startsWith("/trades") || path.includes("evidence"),
    );

    const undocumented = orphaned.filter((path) => !exported.has(path));
    expect(undocumented).toEqual([]);
  });
});

/**
 * Collect every method/path pair declared on an Express router.
 */
function collectRouterEndpoints(
  router: { stack?: Array<{ route?: { path: string; methods: Record<string, boolean> } }> },
  basePath = '',
): Array<{ method: string; path: string }> {
  const endpoints: Array<{ method: string; path: string }> = [];
  for (const layer of router.stack ?? []) {
    if (!layer.route) continue;
    const fullPath = toOpenApiPath(`${basePath}${layer.route.path}`);
    for (const method of Object.keys(layer.route.methods)) {
      if (!layer.route.methods[method]) continue;
      endpoints.push({ method: method.toLowerCase(), path: fullPath });
    }
  }
  return endpoints;
}

const treasuryWalletDocumentedPaths = spec.paths ?? {};

const routeGroups: Array<{ name: string; endpoints: Array<{ method: string; path: string }> }> = [
  { name: 'treasury.routes.ts', endpoints: collectRouterEndpoints(treasuryRoutes as never) },
  { name: 'wallet.routes.ts', endpoints: collectRouterEndpoints(walletRoutes as never) },
];

describe('OpenAPI coverage for treasury/wallet route groups', () => {
  for (const group of routeGroups) {
    describe(group.name, () => {
      it('exports at least one endpoint', () => {
        expect(group.endpoints.length).toBeGreaterThan(0);
      });

      for (const endpoint of group.endpoints) {
        it(`documents ${endpoint.method.toUpperCase()} ${endpoint.path}`, () => {
          const pathItem = treasuryWalletDocumentedPaths[endpoint.path];
          expect(
            pathItem,
            `Missing OpenAPI path entry for ${endpoint.path} (from ${group.name})`,
          ).toBeDefined();
          expect(
            pathItem[endpoint.method],
            `Missing OpenAPI operation '${endpoint.method}' for path ${endpoint.path} (from ${group.name})`,
          ).toBeDefined();
        });
      }
    });
  }
});
