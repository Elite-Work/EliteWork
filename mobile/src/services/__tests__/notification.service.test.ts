import * as Notifications from 'expo-notifications';
import {
  notificationDataToUrl,
  getInitialNotificationData,
  __resetInitialNotificationDedupe,
} from '../notification.service';

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  addNotificationReceivedListener: jest.fn(),
  getLastNotificationResponseAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
}));

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
}));

const getLastNotificationResponseAsync =
  Notifications.getLastNotificationResponseAsync as jest.Mock;

function response(identifier: string, data: Record<string, unknown>) {
  return {
    notification: {
      request: { identifier, content: { data } },
    },
  };
}

describe('notificationDataToUrl (#496)', () => {
  it('prefers an explicit universal link from the payload', () => {
    expect(
      notificationDataToUrl({
        url: 'https://amanavault.app/trades/T-1',
        tradeId: 'ignored',
      }),
    ).toBe('https://amanavault.app/trades/T-1');
  });

  it('accepts an app-relative path', () => {
    expect(notificationDataToUrl({ path: '/disputes/D-9' })).toBe('/disputes/D-9');
  });

  it('builds a trade URL from a legacy tradeId payload', () => {
    expect(notificationDataToUrl({ type: 'trade', tradeId: 'T 1/2' })).toBe(
      '/trades/T%201%2F2',
    );
  });

  it('builds a dispute URL from a disputeId payload', () => {
    expect(notificationDataToUrl({ disputeId: 'D-9' })).toBe('/disputes/D-9');
  });

  it('returns null for payloads with nothing routable', () => {
    expect(notificationDataToUrl({ screen: 'TradeDetail' })).toBeNull();
    expect(notificationDataToUrl(null)).toBeNull();
    expect(notificationDataToUrl({})).toBeNull();
  });
});

describe('getInitialNotificationData (#496 cold start)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __resetInitialNotificationDedupe();
  });

  it('returns the payload of the notification that launched the app', async () => {
    getLastNotificationResponseAsync.mockResolvedValue(
      response('notification-1', { tradeId: 'T-1' }),
    );

    await expect(getInitialNotificationData()).resolves.toEqual({ tradeId: 'T-1' });
  });

  it('does not replay a response that was already consumed', async () => {
    getLastNotificationResponseAsync.mockResolvedValue(
      response('notification-1', { tradeId: 'T-1' }),
    );

    await getInitialNotificationData();
    await expect(getInitialNotificationData()).resolves.toBeNull();
  });

  it('returns null when there is no initial response', async () => {
    getLastNotificationResponseAsync.mockResolvedValue(null);

    await expect(getInitialNotificationData()).resolves.toBeNull();
  });

  it('returns null when the platform API throws', async () => {
    getLastNotificationResponseAsync.mockRejectedValue(new Error('unsupported'));

    await expect(getInitialNotificationData()).resolves.toBeNull();
  });
});
