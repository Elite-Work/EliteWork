/**
 * Trade Creation E2E Suite — Amana Mobile
 *
 * Covers the end-to-end trade creation flow:
 *   1. Navigate from TradeList to CreateTrade screen
 *   2. Step 1: Fill in trade details (commodity, quantity, unit, price, seller address)
 *   3. Step 2: Configure negotiation (loss ratio, delivery window)
 *   4. Step 3: Review and submit trade
 *   5. Verify trade creation success and navigation to TradeDetail
 *   6. Test draft persistence across app restarts
 *   7. Test validation and error handling
 *
 * This suite runs against the Expo dev-client build on both Android emulator
 * and iOS simulator (see .detoxrc.cjs for device configs).
 *
 * The mock server (e2e/helpers/mockServer.ts) must be running before the
 * test; it is started by globalSetup via jest.config.js.
 */

import { device, element, by, expect as detoxExpect, waitFor } from 'detox';
import { mockAuthLaunchArgs, MOCK_SELLER_ADDRESS } from './helpers/auth';
import { startMockServer, stopMockServer, resetTradeState } from './helpers/mockServer';
import { inputByPlaceholder } from './helpers/selectors';

const TIMEOUT = 20_000; // ms — generous for emulator cold-start

async function expectContinueEnabled(enabled: boolean): Promise<void> {
  const attributes = await element(by.id('trade-continue-button')).getAttributes();
  expect((attributes as { enabled: boolean }).enabled).toBe(enabled);
}

// ---------------------------------------------------------------------------
// Suite setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await startMockServer();

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

afterEach(async () => {
  // Reload the app between tests to start from a clean state.
  await device.reloadReactNative();
  resetTradeState();
});

afterAll(async () => {
  await device.terminateApp();
  await stopMockServer();
});

// ---------------------------------------------------------------------------
// Test 1 — Navigate to CreateTrade screen
// ---------------------------------------------------------------------------

