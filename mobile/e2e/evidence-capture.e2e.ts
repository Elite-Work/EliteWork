/**
 * Evidence Capture E2E Suite — Amana Mobile
 *
 * Covers the end-to-end evidence capture flow:
 *   1. Navigate from TradeList to TradeDetail for a trade in IN_TRANSIT status
 *   2. Tap "Upload Evidence" button to open EvidenceCapture screen
 *   3. Select evidence type (Video/Photo)
 *   4. Simulate capture (placeholder in test environment)
 *   5. Upload evidence to mock server
 *   6. Verify success state and navigation back to TradeDetail
 *   7. Test error handling when upload fails
 *
 * This suite runs against the Expo dev-client build on both Android emulator
 * and iOS simulator (see .detoxrc.cjs for device configs).
 *
 * The mock server (e2e/helpers/mockServer.ts) must be running before the
 * test; it is started by globalSetup via jest.config.js.
 */

import { device, element, by, expect as detoxExpect, waitFor } from 'detox';
import { mockAuthLaunchArgs } from './helpers/auth';
import { startMockServer, stopMockServer, resetTradeState } from './helpers/mockServer';

const TIMEOUT = 20_000; // ms — generous for emulator cold-start

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
  resetTradeState();
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
// Test 1 — Open EvidenceCapture from TradeDetail (IN_TRANSIT trade)
// ---------------------------------------------------------------------------

