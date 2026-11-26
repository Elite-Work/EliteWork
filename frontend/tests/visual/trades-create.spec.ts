/**
 * Visual regression test — Create Trade page (/trades/create), blank form state.
 *
 * Covers:
 *  - Step 1 (Details) with no input entered, unauthenticated.
 *
 * Runs in both chromium-desktop and chromium-mobile projects
 * (configured via playwright.config.ts testMatch).
 */

import { test, expect } from './fixtures';

test.describe('Create Trade — blank form', () => {
  test('blank details form matches snapshot', async ({ publicPage: page }) => {
    await page.goto('/trades/create');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('h1')).toHaveText('Create Trade');

    const card = page.locator('.bg-bg-card').first();
    await expect(card).toHaveScreenshot('trades-create-blank-form.png');
  });
});
