import { expect, test, type Page } from '@playwright/test';

const BUYER_ADDRESS = 'GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU';
const SELLER_ADDRESS = 'GA4T33YK6H6D5E7ZQY5W3J2L7F8K9B0N1M2P3Q4R5S6T7U8V9W0X1Y2Z3';
const TRADE_ID = 'TRADE-0001-DASH';

function testJwt(walletAddress: string) {
  const payload = {
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    walletAddress,
  };
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'e2e',
  ].join('.');
}

async function seedAuthenticatedWallet(page: Page) {
  await page.addInitScript(
    ({ token, addr }) => {
      window.sessionStorage.setItem('amana_jwt', token);
      const freighter = {
        isConnected: async () => ({ isConnected: true }),
        isAllowed: async () => ({ isAllowed: true }),
        getAddress: async () => ({ address: addr }),
        requestAccess: async () => ({ address: addr }),
      };
      Object.assign(window, { freighter, freighterApi: freighter });
    },
    { token: testJwt(BUYER_ADDRESS), addr: BUYER_ADDRESS },
  );
}

async function mockDashboardApi(page: Page, items: unknown[]) {
  await page.route('http://localhost:4000/trades/stats', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ totalTrades: 10, totalVolume: 125000, openTrades: 3 }),
    });
  });

  await page.route('http://localhost:4000/trades?**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items,
        pagination: { page: 1, limit: 5, total: items.length, totalPages: 1 },
      }),
    });
  });
}

test.describe('Dashboard E2E', () => {
  test('renders trade-stats tiles', async ({ page }) => {
    await seedAuthenticatedWallet(page);
    await mockDashboardApi(page, []);

    await page.goto('/dashboard');

    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText('Total Volume')).toBeVisible();
    await expect(page.getByText(/125,000 USDC/)).toBeVisible();
    await expect(page.getByText('Active Trades')).toBeVisible();
    await expect(page.getByText('Completed Trades')).toBeVisible();
    await expect(page.getByText('Total Trades', { exact: true })).toBeVisible();
    // 10 total - 3 open = 7 completed
    await expect(page.getByText('7', { exact: true })).toBeVisible();
  });

  test('shows the empty state when there are no recent trades', async ({ page }) => {
    await seedAuthenticatedWallet(page);
    await mockDashboardApi(page, []);

    await page.goto('/dashboard');

    await expect(page.getByText('No recent trades found.')).toBeVisible();
    await expect(page.getByRole('table')).toHaveCount(0);
  });

  test('lists recent trades and navigates to the trade detail page', async ({ page }) => {
    await seedAuthenticatedWallet(page);
    await mockDashboardApi(page, [
      {
        tradeId: TRADE_ID,
        buyerAddress: BUYER_ADDRESS,
        sellerAddress: SELLER_ADDRESS,
        amountCngn: '25000',
        buyerLossBps: 5000,
        sellerLossBps: 5000,
        status: 'active',
        createdAt: new Date().toISOString(),
      },
    ]);

    await page.route(`http://localhost:4000/trades/${TRADE_ID}`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tradeId: TRADE_ID,
          buyerAddress: BUYER_ADDRESS,
          sellerAddress: SELLER_ADDRESS,
          amountCngn: '25000',
          status: 'FUNDED',
          buyerLossBps: 5000,
          sellerLossBps: 5000,
          createdAt: new Date().toISOString(),
        }),
      });
    });

    await page.goto('/dashboard');

    const table = page.getByRole('table');
    await expect(table).toBeVisible();
    await expect(table.getByText('25000 cNGN')).toBeVisible();
    await expect(table.getByText('active')).toBeVisible();
    await expect(table.getByText(/GA4T33\.\.\.Y2Z3/)).toBeVisible();

    await table.getByRole('link', { name: `${TRADE_ID.substring(0, 8)}...` }).click();

    await expect(page).toHaveURL(new RegExp(`/trades/${TRADE_ID}$`));
  });
});
