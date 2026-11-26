import { expect, test, type Page } from '@playwright/test';

const BUYER_ADDRESS = 'GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU';
const SELLER_ADDRESS = 'GA4T33YK6H6D5E7ZQY5W3J2L7F8K9B0N1M2P3Q4R5S6T7U8V9W0X1Y2Z3';

const TRADES = [
  { tradeId: 'aaaaaaaa-1111', status: 'active', amountCngn: '1000' },
  { tradeId: 'bbbbbbbb-2222', status: 'pending', amountCngn: '2000' },
  { tradeId: 'cccccccc-3333', status: 'completed', amountCngn: '3000' },
].map((t) => ({
  ...t,
  buyerAddress: BUYER_ADDRESS,
  sellerAddress: SELLER_ADDRESS,
  buyerLossBps: 5000,
  sellerLossBps: 5000,
  createdAt: new Date().toISOString(),
}));

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

async function seedAuthenticatedWallet(page: Page, address = BUYER_ADDRESS) {
  await page.addInitScript(
    ({ token, addr }) => {
      window.sessionStorage.setItem('amana_jwt', token);
      const freighter = {
        isConnected: async () => ({ isConnected: true }),
        isAllowed: async () => ({ isAllowed: true }),
        getAddress: async () => ({ address: addr }),
        requestAccess: async () => ({ address: addr }),
        signMessage: async () => ({ signedMessage: 'signed-message' }),
        signTransaction: async (xdr: string) => ({ signedTxXdr: `signed-${xdr}` }),
      };
      Object.assign(window, { freighter, freighterApi: freighter });
    },
    { token: testJwt(address), addr: address },
  );
}

/** Mocks GET /trades honouring the `status` filter; records every requested URL. */
async function mockTradeList(page: Page, items = TRADES) {
  const requests: URL[] = [];
  await page.route(/localhost:4000\/trades\?/, async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const status = url.searchParams.get('status');
    const q = url.searchParams.get('q');
    const filtered = items.filter(
      (t) => (!status || t.status === status) && (!q || t.tradeId.includes(q)),
    );
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: filtered,
        pagination: { page: 1, limit: 100, total: filtered.length, totalPages: 1 },
      }),
    });
  });
  return requests;
}

test.describe('Trades page', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthenticatedWallet(page);
  });

  test('lists trades with their statuses', async ({ page }) => {
    await mockTradeList(page);
    await page.goto('/trades');

    await expect(page.getByRole('link', { name: /^aaaaaaaa/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^bbbbbbbb/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^cccccccc/ })).toBeVisible();
    await expect(page.getByText('1000 cNGN')).toBeVisible();
  });

  test('shows the empty state when there are no trades', async ({ page }) => {
    await mockTradeList(page, []);
    await page.goto('/trades');

    await expect(page.getByRole('heading', { name: 'No trades yet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Create Your First Trade' })).toBeVisible();
  });

  test('shows an error when the list request fails', async ({ page }) => {
    await page.route(/localhost:4000\/trades\?/, (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'boom' }),
      }),
    );
    await page.goto('/trades');

    await expect(page.getByRole('link', { name: /^aaaaaaaa/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'No trades yet' })).toHaveCount(0);
  });

  test('status filter tabs narrow the list', async ({ page }) => {
    const requests = await mockTradeList(page);
    await page.goto('/trades');
    await expect(page.getByRole('link', { name: /^aaaaaaaa/ })).toBeVisible();

    await page.getByRole('tab', { name: 'Pending' }).click();

    await expect(page.getByRole('tab', { name: 'Pending' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('link', { name: /^bbbbbbbb/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^aaaaaaaa/ })).toHaveCount(0);
    expect(requests.at(-1)?.searchParams.get('status')).toBe('pending');

    await page.getByRole('tab', { name: 'All' }).click();
    await expect(page.getByRole('link', { name: /^aaaaaaaa/ })).toBeVisible();
    expect(requests.at(-1)?.searchParams.has('status')).toBe(false);
  });

  test('search sends a debounced query and can be cleared from the empty state', async ({ page }) => {
    const requests = await mockTradeList(page);
    await page.goto('/trades');
    await expect(page.getByRole('link', { name: /^aaaaaaaa/ })).toBeVisible();

    await page.getByLabel('Search trades by commodity or counterparty').fill('bbbbbbbb');
    await expect(page.getByRole('link', { name: /^bbbbbbbb/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /^aaaaaaaa/ })).toHaveCount(0);
    expect(requests.at(-1)?.searchParams.get('q')).toBe('bbbbbbbb');

    await page.getByLabel('Search trades by commodity or counterparty').fill('nomatch');
    await expect(page.getByRole('heading', { name: 'No matching trades' })).toBeVisible();

    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(page.getByRole('link', { name: /^aaaaaaaa/ })).toBeVisible();
  });

  test('clicking a trade navigates to its detail page', async ({ page }) => {
    await mockTradeList(page);
    await page.route(/localhost:4000\/trades\/aaaaaaaa-1111$/, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(TRADES[0]),
      }),
    );
    await page.goto('/trades');

    await page.getByRole('link', { name: /^aaaaaaaa/ }).click();

    await expect(page).toHaveURL(/\/trades\/aaaaaaaa-1111$/);
  });

  test('Create Trade button navigates to the create page', async ({ page }) => {
    await mockTradeList(page);
    await page.goto('/trades');

    await page.getByRole('link', { name: 'Create Trade' }).click();

    await expect(page).toHaveURL(/\/trades\/create$/);
  });
});
