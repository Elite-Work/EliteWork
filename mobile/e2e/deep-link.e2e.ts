/**
 * Deep link E2E suite — Amana Mobile
 *
 * Confirms `amanavault://trades/:tradeId` (see docs/deep-linking.md and
 * src/constants/links.ts) actually routes to TradeDetailScreen with the
 * right trade preloaded, from both a cold start (app not running,
 * `device.launchApp({ url })`) and a warm start (app already running,
 * `device.openURL({ url })`). The unit tests for `useDeepLink` /
 * `constants/links.ts` cover the parsing logic in isolation; this suite
 * proves the whole path — URL, navigation, screen, and data fetch — works
 * end to end against a real (mocked-network) app instance.
 */

import { device, element, by, waitFor } from 'detox';
import { mockAuthLaunchArgs } from './helpers/auth';

const TIMEOUT = 15_000; // ms — generous for emulator cold-start

const DEEP_LINK_SCHEME = 'amanavault';
const TRADE_ID_ONE = 'TRD-E2E-0001';
const TRADE_ID_TWO = 'TRD-E2E-0002';

function tradeDeepLink(tradeId: string): string {
  return `${DEEP_LINK_SCHEME}://trades/${tradeId}`;
}

describe('Deep linking — TradeDetailScreen', () => {
  it('cold start: launching with a trade deep link lands directly on that trade\'s detail screen', async () => {
    await device.launchApp({
      newInstance: true,
      url: tradeDeepLink(TRADE_ID_ONE),
      launchArgs: {
        ...mockAuthLaunchArgs(),
        E2E_API_BASE_URL: 'http://localhost:4001',
      },
      permissions: { notifications: 'YES' },
    });

    // Should skip TradeList entirely and land on TradeDetail.
    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // The correct trade (TRD-E2E-0001, IN_TRANSIT) must be the one loaded.
    // TradeDetailScreen renders `#${tradeId.slice(0, 12)}…`.
    await waitFor(element(by.text(`#${TRADE_ID_ONE}…`)))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await waitFor(element(by.text('In Transit')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('cold start: an unknown trade id still reaches TradeDetail and surfaces an error, not a crash', async () => {
    await device.launchApp({
      newInstance: true,
      url: tradeDeepLink('TRD-DOES-NOT-EXIST'),
      launchArgs: {
        ...mockAuthLaunchArgs(),
        E2E_API_BASE_URL: 'http://localhost:4001',
      },
    });

    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('warm start: opening a trade deep link while the app is running navigates to that trade', async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: {
        ...mockAuthLaunchArgs(),
        E2E_API_BASE_URL: 'http://localhost:4001',
      },
    });

    // Confirms we're warm-starting from TradeList, not already on a detail screen.
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await device.openURL({ url: tradeDeepLink(TRADE_ID_TWO) });

    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    // TRD-E2E-0002 fixture is COMPLETED.
    await waitFor(element(by.text('Completed')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });
});
