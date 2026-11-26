import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { treasuryRoutes } from '../routes/treasury.routes';
import { walletRoutes } from '../routes/wallet.routes';

const specPath = join(__dirname, 'openapi.yaml');
const spec = parse(readFileSync(specPath, 'utf8')) as {
  paths: Record<string, Record<string, unknown>>;
};

/**
 * Normalise an Express route path (e.g. `/treasury/:id`) into an OpenAPI
 * template path (e.g. `/treasury/{id}`).
 */
function toOpenApiPath(routePath: string): string {
  return routePath.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

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

const documentedPaths = spec.paths ?? {};

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
          const pathItem = documentedPaths[endpoint.path];
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
