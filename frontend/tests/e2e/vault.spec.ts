import { expect, test, type Page } from '@playwright/test';

const BUYER_ADDRESS = 'GDNM7WSJ7VIUVK2TSZ2OQES5XR2663TZEIBFXRDT56B5IRLHERVWSXMU';
const SELLER_ADDRESS = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI';
const API = 'http://localhost:4000';

function testJwt(walletAddress: string) {
  const payload = { exp: Math.floor(Date.now() / 1000) + 60 * 60, walletAddress };
  return [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    'e2e',
  ].join('.');
}

function trade(i: number, status: string) {
  return {
    tradeId: `trade-${i}-aaaaaaaaaaaa`,
    buyerAddress: BUYER_ADDRESS,
    sellerAddress: SELLER_ADDRESS,
    amountCngn: '1000',
    buyerLossBps: 0,
    sellerLossBps: 0,
    status,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };
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
        signMessage: async () => ({ signedMessage: 'signed-message' }),
        signTransaction: async (xdr: string) => ({ signedTxXdr: `signed-${xdr}` }),
      };
      Object.assign(window, { freighter, freighterApi: freighter });
    },
    { token: testJwt(BUYER_ADDRESS), addr: BUYER_ADDRESS },
  );
}

async function mockVaultApi(page: Page, items: ReturnType<typeof trade>[], balance = '2500.50') {
  const requests: string[] = [];
  await page.route(`${API}/wallet/balance`, (route) =>
    route.fulfill({ json: { balance, asset: 'cNGN' } }),
  );
  await page.route(`${API}/trades/stats`, (route) =>
    route.fulfill({ json: { totalTrades: items.length, totalVolume: 12345, openTrades: items.length } }),
  );
  await page.route(`${API}/trades?*`, (route) => {
    requests.push(route.request().url());
    return route.fulfill({
      json: {
        items,
        pagination: { page: 1, limit: items.length, total: items.length, totalPages: 1 },
      },
    });
  });
  return requests;
}

test.describe('Vault overview (/vault)', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthenticatedWallet(page);
  });

  test('shows wallet balance and vault value', async ({ page }) => {
    await mockVaultApi(page, [trade(1, 'ACTIVE')]);
    await page.goto('/vault');

    await expect(page.getByRole('heading', { name: 'Vault Overview' })).toBeVisible();
    await expect(page.getByText('Balance:')).toContainText('2500.50 cNGN');
    await expect(page.getByText('Authenticated')).toBeVisible();
  });

  test('activity feed shows the most recent trades, capped at three', async ({ page }) => {
    const requests = await mockVaultApi(page, [
      trade(1, 'ACTIVE'),
      trade(2, 'PENDING'),
      trade(3, 'LOCKED'),
      trade(4, 'COMPLETED'),
      trade(5, 'CANCELLED'),
    ]);
    await page.goto('/vault');

    await expect(page.getByText('Audit Log')).toBeVisible();
    await expect(page.getByText('Trade active')).toBeVisible();
    await expect(page.getByText('Trade pending')).toBeVisible();
    await expect(page.getByText('Trade locked')).toBeVisible();
    await expect(page.getByText('Trade completed')).toHaveCount(0);
    // The overview asks the API for a single page of five.
    expect(requests.some((u) => new URL(u).searchParams.get('limit') === '5')).toBe(true);
  });

  test('shows empty state when there are no trades', async ({ page }) => {
    await mockVaultApi(page, []);
    await page.goto('/vault');

    await expect(page.getByText('No trades yet. Create a trade to get started.')).toBeVisible();
    await expect(page.getByText('No recent activity')).toBeVisible();
  });
});

test.describe('Vault deposit flow initiation (/vault/manage)', () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthenticatedWallet(page);
  });

  test('deposit opens a confirmation modal and posts the deposit request', async ({ page }) => {
    await mockVaultApi(page, [trade(1, 'PENDING')]);
    let depositCalled = false;
    await page.route(`${API}/trades/trade-1-aaaaaaaaaaaa/deposit`, (route) => {
      depositCalled = true;
      return route.fulfill({ json: { unsignedXdr: 'AAAA' } });
    });
    await page.goto('/vault/manage');

    await page.getByRole('button', { name: 'Deposit' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Confirm Deposit' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Confirm' }).click();
    await expect(page.getByText('Deposit transaction prepared — sign in Freighter.')).toBeVisible();
    expect(depositCalled).toBe(true);
  });

  test('cancelling the modal does not send a deposit request', async ({ page }) => {
    await mockVaultApi(page, [trade(1, 'PENDING')]);
    let depositCalled = false;
    await page.route(`${API}/trades/*/deposit`, (route) => {
      depositCalled = true;
      return route.fulfill({ json: { unsignedXdr: 'AAAA' } });
    });
    await page.goto('/vault/manage');

    await page.getByRole('button', { name: 'Deposit' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(depositCalled).toBe(false);
  });

  test('deposit is disabled when the wallet balance is zero', async ({ page }) => {
    await mockVaultApi(page, [trade(1, 'PENDING')], '0');
    await page.goto('/vault/manage');

    await expect(page.getByText(/No available balance/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Deposit' })).toBeDisabled();
  });

  test('release (withdraw) opens its confirmation modal for an active trade', async ({ page }) => {
    await mockVaultApi(page, [trade(1, 'ACTIVE')]);
    await page.goto('/vault/manage');

    await page.getByRole('button', { name: 'Release' }).click();
    await expect(page.getByRole('dialog').getByRole('heading', { name: 'Release Funds' })).toBeVisible();
  });
});
