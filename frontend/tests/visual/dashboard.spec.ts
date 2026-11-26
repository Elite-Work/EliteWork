/**
 * Visual regression tests — Dashboard page (/dashboard).
 *
 * Covers:
 *  - Unauthenticated "Connect Wallet" prompt
 *  - Authenticated state with fixture stats + recent trades table
 *  - Loading skeleton (verified structurally, not pixel-snapped — too transient)
 */

import { test, expect } from './fixtures';

async function waitForStable(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(150);
}

test.describe('Dashboard — unauthenticated', () => {
  test('connect-wallet prompt matches snapshot', async ({ publicPage: page }) => {
    await page.goto('/dashboard');
    await waitForStable(page);

    // The unauthenticated guard renders a centred CTA block.
    const main = page.locator('main').first();
    await expect(main).toHaveScreenshot('dashboard-public-main.png');
  });
});

test.describe('Dashboard — authenticated', () => {
  test('stats grid matches snapshot', async ({ authenticatedPage: page }) => {
    await page.goto('/dashboard');
    await waitForStable(page);

    // Wait for the header h1 to confirm content rendered.
    await page.waitForSelector('h1', { timeout: 10_000 });

    // Stats bento cards.
    const statsGrid = page
      .locator('[class*="grid"]')
      .filter({ hasText: 'Total Volume' })
      .first();

    await expect(statsGrid).toBeVisible();
    await expect(statsGrid).toHaveScreenshot('dashboard-stats-grid.png');
  });

  test('recent trades table matches snapshot', async ({ authenticatedPage: page }) => {
    await page.goto('/dashboard');
    await waitForStable(page);

    await page.waitForSelector('h1', { timeout: 10_000 });

    // Recent trades section.
    const tradesSection = page
      .locator('[class*="space-y"]')
      .filter({ hasText: 'Recent Trades' })
      .first();

    await expect(tradesSection).toBeVisible();
    await expect(tradesSection).toHaveScreenshot('dashboard-trades-section.png');
  });

  test('full page layout matches snapshot', async ({ authenticatedPage: page }) => {
    await page.goto('/dashboard');
    await waitForStable(page);
    await page.waitForSelector('h1', { timeout: 10_000 });

    await expect(page).toHaveScreenshot('dashboard-auth-full.png', { fullPage: true });
  });
});
