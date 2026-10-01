import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { loadOptions, BASE_URL } from './options.js';

export const options = loadOptions;

const adminListTrend = new Trend('admin_list_duration');
const adminReconcileTrend = new Trend('admin_reconcile_duration');
const errorRate = new Rate('errors');

// By default we use the staging admin wallet if none provided,
// but the test should supply ADMIN_WALLET environment variable.
const ADMIN_WALLET = __ENV.ADMIN_WALLET || 'GBZ45G6J...';

function generateAdminToken(walletAddress) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = btoa(JSON.stringify({
    walletAddress,
    jti: `k6-${__VU}-${Date.now()}`,
    iss: 'amana',
    aud: 'amana-api',
    iat: now,
    exp: now + 3600,
    tier: 'admin'
  }));
  const signature = btoa(`fake-sig-${walletAddress}`);
  return `${header}.${payload}.${signature}`;
}

export default function () {
  const token = generateAdminToken(ADMIN_WALLET);
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  group('Admin Streams', function () {
    group('List Streams', function () {
      const res = http.get(`${BASE_URL}/admin/streams?page=1&limit=50`, { headers });
      const isOk = check(res, {
        'list streams status 200/403': (r) => r.status === 200 || r.status === 403,
      });
      adminListTrend.add(res.timings.duration);
      errorRate.add(!isOk);
    });

    sleep(1);

    group('Reconcile Stream', function () {
      const streamId = "test-stream-id-123";
      const res = http.post(`${BASE_URL}/admin/streams/${streamId}/reconcile`, JSON.stringify({}), { headers });
      const isOk = check(res, {
        'reconcile stream status 200/404/403': (r) => r.status === 200 || r.status === 404 || r.status === 403,
      });
      adminReconcileTrend.add(res.timings.duration);
      errorRate.add(!isOk);
    });
  });

  sleep(2);
}
