import http from 'k6/http';
import crypto from 'k6/crypto';
import { check } from 'k6';

export const options = {
  scenarios: {
    webhook_replay_flood: {
      executor: 'shared-iterations',
      vus: 20,
      iterations: 100,
      maxDuration: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://nginx/api';
const WEBHOOK_SECRET =
  __ENV.PAYMENT_WEBHOOK_SECRET || 'dev_webhook_secret_DO_NOT_USE_IN_PROD';

export default function () {
  const payload = JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_k6_replay_flood_01',
          order_id: 'order_nonexistent_flood_test',
          amount: 80000,
          status: 'captured',
        },
      },
    },
  });

  const sig = crypto.hmac('sha256', WEBHOOK_SECRET, payload, 'hex');

  const res = http.post(`${BASE_URL}/payments/webhook`, payload, {
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': sig,
    },
  });

  // Valid signed webhook returns 200/201/404 (or 429 under nginx burst protection)
  check(res, {
    'signed webhook processed safely': (r) =>
      r.status === 200 || r.status === 201 || r.status === 404 || r.status === 429,
  });
}
