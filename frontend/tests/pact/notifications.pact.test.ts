import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import { notificationsApi } from '@/lib/api/notifications';

const { like, eachLike, datetime } = MatchersV3;

describe('Notifications API Pact Consumer Tests', () => {
  const provider = new PactV3({
    consumer: 'AmanaFrontend',
    provider: 'AmanaBackend',
    dir: './tests/pact/pacts',
  });

  const mockToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock-token';

  describe('GET /notifications - List In-App Notifications', () => {
    it('returns a paginated list of notifications with an unread count', async () => {
      provider
        .given('the user has in-app notifications')
        .uponReceiving('a request to list in-app notifications')
        .withRequest({
          method: 'GET',
          path: '/api/v1/notifications',
          query: { page: '1', limit: '20' },
          headers: {
            Authorization: `Bearer ${mockToken}`,
          },
        })
        .willRespondWith({
          status: 200,
          headers: { 'Content-Type': 'application/json' },
          body: {
            notifications: eachLike({
              id: like(1),
              title: like('Trade Created'),
              message: like('Your trade #1024 has been successfully created.'),
              type: like('success'),
              isRead: like(false),
              metadata: like({ tradeId: 'TRD-FIXTURE-0001' }),
              createdAt: datetime("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", '2026-01-15T10:00:00.000Z'),
            }),
            pagination: {
              page: 1,
              limit: 20,
              total: 1,
              totalPages: 1,
            },
            unreadCount: like(1),
          },
        });

      await provider.executeTest(async (mockServer) => {
        const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
        process.env.NEXT_PUBLIC_API_URL = mockServer.url;

        const result = await notificationsApi.list(mockToken, { page: 1, limit: 20 });
        expect(result.notifications.length).toBeGreaterThan(0);
        expect(result.notifications[0]).toHaveProperty('isRead');
        expect(result.pagination.total).toBe(1);
        expect(result).toHaveProperty('unreadCount');

        if (originalApiUrl) {
          process.env.NEXT_PUBLIC_API_URL = originalApiUrl;
        } else {
          delete process.env.NEXT_PUBLIC_API_URL;
        }
      });
    });
  });
});
