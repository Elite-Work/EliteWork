/**
 * Visual regression tests — Reputation page.
 *
 * Covers:
 *  - /reputation  (unauthenticated state — wallet-connect prompt)
 *  - /reputation  (authenticated + fixture data — trust score, history)
 *
 * Each test runs in both chromium-desktop and chromium-mobile projects
 * (configured via playwright.config.ts testMatch).
 */

import { test, expect, FIXTURES } from './fixtures';

const API = 'http://localhost:4000';

const REPUTATION_FIXTURE = {
  trustScore: 92,
  totalTrades: 12,
  completedTrades: 11,
  disputedTrades: 1,
  successRate: 91.7,
  history: [
    {
      id: 'evt-fixture-001',
      event: 'Trade completed successfully',
      impact: 5,
      impactLabel: '+5',
      timestamp: '2026-01-15T10:00:00.000Z',
      type: 'trade_completed',
    },
    {
      id: 'evt-fixture-002',
      event: 'Dispute resolved in your favour',
      impact: 2,
      impactLabel: '+2',
      timestamp: '2026-01-10T08:00:00.000Z',
      type: 'dispute_resolved',
    },
  ],
};

async function waitForStable(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(150);
}

test.describe('Reputation Page — unauthenticated', () => {
  test('full page layout matches snapshot', async ({ publicPage: page }) => {
    await page.goto('/reputation');
    await waitForStable(page);

    await expect(page).toHaveScreenshot('reputation-public-full.png', { fullPage: true });
  });

  test('main content area matches snapshot', async ({ publicPage: page }) => {
    await page.goto('/reputation');
    await waitForStable(page);

    const main = page.locator('main, section').first();
    await expect(main).toHaveScreenshot('reputation-public-main.png');
  });
});

test.describe('Reputation Page — authenticated', () => {
  test.beforeEach(async ({ authenticatedPage: page }) => {
    await page.route(`${API}/users/me/reputation`, (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(REPUTATION_FIXTURE),
      }),
    );
    await page.route(`${API}/users/${FIXTURES.walletAddress}/reputation`, (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(REPUTATION_FIXTURE),
      }),
    );
  });

  test('trust score card matches snapshot', async ({ authenticatedPage: page }) => {
    await page.goto('/reputation');
    await waitForStable(page);

    const main = page.locator('main, section').first();
    await expect(main).toHaveScreenshot('reputation-auth-main.png');
  });

  test('full authenticated page matches snapshot', async ({ authenticatedPage: page }) => {
    await page.goto('/reputation');
    await waitForStable(page);

    await expect(page).toHaveScreenshot('reputation-auth-full.png', { fullPage: true });
  });

  test('reputation history section matches snapshot', async ({ authenticatedPage: page }) => {
    await page.goto('/reputation');
    await waitForStable(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(100);

    const historySection = page.locator('[data-testid="reputation-history"], text=History').locator('..').locator('..');
    if (await historySection.isVisible()) {
      await expect(historySection).toHaveScreenshot('reputation-history.png');
    }
  });
});
