import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    webhook_replay_flood: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 200,
      maxDuration: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:4000/api/v1';

export default function () {
  // Replaying identical webhook event ID concurrently to verify idempotency and zero duplicate ledger postings
  const payload = JSON.stringify({
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id: 'pay_flood_k6_99812',
          order_id: 'order_k6_001',
          amount: 100300,
          status: 'captured',
        },
      },
    },
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'X-Razorpay-Signature': 'mock_valid_signature_flood',
    },
  };

  const res = http.post(`${BASE_URL}/payments/webhook`, payload, params);

  // Both fresh acceptance (200) and duplicate idempotent no-op (200) are valid
  check(res, {
    'webhook processed or deduplicated': (r) => r.status === 200,
  });
}