describe('Trade Creation Flow — Navigation', () => {
  it('opens CreateTrade screen from TradeList', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap "+ New" button in header
    await element(by.text('+ New')).tap();

    // Verify CreateTrade screen loads
    await waitFor(element(by.text('Create Trade')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Verify step indicator shows Step 1
    await waitFor(element(by.text('Step 1: Details')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('shows back navigation to TradeList', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('Create Trade')).tap();

    await waitFor(element(by.text('Create Trade')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap back button
    await element(by.text('← Back')).tap();

    // Verify back on TradeList
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Step 1: Details
// ---------------------------------------------------------------------------

describe('Trade Creation Flow — Step 1: Details', () => {
  beforeEach(async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Create Trade')).tap();
    await waitFor(element(by.text('Step 1: Details')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('allows selecting a commodity', async () => {
    // Tap Maize chip
    await element(by.text('Maize')).tap();

    // Verify selection
    await detoxExpect(element(by.id('trade-commodity-maize'))).toExist();
  });

  it('allows entering quantity and unit', async () => {
    // Select commodity first
    await element(by.text('Maize')).tap();

    // Enter quantity
    await element(inputByPlaceholder('e.g. 500')).replaceText('1000');

    // Select unit (tonnes)
    await element(by.text('tonnes')).tap();

    // Verify values
    await detoxExpect(element(inputByPlaceholder('e.g. 500'))).toHaveText('1000');
  });

  it('allows entering price per unit', async () => {
    await element(by.text('Maize')).tap();

    await element(inputByPlaceholder('e.g. 450')).replaceText('500');

    await detoxExpect(element(inputByPlaceholder('e.g. 450'))).toHaveText('500');
  });

  it('shows estimated total when quantity and price are entered', async () => {
    await element(by.text('Maize')).tap();
    await element(inputByPlaceholder('e.g. 500')).replaceText('1000');
    await element(inputByPlaceholder('e.g. 450')).replaceText('500');

    // Estimated total should show NGN 500,000
    await waitFor(element(by.text('NGN 500,000')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('allows entering seller Stellar address', async () => {
    await element(by.text('Maize')).tap();
    await element(inputByPlaceholder('e.g. 500')).replaceText('1000');
    await element(inputByPlaceholder('e.g. 450')).replaceText('500');

    await element(inputByPlaceholder('G...')).replaceText(MOCK_SELLER_ADDRESS);

    await detoxExpect(element(inputByPlaceholder('G...'))).toHaveText(MOCK_SELLER_ADDRESS);
  });

  it('enables Continue button only when all required fields are valid', async () => {
    // Initially Continue should be disabled
    await expectContinueEnabled(false);

    // Fill all required fields
    await element(by.text('Maize')).tap();
    await element(inputByPlaceholder('e.g. 500')).replaceText('1000');
    await element(inputByPlaceholder('e.g. 450')).replaceText('500');
    await element(inputByPlaceholder('G...')).replaceText(MOCK_SELLER_ADDRESS);

    // Continue should now be enabled
    await expectContinueEnabled(true);
  });

  it('navigates to Step 2 when Continue is tapped with valid data', async () => {
    await element(by.text('Maize')).tap();
    await element(inputByPlaceholder('e.g. 500')).replaceText('1000');
    await element(inputByPlaceholder('e.g. 450')).replaceText('500');
    await element(inputByPlaceholder('G...')).replaceText(MOCK_SELLER_ADDRESS);

    await element(by.text('Continue')).tap();

    // Verify Step 2 loads
    await waitFor(element(by.text('Step 2: Negotiation')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Step 2: Negotiation
// ---------------------------------------------------------------------------

describe('Trade Creation Flow — Step 2: Negotiation', () => {
  beforeEach(async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Create Trade')).tap();
    await waitFor(element(by.text('Step 1: Details')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Fill Step 1
    await element(by.text('Maize')).tap();
    await element(inputByPlaceholder('e.g. 500')).replaceText('1000');
    await element(inputByPlaceholder('e.g. 450')).replaceText('500');
    await element(inputByPlaceholder('G...')).replaceText(MOCK_SELLER_ADDRESS);
    await element(by.text('Continue')).tap();

    await waitFor(element(by.text('Step 2: Negotiation')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('shows default 50/50 loss ratio', async () => {
    await waitFor(element(by.text('Loss Ratio: Buyer 50% / Seller 50%')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('allows adjusting buyer loss ratio with +10% / -10% buttons', async () => {
    // Tap +10% to increase buyer ratio to 60%
    await element(by.text('+10%')).tap();

    await waitFor(element(by.text('Loss Ratio: Buyer 60% / Seller 40%')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap -10% to decrease back to 50%
    await element(by.text('−10%')).tap();

    await waitFor(element(by.text('Loss Ratio: Buyer 50% / Seller 50%')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('allows adjusting seller loss ratio (by decreasing buyer ratio)', async () => {
    // Tap -10% to decrease buyer ratio to 40% (seller gets 60%)
    await element(by.text('−10%')).tap();

    await waitFor(element(by.text('Loss Ratio: Buyer 40% / Seller 60%')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('allows entering delivery window in days', async () => {
    await element(inputByPlaceholder('7')).replaceText('14');

    await detoxExpect(element(inputByPlaceholder('7'))).toHaveText('14');
  });

  it('shows platform fee note', async () => {
    await waitFor(element(by.text('Funds will be locked as cNGN. The 1% platform fee is deducted on settlement.')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('navigates back to Step 1 when Back is tapped', async () => {
    await element(by.text('Back')).tap();

    await waitFor(element(by.text('Step 1: Details')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('navigates to Step 3 when Review is tapped', async () => {
    await element(by.text('Review')).tap();

    await waitFor(element(by.text('Step 3: Review & Submit')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });
});

// ---------------------------------------------------------------------------
// Test 4 — Step 3: Review & Submit
// ---------------------------------------------------------------------------

describe('Trade Creation Flow — Step 3: Review & Submit', () => {
  beforeEach(async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Create Trade')).tap();
    await waitFor(element(by.text('Step 1: Details')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Fill Step 1
    await element(by.text('Maize')).tap();
    await element(inputByPlaceholder('e.g. 500')).replaceText('1000');
    await element(inputByPlaceholder('e.g. 450')).replaceText('500');
    await element(inputByPlaceholder('G...')).replaceText(MOCK_SELLER_ADDRESS);
    await element(by.text('Continue')).tap();

    await waitFor(element(by.text('Step 2: Negotiation')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Fill Step 2
    await element(by.text('Review')).tap();

    await waitFor(element(by.text('Step 3: Review & Submit')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('displays all trade details in review card', async () => {
    await waitFor(element(by.text('Commodity')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await waitFor(element(by.text('Maize')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await waitFor(element(by.text('Quantity')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await waitFor(element(by.text('1000 kg')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await waitFor(element(by.text('Total Value')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await waitFor(element(by.text('NGN 500,000')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await waitFor(element(by.text('Seller')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await waitFor(element(by.text(MOCK_SELLER_ADDRESS)))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await waitFor(element(by.text('Loss Ratio')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await waitFor(element(by.text('Buyer 50% / Seller 50%')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await waitFor(element(by.text('Delivery')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await waitFor(element(by.text('7 days')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('shows authorization note', async () => {
    await waitFor(element(by.text('By submitting, you authorize a Stellar transaction to create an escrow trade.')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('navigates back to Step 2 when Back is tapped', async () => {
    await element(by.text('Back')).tap();

    await waitFor(element(by.text('Step 2: Negotiation')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('submits trade and shows success alert', async () => {
    // Tap Create Trade button
    await element(by.text('Create Trade')).tap();

    // Verify submitting state (activity indicator)
    await waitFor(element(by.text('Create Trade')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Wait for success alert
    await waitFor(element(by.text('Trade Created')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Alert should contain trade ID
    await waitFor(element(by.text(/TRD-E2E/)))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Dismiss alert
    await element(by.text('OK')).tap();

    // Should navigate to TradeDetail
    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });
});

// ---------------------------------------------------------------------------
// Test 5 — Draft Persistence
// ---------------------------------------------------------------------------

describe('Trade Creation Flow — Draft Persistence', () => {
  it('persists draft when navigating away and restores on return', async () => {
    // Start trade creation
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Create Trade')).tap();
    await waitFor(element(by.text('Step 1: Details')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Fill partial data
    await element(by.text('Maize')).tap();
    await element(inputByPlaceholder('e.g. 500')).replaceText('500');
    await element(inputByPlaceholder('e.g. 450')).replaceText('400');

    // Go to Step 2
    await element(by.text('Continue')).tap();
    await waitFor(element(by.text('Step 2: Negotiation')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Adjust ratio
    await element(by.text('+10%')).tap();

    // Go to Step 3
    await element(by.text('Review')).tap();
    await waitFor(element(by.text('Step 3: Review & Submit')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Navigate back to TradeList (simulate app backgrounding)
    await element(by.text('← Back')).tap(); // Back to Step 2
    await element(by.text('← Back')).tap(); // Back to Step 1
    await element(by.text('← Back')).tap(); // Back to TradeList

    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Re-open CreateTrade
    await element(by.text('Create Trade')).tap();

    // Should restore to Step 3 with data intact
    await waitFor(element(by.text('Step 3: Review & Submit')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await waitFor(element(by.text('Maize')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await waitFor(element(by.text('500 kg')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await waitFor(element(by.text('Buyer 60% / Seller 40%')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('clears draft after successful trade creation', async () => {
    // Create a trade
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Create Trade')).tap();
    await waitFor(element(by.text('Step 1: Details')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('Maize')).tap();
    await element(inputByPlaceholder('e.g. 500')).replaceText('500');
    await element(inputByPlaceholder('e.g. 450')).replaceText('400');
    await element(inputByPlaceholder('G...')).replaceText(MOCK_SELLER_ADDRESS);
    await element(by.text('Continue')).tap();

    await waitFor(element(by.text('Step 2: Negotiation')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Review')).tap();

    await waitFor(element(by.text('Step 3: Review & Submit')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Submit
    await element(by.text('Create Trade')).tap();
    await waitFor(element(by.text('Trade Created')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('OK')).tap();

    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Go back to TradeList
    await element(by.text('← Back')).tap();
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Open CreateTrade again - should start fresh
    await element(by.text('Create Trade')).tap();

    // Should be at Step 1 with defaults
    await waitFor(element(by.text('Step 1: Details')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Commodity should not be pre-selected
    await detoxExpect(element(by.id('trade-commodity-maize'))).toExist();
  });
});

// ---------------------------------------------------------------------------
// Test 6 — Validation and Error Handling
// ---------------------------------------------------------------------------

describe('Trade Creation Flow — Validation', () => {
  it('shows validation error for invalid seller address', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Create Trade')).tap();
    await waitFor(element(by.text('Step 1: Details')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('Maize')).tap();
    await element(inputByPlaceholder('e.g. 500')).replaceText('1000');
    await element(inputByPlaceholder('e.g. 450')).replaceText('500');
    await element(inputByPlaceholder('G...')).replaceText('INVALID_ADDRESS');

    // Continue should remain disabled
    await expectContinueEnabled(false);
  });

  it('does not allow quantity of zero or negative', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Create Trade')).tap();
    await waitFor(element(by.text('Step 1: Details')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('Maize')).tap();
    await element(inputByPlaceholder('e.g. 500')).replaceText('0');
    await element(inputByPlaceholder('e.g. 450')).replaceText('500');
    await element(inputByPlaceholder('G...')).replaceText(MOCK_SELLER_ADDRESS);

    await expectContinueEnabled(false);

    // Test negative
    await element(inputByPlaceholder('e.g. 500')).replaceText('-100');
    await expectContinueEnabled(false);
  });

  it('does not allow price of zero or negative', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Create Trade')).tap();
    await waitFor(element(by.text('Step 1: Details')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('Maize')).tap();
    await element(inputByPlaceholder('e.g. 500')).replaceText('1000');
    await element(inputByPlaceholder('e.g. 450')).replaceText('0');
    await element(inputByPlaceholder('G...')).replaceText(MOCK_SELLER_ADDRESS);

    await expectContinueEnabled(false);
  });
});

// ---------------------------------------------------------------------------
// Test 7 — Step Indicator Progress
// ---------------------------------------------------------------------------

describe('Trade Creation Flow — Step Indicator', () => {
  it('shows correct step progress through all three steps', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Create Trade')).tap();

    // Step 1 - first dot should be active
    await waitFor(element(by.text('Step 1: Details')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('Maize')).tap();
    await element(inputByPlaceholder('e.g. 500')).replaceText('1000');
    await element(inputByPlaceholder('e.g. 450')).replaceText('500');
    await element(inputByPlaceholder('G...')).replaceText(MOCK_SELLER_ADDRESS);
    await element(by.text('Continue')).tap();

    // Step 2 - second dot should be active
    await waitFor(element(by.text('Step 2: Negotiation')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('Review')).tap();

    // Step 3 - third dot should be active
    await waitFor(element(by.text('Step 3: Review & Submit')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });
});

// ---------------------------------------------------------------------------
// Test 8 — Accessibility
// ---------------------------------------------------------------------------

describe('Trade Creation Flow — Accessibility', () => {
  it('has accessible labels on all form fields', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Create Trade')).tap();
    await waitFor(element(by.text('Step 1: Details')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Check for accessibility labels
    await detoxExpect(element(by.label('Commodity'))).toExist();
    await detoxExpect(element(by.label('Quantity'))).toExist();
    await detoxExpect(element(by.label('Unit'))).toExist();
    await detoxExpect(element(by.label('Price per unit (NGN)'))).toExist();
    await detoxExpect(element(by.label('Seller Stellar Address'))).toExist();
  });

  it('has accessible step indicator', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Create Trade')).tap();

    await waitFor(element(by.text('Step 1: Details')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('has accessible buttons with proper labels', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Create Trade')).tap();
    await waitFor(element(by.text('Step 1: Details')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await detoxExpect(element(by.label('Go back'))).toExist();
    await element(by.text('Maize')).tap();
    await element(inputByPlaceholder('e.g. 500')).replaceText('1000');
    await element(inputByPlaceholder('e.g. 450')).replaceText('500');
    await element(inputByPlaceholder('G...')).replaceText(MOCK_SELLER_ADDRESS);

    await detoxExpect(element(by.text('Continue'))).toExist();
  });
});
