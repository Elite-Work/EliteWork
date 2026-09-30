import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import { disputesApi } from '@/lib/api/disputes';

const { like, eachLike, datetime, term } = MatchersV3;

describe('Disputes API Pact Consumer Tests', () => {
  const provider = new PactV3({
    consumer: 'AmanaFrontend',
    provider: 'AmanaBackend',
    dir: './tests/pact/pacts',
  });

  const mockToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock-token';

  describe('GET /disputes - List Disputes (no filter)', () => {
    it('returns a paginated list of disputes', async () => {
      provider
        .given('the user has disputes')
        .uponReceiving('a request to list disputes without a status filter')
        .withRequest({
          method: 'GET',
          path: '/disputes',
          query: { page: '1', limit: '10' },
          headers: {
            Authorization: `Bearer ${mockToken}`,
          },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            items: eachLike({
              id: like(1),
              tradeId: like('TRD-FIXTURE-0001'),
              initiator: like('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA001'),
              reason: like('Goods not delivered as agreed'),
              status: term({ matcher: 'OPEN|UNDER_REVIEW|RESOLVED|CLOSED', generate: 'OPEN' }),
              createdAt: datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2026-01-15T10:00:00.000Z'),
              updatedAt: datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2026-01-15T10:00:00.000Z'),
              resolvedAt: null,
              trade: {
                buyerAddress: like('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA001'),
                sellerAddress: like('GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB002'),
                amountUsdc: like('5000'),
              },
            }),
            pagination: {
              page: 1,
              limit: 10,
              total: 1,
              totalPages: 1,
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        process.env.NEXT_PUBLIC_API_BASE_URL = mockServer.url;

        const result = await disputesApi.list(mockToken, { page: 1, limit: 10 });
        expect(result.items).toBeDefined();
        expect(result.items.length).toBeGreaterThan(0);
        expect(result.pagination).toBeDefined();
        expect(result.pagination).toHaveProperty('page');
        expect(result.pagination).toHaveProperty('total');

        if (originalBaseUrl) {
          process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
        } else {
          delete process.env.NEXT_PUBLIC_API_BASE_URL;
        }
      });
    });
  });

  describe('GET /disputes?status=OPEN - List Open Disputes', () => {
    it('returns only open disputes when filtered by status', async () => {
      provider
        .given('the user has open disputes')
        .uponReceiving('a request to list disputes filtered by OPEN status')
        .withRequest({
          method: 'GET',
          path: '/disputes',
          query: { status: 'OPEN', page: '1', limit: '10' },
          headers: {
            Authorization: `Bearer ${mockToken}`,
          },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            items: eachLike({
              id: like(1),
              tradeId: like('TRD-FIXTURE-0001'),
              initiator: like('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA001'),
              reason: like('Item condition misrepresented'),
              status: 'OPEN',
              createdAt: datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2026-01-15T10:00:00.000Z'),
              updatedAt: datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2026-01-15T10:00:00.000Z'),
              resolvedAt: null,
              trade: {
                buyerAddress: like('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA001'),
                sellerAddress: like('GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB002'),
                amountUsdc: like('12000'),
              },
            }),
            pagination: {
              page: 1,
              limit: 10,
              total: 1,
              totalPages: 1,
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        process.env.NEXT_PUBLIC_API_BASE_URL = mockServer.url;

        const result = await disputesApi.list(mockToken, { status: 'OPEN', page: 1, limit: 10 });
        expect(result.items).toBeDefined();
        expect(result.items.every((d) => d.status === 'OPEN')).toBe(true);
        expect(result.pagination).toBeDefined();

        if (originalBaseUrl) {
          process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
        } else {
          delete process.env.NEXT_PUBLIC_API_BASE_URL;
        }
      });
    });
  });

  describe('GET /disputes - Empty disputes list', () => {
    it('returns an empty list with valid pagination when no disputes exist', async () => {
      provider
        .given('the user has no disputes')
        .uponReceiving('a request to list disputes for a user with no disputes')
        .withRequest({
          method: 'GET',
          path: '/disputes',
          query: { page: '1', limit: '10' },
          headers: {
            Authorization: `Bearer ${mockToken}`,
          },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            items: [],
            pagination: {
              page: 1,
              limit: 10,
              total: 0,
              totalPages: 0,
            },
          },
        });

      await provider.executeTest(async (mockServer) => {
        const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        process.env.NEXT_PUBLIC_API_BASE_URL = mockServer.url;

        const result = await disputesApi.list(mockToken, { page: 1, limit: 10 });
        expect(result.items).toHaveLength(0);
        expect(result.pagination.total).toBe(0);

        if (originalBaseUrl) {
          process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
        } else {
          delete process.env.NEXT_PUBLIC_API_BASE_URL;
        }
      });
    });
  });
});
