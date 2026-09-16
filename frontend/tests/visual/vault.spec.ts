/**
 * Visual regression tests — Vault pages.
 *
 * Covers:
 *  - /vault  (overview, unauthenticated state)
 *  - /vault  (overview, authenticated + fixture data)
 *  - /vault/manage (authenticated)
 *
 * Each test runs in both chromium-desktop and chromium-mobile projects
 * (configured via playwright.config.ts testMatch).
 */

import { test, expect, FIXTURES } from './fixtures';

// Wait helper: page has settled and no pending network activity.
async function waitForStable(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  // Allow one extra frame for layout paint to flush.
  await page.waitForTimeout(150);
}

test.describe('Vault Overview — unauthenticated', () => {
  test('full page layout matches snapshot', async ({ publicPage: page }) => {
    await page.goto('/vault');
    await waitForStable(page);

    // Unauthenticated state shows the wallet-connect prompt area.
    const main = page.locator('main, section').first();
    await expect(main).toHaveScreenshot('vault-public-main.png');
  });

  test('vault hero section spacing matches snapshot', async ({ publicPage: page }) => {
    await page.goto('/vault');
    await waitForStable(page);

    await expect(page).toHaveScreenshot('vault-public-full.png', { fullPage: true });
  });
});

test.describe('Vault Overview — authenticated', () => {
  test('vault hero and value card match snapshot', async ({ authenticatedPage: page }) => {
    await page.goto('/vault');
    await waitForStable(page);

    const main = page.locator('main, section').first();
    await expect(main).toHaveScreenshot('vault-auth-main.png');
  });

  test('vault stats cards layout matches snapshot', async ({ authenticatedPage: page }) => {
    await page.goto('/vault');
    await waitForStable(page);

    // Full page with fixture data — stable because API routes return fixed data.
    await expect(page).toHaveScreenshot('vault-auth-full.png', { fullPage: true });
  });

  test('vault partner network row matches snapshot', async ({ authenticatedPage: page }) => {
    await page.goto('/vault');
    await waitForStable(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(100);

    // Capture just the partner network section if it has a stable locator.
    const partnerSection = page.locator('text=Partner network').locator('..').locator('..');
    if (await partnerSection.isVisible()) {
      await expect(partnerSection).toHaveScreenshot('vault-partner-network.png');
    }
  });
});

test.describe('Vault Manage — authenticated', () => {
  test('vault manage page layout matches snapshot', async ({ authenticatedPage: page }) => {
    // Mock the manage-page specific API calls.
    await page.route('http://localhost:4000/trades?**', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [...FIXTURES.trades],
          pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
        }),
      }),
    );

    await page.goto('/vault/manage');
    await waitForStable(page);

    const main = page.locator('main, section').first();
    await expect(main).toHaveScreenshot('vault-manage-main.png');
  });
});
