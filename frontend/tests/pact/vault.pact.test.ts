import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import { walletApi } from '@/lib/api/wallet';
import { tradesApi } from '@/lib/api/trades';

const { like, term } = MatchersV3;

describe('Vault API Pact Consumer Tests', () => {
  const provider = new PactV3({
    consumer: 'AmanaFrontend',
    provider: 'AmanaBackend',
    dir: './tests/pact/pacts',
  });

  const mockToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock-token';

  describe('GET /wallet/balance - Fetch Vault Balance', () => {
    it('returns the authenticated user balance and asset', async () => {
      provider
        .given('a user is authenticated with a funded wallet')
        .uponReceiving('a request for the wallet balance')
        .withRequest({
          method: 'GET',
          path: '/wallet/balance',
          headers: {
            Authorization: `Bearer ${mockToken}`,
          },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            balance: term({ matcher: '\\d+(\\.\\d+)?', generate: '125.5000000' }),
            asset: like('USDC'),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        process.env.NEXT_PUBLIC_API_BASE_URL = mockServer.url;

        const result = await walletApi.getBalance(mockToken);
        expect(result).toHaveProperty('balance');
        expect(result).toHaveProperty('asset');

        if (originalBaseUrl) {
          process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
        } else {
          delete process.env.NEXT_PUBLIC_API_BASE_URL;
        }
      });
    });
  });

  describe('POST /trades/:id/deposit - Initiate Vault Deposit', () => {
    it('returns an unsigned deposit XDR for the trade', async () => {
      provider
        .given('a trade exists in CREATED status')
        .uponReceiving('a request to initiate a vault deposit')
        .withRequest({
          method: 'POST',
          path: '/trades/4294967297/deposit',
          headers: {
            Authorization: `Bearer ${mockToken}`,
            'Content-Type': 'application/json',
          },
          body: {},
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            unsignedXdr: term({
              matcher: '[A-Za-z0-9+/=]+',
              generate: 'AAAAAXNvbWUtZGVwb3NpdC10eC14ZHI=',
            }),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        process.env.NEXT_PUBLIC_API_BASE_URL = mockServer.url;

        const result = await tradesApi.deposit(mockToken, '4294967297');
        expect(result).toHaveProperty('unsignedXdr');

        if (originalBaseUrl) {
          process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
        } else {
          delete process.env.NEXT_PUBLIC_API_BASE_URL;
        }
      });
    });
  });

  describe('POST /trades/:id/release - Initiate Vault Withdrawal', () => {
    it('returns an unsigned release XDR for the trade', async () => {
      provider
        .given('a trade exists in DELIVERED status with the buyer confirmed')
        .uponReceiving('a request to initiate a vault withdrawal via release')
        .withRequest({
          method: 'POST',
          path: '/trades/4294967297/release',
          headers: {
            Authorization: `Bearer ${mockToken}`,
            'Content-Type': 'application/json',
          },
          body: {},
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            unsignedXdr: term({
              matcher: '[A-Za-z0-9+/=]+',
              generate: 'AAAAAXNvbWUtcmVsZWFzZS10eC14ZHI=',
            }),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
        process.env.NEXT_PUBLIC_API_BASE_URL = mockServer.url;

        const result = await tradesApi.releaseFunds(mockToken, '4294967297');
        expect(result).toHaveProperty('unsignedXdr');

        if (originalBaseUrl) {
          process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
        } else {
          delete process.env.NEXT_PUBLIC_API_BASE_URL;
        }
      });
    });
  });
});