describe('Evidence Capture Flow — IN_TRANSIT trade', () => {
  it('navigates from TradeList to TradeDetail and opens EvidenceCapture screen', async () => {
    // Start at TradeList
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap the IN_TRANSIT trade (TRD-E2E-0001)
    await element(by.text('#TRD-E2E')).tap();

    // Verify TradeDetail screen loads
    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Verify the trade is IN_TRANSIT
    await waitFor(element(by.text('In Transit')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap "📹 Upload Evidence" button
    await element(by.text('📹 Upload Evidence')).tap();

    // Verify EvidenceCapture screen loads
    await waitFor(element(by.text('Upload Evidence')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Verify trade reference is shown
    await waitFor(element(by.text(/Trade: #TRD-E2E/)))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('allows selecting video evidence type and simulates capture', async () => {
    // Navigate to EvidenceCapture
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('#TRD-E2E')).tap();
    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('📹 Upload Evidence')).tap();
    await waitFor(element(by.text('Upload Evidence')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Video type should be selected by default
    await waitFor(element(by.text('Video')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap "Simulate Capture" in the alert
    await element(by.text('Record Delivery Video')).tap();
    await waitFor(element(by.text('Simulate Capture')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Simulate Capture')).tap();

    // Verify capture preview appears
    await waitFor(element(by.text('Ready to upload')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Verify the captured file name is shown
    await waitFor(element(by.text(/evidence-TRD-E2E/)))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('allows selecting photo evidence type and simulates capture', async () => {
    // Navigate to EvidenceCapture
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('#TRD-E2E')).tap();
    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('📹 Upload Evidence')).tap();
    await waitFor(element(by.text('Upload Evidence')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Switch to Photo type
    await element(by.text('Photo')).tap();

    // Verify photo hint text appears
    await waitFor(element(by.text('Take a clear photo of the goods showing any damage or discrepancy.')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap "Simulate Capture"
    await element(by.text('Take Delivery Photo')).tap();
    await waitFor(element(by.text('Simulate Capture')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Simulate Capture')).tap();

    // Verify capture preview appears
    await waitFor(element(by.text('Ready to upload')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Verify the captured file name is shown
    await waitFor(element(by.text(/evidence-TRD-E2E/)))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('uploads video evidence successfully and shows success state', async () => {
    // Navigate to EvidenceCapture and capture video
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('#TRD-E2E')).tap();
    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('📹 Upload Evidence')).tap();
    await waitFor(element(by.text('Upload Evidence')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('Record Delivery Video')).tap();
    await waitFor(element(by.text('Simulate Capture')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Simulate Capture')).tap();

    await waitFor(element(by.text('Ready to upload')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap Upload button
    await element(by.text('☁️ Upload Video')).tap();

    // Verify uploading state
    await waitFor(element(by.text('Uploading…')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Verify success state
    await waitFor(element(by.text('Evidence Uploaded')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await waitFor(element(by.text('Your video has been submitted. A mediator will review it shortly.')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap Back to Trade button
    await element(by.text('Back to Trade')).tap();

    // Verify back on TradeDetail
    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('uploads photo evidence successfully and shows success state', async () => {
    // Navigate to EvidenceCapture and capture photo
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('#TRD-E2E')).tap();
    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('📹 Upload Evidence')).tap();
    await waitFor(element(by.text('Upload Evidence')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Switch to photo
    await element(by.text('Photo')).tap();

    await element(by.text('Take Delivery Photo')).tap();
    await waitFor(element(by.text('Simulate Capture')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Simulate Capture')).tap();

    await waitFor(element(by.text('Ready to upload')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap Upload button
    await element(by.text('☁️ Upload Photo')).tap();

    // Verify uploading state
    await waitFor(element(by.text('Uploading…')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Verify success state
    await waitFor(element(by.text('Evidence Uploaded')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await waitFor(element(by.text('Your photo has been submitted. A mediator will review it shortly.')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('shows error state when upload fails', async () => {
    // Relaunch with force error header
    await device.launchApp({
      newInstance: true,
      launchArgs: {
        ...mockAuthLaunchArgs(),
        E2E_API_BASE_URL: 'http://localhost:4001',
        // The mock server checks for this header to simulate upload failure
        X_FORCE_UPLOAD_ERROR: 'true',
      },
    });

    // Navigate to EvidenceCapture and capture video
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('#TRD-E2E')).tap();
    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('📹 Upload Evidence')).tap();
    await waitFor(element(by.text('Upload Evidence')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('Record Delivery Video')).tap();
    await waitFor(element(by.text('Simulate Capture')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Simulate Capture')).tap();

    await waitFor(element(by.text('Ready to upload')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap Upload button
    await element(by.text('☁️ Upload Video')).tap();

    // Verify error state
    await waitFor(element(by.text(/Upload failed:/)))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Verify retake button is available
    await waitFor(element(by.text('↩ Retake')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('allows retake after capture', async () => {
    // Navigate to EvidenceCapture and capture video
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('#TRD-E2E')).tap();
    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('📹 Upload Evidence')).tap();
    await waitFor(element(by.text('Upload Evidence')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await element(by.text('Record Delivery Video')).tap();
    await waitFor(element(by.text('Simulate Capture')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('Simulate Capture')).tap();

    await waitFor(element(by.text('Ready to upload')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap Retake button
    await element(by.text('↩ Retake')).tap();

    // Verify back to capture state (placeholder shown)
    await waitFor(element(by.text('Tap to record')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });

  it('navigates back to TradeDetail using back button', async () => {
    // Navigate to EvidenceCapture
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('#TRD-E2E')).tap();
    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('📹 Upload Evidence')).tap();
    await waitFor(element(by.text('Upload Evidence')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Tap back button
    await element(by.text('← Back')).tap();

    // Verify back on TradeDetail
    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });
});

// ---------------------------------------------------------------------------
// Test 2 — Evidence Capture for DISPUTED trade
// ---------------------------------------------------------------------------

describe('Evidence Capture Flow — DISPUTED trade', () => {
  it('opens EvidenceCapture for a disputed trade (TRD-E2E-0003)', async () => {
    // Navigate to the disputed trade
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Find and tap TRD-E2E-0003
    await element(by.text('#TRD-E2E')).atIndex(2).tap();

    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Verify disputed status
    await waitFor(element(by.text('Disputed')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Open EvidenceCapture
    await element(by.text('Upload Evidence')).tap();

    await waitFor(element(by.text('Upload Evidence')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    await waitFor(element(by.text(/Trade: #TRD-E2E/)))
      .toBeVisible()
      .withTimeout(TIMEOUT);
  });
});

// ---------------------------------------------------------------------------
// Test 3 — Accessibility and UI verification
// ---------------------------------------------------------------------------

describe('Evidence Capture — Accessibility', () => {
  it('has accessible labels on all interactive elements', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('#TRD-E2E')).tap();
    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('📹 Upload Evidence')).tap();
    await waitFor(element(by.text('Upload Evidence')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Check accessibility labels on key elements
    await detoxExpect(element(by.label('Go back'))).toExist();
    await detoxExpect(element(by.label('Video evidence type'))).toExist();
    await detoxExpect(element(by.label('Photo evidence type'))).toExist();
  });

  it('has proper accessibility state on disabled upload button', async () => {
    await waitFor(element(by.text('🌾 Trades')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('#TRD-E2E')).tap();
    await waitFor(element(by.text('Trade Detail')))
      .toBeVisible()
      .withTimeout(TIMEOUT);
    await element(by.text('📹 Upload Evidence')).tap();
    await waitFor(element(by.text('Upload Evidence')))
      .toBeVisible()
      .withTimeout(TIMEOUT);

    // Upload button should not be visible without capture
    await detoxExpect(element(by.text('☁️ Upload Video'))).not.toExist();
  });
});
