import { test, expect } from './fixtures';

test('Settings page matches the authenticated snapshot', async ({ authenticatedPage: page }) => {
  await page.goto('/settings');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible();

  const settingsPage = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Settings', level: 1 }) })
    .first();
  await expect(settingsPage).toHaveScreenshot('settings-auth-page.png');
});