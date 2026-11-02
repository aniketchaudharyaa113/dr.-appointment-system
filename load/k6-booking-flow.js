import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 20 },  // Ramp-up to 20 virtual users
    { duration: '1m', target: 50 },   // Sustained load at 50 VUs
    { duration: '20s', target: 0 },   // Cool-down
  ],
  thresholds: {
    http_req_duration: ['p(95)<250'], // 95% of requests must complete below 250ms
    http_req_failed: ['rate<0.01'],    // Error rate must be under 1%
  },
};

const BASE_URL = __ENV.TARGET_URL || 'http://localhost:4000/api/v1';

export default function () {
  // Step 1: Browse doctors
  const doctorsRes = http.get(`${BASE_URL}/doctors?specialty=Cardiology`);
  check(doctorsRes, {
    'doctors listed successfully': (r) => r.status === 200,
  });

  sleep(1);

  // Step 2: Request 10-minute hold lease
  const holdPayload = JSON.stringify({
    doctorId: 'doc-1',
    slotTime: '2026-11-03T17:30:00+05:30',
  });
  const holdParams = {
    headers: { 'Content-Type': 'application/json' },
  };

  const holdRes = http.post(`${BASE_URL}/scheduling/hold`, holdPayload, holdParams);
  check(holdRes, {
    'hold response received': (r) => r.status === 200 || r.status === 409,
  });

  sleep(1);

  // Step 3: Simulate Fake Provider Payment Capture
  const paymentPayload = JSON.stringify({
    appointmentId: 'apt-k6-test',
    amountPaise: 100300,
    provider: 'FAKE',
  });
  const paymentRes = http.post(`${BASE_URL}/payments/capture-fake`, paymentPayload, holdParams);
  check(paymentRes, {
    'payment processed': (r) => r.status === 200 || r.status === 400,
  });

  sleep(1);
}
