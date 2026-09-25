/**
 * Push notification tap-through E2E suite — Amana Mobile
 *
 * Confirms that tapping a trade status-change push notification opens
 * TradeDetailScreen for the trade named in the payload (`data.tradeId`,
 * see NotificationData in src/services/notification.service.ts), not just
 * that a notification is received. Routing happens in App.tsx via
 * `setupNotificationListeners`, which navigates with the payload's tradeId.
 *
 * `device.sendUserNotification` is only implemented by Detox on iOS, so the
 * cases are skipped on Android.
 */

import { device, element, by, waitFor } from 'detox';
import { mockAuthLaunchArgs } from './helpers/auth';

const TIMEOUT = 15_000; // ms — generous for emulator cold-start

const TRADE_ID_ONE = 'TRD-E2E-0001'; // IN_TRANSIT fixture
const TRADE_ID_TWO = 'TRD-E2E-0002'; // COMPLETED fixture

const itIos = device.getPlatform() === 'ios' ? it : it.skip;

function tradeStatusNotification(tradeId: string) {
  return {
    trigger: { type: 'push' as const },
    title: 'Trade update',
    body: `Trade ${tradeId} changed status`,
    payload: { type: 'trade', tradeId },
  };
}

describe('Push notification tap-through — TradeDetailScreen', () => {
  beforeEach(async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: {
        ...mockAuthLaunchArgs(),
        E2E_API_BASE_URL: 'http://localhost:4001',
      },
      permissions: { notifications: 'YES' },
    });

    // Start from TradeList so a match on TradeDetail proves the tap navigated.
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  itIos('tapping a notification opens the detail screen for the notified trade', async () => {
    await device.sendUserNotification(tradeStatusNotification(TRADE_ID_TWO));

    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await waitFor(element(by.text(`#${TRADE_ID_TWO}…`)))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await waitFor(element(by.text('Completed')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  itIos('a second notification for a different trade opens that trade, not the previous one', async () => {
    await device.sendUserNotification(tradeStatusNotification(TRADE_ID_TWO));
    await waitFor(element(by.text(`#${TRADE_ID_TWO}…`)))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await device.sendUserNotification(tradeStatusNotification(TRADE_ID_ONE));

    await waitFor(element(by.text(`#${TRADE_ID_ONE}…`)))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await waitFor(element(by.text('In Transit')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });
});
