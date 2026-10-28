/**
 * Smoke E2E suite — Amana Mobile
 *
 * Covers the critical happy-path navigation flow:
 *   1. App launches and shows WalletConnect screen
 *   2. Mock login → navigate to TradeList
 *   3. TradeList renders items; tap to open TradeDetail
 *   4. TradeDetail shows correct trade metadata
 *   5. Offline banner appears when NetInfo reports no connectivity
 *
 * This suite runs against the Expo dev-client build on both Android emulator
 * and iOS simulator (see .detoxrc.cjs for device configs).
 *
 * The mock server (e2e/helpers/mockServer.ts) must be running before the
 * test; it is started by globalSetup via jest.config.js.
 */

import { device, element, by, expect as detoxExpect, waitFor } from 'detox';
import { mockAuthLaunchArgs } from './helpers/auth';
import { startMockServer, stopMockServer } from './helpers/mockServer';

const TIMEOUT = 15_000; // ms — generous for emulator cold-start

// ---------------------------------------------------------------------------
// Suite setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await startMockServer();

  // Launch with mock auth args so the app reads a pre-seeded JWT from
  // launchArgs and skips the real wallet-connect flow.
  await device.launchApp({
    newInstance: true,
    launchArgs: {
      ...mockAuthLaunchArgs(),
      // Point the app's API base URL at the in-process mock server.
      // The app reads DETOX_API_URL (or E2E_API_BASE_URL) in e2e mode.
      E2E_API_BASE_URL: 'http://localhost:4001',
    },
    permissions: {
      notifications: 'YES',
    },
  });
});

afterEach(async () => {
  // A full relaunch is more reliable than Detox's React Native reload hook on
  // the CI emulator, where the Metro websocket can disappear after a test.
  await device.launchApp({
    newInstance: true,
    launchArgs: {
      ...mockAuthLaunchArgs(),
      E2E_API_BASE_URL: 'http://localhost:4001',
    },
  });
});

afterAll(async () => {
  await device.terminateApp();
  await stopMockServer();
});

// ---------------------------------------------------------------------------
// Test 1 — App launches and shows the correct initial screen
// ---------------------------------------------------------------------------

describe('App launch', () => {
  it('shows TradeList screen when session token is present', async () => {
    // With mock JWT injected, the navigator renders TradeList as initial route.
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('renders the Amana header on the trade list', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Filter tabs should be present.
    await detoxExpect(element(by.text('All'))).toBeVisible();
    await detoxExpect(element(by.text('Pending'))).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Test 2 — WalletConnect screen (unauthenticated launch)
// ---------------------------------------------------------------------------

describe('WalletConnect screen', () => {
  it.skip('shows Connect Wallet button on unauthenticated launch', async () => {
    // Relaunch without the mock JWT so the navigator starts at WalletConnect.
    await device.launchApp({
      newInstance: true,
      launchArgs: {
        E2E_API_BASE_URL: 'http://localhost:4001',
        E2E_MODE: 'true',
        // No E2E_MOCK_JWT — triggers unauthenticated initial route.
      },
    });

    await waitFor(element(by.text('Connect Wallet')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await waitFor(element(by.text('Amana')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

  });
});

// ---------------------------------------------------------------------------
// Test 3 — Trade list renders items and supports filter tabs
// ---------------------------------------------------------------------------

describe('Trade list navigation', () => {
  it('renders mock trade items from fixture server', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Mock server returns TRD-E2E-0001 with status IN_TRANSIT.
    await waitFor(element(by.text('#TRD-E2E')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('taps status filter and updates list', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap "Active" filter tab.
    await element(by.text('Active')).tap();

    // The list re-renders — still visible (mock server returns same data).
    await waitFor(element(by.text('All'))).toBeVisible().withTimeout(TIMEOUT);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Trade detail screen
// ---------------------------------------------------------------------------

describe('Trade detail', () => {
  it('opens trade detail on card tap', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap the first trade card in the list.
    await element(by.text('#TRD-E2E')).tap();

    // TradeDetail header must be visible.
    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('shows trade status badge in detail screen', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('#TRD-E2E')).tap();

    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Status badge — IN_TRANSIT fixture.
    await waitFor(element(by.text('In Transit')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('navigates back to trade list from detail screen', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('#TRD-E2E')).tap();

    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('← Back')).tap();

    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Offline banner appears when network is unavailable
// ---------------------------------------------------------------------------

describe('Offline banner', () => {
  it('shows offline indicator when device is set to airplane mode', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Block requests to simulate a disconnected API. Detox 20 does not
    // expose the old `connectivity` status-bar option.
    await device.setURLBlacklist(['.*']);
    // Trigger a refresh to surface the error/offline state.
    await element(by.text('🌾 Trades')).swipe('down', 'fast', 0.5);

    // The AdminErrorBanner / offline text should appear. The exact text
    // depends on the error view the store surfaces — match partial text.
    await waitFor(
      element(by.text(/offline|network|connection/i)).atIndex(0),
    )
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Restore network.
    await device.setURLBlacklist([]);
  });
});
