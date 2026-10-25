/**
 * Visual regression tests — Cooperative pages.
 *
 * Covers:
 *  - /cooperative/bulk-import (unauthenticated state — connect wallet prompt)
 *  - /cooperative/bulk-import (authenticated state — CSV bulk import form)
 *  - /cooperative/bulk-import (authenticated state — bulk import result view)
 *  - /cooperative (redirect to /cooperative/bulk-import)
 *
 * Each test runs in both chromium-desktop and chromium-mobile projects
 * (configured via playwright.config.ts testMatch).
 */

import { test, expect } from './fixtures';

async function waitForStable(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(150);
}

test.describe('Cooperative Page — unauthenticated', () => {
  test('connect-wallet prompt matches snapshot', async ({ publicPage: page }) => {
    await page.goto('/cooperative/bulk-import');
    await waitForStable(page);

    await expect(page.getByRole('heading', { level: 1, name: 'Cooperative bulk import' })).toBeVisible();
    const main = page.locator('main').first();
    await expect(main).toHaveScreenshot('cooperative-public-main.png');
  });

  test('full unauthenticated page layout matches snapshot', async ({ publicPage: page }) => {
    await page.goto('/cooperative/bulk-import');
    await waitForStable(page);

    await expect(page.getByRole('heading', { level: 1, name: 'Cooperative bulk import' })).toBeVisible();
    await expect(page).toHaveScreenshot('cooperative-public-full.png', { fullPage: true });
  });

  test('navigating to /cooperative redirects to /cooperative/bulk-import', async ({ publicPage: page }) => {
    await page.goto('/cooperative');
    await page.waitForURL('**/cooperative/bulk-import', { timeout: 10_000 });
    await waitForStable(page);

    await expect(page.getByRole('heading', { level: 1, name: 'Cooperative bulk import' })).toBeVisible();
    expect(page.url()).toContain('/cooperative/bulk-import');
  });
});

test.describe('Cooperative Page — authenticated', () => {
  test('bulk import form matches snapshot', async ({ authenticatedPage: page }) => {
    await page.goto('/cooperative/bulk-import');
    await waitForStable(page);

    await expect(page.getByRole('heading', { level: 1, name: 'Cooperative bulk import' })).toBeVisible();
    await expect(page.locator('#bulk-csv')).toBeVisible();

    const main = page.locator('main').first();
    await expect(main).toHaveScreenshot('cooperative-auth-main.png');
  });

  test('full authenticated page matches snapshot', async ({ authenticatedPage: page }) => {
    await page.goto('/cooperative/bulk-import');
    await waitForStable(page);

    await expect(page.getByRole('heading', { level: 1, name: 'Cooperative bulk import' })).toBeVisible();
    await expect(page).toHaveScreenshot('cooperative-auth-full.png', { fullPage: true });
  });

  test('import result view matches snapshot', async ({ authenticatedPage: page }) => {
    await page.route('**/trades/bulk', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          created: [{ index: 0, tradeId: 'TRD-FIXTURE-0001', unsignedXdr: 'mock-xdr' }],
          failed: [],
        }),
      }),
    );

    await page.goto('/cooperative/bulk-import');
    await waitForStable(page);

    const submitBtn = page.getByRole('button', { name: /import 1 trade/i });
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    await expect(page.getByRole('heading', { level: 2, name: 'Result' })).toBeVisible();
    await waitForStable(page);

    const main = page.locator('main').first();
    await expect(main).toHaveScreenshot('cooperative-import-result.png');
  });
});
