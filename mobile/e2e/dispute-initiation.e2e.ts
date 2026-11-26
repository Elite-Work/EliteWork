/**
 * Dispute Initiation Smoke E2E suite — Amana Mobile (#449)
 *
 * Covers the critical smoke path for the dispute-initiation flow:
 *   1. App launches with a mock session and navigates to TradeList
 *   2. User taps a trade in IN_TRANSIT status to open TradeDetail
 *   3. User taps "Initiate Dispute" and sees the dispute modal
 *   4. User enters a reason and submits — trade transitions to DISPUTED
 *   5. User cancels a dispute initiation — trade status is unchanged
 *   6. The "Initiate Dispute" button is not shown for already-disputed trades
 *
 * This suite is scoped to initiation only; evidence capture and mediator
 * resolution are covered by dispute-resolution.e2e.ts.
 *
 * The mock server (e2e/helpers/mockServer.ts) must be running before the
 * test; it is started by globalSetup via jest.config.js.
 */

import { device, element, by, expect as detoxExpect, waitFor } from 'detox';
import { mockAuthLaunchArgs } from './helpers/auth';
import { resetTradeState } from './helpers/mockServer';
import { inputByPlaceholder } from './helpers/selectors';

const TIMEOUT = 20_000; // ms — generous for emulator cold-start

describe('Dispute Initiation Flow', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: {
        ...mockAuthLaunchArgs(),
        E2E_API_BASE_URL: 'http://localhost:4001',
      },
      permissions: {
        notifications: 'YES',
      },
    });
  });

  beforeEach(async () => {
    resetTradeState();
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
  });

  // -------------------------------------------------------------------------
  // 1. Happy path — user successfully initiates a dispute
  // -------------------------------------------------------------------------

  it('navigates to TradeDetail and initiates a dispute', async () => {
    // Confirm TradeList is visible
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap the first trade card (fixture returns TRD-E2E with IN_TRANSIT status)
    await element(by.text('#TRD-E2E')).tap();

    // TradeDetail must load
    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Trade must be in a disputable state
    await waitFor(element(by.text('In Transit')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Initiate dispute button must be present
    await detoxExpect(element(by.text('⚠️ Initiate Dispute'))).toBeVisible();
    await element(by.text('⚠️ Initiate Dispute')).tap();

    // Dispute modal appears
    await waitFor(element(by.text('Initiate Dispute')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await waitFor(element(by.text('Describe the issue with this trade:')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Enter a dispute reason
    await element(inputByPlaceholder('e.g. Goods arrived damaged, quantity mismatch…'))
      .typeText('Quantity mismatch — 10 bags short of agreed 50');

    // Submit the dispute
    await element(by.text('Submit')).tap();

    // Trade status must update to DISPUTED
    await waitFor(element(by.text('Disputed')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  // -------------------------------------------------------------------------
  // 2. Cancel path — user dismisses the dispute modal without submitting
  // -------------------------------------------------------------------------

  it('cancels dispute initiation and trade remains IN_TRANSIT', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('#TRD-E2E')).tap();

    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await waitFor(element(by.text('In Transit')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('⚠️ Initiate Dispute')).tap();

    await waitFor(element(by.text('Initiate Dispute')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap Cancel — modal should close without changing trade status
    await element(by.text('Cancel')).tap();

    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Trade must still be IN_TRANSIT (not disputed)
    await waitFor(element(by.text('In Transit')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  // -------------------------------------------------------------------------
  // 3. Already-disputed trade — initiate button not shown
  // -------------------------------------------------------------------------

  it('does not show Initiate Dispute for an already-disputed trade', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap the trade and initiate a dispute first
    await element(by.text('#TRD-E2E')).tap();

    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('⚠️ Initiate Dispute')).tap();

    await waitFor(element(by.text('Initiate Dispute')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(inputByPlaceholder('e.g. Goods arrived damaged, quantity mismatch…'))
      .typeText('Quality does not meet contract specification');

    await element(by.text('Submit')).tap();

    // Wait for DISPUTED status
    await waitFor(element(by.text('Disputed')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // The "Initiate Dispute" button must no longer be visible once disputed
    await detoxExpect(element(by.text('⚠️ Initiate Dispute'))).not.toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 4. Validation — submit button disabled when reason is empty
  // -------------------------------------------------------------------------

  it('keeps Submit disabled when the dispute reason is empty', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('#TRD-E2E')).tap();

    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('⚠️ Initiate Dispute')).tap();

    await waitFor(element(by.text('Initiate Dispute')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Reason field is empty — Submit must be disabled
    const attrs = await element(by.text('Submit')).getAttributes();
    expect((attrs as { enabled: boolean }).enabled).toBe(false);
  });
});
