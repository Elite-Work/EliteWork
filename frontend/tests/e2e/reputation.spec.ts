import { expect, test, type Page } from '@playwright/test';

const API = 'http://localhost:4000';
const WALLET_ADDRESS = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA001';

const REPUTATION = {
  trustScore: 92,
  totalTrades: 12,
  completedTrades: 11,
  disputedTrades: 1,
  successRate: 91.7,
  history: [
    {
      id: 'evt-001',
      event: 'Trade completed successfully',
      impact: 5,
      impactLabel: '+5',
      timestamp: '2026-01-15T12:00:00.000Z',
      type: 'trade_completed',
    },
    {
      id: 'evt-002',
      event: 'Dispute resolved in your favour',
      impact: -3,
      impactLabel: '-3',
      timestamp: '2026-01-10T12:00:00.000Z',
      type: 'dispute_resolved',
    },
  ],
};

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

async function seedWallet(page: Page) {
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
    { token: testJwt(WALLET_ADDRESS), addr: WALLET_ADDRESS },
  );
}

test.describe('Reputation page', () => {
  test('prompts unauthenticated users to connect a wallet', async ({ page }) => {
    await page.goto('/reputation');

    await expect(page.getByRole('heading', { name: 'Connect Wallet' })).toBeVisible();
  });

  test('displays trust score and trade metrics', async ({ page }) => {
    await seedWallet(page);
    await page.route(`${API}/users/me/reputation`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(REPUTATION),
      }),
    );

    await page.goto('/reputation');

    await expect(page.getByRole('heading', { name: 'Reputation', exact: true })).toBeVisible();
    await expect(page.getByText('Trust Score', { exact: true })).toBeVisible();
    await expect(page.getByText('92', { exact: true })).toBeVisible();
    await expect(page.getByText('out of 100')).toBeVisible();

    for (const [title, value] of [
      ['Total Trades', '12'],
      ['Completed', '11'],
      ['Disputed', '1'],
      ['Success Rate', '91.7%'],
    ]) {
      const card = page.locator('div.bg-bg-elevated', { has: page.getByRole('heading', { name: title, exact: true }) });
      await expect(card.getByText(value, { exact: true })).toBeVisible();
    }
  });

  test('renders trust history events with impact and date', async ({ page }) => {
    await seedWallet(page);
    await page.route(`${API}/users/me/reputation`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(REPUTATION),
      }),
    );

    await page.goto('/reputation');

    await expect(page.getByRole('heading', { name: 'Trust History' })).toBeVisible();
    const first = page.locator('div.py-3', { hasText: 'Trade completed successfully' });
    await expect(first.getByText('+5', { exact: true })).toBeVisible();
    await expect(first.getByText(/Jan 1[45], 2026/)).toBeVisible();

    const second = page.locator('div.py-3', { hasText: 'Dispute resolved in your favour' });
    await expect(second.getByText('-3', { exact: true })).toBeVisible();
    await expect(page.locator('div.py-3')).toHaveCount(2);
  });

  test('shows empty state when there is no trust history', async ({ page }) => {
    await seedWallet(page);
    await page.route(`${API}/users/me/reputation`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...REPUTATION, history: [] }),
      }),
    );

    await page.goto('/reputation');

    await expect(
      page.getByText('No reputation events yet. Complete trades to build your trust history.'),
    ).toBeVisible();
  });
});
